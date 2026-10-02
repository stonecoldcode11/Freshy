"""Priority vehicles (emergency vehicles and buses) travelling a fixed route.

A priority vehicle moves at its free-flow speed until it reaches the back of the
queue of the movement it needs at the next stop line.  It then *freezes* the
number of vehicles ahead of it (``ahead``) and creeps forward as that queue
discharges.  It may cross the stop line once

    signal for its movement is green   AND   ahead <= yield_threshold

Emergency vehicles use ``yield_threshold = 1`` (siren: one vehicle can pull
aside); buses wait for the whole queue ahead of them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .network import Route

if TYPE_CHECKING:  # pragma: no cover
    from .simulator import Simulation

CREEP_SPEED = 5.0       # m/s while moving up through a discharging queue
BOX_LENGTH = 6.0        # metres added when crossing the intersection box


@dataclass
class PriorityVehicle:
    id: str
    kind: str                       # "ev" | "bus"
    label: str
    route: Route
    t_dispatch: float
    speed: float                    # free-flow speed along the route, m/s
    etype: str = "ambulance"
    priority: str = "critical"
    yield_threshold: int = 1
    late_min: float = 0.0           # buses
    occupancy: int = 0              # buses
    school: bool = False

    # dynamic state
    status: str = "pending"         # pending | enroute | done
    s: float = 0.0                  # distance travelled along the route, m
    j: int = 0                      # index of next stop line on the route
    joined: bool = False
    ahead: int = 0
    held: float = 0.0               # seconds spent at the stop line with green + clear path
    v_now: float = 0.0
    t_arrive: float | None = None
    stops: int = 0                  # number of times the vehicle came to a stop
    stop_seconds: float = 0.0
    _was_stopped: bool = False
    passed_at: list[float | None] = field(default_factory=list)
    wait_at: list[float] = field(default_factory=list)   # delay vs free-flow at each stop line
    _arrived_stop_at: float | None = None
    stop_overrides: int = 0
    # filled by controllers: predicted delay per upcoming stop (seconds)
    expected_delay: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        n = len(self.route.stops)
        self.passed_at = [None] * n
        self.wait_at = [0.0] * n
        self.expected_delay = [0.0] * n

    # -- geometry ----------------------------------------------------------------
    def free_flow_time(self) -> float:
        return self.route.total_length / max(self.speed, 0.1)

    def stop_dist(self, j: int) -> float:
        return self.route.stops[j].dist_to_stop

    def remaining_to_stop(self, j: int) -> float:
        return max(0.0, self.stop_dist(j) - self.s)

    def eta_free(self, j: int, now: float) -> float:
        """Free-flow arrival time at the stop line of stop ``j`` (absolute time)."""
        if self.status == "pending":
            return self.t_dispatch + self.stop_dist(j) / max(self.speed, 0.1)
        return now + self.remaining_to_stop(j) / max(self.speed, 0.1)

    # -- dynamics ------------------------------------------------------------------
    def step(self, sim: "Simulation", now: float, dt: float) -> None:
        if self.status == "done":
            self.v_now = 0.0
            return
        if self.status == "pending":
            if now < self.t_dispatch:
                return
            self.status = "enroute"
        s0 = self.s
        net = sim.net
        jam = net.phys.jam_spacing_m
        s_free = s0 + self.speed * dt
        s_new = s_free

        if self.j < len(self.route.stops):
            stop = self.route.stops[self.j]
            S = stop.dist_to_stop
            mv = stop.movement
            lk = net.links[mv.link]
            lanes = max(mv.lanes, 0.5)
            joined_now = False
            if not self.joined:
                q_now = sim.Q[mv.idx]
                join_pos = max(S - lk.length, S - q_now / lanes * jam)   # tail of the queue
                if q_now > self.yield_threshold and s_free >= join_pos:
                    s_new = max(s0, join_pos)
                    self.joined, self.ahead, joined_now = True, q_now, True
                elif s_free >= S:
                    s_new = S
                    self.joined, self.ahead = True, q_now
            if self.joined and not joined_now:
                front = S - max(0, self.ahead - self.yield_threshold) / lanes * jam
                s_new = min(s0 + min(self.speed, CREEP_SPEED) * dt, front, S)
                s_new = max(s_new, s0)
                if s_new >= S - 1e-6 and self.ahead <= self.yield_threshold:
                    if self._arrived_stop_at is None:
                        self._arrived_stop_at = now
                    green = sim.is_green(mv)
                    if green or self.held >= sim.cfg.emergency.ev_max_hold:
                        if not green:
                            self.stop_overrides += 1
                        self.wait_at[self.j] = max(0.0, now - self.eta_free_at_dispatch(self.j))
                        self.passed_at[self.j] = now
                        self.j += 1
                        self.joined, self.ahead, self.held = False, 0, 0.0
                        self._arrived_stop_at = None
                        s_new = S + BOX_LENGTH
                    else:
                        self.held += dt
                        s_new = S
        if s_new >= self.route.total_length:
            s_new = self.route.total_length
            self.status = "done"
            self.t_arrive = now + (self.route.total_length - s0) / max(self.speed, 0.1)
        self.s = s_new
        self.v_now = (s_new - s0) / dt
        stopped = self.v_now < sim.cfg.emergency.ev_stop_speed and self.status == "enroute"
        if stopped:
            self.stop_seconds += dt
            if not self._was_stopped:
                self.stops += 1
        self._was_stopped = stopped

    def eta_free_at_dispatch(self, j: int) -> float:
        """Arrival time at stop line j if the vehicle had never been delayed."""
        return self.t_dispatch + self.stop_dist(j) / max(self.speed, 0.1)

    def travel_time(self) -> float | None:
        if self.t_arrive is None:
            return None
        return self.t_arrive - self.t_dispatch

    def delay(self) -> float | None:
        tt = self.travel_time()
        return None if tt is None else max(0.0, tt - self.free_flow_time())

    def priority_score(self) -> float:
        """P_b(t) = w_L * lateness + w_O * occupancy (transit only)."""
        return 0.6 * self.late_min + 0.05 * self.occupancy

    def snapshot(self, sim: "Simulation") -> dict:
        return {
            "id": self.id, "kind": self.kind, "label": self.label, "st": self.status,
            "s": round(self.s, 1), "v": round(self.v_now, 1), "j": self.j,
            "ahead": self.ahead if self.joined else None, "held": round(self.held, 1),
            "stops": self.stops, "etype": self.etype,
        }
