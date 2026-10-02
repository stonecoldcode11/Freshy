"""Mode 2: reactive emergency preemption on top of the fixed-time plan.

A detector sees the emergency vehicle only when it is ``reactive_detect_s``
seconds from the stop line.  The controller then does the safe transition to
the vehicle's phase and holds it until the vehicle has passed.  It knows
nothing about queues ahead of the vehicle, downstream storage or fairness —
that is exactly the gap PriorityPulse closes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..network import PHASE_NAMES
from .fixed import FixedTimeController

if TYPE_CHECKING:  # pragma: no cover
    from ..simulator import Simulation


class ReactiveController(FixedTimeController):
    name = "reactive"
    label = "Reactive preemption"

    def setup(self, sim: "Simulation") -> None:
        super().setup(sim)
        self.stop_of: dict[int, int] = {}
        self.active: dict[int, bool] = {}
        self.release_at: dict[int, float] = {}
        ev = sim.ev
        if ev:
            for j, st in enumerate(ev.route.stops):
                self.stop_of[sim.node_idx[st.node]] = j
        self.logged: set[tuple[int, str]] = set()

    def update(self, sim: "Simulation", t: int) -> None:
        ev = sim.ev
        preempting: set[int] = set()
        if ev is not None and ev.status != "pending":
            for ni, j in self.stop_of.items():
                sg = sim.signals[ni]
                st = ev.route.stops[j]
                node = st.node
                passed = ev.passed_at[j]
                if passed is not None:
                    if t - passed < sim.cfg.emergency.release_buffer:
                        preempting.add(ni)
                        sim.pre_state[ni] = "release"
                    else:
                        if sim.pre_state[ni] != "none":
                            if (ni, "release") not in self.logged:
                                self.logged.add((ni, "release"))
                                sim.add_event("preempt_release", node, f"{sim.net.intersection(node).name}: preemption released; fixed plan resumes",
                                              "info")
                            sim.pre_state[ni] = "none"
                    continue
                eta_rel = ev.remaining_to_stop(j) / max(ev.speed, 0.1)
                if eta_rel > sim.cfg.emergency.reactive_detect_s:
                    sim.pre_state[ni] = "none"
                    continue
                preempting.add(ni)
                target = st.movement.phase
                if (ni, "req") not in self.logged:
                    self.logged.add((ni, "req"))
                    nm = sim.net.intersection(node).name
                    sim.add_event("preempt_start", node,
                                  f"{nm}: detector sees the emergency vehicle {eta_rel:.0f}s away; requesting preemption", "info")
                    sim.add_decision({
                        "node": node, "mode": "reactive", "kind": "preempt_request",
                        "title": f"Request {PHASE_NAMES[target].lower()} green for the emergency vehicle",
                        "reasons": [f"Emergency vehicle detected {eta_rel:.0f}s from the stop line",
                                    "No look-ahead: queue ahead and downstream space are not considered"],
                        "candidates": [], "constraints": [],
                    })
                if sg.state == "G" and sg.phase == target:
                    sim.pre_state[ni] = "hold"
                elif sg.state == "G":
                    sim.pre_state[ni] = "active"
                    sg.request_switch(target, t)
                else:
                    sim.pre_state[ni] = "active"
        self.plan_update(sim, t, skip=preempting)
