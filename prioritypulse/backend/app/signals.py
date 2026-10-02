"""Signal-state machine, pedestrian clearance and an independent safety monitor.

Legal sequence (the only one the machine can produce):

    Green(p) -> Yellow(p) -> AllRed -> Green(p')       p' != p

Hard constraints enforced here, never traded against cost:

* g_p >= g_min before a green may end;
* a pedestrian walk + flashing-don't-walk + clearance interval, once started,
  must finish before the parallel phase can end;
* yellow >= y_min, all-red >= r_min;
* only one (conflict-free) phase displays green at a time.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .config import SignalParams
from .network import Intersection

GREEN, YELLOW, ALLRED = "G", "Y", "R"


@dataclass
class PedState:
    crosswalk: str
    parallel_phase: int
    call: bool = False       # button pressed, not yet served
    wait: float = 0.0        # seconds since the call
    stage: str = "idle"      # idle | walk | fdw | clear
    t: float = 0.0           # seconds in the current stage
    served: int = 0

    def active(self) -> bool:
        return self.stage != "idle"


class Signal:
    """One intersection's signal controller hardware (no policy, only legality)."""

    def __init__(self, node: Intersection, params: SignalParams, *, main_axis_phases=(0, 1)) -> None:
        self.node = node
        self.p = params
        self.n_phases = len(node.phases)
        self.state = GREEN
        self.phase = 0
        self.target = -1
        self.timer = 0.0
        self.peds = [PedState(c.id, c.parallel_phase) for c in node.crosswalks]
        self.log: list[dict] = []
        self.phase_green_total = [0.0] * self.n_phases
        self.switches = 0
        self.denied = 0
        self.ped_block: set[int] = set()     # parallel phases whose walk may not *start* (emergency lead-up)
        self._main = set(main_axis_phases)

    # -- timing limits ---------------------------------------------------------
    def g_min(self, phase: int) -> float:
        return self.p.g_min_left if phase in (1, 3) else self.p.g_min_through

    def g_max(self, phase: int) -> float:
        if phase in (1, 3):
            return self.p.g_max_left
        return self.p.g_max_through_main if phase in self._main else self.p.g_max_through_side

    def ped_total(self) -> float:
        return self.p.ped_walk + self.p.ped_fdw + self.p.ped_clear

    # -- pedestrian helpers ------------------------------------------------------
    def _ped_rem(self, pd: PedState) -> float:
        if pd.stage == "idle":
            return 0.0
        elapsed = pd.t + {"walk": 0.0, "fdw": self.p.ped_walk,
                          "clear": self.p.ped_walk + self.p.ped_fdw}[pd.stage]
        return max(0.0, self.ped_total() - elapsed)

    def ped_remaining(self) -> float:
        """Time until every active pedestrian interval has finished."""
        return max((self._ped_rem(pd) for pd in self.peds), default=0.0)

    def ped_call(self, idx: int) -> None:
        pd = self.peds[idx]
        if pd.call or pd.active():
            return
        if self.state == GREEN and self.phase == pd.parallel_phase and pd.parallel_phase not in self.ped_block:
            pd.stage, pd.t = "walk", 0.0           # parallel green is already showing: walk now
        else:
            pd.call, pd.wait = True, 0.0

    def ped_waiting(self, phase: int) -> float:
        """Longest wait of a pending call that phase ``phase`` would serve."""
        return max((pd.wait for pd in self.peds if pd.call and pd.parallel_phase == phase), default=0.0)

    def pending_ped_phase(self) -> list[int]:
        return [pd.parallel_phase for pd in self.peds if pd.call]

    # -- legality queries --------------------------------------------------------
    def time_to_legal_switch(self) -> float:
        """Seconds until a switch may *begin* (inf unless currently green)."""
        if self.state != GREEN:
            return math.inf
        return max(0.0, self.g_min(self.phase) - self.timer, self.ped_remaining())

    def can_switch(self) -> bool:
        return self.state == GREEN and self.time_to_legal_switch() <= 1e-9

    def time_until_green(self, phase: int) -> float:
        """Earliest time (from now) at which ``phase`` can display green."""
        y, r = self.p.yellow, self.p.all_red
        if self.state == GREEN:
            if self.phase == phase:
                return 0.0
            return self.time_to_legal_switch() + y + r
        if self.state == YELLOW:
            rem = max(0.0, y - self.timer)
            if self.target == phase:
                return rem + r
            return rem + r + self.g_min(self.target) + y + r
        rem = max(0.0, r - self.timer)           # all-red
        if self.target == phase:
            return rem
        return rem + self.g_min(self.target) + y + r

    def service_factor(self, phase: int, yellow_factor: float) -> float:
        """G_{i,m}: how much of saturation flow phase ``phase`` may discharge right now."""
        if phase != self.phase:
            return 0.0
        if self.state == GREEN:
            return 1.0
        if self.state == YELLOW:
            return yellow_factor
        return 0.0

    # -- commands ----------------------------------------------------------------
    def request_switch(self, target: int, now: float) -> bool:
        """Begin Green -> Yellow.  Denied (returns False) when it would be illegal."""
        if target == self.phase or not (0 <= target < self.n_phases):
            return False
        if not self.can_switch():
            self.denied += 1
            return False
        self.log.append({
            "t": now, "node": self.node.id, "type": "yellow_start", "phase": self.phase,
            "target": target, "g_elapsed": self.timer, "ped_remaining": self.ped_remaining(),
            "g_min": self.g_min(self.phase),
        })
        self.state, self.target, self.timer = YELLOW, target, 0.0
        self.switches += 1
        return True

    def start_in(self, phase: int, elapsed: float, now: float = 0.0) -> None:
        """Initial condition (used for fixed-time offsets).  Logged as a green start."""
        self.phase, self.state, self.timer, self.target = phase, GREEN, elapsed, -1
        self.log.append({"t": now, "node": self.node.id, "type": "green_start", "phase": phase,
                         "prev": None, "allred": None})

    # -- time advance --------------------------------------------------------------
    def step(self, dt: float, now: float) -> None:
        for pd in self.peds:
            if pd.call:
                pd.wait += dt
        self.timer += dt
        if self.state == GREEN:
            self.phase_green_total[self.phase] += dt
        # pedestrian stage machine runs only while the parallel phase is green
        for pd in self.peds:
            if pd.stage != "idle":
                pd.t += dt
                if pd.stage == "walk" and pd.t >= self.p.ped_walk - 1e-9:
                    pd.stage, pd.t = "fdw", pd.t - self.p.ped_walk
                if pd.stage == "fdw" and pd.t >= self.p.ped_fdw - 1e-9:
                    pd.stage, pd.t = "clear", pd.t - self.p.ped_fdw
                if pd.stage == "clear" and pd.t >= self.p.ped_clear - 1e-9:
                    pd.stage, pd.t = "idle", 0.0
                    pd.served += 1
        if self.state == YELLOW and self.timer >= self.p.yellow - 1e-9:
            self.log.append({"t": now, "node": self.node.id, "type": "allred_start", "phase": self.phase,
                             "yellow": self.timer})
            self.state, self.timer = ALLRED, 0.0
        elif self.state == ALLRED and self.timer >= self.p.all_red - 1e-9:
            self.log.append({"t": now, "node": self.node.id, "type": "green_start", "phase": self.target,
                             "prev": self.phase, "allred": self.timer})
            self.phase, self.target, self.state, self.timer = self.target, -1, GREEN, 0.0
        # serve pending pedestrian calls whose parallel phase is green
        if self.state == GREEN:
            for pd in self.peds:
                if (pd.call and pd.stage == "idle" and pd.parallel_phase == self.phase
                        and pd.parallel_phase not in self.ped_block):
                    pd.call, pd.stage, pd.t = False, "walk", 0.0

    # -- snapshot for frames ---------------------------------------------------------
    def snapshot(self) -> dict:
        return {
            "s": self.state, "p": self.phase, "tp": self.target, "tm": round(self.timer, 1),
            "ped": [
                {"st": {"idle": (1 if pd.call else 0), "walk": 2, "fdw": 3, "clear": 3}[pd.stage],
                 "rem": round(self._ped_rem(pd), 1),
                 "w": round(pd.wait, 1) if pd.call else 0}
                for pd in self.peds
            ],
        }


