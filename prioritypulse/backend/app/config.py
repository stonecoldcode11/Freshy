"""Tunable parameters, grouped by the layer of the model they belong to.

Everything here is a plain dataclass so it can be serialised to the frontend
(Engineer View shows the live values) and overridden per scenario.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from typing import Any


@dataclass
class PhysicsParams:
    """Layer 0/2 traffic-physics constants."""

    dt: float = 1.0                    # simulation step, seconds
    jam_spacing_m: float = 7.5         # h_jam: metres per stopped vehicle
    r_block: float = 0.85              # downstream storage ratio that blocks inflow
    sat_flow_per_lane: float = 0.5     # veh/s/lane (1800 veh/h/lane)
    left_sat_flow: float = 0.40        # protected left-turn bay, veh/s
    right_sat_flow: float = 0.35       # right turn (shared lane), veh/s
    tau_startup: float = 1.6           # start-up lost-time recovery constant, s
    yellow_flow_factor: float = 0.5    # fraction of s still discharging in yellow
    v_free_main: float = 13.4          # m/s (~30 mph)
    v_free_side: float = 11.2          # m/s (~25 mph)
    eps: float = 1e-6


@dataclass
class SignalParams:
    """Signal-state-machine timing constraints."""

    yellow: float = 3.0                # y_p
    all_red: float = 2.0               # r_p
    g_min_through: float = 8.0
    g_max_through_main: float = 50.0
    g_max_through_side: float = 28.0
    g_min_left: float = 5.0
    g_max_left: float = 15.0
    ped_walk: float = 7.0              # t_walk
    ped_fdw: float = 10.0              # t_FDW (flashing don't walk)
    ped_clear: float = 2.0             # t_clear (remaining clearance buffer)
    # Fixed-time baseline plan (seconds of green per phase, in cycle order)
    fixed_green: tuple[float, float, float, float] = (34.0, 9.0, 20.0, 9.0)
    fixed_offsets: str = "progression"  # "progression" | "none"
    platoon_speed: float = 11.0        # m/s used for progression offsets


@dataclass
class EmergencyParams:
    """Layer 3 emergency-vehicle constants."""

    t_buffer: float = 3.0              # T_buffer
    v_ev: dict[str, float] = field(
        default_factory=lambda: {"routine": 14.0, "urgent": 17.0, "critical": 20.0}
    )
    ev_yield_threshold: int = 1        # queued vehicles that may remain ahead (they pull aside)
    ev_stop_speed: float = 2.0         # m/s below which the EV counts as stopped
    ev_max_hold: float = 15.0          # s at the stop line (green, path clear) before forced pass
    reactive_detect_s: float = 12.0    # reactive preemption: detector ETA threshold
    release_buffer: float = 2.0        # s after the EV clears before preemption is released
    t_critical: float = 25.0           # T_critical: ETA threshold for critical weight
    lookahead_s: float = 90.0          # how far ahead PriorityPulse plans for the EV
    notice_lead: float = 20.0          # s before departure that dispatch tells the signals the route


@dataclass
class ControlWeights:
    """Weights of the PriorityPulse MPC objective J(a)."""

    w_ev_base: float = 40.0
    w_ev_critical: float = 120.0
    w_q: float = 0.012                 # sum Q^2
    w_d: float = 0.35                  # total delay (vehicle-seconds)
    w_s: float = 55.0                  # spillback risk
    w_f: float = 30.0                  # fairness penalty
    w_c: float = 6.0                   # phase-change penalty
    w_p: float = 8.0                   # pedestrian wait penalty
    w_t: float = 20.0                  # transit benefit
    horizon: int = 36                  # H, seconds (24 s was too short to see the full cost of a phase change)
    eta: float = 3.0                   # spillback exponent
    t_fair: float = 60.0               # soft fairness threshold, s
    t_max_allowed: float = 120.0       # hard fairness cap, s
    ped_wait_max: float = 60.0         # seconds a pedestrian should wait at most
    switch_delays: tuple[int, ...] = (0, 5, 10)


@dataclass
class SimConfig:
    """Everything needed to deterministically reproduce a run."""

    scenario_id: str = "rush_hour_ambulance"
    mode: str = "prioritypulse"        # fixed | reactive | prioritypulse
    seed: int = 7
    duration: int = 420                # seconds recorded after warm-up
    warmup: int = 90                   # seconds simulated (not recorded) before t = 0
    intensity: float | None = None     # K level; None -> scenario default
    weather: str = "clear"             # clear | rain | snow
    school_zone: bool = False
    physics: PhysicsParams = field(default_factory=PhysicsParams)
    signals: SignalParams = field(default_factory=SignalParams)
    emergency: EmergencyParams = field(default_factory=EmergencyParams)
    weights: ControlWeights = field(default_factory=ControlWeights)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def with_mode(self, mode: str) -> "SimConfig":
        return replace(self, mode=mode)


# Controller weights a client may override, with hard bounds (a huge horizon would be a trivial DoS).
WEIGHT_BOUNDS: dict[str, tuple[float, float]] = {
    "w_ev_base": (0, 1000), "w_ev_critical": (0, 2000), "w_q": (0, 10), "w_d": (0, 100), "w_s": (0, 1000),
    "w_f": (0, 1000), "w_c": (0, 500), "w_p": (0, 500), "w_t": (0, 500),
    "horizon": (8, 48), "eta": (1, 6), "t_fair": (20, 300), "t_max_allowed": (60, 600), "ped_wait_max": (20, 300),
}


def validate_weights(weights: dict[str, float]) -> dict[str, float]:
    """Reject unknown keys and out-of-range values; returns the weights unchanged when valid."""
    for k, v in weights.items():
        if k not in WEIGHT_BOUNDS:
            raise ValueError(f"unknown weight {k!r}; allowed: {sorted(WEIGHT_BOUNDS)}")
        lo, hi = WEIGHT_BOUNDS[k]
        if not lo <= float(v) <= hi:
            raise ValueError(f"weight {k} must be between {lo} and {hi}")
    return weights


WEATHER_FACTORS = {
    # r_v (free-flow speed), r_s (saturation flow), demand factor
    "clear": (1.0, 1.0, 1.0),
    "rain": (0.85, 0.88, 0.97),
    "snow": (0.65, 0.72, 0.90),
}

MODES = ("fixed", "reactive", "prioritypulse")
