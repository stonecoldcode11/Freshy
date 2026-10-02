"""Mode 3: PriorityPulse predictive control.

Every second, for every intersection that is allowed to change:

1. predict arrivals (vehicles already in transit + expected flow);
2. for the emergency vehicle compute  ETA_j,  T_clear,  T_safe  and the proactive trigger
        t_trigger = ETA_j - (T_clear + T_safe + T_buffer);
3. enumerate candidate actions (hold, extend-then-switch, switch now), drop the ones that
   violate a hard constraint (min green, pedestrian clearance, max green, fairness cap,
   spillback guard, the emergency route), roll every survivor forward H seconds, and score it
   with the objective J(a);
4. apply only the first step of the cheapest action and repeat (receding horizon).

Hard safety constraints are never traded against cost: the signal state machine also refuses
any illegal request, so a bug here can make the controller *worse* but never *unsafe*.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

import numpy as np

from ..network import PHASE_NAMES
from .base import Controller
from .mpc import Candidate, NodeStatic, TrackedVehicle, build_static, rollout

if TYPE_CHECKING:  # pragma: no cover
    from ..simulator import Simulation

PRIORITY_MULT = {"routine": 0.6, "urgent": 1.0, "critical": 1.5}
PED_HARD_WAIT = 80.0            # a pedestrian call must be served within this many seconds
DETOUR_ARRIVAL_MARGIN = 1.4     # inflate forecast arrivals when judging whether a detour leaves enough time
DETOUR_EXTRA_VEH = 2.0          # ... plus a couple of vehicles of slack
FAIR_MARGIN = 32.0              # start forcing service this long before the hard fairness cap (clearance + start-up)


class PriorityPulseController(Controller):
    name = "prioritypulse"
    label = "PriorityPulse"
    guard = True

    # ------------------------------------------------------------------ setup
    def setup(self, sim: "Simulation") -> None:
        self.w = sim.cfg.weights
        self.statics: list[NodeStatic] = [build_static(sim, ni) for ni in range(len(sim.signals))]
        self.local_of: list[dict[tuple[int, int], int]] = []
        for ni, st in enumerate(self.statics):
            d = {}
            for loc, mid in enumerate(st.mids):
                mv = sim.net.movements[mid]
                d[(sim.li[mv.link], ("L", "T", "R").index(mv.kind))] = loc
            self.local_of.append(d)
        self.stop_of_node: dict[int, int] = {}
        if sim.ev:
            for j, s in enumerate(sim.ev.route.stops):
                self.stop_of_node[sim.node_idx[s.node]] = j
        self.latched: dict[int, bool] = {}
        self.plan: dict[int, dict[str, Any]] = {}
        self.logged: set[tuple] = set()
        self.last_extend_log = [-99.0] * len(sim.signals)
        self.guard_active: dict[str, bool] = {}
        self.release_t: dict[int, float] = {}
        self.cycle = sum(sim.sp.fixed_green) + 4 * (sim.sp.yellow + sim.sp.all_red)
        self.last_eval: dict[int, dict] = {}
        self.stats = {"evaluations": 0, "switches": 0, "preemptions": 0, "forced_fairness": 0}

    # ------------------------------------------------------------------ helpers
    def _phase_label(self, p: int) -> str:
        return PHASE_NAMES[p]

    @staticmethod
    def _cap(text: str) -> str:
        return text[:1].upper() + text[1:]

    def _mv_label(self, sim, mid: int) -> str:
        return sim.net.movements[mid].label(sim.net.compass)

    def _node_name(self, sim, ni: int) -> str:
        return sim.net.intersections[ni].name

    def _arrivals(self, sim: "Simulation", ni: int, t: int, H: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Predicted arrivals A^[k, m] (+ per own-link transit and cumulative arrivals)."""
        st = self.statics[ni]
        M = len(st.mids)
        A = np.zeros((H, M))
        idx = min(max(0, t + sim.warmup), len(sim.demand.lam) - 1)
        own_transit = np.zeros(len(st.own_links))
        cumA = np.zeros((H, len(st.own_links)))
        for oi, li in enumerate(st.own_links):
            lid = sim.link_ids[li]
            lk = sim.net.links[lid]
            pipe = np.array(list(sim.pipe[lid]), dtype=float).reshape(-1, 3)
            tau = pipe.shape[0]
            own_transit[oi] = sim.in_transit[li]
            for col in range(3):
                loc = self.local_of[ni][(li, col)]
                n_pipe = min(H, tau)
                A[:n_pipe, loc] = pipe[:n_pipe, col]
                if H > tau:
                    if lk.kind == "entry":
                        rate = float(sim.demand.lam[idx, sim.entry_col[lid], col])
                    else:
                        rate = sim.recent_inflow[lid] * lk.turn_base[col]
                    A[tau:, loc] = rate
            cols = [loc for loc in range(M) if st.own_of[loc] == oi]
            cumA[:, oi] = np.cumsum(A[:, cols].sum(axis=1))
        return A, own_transit, cumA

    def _room(self, sim: "Simulation", ni: int) -> np.ndarray:
        st = self.statics[ni]
        room = np.full(len(st.mids), 1e9)
        r_block = sim.phys.r_block
        for loc, mid in enumerate(st.mids):
            if sim.mv_out_exit[mid]:
                continue
            oi = sim.mv_out[mid]
            cap, occ = sim.cap_eff[oi], sim.occ[oi]
            if mid in sim.override_block:
                room[loc] = max(0.0, cap - occ)
            else:
                room[loc] = 0.0 if occ >= r_block * cap else max(0.0, cap - occ)
        return room

    # ------------------------------------------------------------------ emergency plan
    def _update_ev(self, sim: "Simulation", t: int) -> None:
        sim.override_block.clear()
        for sg in sim.signals:
            sg.ped_block = set()
        ev = sim.ev
        if ev is None or (ev.status == "done" and all(p is not None for p in ev.passed_at)):
            self._release_states(sim, t)
            return
        em = sim.cfg.emergency
        if t < ev.t_dispatch - em.notice_lead:
            return                                   # the signals have not been told about the call yet
        cum_delay = 0.0
        for j, stop in enumerate(ev.route.stops):
            ni = sim.node_idx[stop.node]
            sg = sim.signals[ni]
            mv = stop.movement
            passed = ev.passed_at[j]
            if passed is not None:
                continue
            eta_free_rel = max(0.0, ev.eta_free(j, t) - t)      # optimistic: can only arrive earlier than this
            eta_abs = ev.eta_free(j, t) + cum_delay              # ETA_j incl. expected upstream signal delay
            eta_rel = max(0.0, eta_abs - t)
            phase = mv.phase
            t_safe = sg.time_until_green(phase)
            st = self.statics[ni]
            loc = self.local_of[ni][(sim.mv_link[mv.idx], ("L", "T", "R").index(mv.kind))]
            s_m = mv.sat_flow * sim.r_s * sim.sat_fac[sim.mv_link[mv.idx]]
            if ev.joined and ev.j == j:
                ahead_est = float(ev.ahead)
                q_now = float(sim.Q[mv.idx])
            else:
                q_now = float(sim.Q[mv.idx])
                # vehicles that will join the queue during the safety transition
                lid = mv.link
                pipe = sim.pipe[lid]
                col = ("L", "T", "R").index(mv.kind)
                steps = int(math.ceil(t_safe))
                arr = sum(pipe[k][col] for k in range(min(steps, len(pipe))))
                if steps > len(pipe):
                    lk = sim.net.links[lid]
                    idx = min(max(0, t + sim.warmup), len(sim.demand.lam) - 1)
                    rate = (float(sim.demand.lam[idx, sim.entry_col[lid], col]) if lk.kind == "entry"
                            else sim.recent_inflow[lid] * lk.turn_base[col])
                    arr += rate * (steps - len(pipe))
                ahead_est = max(0.0, q_now + arr - em.ev_yield_threshold)
                if t_safe == 0.0:
                    ahead_est = max(0.0, q_now - em.ev_yield_threshold)
            if ahead_est > 0:
                t_clear = sim.phys.tau_startup + ahead_est / max(s_m, 0.05)
            else:
                t_clear = 0.0
            t_prep = t_clear + t_safe + em.t_buffer
            # The trigger uses the free-flow ETA: an over-estimated upstream delay must never make
            # preemption late (starting early only costs a few seconds of side-street green).
            trigger_in = eta_free_rel - t_prep            # t_trigger - t
            if eta_free_rel > em.lookahead_s and not self.latched.get(j):
                status = "far"
            elif trigger_in <= 0 or self.latched.get(j):
                if not self.latched.get(j):
                    self.latched[j] = True
                    self.stats["preemptions"] += 1
                status = "active"
            else:
                status = "pending"
            exp_delay = max(0.0, -trigger_in) if status == "active" and not (
                sg.state == "G" and sg.phase == phase) else 0.0
            ev.expected_delay[j] = exp_delay
            cum_delay += exp_delay
            self.plan[j] = {
                "j": j, "node": stop.node, "phase": phase, "mv": mv.id,
                "eta_rel": round(eta_rel, 1), "eta_free": round(eta_free_rel, 1), "eta_abs": round(eta_abs, 1),
                "queue": int(q_now),
                "ahead": round(ahead_est, 1), "t_clear": round(t_clear, 1), "t_safe": round(t_safe, 1),
                "t_buffer": em.t_buffer, "t_prep": round(t_prep, 1),
                "trigger_in": round(trigger_in, 1), "status": status,
                "exp_delay": round(exp_delay, 1), "ped_rem": round(sg.ped_remaining(), 1),
            }
            if status in ("pending", "active") and trigger_in < sg.ped_total() + 2.0:
                # not enough time left to finish a pedestrian interval: defer new walks that would
                # hold a conflicting phase (a walk already under way is never cut short)
                sg.ped_block = {pd.parallel_phase for pd in sg.peds if pd.parallel_phase != phase}
            if status == "active":
                sim.override_block.add(mv.idx)
                if sg.state == "G" and sg.phase == phase:
                    sim.pre_state[ni] = "hold"
                else:
                    sim.pre_state[ni] = "active"
                key = ("trigger", j)
                if key not in self.logged:
                    self.logged.add(key)
                    nm = self._node_name(sim, ni)
                    if sg.state == "G" and sg.phase == phase:
                        self._explain_emergency_hold(sim, ni, sg, t, j)
                    why = [f"ETA {eta_rel:.0f}s", f"queue ahead {ahead_est:.0f} veh → clearance {t_clear:.0f}s",
                           f"safe transition {t_safe:.0f}s", f"buffer {em.t_buffer:.0f}s"]
                    sim.add_event("preempt_start", stop.node,
                                  f"{nm}: preemption begins — ETA {eta_rel:.0f}s, needs {t_prep:.0f}s ({', '.join(why[1:])})",
                                  "info")
            elif status == "pending":
                sim.pre_state[ni] = "pending"
            else:
                sim.pre_state[ni] = "none"
        self._release_states(sim, t)

    def _release_states(self, sim: "Simulation", t: int) -> None:
        ev = sim.ev
        if ev is None:
            return
        em = sim.cfg.emergency
        for j, stop in enumerate(ev.route.stops):
            ni = sim.node_idx[stop.node]
            passed = ev.passed_at[j]
            if passed is None:
                continue
            dt_since = t - passed
            if dt_since < em.release_buffer:
                sim.pre_state[ni] = "release"
                sim.override_block.add(stop.movement.idx)
            elif dt_since < em.release_buffer + 25.0:
                if sim.pre_state[ni] in ("release", "hold", "active"):
                    key = ("release", j)
                    if key not in self.logged:
                        self.logged.add(key)
                        sim.add_event("preempt_release", stop.node,
                                      f"{self._node_name(sim, ni)}: emergency vehicle clear — restoring normal coordination",
                                      "info")
                sim.pre_state[ni] = "recovery"
            else:
                sim.pre_state[ni] = "none"

    # ------------------------------------------------------------------ main update
    def update(self, sim: "Simulation", t: int) -> None:
        self._update_ev(sim, t)
        for ni, sg in enumerate(sim.signals):
            if sg.state == "G":
                self._decide(sim, ni, sg, t)
        self._guard_events(sim, t)

    # ------------------------------------------------------------------ per-node decision
    def _decide(self, sim: "Simulation", ni: int, sg, t: int) -> None:
        j = self.stop_of_node.get(ni)
        ev = sim.ev
        latched_phase = None
        if ev is not None and j is not None and ev.passed_at[j] is None and self.latched.get(j):
            latched_phase = ev.route.stops[j].movement.phase
        if latched_phase is not None and sg.phase == latched_phase:
            return                                              # hold the emergency green
        if not sg.can_switch():
            if latched_phase is not None and (ni, "wait", j) not in self.logged:
                self.logged.add((ni, "wait", j))
                why = "pedestrian clearance" if sg.ped_remaining() > 0 else "minimum green"
                sim.add_event("preempt_wait", sg.node.id,
                              f"{self._node_name(sim, ni)}: preemption waits for {why} "
                              f"({sg.time_to_legal_switch():.0f}s) — hard safety constraint", "info")
            return
        ctx = self._context(sim, ni, sg, t)
        cands, removed, forced = self._candidates(sim, ni, sg, t, ctx, latched_phase)
        if len(cands) == 1 and cands[0].kind == "hold" and not forced:
            self._maybe_log_hold(sim, ni, sg, t, ctx)
            return
        res = self._evaluate(sim, ni, sg, ctx, cands)
        costs = res["total"]
        best = int(np.argmin(costs))
        # prefer holding on ties (avoid pointless phase changes)
        hold_i = next((i for i, c in enumerate(cands) if c.kind == "hold"), None)
        if hold_i is not None and costs[hold_i] <= costs[best] + 1e-9:
            best = hold_i
        chosen = cands[best]
        self.stats["evaluations"] += 1
        self.last_eval[ni] = {"t": t, "best": chosen.label, "cost": float(costs[best])}
        if chosen.kind == "switch" and chosen.start == 0:
            if sg.request_switch(chosen.target, t):
                self.stats["switches"] += 1
                sim.add_decision(self._explain_switch(sim, ni, sg, t, ctx, cands, res, best, removed, forced, latched_phase))
        else:
            self._maybe_log_hold(sim, ni, sg, t, ctx, cands, res, best, removed)

    # ------------------------------------------------------------------ candidate generation
    def _candidates(self, sim, ni, sg, t, ctx, latched_phase):
        w = self.w
        P = sg.n_phases
        cur = sg.phase
        removed: list[dict] = []
        forced: str | None = None
        cands: list[Candidate] = [Candidate("hold", None, 10 ** 6, "Hold current green")]
        for p in range(P):
            if p == cur:
                continue
            for tau in w.switch_delays:
                label = (f"Switch to {self._phase_label(p).lower()} now" if tau == 0
                         else f"Extend {self._phase_label(cur).lower()} {tau}s, then {self._phase_label(p).lower()}")
                cands.append(Candidate("switch", p, tau, label))
        ph_demand = ctx["phase_demand"]
        # 1. skip phases with no demand at all
        keep = []
        for c in cands:
            if c.kind == "switch" and ph_demand[c.target] <= 0 and c.target not in ctx["ped_phases"]:
                removed.append({"label": c.label, "why": "no vehicles or pedestrians waiting"})
                continue
            keep.append(c)
        cands = keep
        # 2. maximum green reached: must leave if anything else wants service
        if sg.timer >= sg.g_max(cur) and any(c.kind == "switch" for c in cands) and latched_phase is None:
            cands = [c for c in cands if c.kind == "switch" and c.start == 0]
            removed.append({"label": "Hold / extend", "why": f"maximum green {sg.g_max(cur):.0f}s reached"})
        # 3. spillback guard: do not extend a green whose traffic cannot move
        if ctx["blocked_all"] and any(c.kind == "switch" for c in cands) and latched_phase is None:
            cands = [c for c in cands if c.kind == "switch" and c.start == 0]
            removed.append({"label": "Hold / extend", "why": ctx["blocked_text"]})
            forced = forced or "guard"
        # 4. hard anti-starvation (vehicles and pedestrians)
        starve = ctx["starved_phase"]
        if starve is not None and starve != cur and latched_phase is None:
            tgt = [c for c in cands if c.kind == "switch" and c.target == starve and c.start == 0]
            if tgt:
                cands = tgt
                forced = "fairness"
        # 5. emergency route: preempt now, or only make detours that still leave time
        if latched_phase is not None:
            tgt = [c for c in cands if c.kind == "switch" and c.target == latched_phase and c.start == 0]
            if not tgt:
                tgt = [Candidate("switch", latched_phase, 0, f"Emergency preemption: {self._phase_label(latched_phase).lower()} green now")]
                cands = cands + tgt
            for c in tgt:
                c.label = f"Emergency preemption: {self._phase_label(latched_phase).lower()} green now"
                c.tags.append("emergency")
            cands = tgt
            forced = "emergency"
        elif ctx["ev_pending"] is not None:
            pl = ctx["ev_pending"]
            ev_phase = pl["phase"]
            y, r = sg.p.yellow, sg.p.all_red
            keep = []
            for c in cands:
                if c.kind == "switch" and c.target != ev_phase:
                    back = c.start + y + r + sg.g_min(c.target) + y + r   # earliest return to the EV phase
                    # While the EV phase is red its queue keeps growing, so the clearance time after the
                    # detour is longer than the clearance time now.
                    # forecast + safety margin: surges arrive faster than the smoothed rate predicts, and a
                    # wrong guess costs the emergency vehicle seconds but a cautious one costs side streets little
                    grown = pl["queue"] + DETOUR_ARRIVAL_MARGIN * self._arrivals_within(ctx, pl["loc"], back, sim) + DETOUR_EXTRA_VEH
                    ahead = max(0.0, grown - sim.cfg.emergency.ev_yield_threshold)
                    clear_after = (sim.phys.tau_startup + ahead / pl["s_m"]) if ahead > 0 else 0.0
                    if back + clear_after + pl["t_buffer"] > pl["eta_free"]:
                        removed.append({"label": c.label, "why": (
                            f"the emergency phase would be red for {back:.0f}s; the queue ahead (now {pl['queue']}) "
                            f"would grow to ~{grown:.0f} and need ~{clear_after:.0f}s to clear, leaving too little "
                            f"time before the vehicle arrives in {pl['eta_free']:.0f}s")})
                        continue
                keep.append(c)
            cands = keep or [Candidate("hold", None, 10 ** 6, "Hold current green")]
        if not cands:
            cands = [Candidate("hold", None, 10 ** 6, "Hold current green")]
        return cands, removed, forced

    @staticmethod
    def _arrivals_within(ctx: dict[str, Any], loc: int, seconds: float, sim: "Simulation") -> float:
        """Predicted vehicles joining movement ``loc`` in the next ``seconds`` (rate extended past the horizon)."""
        A = ctx["A"][:, loc]
        n = int(math.ceil(seconds))
        total = float(A[: min(n, len(A))].sum())
        if n > len(A):
            total += float(A[-3:].mean()) * (n - len(A))
        return total

    # ------------------------------------------------------------------ context for rollouts and explanations
    def _context(self, sim: "Simulation", ni: int, sg, t: int) -> dict[str, Any]:
        st = self.statics[ni]
        H = self.w.horizon
        M = len(st.mids)
        mids = st.mids
        A, own_transit, cumA = self._arrivals(sim, ni, t, H)
        Q0 = np.array([sim.Q[m] for m in mids], dtype=float)
        wait0 = np.array([sim.wait[m] for m in mids], dtype=float)
        gel0 = np.array([sim.gel[m] for m in mids], dtype=float)
        credit0 = np.array([sim.credit[m] for m in mids], dtype=float)
        s_eff = np.array([sim.net.movements[m].sat_flow * sim.r_s * sim.sat_fac[sim.mv_link[m]] for m in mids])
        room = self._room(sim, ni)
        own_cap = np.array([sim.cap_eff[li] for li in st.own_links], dtype=float)
        down_cap = np.array([sim.cap_eff[li] for li in st.down_links], dtype=float)
        down_occ = np.array([sim.occ[li] for li in st.down_links], dtype=float)
        peds = sg.peds
        ped_pending = np.array([pd.call for pd in peds], dtype=bool)
        ped_wait = np.array([pd.wait for pd in peds], dtype=float)
        ped_phase = np.array([pd.parallel_phase for pd in peds], dtype=int)

        cur = sg.phase
        ph_demand = [0.0] * sg.n_phases
        for loc in range(M):
            ph_demand[int(st.phase_of[loc])] += Q0[loc] + A[:, loc].sum()

        # --- spillback guard status of the current phase -----------------------------------
        guard_blocked = []
        any_demand = False
        r_block = sim.phys.r_block
        for loc, mid in enumerate(mids):
            if st.phase_of[loc] != cur or sim.mv_out_exit[mid]:
                if st.phase_of[loc] == cur and Q0[loc] + A[:3, loc].sum() > 0:
                    any_demand = True
                continue
            if Q0[loc] + A[:3, loc].sum() > 0:
                any_demand = True
                oi = sim.mv_out[mid]
                if sim.occ[oi] >= r_block * sim.cap_eff[oi] and mid not in sim.override_block:
                    guard_blocked.append((mid, oi))
        movers = [loc for loc in range(M) if st.phase_of[loc] == cur and Q0[loc] + A[:3, loc].sum() > 0]
        blocked_all = bool(movers) and len(guard_blocked) == len(movers) and any_demand
        blocked_text = ""
        if guard_blocked:
            mid, oi = guard_blocked[0]
            blocked_text = (f"Spillback protection: {sim.link_ids[oi]} is {100 * sim.occ[oi] / max(1, sim.cap_eff[oi]):.0f}% full "
                            f"(limit {100 * r_block:.0f}%) — green extension denied")

        # --- hard fairness / pedestrian starvation -----------------------------------------------
        cap = self.w.t_max_allowed
        starved_phase = None
        starved_text = ""
        worst = -1.0
        for loc in range(M):
            if Q0[loc] > 0 and wait0[loc] >= cap - FAIR_MARGIN and wait0[loc] > worst:
                worst = wait0[loc]
                starved_phase = int(st.phase_of[loc])
                starved_text = (f"{self._cap(self._mv_label(sim, mids[loc]))} has waited {wait0[loc]:.0f}s "
                                f"(cap {cap:.0f}s) — anti-starvation forces service")
        for pd in peds:
            if pd.call and pd.wait >= PED_HARD_WAIT and pd.wait > worst:
                worst = pd.wait
                starved_phase = pd.parallel_phase
                starved_text = f"A pedestrian has waited {pd.wait:.0f}s — crossing must be served"

        # --- tracked priority vehicles at this node ---------------------------------------------------
        tracked: list[TrackedVehicle] = []
        buses: list[dict[str, Any]] = []
        ev_pending = None
        ev = sim.ev
        j_ev = self.stop_of_node.get(ni)
        w = self.w
        if ev is not None and j_ev is not None and ev.passed_at[j_ev] is None:
            pl = self.plan.get(j_ev)
            if pl is not None and pl["status"] != "far":
                stop = ev.route.stops[j_ev]
                loc = self.local_of[ni][(sim.mv_link[stop.movement.idx], ("L", "T", "R").index(stop.movement.kind))]
                eta_next = min((p["eta_rel"] for p in self.plan.values()), default=pl["eta_rel"])
                wev = (w.w_ev_base + (w.w_ev_critical if eta_next <= sim.cfg.emergency.t_critical else 0.0)) \
                    * PRIORITY_MULT.get(ev.priority, 1.0)
                if pl["eta_rel"] < H:
                    tracked.append(TrackedVehicle(loc, pl["eta_rel"], sim.cfg.emergency.ev_yield_threshold, wev, "ev",
                                                  ev.joined and ev.j == j_ev, ev.ahead if ev.joined else 0))
                if pl["status"] == "pending" and not self.latched.get(j_ev):
                    ev_pending = dict(pl)
                    ev_pending["loc"] = loc
                    ev_pending["s_m"] = max(0.05, float(s_eff[loc]))
        for pv in sim.pvs:
            if pv.kind != "bus" or pv.status == "done":
                continue
            for jb, stop in enumerate(pv.route.stops):
                if sim.node_idx[stop.node] != ni or pv.passed_at[jb] is not None:
                    continue
                eta = pv.eta_free(jb, t) - t
                if 0 <= eta < H:
                    loc = self.local_of[ni][(sim.mv_link[stop.movement.idx], ("L", "T", "R").index(stop.movement.kind))]
                    wb = w.w_t * pv.priority_score() / 10.0
                    tracked.append(TrackedVehicle(loc, eta, 0, wb, "bus", pv.joined and pv.j == jb, pv.ahead if pv.joined else 0))
                    buses.append({"label": pv.label, "eta": eta, "phase": stop.movement.phase, "late_min": pv.late_min,
                                  "occupancy": pv.occupancy, "score": pv.priority_score(), "school": pv.school})
        return {
            "A": A, "own_transit": own_transit, "cumA": cumA, "Q0": Q0, "wait0": wait0, "gel0": gel0,
            "credit0": credit0, "s_eff": s_eff, "room": room, "own_cap": own_cap, "down_cap": down_cap,
            "down_occ": down_occ, "ped_pending": ped_pending, "ped_wait": ped_wait, "ped_phase": ped_phase,
            "phase_demand": ph_demand, "ped_phases": {int(p) for p, c in zip(ped_phase, ped_pending) if c},
            "blocked_all": blocked_all, "blocked_text": blocked_text, "starved_phase": starved_phase,
            "starved_text": starved_text, "tracked": tracked, "ev_pending": ev_pending, "buses": buses,
        }

    def _evaluate(self, sim, ni, sg, ctx, cands):
        st = self.statics[ni]
        shifted = []
        for c in cands:
            # a candidate that starts immediately but cannot be legal yet is delayed until it can
            shifted.append(c)
        return rollout(
            st, shifted, sg, H=self.w.horizon, w=self.w, Q0=ctx["Q0"], gel0=ctx["gel0"], credit0=ctx["credit0"],
            wait0=ctx["wait0"], A_hat=ctx["A"], room=ctx["room"], s_eff_full=ctx["s_eff"],
            tau_startup=sim.phys.tau_startup, yellow_factor=sim.phys.yellow_flow_factor, dt=sim.dt,
            own_cap=ctx["own_cap"], own_transit0=ctx["own_transit"], own_cumA=ctx["cumA"],
            down_cap=ctx["down_cap"], down_occ0=ctx["down_occ"], ped_pending=ctx["ped_pending"],
            ped_wait0=ctx["ped_wait"], ped_phase=ctx["ped_phase"], tracked=ctx["tracked"],
        )

    # ------------------------------------------------------------------ explanations
    def _candidate_table(self, cands, res, best) -> list[dict]:
        out = []
        for i, c in enumerate(cands):
            out.append({
                "label": c.label, "kind": c.kind, "cost": round(float(res["total"][i]), 1),
                "terms": {k: round(float(v[i]), 1) for k, v in res["terms"].items()},
                "selected": i == best, "tags": c.tags,
            })
        return out

    def _constraints(self, sim, ni, sg, t, ctx, target: int | None) -> list[dict]:
        out = []
        out.append({"name": "Minimum green", "ok": True,
                    "detail": f"{sg.timer:.0f}s shown ≥ {sg.g_min(sg.phase):.0f}s required"})
        pr = sg.ped_remaining()
        out.append({"name": "Pedestrian clearance", "ok": pr <= 0,
                    "detail": "no crossing in progress" if pr <= 0 else f"{pr:.0f}s of clearance still required"})
        out.append({"name": "Clearance sequence", "ok": True,
                    "detail": f"yellow {sg.p.yellow:.0f}s + all-red {sg.p.all_red:.0f}s before the next green"})
        r_block = sim.phys.r_block
        if target is not None:
            worst = None
            for loc, mid in enumerate(self.statics[ni].mids):
                mv = sim.net.movements[mid]
                if mv.phase != target or sim.mv_out_exit[mid]:
                    continue
                if sim.Q[mid] <= 0 and ctx["A"][:5, loc].sum() <= 0:
                    continue
                oi = sim.mv_out[mid]
                r = sim.occ[oi] / max(1, sim.cap_eff[oi])
                if worst is None or r > worst[0]:
                    worst = (r, sim.link_ids[oi])
            if worst is not None:
                out.append({"name": "Downstream storage", "ok": worst[0] < r_block,
                            "detail": f"{worst[1]} is {100 * worst[0]:.0f}% full (limit {100 * r_block:.0f}%)"})
        mw = float(ctx["wait0"].max()) if len(ctx["wait0"]) else 0.0
        out.append({"name": "Fairness cap", "ok": mw < self.w.t_max_allowed,
                    "detail": f"longest wait here {mw:.0f}s < {self.w.t_max_allowed:.0f}s cap"})
        return out

    def _explain_switch(self, sim, ni, sg, t, ctx, cands, res, best, removed, forced, latched_phase) -> dict:
        chosen = cands[best]
        st = self.statics[ni]
        cur = sg.phase  # still the old phase until yellow ends; request_switch already moved to Y
        tgt = chosen.target
        nm = self._node_name(sim, ni)
        hold_i = next((i for i, c in enumerate(cands) if c.kind == "hold"), None)
        reasons: list[str] = []
        # who is waiting
        def phase_stats(p):
            q = sum(int(ctx["Q0"][loc]) for loc in range(len(st.mids)) if st.phase_of[loc] == p)
            wt = max([ctx["wait0"][loc] for loc in range(len(st.mids)) if st.phase_of[loc] == p and ctx["Q0"][loc] > 0] or [0.0])
            return q, wt
        q_t, w_t = phase_stats(tgt)
        q_c, w_c = phase_stats(cur)
        kind = "switch"
        title = f"Transition to {self._phase_label(tgt).lower()} green"
        if forced == "emergency" and sim.ev is not None:
            kind = "preempt"
            j = self.stop_of_node[ni]
            pl = self.plan[j]
            comp = sim.net.compass
            mv = sim.ev.route.stops[j].movement
            title = f"Transition to {self._mv_label(sim, mv.idx)} emergency green"
            reasons += [
                f"{self._ev_name(sim)} ETA is {pl['eta_rel']:.0f} seconds",
                f"Queue ahead contains {pl['queue']} vehicles",
                f"Predicted clearance requires {pl['t_clear']:.0f} seconds",
                f"Safe transition (min green, yellow, all-red, pedestrian) requires {pl['t_safe']:.0f} seconds",
                f"Total preparation {pl['t_prep']:.0f}s ≥ ETA {pl['eta_rel']:.0f}s → trigger reached",
            ]
        elif forced == "fairness":
            kind = "fairness"
            title = f"Serve {self._phase_label(tgt).lower()} — anti-starvation"
            reasons.append(ctx["starved_text"])
        elif forced == "guard":
            kind = "guard"
            title = f"Leave {self._phase_label(cur).lower()} green — spillback protection"
            reasons.append(ctx["blocked_text"])
        else:
            reasons.append(f"{self._phase_label(tgt)} has {q_t} vehicles waiting (longest wait {w_t:.0f}s)")
            reasons.append(f"{self._phase_label(cur)} has {q_c} vehicles left to serve")
        if hold_i is not None and forced is None:
            saved = float(res["delay_raw"][hold_i] - res["delay_raw"][best])
            reasons.append(f"Predicted queue delay over the next {self.w.horizon}s: "
                           f"{res['delay_raw'][hold_i]:.0f} veh·s if held vs {res['delay_raw'][best]:.0f} veh·s "
                           f"({'saves' if saved >= 0 else 'costs'} {abs(saved):.0f})")
        if ctx["ev_pending"] is not None and forced is None:
            pl = ctx["ev_pending"]
            reasons.append(f"Emergency vehicle ETA {pl['eta_rel']:.0f}s — detour keeps ≥ {pl['t_buffer']:.0f}s of margin")
        for b in ctx["buses"]:
            who = f"{b['label']} ({b['late_min']:.0f} min late, {b['occupancy']} on board) arrives in {b['eta']:.0f}s"
            if b["phase"] == tgt:
                reasons.append(f"Transit priority: {who} — this green serves it (priority score {b['score']:.1f})")
            elif forced == "emergency":
                reasons.append(f"Transit priority denied: {who}, but the emergency vehicle outranks it")
            elif forced in ("fairness", "guard"):
                reasons.append(f"Transit priority not applied: {who}; a hard rule decided this change")
        for rm in removed[:3]:
            reasons.append(f"Ruled out: {rm['label']} — {rm['why']}")
        reasons.append(f"Safety transition inserted: yellow {sg.p.yellow:.0f}s, all-red {sg.p.all_red:.0f}s")
        return {
            "node": sg.node.id, "node_name": nm, "mode": "prioritypulse", "kind": kind, "title": title,
            "from_phase": cur, "to_phase": tgt, "reasons": reasons,
            "constraints": self._constraints(sim, ni, sg, t, ctx, tgt),
            "candidates": self._candidate_table(cands, res, best),
            "weights": {"w_ev": None, "w_q": self.w.w_q, "w_d": self.w.w_d, "w_s": self.w.w_s,
                        "w_f": self.w.w_f, "w_c": self.w.w_c, "w_p": self.w.w_p},
        }

    def _explain_emergency_hold(self, sim, ni: int, sg, t: int, j: int) -> None:
        """The emergency phase is already green: record why it is being held (with candidate costs)."""
        pl = self.plan[j]
        ctx = self._context(sim, ni, sg, t)
        cur = sg.phase
        cands = [Candidate("hold", None, 10 ** 6, f"Hold emergency green ({self._phase_label(cur).lower()})", ["emergency"])]
        for p in range(sg.n_phases):
            if p != cur:
                cands.append(Candidate("switch", p, 0, f"Switch to {self._phase_label(p).lower()} now"))
        res = self._evaluate(sim, ni, sg, ctx, cands)
        mv = sim.ev.route.stops[j].movement
        reasons = [
            f"{self._ev_name(sim)} ETA is {pl['eta_rel']:.0f} seconds",
            f"Queue ahead contains {pl['queue']} vehicles",
            f"Predicted clearance requires {pl['t_clear']:.0f} seconds; the phase is already green, so no transition is needed",
            f"Preparation {pl['t_prep']:.0f}s ≥ ETA {pl['eta_rel']:.0f}s → hold this green until the vehicle has passed",
        ]
        sim.add_decision({
            "node": sg.node.id, "node_name": self._node_name(sim, ni), "mode": "prioritypulse", "kind": "preempt",
            "title": f"Hold {self._mv_label(sim, mv.idx)} green for the emergency vehicle",
            "from_phase": cur, "to_phase": cur, "reasons": reasons,
            "constraints": self._constraints(sim, ni, sg, t, ctx, cur),
            "candidates": self._candidate_table(cands, res, 0),
        })

    def _ev_name(self, sim) -> str:
        return {"ambulance": "Ambulance", "fire": "Fire truck", "police": "Police vehicle"}.get(
            sim.ev.etype if sim.ev else "", "Emergency vehicle")

    def _maybe_log_hold(self, sim, ni, sg, t, ctx, cands=None, res=None, best=None, removed=None) -> None:
        """Record an 'extended green' decision, rate-limited, only when someone else is waiting."""
        if t - self.last_extend_log[ni] < 12 or cands is None or res is None:
            return
        st = self.statics[ni]
        waiting = [p for p, d in enumerate(ctx["phase_demand"]) if p != sg.phase and d > 0]
        if not waiting:
            return
        chosen = cands[best]
        if chosen.kind == "hold" or chosen.kind == "switch":
            self.last_extend_log[ni] = t
            cur = sg.phase
            q_c = sum(int(ctx["Q0"][loc]) for loc in range(len(st.mids)) if st.phase_of[loc] == cur)
            q_w = {p: sum(int(ctx["Q0"][loc]) for loc in range(len(st.mids)) if st.phase_of[loc] == p) for p in waiting}
            title = f"Extend {self._phase_label(cur).lower()} green"
            if chosen.kind == "switch":
                title += f" ({chosen.start}s more, then {self._phase_label(chosen.target).lower()})"
            reasons = [
                f"{self._phase_label(cur)} still has {q_c} vehicles queued and more arriving",
                "Waiting: " + ", ".join(f"{self._phase_label(p).lower()} {n}" for p, n in q_w.items()),
                "Cheapest predicted outcome over the horizon",
            ]
            if removed:
                reasons += [f"Ruled out: {r['label']} — {r['why']}" for r in removed[:2]]
            sim.add_decision({
                "node": sg.node.id, "node_name": self._node_name(sim, ni), "mode": "prioritypulse",
                "kind": "extend", "title": title, "from_phase": cur, "to_phase": cur, "reasons": reasons,
                "constraints": self._constraints(sim, ni, sg, t, ctx, None),
                "candidates": self._candidate_table(cands, res, best),
            })

    # ------------------------------------------------------------------ spillback events
    def _guard_events(self, sim: "Simulation", t: int) -> None:
        r_block = sim.phys.r_block
        for lid, pipe in sim.pipe.items():
            li = sim.li[lid]
            ratio = sim.occ[li] / max(1, sim.cap_eff[li])
            on = sim.occ[li] >= r_block * sim.cap_eff[li]
            was = self.guard_active.get(lid, False)
            if on and not was:
                self.guard_active[lid] = True
                lk = sim.net.links[lid]
                up = [m.node for m in sim.net.movements if m.out_link == lid]
                up_name = sim.net.intersection(up[0]).name if up else "the network edge"
                sim.add_event("guard_on", lk.approach_of,
                              f"SPILLBACK PROTECTION ACTIVE — {sim.net.compass.get(lk.role, lk.role)} block {lid} is "
                              f"{100 * ratio:.0f}% full; green from {up_name} into it is denied", "warn",
                              link=lid, ratio=round(ratio, 3))
            elif was and sim.occ[li] < (r_block - 0.08) * sim.cap_eff[li]:
                self.guard_active[lid] = False
                sim.add_event("guard_off", sim.net.links[lid].approach_of,
                              f"Spillback protection released on {lid} ({100 * ratio:.0f}% full)", "info", link=lid)

    # ------------------------------------------------------------------ per-frame data for the UI
    def frame_extra(self, sim: "Simulation") -> dict[str, Any]:
        if not self.plan or sim.ev is None:
            return {}
        return {"plan": [self.plan[j] for j in sorted(self.plan)
                         if sim.ev.passed_at[j] is None]}

    def info(self) -> dict:
        return {"stats": self.stats, "cycle": self.cycle}