# ---------------------------------------------------------------------------
# Safety monitor: audits the transition log independently of the controllers
# ---------------------------------------------------------------------------

@dataclass
class SafetyReport:
    transitions: int = 0
    legal: int = 0
    violations: list[str] = field(default_factory=list)
    conflict_steps: int = 0
    steps_checked: int = 0

    @property
    def compliance_pct(self) -> float:
        if self.transitions == 0:
            return 100.0
        return 100.0 * self.legal / self.transitions


class SafetyMonitor:
    """Re-derives legality from the event log and per-step active-movement sets."""

    def __init__(self, params: SignalParams, conflicts: list[list[int]]) -> None:
        self.p = params
        self.conflicts = conflicts
        self._seen_sets: dict[frozenset[int], bool] = {}
        self.conflict_steps = 0
        self.steps_checked = 0
        self.step_violations: list[str] = []

    def check_active_set(self, t: float, node: str, active: frozenset[int]) -> bool:
        self.steps_checked += 1
        ok = self._seen_sets.get(active)
        if ok is None:
            ok = True
            lst = sorted(active)
            for a in lst:
                for b in lst:
                    if a < b and self.conflicts[a][b]:
                        ok = False
            self._seen_sets[active] = ok
        if not ok:
            self.conflict_steps += 1
            if len(self.step_violations) < 20:
                self.step_violations.append(f"t={t:.0f} {node}: conflicting movements served together")
        return ok

    def audit(self, logs: list[list[dict]]) -> SafetyReport:
        rep = SafetyReport(conflict_steps=self.conflict_steps, steps_checked=self.steps_checked)
        rep.violations.extend(self.step_violations)
        for log in logs:
            expect = "yellow_start"
            cur_ok = True
            for ev in log:
                kind = ev["type"]
                if kind == "green_start":
                    if ev.get("prev") is not None:                # a completed transition
                        rep.transitions += 1
                        ok = cur_ok
                        if ev["phase"] == ev["prev"]:
                            ok = False
                            rep.violations.append(f"t={ev['t']:.0f} {ev['node']}: green re-issued to same phase")
                        if ev["allred"] is not None and ev["allred"] + 1e-9 < self.p.all_red:
                            ok = False
                            rep.violations.append(f"t={ev['t']:.0f} {ev['node']}: all-red {ev['allred']:.1f}s < {self.p.all_red}s")
                        if expect != "green_start":
                            ok = False
                            rep.violations.append(f"t={ev['t']:.0f} {ev['node']}: green without all-red")
                        rep.legal += 1 if ok else 0
                    expect, cur_ok = "yellow_start", True
                elif kind == "yellow_start":
                    if expect != "yellow_start":
                        cur_ok = False
                        rep.violations.append(f"t={ev['t']:.0f} {ev['node']}: yellow out of sequence")
                    if ev["g_elapsed"] + 1e-9 < ev["g_min"]:
                        cur_ok = False
                        rep.violations.append(
                            f"t={ev['t']:.0f} {ev['node']}: green {ev['g_elapsed']:.1f}s < min {ev['g_min']:.0f}s")
                    if ev["ped_remaining"] > 1e-9:
                        cur_ok = False
                        rep.violations.append(
                            f"t={ev['t']:.0f} {ev['node']}: ended green with {ev['ped_remaining']:.1f}s pedestrian clearance left")
                    expect = "allred_start"
                elif kind == "allred_start":
                    if expect != "allred_start":
                        cur_ok = False
                        rep.violations.append(f"t={ev['t']:.0f} {ev['node']}: all-red out of sequence")
                    if ev["yellow"] + 1e-9 < self.p.yellow:
                        cur_ok = False
                        rep.violations.append(f"t={ev['t']:.0f} {ev['node']}: yellow {ev['yellow']:.1f}s < {self.p.yellow}s")
                    expect = "green_start"
        return rep
