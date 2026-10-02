"""Controller interface.  A controller only ever *requests* signal changes;
the signal state machine refuses anything that would be illegal."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from ..simulator import Simulation


class Controller:
    name = "base"
    label = "Base"
    guard = False        # spillback guard (blocks inflow to links >= r_block full); PriorityPulse only

    def setup(self, sim: "Simulation") -> None:  # pragma: no cover - interface
        pass

    def update(self, sim: "Simulation", t: int) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def frame_extra(self, sim: "Simulation") -> dict:
        """Controller data attached to every recorded frame (e.g. the emergency plan)."""
        return {}

    def info(self) -> dict:
        """Extra, controller-specific data attached to the run result."""
        return {}
