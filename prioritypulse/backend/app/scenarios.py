"""Scenario library: demand multipliers M_i(t), incidents, weather and default dispatches.

A scenario only describes *what happens*; the controllers never see it, so all
three modes face exactly the same world.
"""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Surge:
    """Demand multiplier M_i(t) on a set of entry links (trapezoid in time)."""

    links: list[str]
    start: float
    end: float
    factor: float
    ramp: float = 30.0

    def multiplier(self, t: float) -> float:
        if t < self.start - 1e-9 or t > self.end + 1e-9:
            return 1.0
        up = min(1.0, (t - self.start) / self.ramp) if self.ramp > 0 else 1.0
        down = min(1.0, (self.end - t) / self.ramp) if self.ramp > 0 else 1.0
        shape = max(0.0, min(up, down))
        return 1.0 + (self.factor - 1.0) * shape


@dataclass
class TurnShift:
    """Sigmoid shift of turning proportions on an entry link (event traffic leaves, etc.)."""

    link: str
    delta: tuple[float, float, float]     # added to (L, T, R) after the switch
    t_switch: float
    k: float = 0.04


@dataclass
class Incident:
    """Lane closure on a link: capacity and discharge scale by (lanes - closed) / lanes."""

    link: str
    start: float
    end: float
    lanes_closed: int = 1
    label: str = "Incident"


@dataclass
class DispatchSpec:
    origin: str
    destination: str
    etype: str = "ambulance"        # ambulance | fire | police
    priority: str = "critical"      # routine | urgent | critical
    t: float = 60.0


@dataclass
class BusSpec:
    id: str
    origin: str
    destination: str
    t: float
    late_min: float = 4.0
    occupancy: int = 28
    school: bool = False


