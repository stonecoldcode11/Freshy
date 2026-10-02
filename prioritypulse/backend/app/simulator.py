"""Discrete-time (dt = 1 s) corridor simulator: Layer 2 traffic physics.

State per movement m = (approach link, L/T/R):

    Q_m(t+1) = Q_m(t) + A_m(t) - D_m(t)                       queue conservation
    D_m(t)   = min[ Q_m + A_m,  s_eff,m * dt,  space_down ] * G_m(t) * B_m(t)

``A_m`` is what leaves the link's transit pipeline this second (vehicles that
reached the back of the queue), ``s_eff`` includes start-up lost time,
``space_down`` is the downstream link's free storage, ``G`` the green
eligibility and ``B`` the downstream-availability (spillback guard).  Vehicles
are integers; fractional discharge is carried in a per-movement credit.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Any

from .config import WEATHER_FACTORS, SimConfig
from .demand import DemandTable, generate_demand, split_counts
from .network import Network, Route, find_route
from .scenarios import DispatchSpec, Scenario
from .signals import ALLRED, GREEN, YELLOW, SafetyMonitor, Signal
from .vehicles import PriorityVehicle

if TYPE_CHECKING:  # pragma: no cover
    from .controllers.base import Controller

EV_NAMES = {"ambulance": "Ambulance", "fire": "Fire truck", "police": "Police"}


@dataclass
class RunResult:
    mode: str
    config: dict[str, Any]
    frames: list[dict]
    events: list[dict]
    decisions: list[dict]
    metrics: dict[str, Any]
    series: dict[str, list]
    ev: dict[str, Any] | None
    buses: list[dict]
    safety: dict[str, Any]
    elapsed_s: float = 0.0


class Simulation:
    def __init__(
        self,
        net: Network,
        cfg: SimConfig,
        scenario: Scenario,
        controller: "Controller",
        demand: DemandTable | None = None,
        dispatch: DispatchSpec | None | bool = True,
        extra_ped_calls: list[tuple[int, str]] | None = None,
    ) -> None:
        self.net, self.cfg, self.scenario = net, cfg, scenario
        self.phys = net.phys
        self.dt = self.phys.dt
        self.warmup = cfg.warmup
        self.T = cfg.duration
        self.t = -self.warmup                                # relative time; recording starts at 0
        self.r_v, self.r_s, _ = WEATHER_FACTORS[cfg.weather]

        sp = cfg.signals
        if cfg.school_zone:
            # school zone: longer pedestrian intervals, stricter buffers
            sp = replace(sp, ped_walk=max(sp.ped_walk, 10.0), ped_fdw=max(sp.ped_fdw, 14.0),
                         ped_clear=max(sp.ped_clear, 3.0))
            cfg.emergency.t_buffer = max(cfg.emergency.t_buffer, 5.0)
        self.sp = sp
        self.demand = demand or generate_demand(net, cfg, scenario)
        self.ped_inject: dict[int, list[int]] = {}
        xw_index = {x: i for i, x in enumerate(self.demand.crosswalks)}
        for (t_inj, cid) in (extra_ped_calls or []):
            if cid in xw_index:
                self.ped_inject.setdefault(int(t_inj), []).append(xw_index[cid])

        # ---- indices -----------------------------------------------------------------
        self.link_ids = list(net.links.keys())
        self.li = {lid: i for i, lid in enumerate(self.link_ids)}
        self.nl = len(self.link_ids)
        self.nm = len(net.movements)
        self.node_idx = {nd.id: i for i, nd in enumerate(net.intersections)}
        self.mv_node = [self.node_idx[m.node] for m in net.movements]
        self.mv_link = [self.li[m.link] for m in net.movements]
        self.mv_out = [self.li[m.out_link] for m in net.movements]
        self.mv_out_exit = [net.links[m.out_link].kind == "exit" for m in net.movements]
        self.link_moves: dict[str, list[int]] = {}
        for m in net.movements:
            self.link_moves.setdefault(m.link, [None] * 3)[("L", "T", "R").index(m.kind)] = m.idx
        self.cap_base = [net.links[lid].capacity for lid in self.link_ids]
        self.cap_eff = list(self.cap_base)
        self.sat_fac = [1.0] * self.nl
        self.is_exit = [net.links[lid].kind == "exit" for lid in self.link_ids]
        self.tau = {}
        for lid in self.link_ids:
            lk = net.links[lid]
            if lk.kind != "exit":
                self.tau[lid] = max(2, int(round(lk.length / max(lk.v_free * self.r_v, 0.5))))
        self.entry = [lk for lk in net.links.values() if lk.kind == "entry"]
        self.entry_col = {lk.id: e for e, lk in enumerate(self.entry)}
        assert [lk.id for lk in self.entry] == self.demand.entry_links

        # ---- dynamic state --------------------------------------------------------------
        self.Q = [0] * self.nm
        self.credit = [0.0] * self.nm
        self.gel = [0.0] * self.nm
        self.wait = [0.0] * self.nm
        self.pipe: dict[str, deque] = {lid: deque([0, 0, 0] for _ in range(tau)) for lid, tau in self.tau.items()}
        self.in_transit = [0] * self.nl
        self.occ = [0] * self.nl
        self.backlog = {lk.id: [0, 0, 0] for lk in self.entry}
        self._rr = {lk.id: 0 for lk in self.entry}
        self._acc = {lid: [0.0, 0.0, 0.0] for lid in self.link_ids}
        self.recent_inflow = {lid: 0.0 for lid in self.link_ids}      # EMA used for prediction
        self.D = [0] * self.nm
        self.A = [0] * self.nm
        self.completed = 0
        self.admitted = 0
        self._c0 = 0                                # completed / admitted counters at t = 0
        self._a0 = 0
        self.guard_enabled = False                  # spillback guard (PriorityPulse only)
        self.override_block: set[int] = set()       # movements exempt from the guard (EV route)
        self.blocked_now = [False] * self.nl
        self.pre_state = ["none"] * len(net.intersections)

        # ---- signals ----------------------------------------------------------------------
        self.signals = [Signal(nd, sp) for nd in net.intersections]
        self.monitor = SafetyMonitor(sp, net.conflicts)
        self._active_sets = [
            [frozenset(mi for mi in nd.phases[p]) for p in range(len(nd.phases))]
            for nd in net.intersections
        ]
        self.xw_flat = [(ni, ci) for ni, nd in enumerate(net.intersections) for ci in range(len(nd.crosswalks))]

        # ---- priority vehicles --------------------------------------------------------------
        self.pvs: list[PriorityVehicle] = []
        self.ev: PriorityVehicle | None = None
        spec = scenario.dispatch if dispatch is True else (dispatch or None)
        if spec:
            self.add_ev(spec)
        for b in scenario.buses:                     # scheduled buses run regardless of the EV dispatch
            self.add_bus(b)

        # ---- outputs ----------------------------------------------------------------------------
        self.frames: list[dict] = []
        self.events: list[dict] = []
        self.decisions: list[dict] = []
        self.series: dict[str, list] = {k: [] for k in ("t", "queue", "backlog", "blocked", "arrived", "departed", "maxwait")}
        self.acc = {
            "delay": 0.0, "idle": 0.0, "dep": 0, "max_q": 0, "spill_secs": 0, "max_wait": 0.0,
            "wait_over_fair": 0, "max_occ": 0.0, "ped_served": 0, "ped_max_wait": 0.0,
            "admitted": 0, "completed": 0, "backlog_peak": 0,
        }
        self.spill_events: dict[str, int] = {}
        self._spill_prev = [False] * self.nl
        self.max_q_by_link: dict[str, int] = {}

        # Every mode is warmed up under the same fixed-time plan, so all three controllers
        # take over from an identical network state at t = 0 (and identical arrivals).
        from .controllers.fixed import FixedTimeController
        self.ctrl = controller
        if isinstance(controller, FixedTimeController):
            self.warm_ctrl = controller
            controller.setup(self)
        else:
            self.warm_ctrl = FixedTimeController()
            self.warm_ctrl.setup(self)
            controller.setup(self)

    # ------------------------------------------------------------------------------------
    # setup helpers
    # ------------------------------------------------------------------------------------
    def add_ev(self, spec: DispatchSpec) -> PriorityVehicle:
        route = find_route(self.net, spec.origin, spec.destination)
        speed = self.cfg.emergency.v_ev[spec.priority] * self.r_v
        o, d = self.net.boundary(spec.origin).name, self.net.boundary(spec.destination).name
        pv = PriorityVehicle(
            id="EV1", kind="ev", label=f"{EV_NAMES.get(spec.etype, 'Emergency vehicle')}: {o} → {d}",
            route=route, t_dispatch=float(spec.t), speed=speed, etype=spec.etype,
            priority=spec.priority, yield_threshold=self.cfg.emergency.ev_yield_threshold,
        )
        self.pvs.append(pv)
        self.ev = pv
        return pv

    def add_bus(self, b) -> PriorityVehicle:
        route = find_route(self.net, b.origin, b.destination)
        pv = PriorityVehicle(
            id=b.id, kind="bus", label=b.id, route=route, t_dispatch=float(b.t),
            speed=min(11.0, 0.85 * self.net.links[route.links[0]].v_free) * self.r_v,
            etype="bus", priority="routine", yield_threshold=0, late_min=b.late_min,
            occupancy=b.occupancy, school=b.school,
        )
        self.pvs.append(pv)
        return pv

    # ------------------------------------------------------------------------------------
    # queries used by controllers
    # ------------------------------------------------------------------------------------
    def is_green(self, mv) -> bool:
        sg = self.signals[self.node_idx[mv.node]]
        return sg.state == GREEN and sg.phase == mv.phase

    def link_queue(self, lid: str) -> int:
        return sum(self.Q[m] for m in self.link_moves.get(lid, []) if m is not None)

    def occupancy_ratio(self, lid: str) -> float:
        i = self.li[lid]
        return self.occ[i] / max(1, self.cap_eff[i])

    def network_queue(self) -> int:
        return sum(self.Q)

    def vehicles_in_system(self) -> int:
        """Queued + in transit + waiting outside a full entry link."""
        return sum(self.Q) + sum(self.in_transit) + sum(sum(b) for b in self.backlog.values())

    def add_event(self, kind: str, node: str | None, text: str, severity: str = "info", **data: Any) -> None:
        self.events.append({"t": self.t, "kind": kind, "node": node, "text": text,
                            "severity": severity, **data})

    def add_decision(self, dec: dict) -> None:
        dec["t"] = self.t
        self.decisions.append(dec)

    # ------------------------------------------------------------------------------------
    # one time step
    # ------------------------------------------------------------------------------------
    def _update_incidents(self, t: int) -> None:
        for i, lid in enumerate(self.link_ids):
            self.cap_eff[i] = self.cap_base[i]
            self.sat_fac[i] = 1.0
        for inc in self.scenario.incidents:
            if inc.start <= t < inc.end and inc.link in self.li:
                i = self.li[inc.link]
                lk = self.net.links[inc.link]
                open_frac = max(1, lk.lanes - inc.lanes_closed) / lk.lanes
                self.cap_eff[i] = max(1, int(self.cap_base[i] * open_frac))
                self.sat_fac[i] = open_frac

    def step(self) -> None:
        t = self.t
        dt = self.dt
        idx = t + self.warmup
        nm, nl = self.nm, self.nl
        mvs = self.net.movements
        if t == 0:                                   # recording window starts here
            self._c0, self._a0 = self.completed, self.admitted

        # --- exogenous pedestrian calls -------------------------------------------------
        if idx < len(self.demand.ped_calls):
            row = self.demand.ped_calls[idx]
            for x in range(len(self.xw_flat)):
                if row[x]:
                    ni, ci = self.xw_flat[x]
                    self.signals[ni].ped_call(ci)
        for x in self.ped_inject.get(t, []):
            ni, ci = self.xw_flat[x]
            self.signals[ni].ped_call(ci)
        self._update_incidents(t)

        # --- controllers decide (may request legal signal changes) -------------------------
        self.guard_enabled = self.ctrl.guard and t >= 0
        (self.warm_ctrl if t < 0 else self.ctrl).update(self, t)

        # --- A_m: vehicles reaching the back of each queue this second ------------------------
        A = self.A
        for lid, pipe in self.pipe.items():
            arr = pipe.popleft()
            mids = self.link_moves[lid]
            li = self.li[lid]
            for k in range(3):
                A[mids[k]] = arr[k]
            self.in_transit[li] -= arr[0] + arr[1] + arr[2]

        # --- D_m: departures -----------------------------------------------------------------
        occ0 = self.occ
        D = self.D
        sent = [0] * nl
        guard = self.guard_enabled
        r_block = self.phys.r_block
        yf = self.phys.yellow_flow_factor
        tau_su = self.phys.tau_startup
        Q, credit, gel = self.Q, self.credit, self.gel
        for m in range(nm):
            mv = mvs[m]
            sg = self.signals[self.mv_node[m]]
            f = sg.service_factor(mv.phase, yf)
            if f <= 0.0:
                gel[m] = 0.0
                credit[m] = 0.0
                D[m] = 0
                continue
            gel[m] += dt
            s_eff = mv.sat_flow * self.r_s * self.sat_fac[self.mv_link[m]] \
                * (1.0 - math.exp(-gel[m] / tau_su)) * f
            credit[m] += s_eff * dt
            d = min(Q[m] + A[m], int(credit[m] + 1e-9))
            if d > 0 and not self.mv_out_exit[m]:
                oi = self.mv_out[m]
                cap_d = self.cap_eff[oi]
                space = max(0, cap_d - occ0[oi] - sent[oi])
                if guard and m not in self.override_block and occ0[oi] >= r_block * cap_d:
                    space = 0                       # B_m = 0: block before physical failure
                d = min(d, space)
            credit[m] = max(0.0, min(credit[m] - d, 1.0))
            D[m] = d
            if d and not self.mv_out_exit[m]:
                sent[self.mv_out[m]] += d

        # --- queue conservation, wait clocks -----------------------------------------------------
        dep_total = 0
        inflow = [0] * nl
        for m in range(nm):
            q = Q[m] + A[m] - D[m]
            Q[m] = q
            if D[m] > 0 or q <= 0:
                self.wait[m] = 0.0
            else:
                self.wait[m] += dt
            if D[m]:
                dep_total += D[m]
                if self.mv_out_exit[m]:
                    self.completed += D[m]
                else:
                    inflow[self.mv_out[m]] += D[m]

        # --- exogenous arrivals: virtual source queue + admission -------------------------------------
        for lk in self.entry:
            e = self.entry_col[lk.id]
            li = self.li[lk.id]
            bl = self.backlog[lk.id]
            if 0 <= idx < len(self.demand.arrivals):
                a = self.demand.arrivals[idx, e]
                bl[0] += int(a[0]); bl[1] += int(a[1]); bl[2] += int(a[2])
            space = max(0, self.cap_eff[li] - occ0[li])
            enter = [0, 0, 0]
            rr = self._rr[lk.id]
            while space > 0 and (bl[0] or bl[1] or bl[2]):
                for _ in range(3):
                    k = rr % 3
                    rr += 1
                    if bl[k] > 0:
                        bl[k] -= 1
                        enter[k] += 1
                        space -= 1
                        break
            self._rr[lk.id] = rr % 3
            n_in = enter[0] + enter[1] + enter[2]
            self.admitted += n_in
            self.pipe[lk.id].append(enter)
            self.in_transit[li] += n_in
            self.recent_inflow[lk.id] = 0.95 * self.recent_inflow[lk.id] + 0.05 * n_in

        # --- internal links: split upstream departures by turning proportions --------------------------
        for lid in self.pipe:
            lk = self.net.links[lid]
            if lk.kind == "entry":
                continue
            li = self.li[lid]
            n_in = inflow[li]
            enter = list(split_counts(n_in, lk.turn_base, self._acc[lid])) if n_in else [0, 0, 0]
            self.pipe[lid].append(enter)
            self.in_transit[li] += n_in
            self.recent_inflow[lid] = 0.95 * self.recent_inflow[lid] + 0.05 * n_in

        # --- occupancy -----------------------------------------------------------------------------------
        for lid in self.pipe:
            li = self.li[lid]
            mids = self.link_moves[lid]
            self.occ[li] = self.in_transit[li] + Q[mids[0]] + Q[mids[1]] + Q[mids[2]]

        # --- priority vehicles ------------------------------------------------------------------------------
        for pv in self.pvs:
            if pv.joined and pv.j < len(pv.route.stops):
                pv.ahead = max(0, pv.ahead - D[pv.route.stops[pv.j].movement.idx])
            pv.step(self, t, dt)

        # --- monitor + signal time advance --------------------------------------------------------------------
        for ni, sg in enumerate(self.signals):
            if sg.state != ALLRED:
                self.monitor.check_active_set(t, sg.node.id, self._active_sets[ni][sg.phase])
            sg.step(dt, t + dt)

        # --- metrics ---------------------------------------------------------------------------------------------
        if t >= 0:
            self._record_metrics(t, dep_total)
        self.t += 1

    # ------------------------------------------------------------------------------------
    def _record_metrics(self, t: int, dep_total: int) -> None:
        a = self.acc
        qtot = sum(self.Q)
        bl = sum(sum(b) for b in self.backlog.values())
        a["delay"] += (qtot + bl) * self.dt
        a["idle"] += qtot * self.dt
        a["dep"] += dep_total
        a["backlog_peak"] = max(a["backlog_peak"], bl)
        mq = max(self.Q)
        a["max_q"] = max(a["max_q"], mq)
        mw = max(self.wait)
        a["max_wait"] = max(a["max_wait"], mw)
        if mw > self.cfg.weights.t_fair:
            a["wait_over_fair"] += 1
        r_block = self.phys.r_block
        n_blocked = 0
        for lid in self.pipe:
            li = self.li[lid]
            cap = max(1, self.cap_eff[li])
            ratio = self.occ[li] / cap
            a["max_occ"] = max(a["max_occ"], ratio)
            is_blocked = self.occ[li] >= r_block * cap
            self.blocked_now[li] = is_blocked
            if is_blocked:
                n_blocked += 1
                a["spill_secs"] += 1
            # an *event* starts when a link first reaches r_block and ends only once it has
            # drained below (r_block - 0.15), so chatter around the threshold is one episode
            if is_blocked and not self._spill_prev[li]:
                self.spill_events[lid] = self.spill_events.get(lid, 0) + 1
                self._spill_prev[li] = True
            elif self._spill_prev[li] and self.occ[li] < (r_block - 0.15) * cap:
                self._spill_prev[li] = False
            self.max_q_by_link[lid] = max(self.max_q_by_link.get(lid, 0), self.occ[li])
        for sg in self.signals:
            for pd in sg.peds:
                if pd.call:
                    a["ped_max_wait"] = max(a["ped_max_wait"], pd.wait)
        s = self.series
        s["t"].append(t)
        s["queue"].append(qtot)
        s["backlog"].append(bl)
        s["blocked"].append(n_blocked)
        s["arrived"].append(self.admitted - self._a0)
        s["departed"].append(self.completed - self._c0)
        s["maxwait"].append(int(mw))
        self.frames.append(self._frame(t))

    def _frame(self, t: int) -> dict:
        pre = self.pre_state
        sig = []
        for ni, sg in enumerate(self.signals):
            snap = sg.snapshot()
            snap["pre"] = pre[ni]
            sig.append(snap)
        tr = []
        for lid in self.link_ids:
            p = self.pipe.get(lid)
            if p is None:
                tr.append([])
            else:
                tr.append([a[0] + a[1] + a[2] for a in p])
        evs = [pv.snapshot(self) for pv in self.pvs if pv.status != "pending"]
        return {
            "t": t,
            "sig": sig,
            "q": list(self.Q),
            "occ": [round(self.occ[i] / max(1, self.cap_eff[i]), 3) for i in range(self.nl)],
            "tr": tr,
            "w": [int(w) for w in self.wait],
            "pv": evs,
            "bl": sum(sum(b) for b in self.backlog.values()),
            "blk": [i for i in range(self.nl) if self.blocked_now[i]],
            "cum": [self.admitted - self._a0, self.completed - self._c0],
            "ctl": self.ctrl.frame_extra(self),
        }

    # ------------------------------------------------------------------------------------
    def run(self) -> None:
        end = self.T
        while self.t < end:
            self.step()
