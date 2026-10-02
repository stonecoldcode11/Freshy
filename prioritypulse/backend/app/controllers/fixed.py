"""Mode 1: fixed-time signals (pre-timed plan, optional progression offsets)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import Controller

if TYPE_CHECKING:  # pragma: no cover
    from ..simulator import Simulation


class FixedTimeController(Controller):
    name = "fixed"
    label = "Fixed-time"

    def setup(self, sim: "Simulation") -> None:
        sp = sim.sp
        self.greens = list(sp.fixed_green)
        self.cycle = sum(self.greens) + len(self.greens) * (sp.yellow + sp.all_red)
        self.offsets = self._offsets(sim)
        # Start each intersection at its position in the cycle (t = -warmup).
        for ni, sg in enumerate(sim.signals):
            pos = (sim.t - self.offsets[ni]) % self.cycle
            phase, elapsed = 0, 0.0
            acc = 0.0
            for p, g in enumerate(self.greens):
                seg = g + sp.yellow + sp.all_red
                if pos < acc + g:
                    phase, elapsed = p, pos - acc
                    break
                if pos < acc + seg:
                    phase, elapsed = (p + 1) % len(self.greens), 0.0
                    break
                acc += seg
            sg.start_in(phase, elapsed, sim.t)
        self.planned = list(self.greens)

    def _offsets(self, sim: "Simulation") -> list[float]:
        sp = sim.sp
        if sp.fixed_offsets != "progression":
            return [0.0] * len(sim.signals)
        # theta_{i+1} = theta_i + L_{i,i+1} / v_platoon  (mod C)
        offs = [0.0]
        xs = [nd.x for nd in sim.net.intersections]
        for i in range(1, len(xs)):
            offs.append((offs[-1] + abs(xs[i] - xs[i - 1]) / sp.platoon_speed) % self.cycle)
        return offs

    def next_phase(self, sg) -> int:
        return (sg.phase + 1) % sg.n_phases

    def plan_update(self, sim: "Simulation", t: int, skip: set[int] | None = None) -> None:
        """Advance the pre-timed plan.  ``skip`` lists intersection indices under preemption."""
        for ni, sg in enumerate(sim.signals):
            if skip and ni in skip:
                continue
            if sg.state == "G" and sg.timer >= self.planned[sg.phase] - 1e-9 and sg.can_switch():
                sg.request_switch(self.next_phase(sg), t)

    def update(self, sim: "Simulation", t: int) -> None:
        self.plan_update(sim, t)