@dataclass
class Scenario:
    id: str
    name: str
    tagline: str
    description: str
    icon: str
    intensity: float = 0.6
    duration: int = 420
    weather: str = "clear"
    school_zone: bool = False
    ped_rate: float = 0.012               # pedestrian calls per crosswalk per second
    surges: list[Surge] = field(default_factory=list)
    turn_shifts: list[TurnShift] = field(default_factory=list)
    incidents: list[Incident] = field(default_factory=list)
    dispatch: DispatchSpec | None = None
    buses: list[BusSpec] = field(default_factory=list)
    watch_for: list[str] = field(default_factory=list)
    phi: float = 28.0                     # Beta precision: higher = less demand randomness
    peaks: list[dict[str, float]] = field(default_factory=list)   # optional Gaussian peaks

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _library() -> dict[str, Scenario]:
    s: dict[str, Scenario] = {}

    s["rush_hour_ambulance"] = Scenario(
        id="rush_hour_ambulance",
        name="Rush-Hour Ambulance",
        tagline="Heavy queues delay an ambulance headed to the hospital.",
        description=(
            "Evening commute on Main St. Demand is high on the main street, queues are long at "
            "every signal, and an ambulance leaves Station 4 for General Hospital."
        ),
        icon="ambulance", intensity=0.82, duration=420,
        surges=[Surge(["F0", "R3"], 0, 420, 1.12, 20)],
        dispatch=DispatchSpec("B_W", "B_E", "ambulance", "critical", 70),
        watch_for=[
            "Fixed-time and reactive preemption both reach red lights or queues the ambulance can't pass.",
            "PriorityPulse starts clearing each queue before the ambulance arrives.",
        ],
    )

    s["school_dismissal"] = Scenario(
        id="school_dismissal",
        name="School Dismissal",
        tagline="Pedestrian clearances and a late school bus constrain every decision.",
        description=(
            "Lincoln School lets out on Pine Ave. Pedestrian calls are frequent, clearance buffers "
            "are longer, a late school bus wants an early green, and an ambulance is dispatched anyway."
        ),
        icon="school", intensity=0.62, duration=420, school_zone=True, ped_rate=0.05,
        surges=[Surge(["SR2_in"], 20, 300, 2.2, 30)],
        dispatch=DispatchSpec("B_W", "B_E", "ambulance", "urgent", 110),
        buses=[BusSpec("Bus 22", "B_SR2", "B_E", 25, late_min=6.0, occupancy=31, school=True)],
        watch_for=[
            "Pedestrian clearance is never cut short, even for the ambulance.",
            "The bus gets an early green only if it doesn't conflict with the emergency route.",
        ],
    )

    s["stadium_exit"] = Scenario(
        id="stadium_exit",
        name="Stadium Exit",
        tagline="A surge of outbound traffic threatens corridor spillback.",
        description=(
            "An event lets out onto Maple Dr and Pine Ave. Demand on the side streets doubles and "
            "turning flows shift onto the main street, threatening to fill the short blocks."
        ),
        icon="stadium", intensity=0.66, duration=420,
        surges=[
            Surge(["SL3_in", "SR3_in"], 10, 330, 3.3, 40),
            Surge(["SL2_in", "SR2_in"], 10, 330, 2.6, 40),
            Surge(["F0"], 0, 420, 1.10, 20),
        ],
        turn_shifts=[
            TurnShift("SL3_in", (-0.15, -0.25, 0.40), 100), TurnShift("SR3_in", (0.40, -0.25, -0.15), 100),
        ],
        dispatch=DispatchSpec("B_SL1", "B_E", "police", "urgent", 120),
        watch_for=[
            "Count the spillback events in each mode.",
            "PriorityPulse refuses to send platoons into a block that is already ≥ 85% full.",
        ],
    )

    s["crash_diversion"] = Scenario(
        id="crash_diversion",
        name="Crash Diversion",
        tagline="A lane closure forces traffic onto a side corridor.",
        description=(
            "A crash closes a lane on the middle block of Main St eastbound, cutting its capacity. "
            "Drivers divert onto Oak St and Maple Dr while an ambulance heads for the hospital."
        ),
        icon="crash", intensity=0.7, duration=420,
        incidents=[Incident("F1", 30, 420, 2, "Crash: eastbound lanes closed")],
        surges=[Surge(["SL1_in", "SR1_in", "SL3_in", "SR3_in"], 40, 380, 1.9, 30)],
        dispatch=DispatchSpec("B_W", "B_E", "ambulance", "critical", 100),
        watch_for=[
            "The block with the closed lane fills quickly; the guard stops upstream green from feeding it.",
            "The ambulance still needs a path through the blocked corridor.",
        ],
    )

    s["fire_station_dispatch"] = Scenario(
        id="fire_station_dispatch",
        name="Fire Station Dispatch",
        tagline="A fire truck needs progression through three intersections.",
        description=(
            "Fire Station 2 sends an engine out of Pine Ave, left onto Main St, through Maple Dr and "
            "right to Riverside Park. Watch the green wave build ahead of it."
        ),
        icon="fire", intensity=0.7, duration=420,
        dispatch=DispatchSpec("B_SL2", "B_SR3", "fire", "critical", 80),
        watch_for=[
            "The truck uses a left turn and a right turn — each needs its own protected phase.",
            "Preemption starts early at each intersection so the green wave stays ahead of the truck.",
        ],
    )

    s["rain_snow"] = Scenario(
        id="rain_snow",
        name="Rain or Snow",
        tagline="Slower speeds and lower discharge rates stretch clearance times.",
        description=(
            "Snow lowers free-flow speed and saturation flow, so queues take longer to clear and the "
            "ambulance needs more lead time at every intersection."
        ),
        icon="snow", intensity=0.66, duration=420, weather="snow",
        dispatch=DispatchSpec("B_E", "B_W", "ambulance", "critical", 80),
        watch_for=[
            "Clearance times grow with weather; the preemption trigger accounts for it automatically.",
        ],
    )
    return s


SCENARIOS: dict[str, Scenario] = _library()


def get_scenario(sid: str) -> Scenario:
    """A private copy: callers may adjust it without touching the shared library."""
    if sid not in SCENARIOS:
        raise KeyError(sid)
    return copy.deepcopy(SCENARIOS[sid])


def custom_scenario(
    *, intensity: float = 0.65, duration: int = 420, weather: str = "clear",
    dispatch: DispatchSpec | None = None, school_zone: bool = False,
) -> Scenario:
    return Scenario(
        id="custom", name="Custom location", tagline="Your corridor, your assumptions.",
        description="Road geometry is map-based; demand, lanes and timing are configurable estimates.",
        icon="map", intensity=intensity, duration=duration, weather=weather,
        school_zone=school_zone, ped_rate=0.04 if school_zone else 0.012, dispatch=dispatch,
    )
