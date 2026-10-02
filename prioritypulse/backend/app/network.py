"""Layer 0: road network as a directed graph G = (N, L).

A *corridor* is the unit PriorityPulse simulates: a main street crossed by
``n`` side streets.  Every intersection has four legs and twelve vehicle
movements (L/T/R from each approach) grouped into four conflict-free phases:

    phase 0  MAIN_THRU   both main-street approaches, through + right
    phase 1  MAIN_LEFT   both main-street approaches, protected left
    phase 2  SIDE_THRU   both side-street approaches, through + right
    phase 3  SIDE_LEFT   both side-street approaches, protected left

Link naming (positions P0 = west/start boundary, P1..Pn = intersections,
P(n+1) = east/end boundary):

    F{k}    forward main link  P_k -> P_(k+1)      k = 0..n
    R{k}    reverse main link  P_(k+1) -> P_k      k = 0..n
    SL{i}_in / SL{i}_out   side street on the left of the forward direction
    SR{i}_in / SR{i}_out   side street on the right of the forward direction

For an east-bound corridor "left of forward" is north, so SL{i}_in carries
south-bound traffic and SR{i}_in carries north-bound traffic.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .config import PhysicsParams

# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------

PHASE_NAMES = ["Main through", "Main left", "Side through", "Side left"]
PHASE_SHORT = ["MAIN_THRU", "MAIN_LEFT", "SIDE_THRU", "SIDE_LEFT"]
MOVES = ("L", "T", "R")

# Approach "role" -> axis.  F/R run along the corridor, SL/SR across it.
AXIS = {"F": "main", "R": "main", "SL": "side", "SR": "side"}
OPPOSITE = {"F": "R", "R": "F", "SL": "SR", "SR": "SL"}

# Base turning splits for exogenous traffic (L, T, R) and for vehicles that
# arrive on internal links (used by the deterministic splitter).
BASE_TURNS_MAIN = (0.12, 0.78, 0.10)
BASE_TURNS_SIDE = (0.20, 0.60, 0.20)

# Base volumes (veh/s at K = 1) per entry link.
BASE_VOLUME_MAIN = 0.55
BASE_VOLUME_SIDE = 0.17

_COMPASS = ["N", "E", "S", "W"]
_BOUND = {"N": "NB", "E": "EB", "S": "SB", "W": "WB"}


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------

EARTH_R = 6_371_000.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def compass_labels(forward_bearing: float) -> dict[str, str]:
    """Names of the four approach roles ("EB", "WB", ...) for a corridor heading."""
    idx = int(((forward_bearing + 45.0) % 360.0) // 90.0)  # 0=N 1=E 2=S 3=W
    fwd = _COMPASS[idx]
    rev = _COMPASS[(idx + 2) % 4]
    # side-left approach heads clockwise from forward (E -> S); side-right counter-clockwise.
    sl = _COMPASS[(idx + 1) % 4]
    sr = _COMPASS[(idx + 3) % 4]
    return {"F": _BOUND[fwd], "R": _BOUND[rev], "SL": _BOUND[sl], "SR": _BOUND[sr]}


def offset_latlon(lat: float, lon: float, bearing_deg: float, dist_m: float) -> tuple[float, float]:
    """Move ``dist_m`` metres from (lat, lon) along a compass bearing (small-distance approximation)."""
    fr = LocalFrame(lat, lon)
    th = math.radians(bearing_deg)
    return fr.to_latlon(dist_m * math.sin(th), dist_m * math.cos(th))


class LocalFrame:
    """Local tangent-plane projection between metres (x east, y north) and lat/lon."""

    def __init__(self, lat0: float, lon0: float) -> None:
        self.lat0, self.lon0 = lat0, lon0
        self.m_per_deg_lat = math.pi * EARTH_R / 180.0
        self.m_per_deg_lon = self.m_per_deg_lat * math.cos(math.radians(lat0))

    def to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self.m_per_deg_lon, (lat - self.lat0) * self.m_per_deg_lat)

    def to_latlon(self, x: float, y: float) -> tuple[float, float]:
        return (self.lat0 + y / self.m_per_deg_lat, self.lon0 + x / self.m_per_deg_lon)


# ---------------------------------------------------------------------------
# data classes
# ---------------------------------------------------------------------------

@dataclass
class Movement:
    """One permitted path through an intersection (index = position in Network.movements)."""

    idx: int
    id: str                 # f"{link}:{kind}"
    link: str               # approach link id
    kind: str               # "L" | "T" | "R"
    node: str               # intersection id
    role: str               # approach role: F | R | SL | SR
    phase: int
    out_link: str
    sat_flow: float         # s, veh/s at clear weather
    lanes: float
    share: float            # fraction of the link's storage this movement owns
    turn_base: float        # base turning proportion pi

    def label(self, compass: dict[str, str]) -> str:
        names = {"L": "left", "T": "through", "R": "right"}
        return f"{compass.get(self.role, self.role)} {names[self.kind]}"


@dataclass
class Link:
    id: str
    frm: str
    to: str
    kind: str               # entry | internal | exit
    role: str               # F | R | SL | SR  (travel direction relative to corridor)
    length: float
    lanes: int
    v_free: float
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 0.0
    y2: float = 0.0
    capacity: int = 0       # C_l
    approach_of: str | None = None   # intersection this link feeds (None for exits)
    base_volume: float = 0.0         # q_base for entry links (veh/s at K = 1)
    turn_base: tuple[float, float, float] = BASE_TURNS_MAIN
    out: dict[str, str] = field(default_factory=dict)   # movement kind -> out link id

    @property
    def free_flow_time(self) -> float:
        return self.length / max(self.v_free, 0.1)


@dataclass
class Crosswalk:
    id: str
    node: str
    name: str
    parallel_phase: int     # walk is displayed during this phase
    x: float = 0.0
    y: float = 0.0


@dataclass
class Intersection:
    id: str
    name: str
    x: float
    y: float
    lat: float = 0.0
    lon: float = 0.0
    index: int = 0
    phases: list[list[int]] = field(default_factory=list)   # movement indices per phase
    crosswalks: list[Crosswalk] = field(default_factory=list)
    approaches: dict[str, str] = field(default_factory=dict)  # role -> approach link id


@dataclass
class Boundary:
    id: str
    name: str
    x: float
    y: float
    lat: float = 0.0
    lon: float = 0.0
    kind: str = "gate"      # station | hospital | school | gate
    entry_link: str = ""
    exit_link: str = ""


@dataclass
class Network:
    name: str
    intersections: list[Intersection]
    boundaries: list[Boundary]
    links: dict[str, Link]
    movements: list[Movement]
    compass: dict[str, str]
    phys: PhysicsParams
    origin_lat: float = 0.0
    origin_lon: float = 0.0
    forward_bearing: float = 90.0
    conflicts: list[list[int]] = field(default_factory=list)  # C[m][n] over movement idx
    source: str = "demo"
    notes: list[str] = field(default_factory=list)

    # -- lookups -----------------------------------------------------------
    def __post_init__(self) -> None:
        self._mv_by_id = {m.id: m for m in self.movements}
        self._node = {n.id: n for n in self.intersections}
        self._bnd = {b.id: b for b in self.boundaries}

    def movement(self, mid: str) -> Movement:
        return self._mv_by_id[mid]

    def intersection(self, nid: str) -> Intersection:
        return self._node[nid]

    def boundary(self, bid: str) -> Boundary:
        return self._bnd[bid]

    def link_ids(self) -> list[str]:
        return list(self.links.keys())

    def movements_of(self, node_id: str) -> list[Movement]:
        return [m for m in self.movements if m.node == node_id]

    def movement_for(self, link: str, kind: str) -> Movement:
        return self._mv_by_id[f"{link}:{kind}"]

    def node_latlon(self, nid: str) -> tuple[float, float]:
        n = self._node.get(nid) or self._bnd[nid]
        return n.lat, n.lon

    def node_xy(self, nid: str) -> tuple[float, float]:
        if nid in self._node:
            n = self._node[nid]
            return n.x, n.y
        b = self._bnd[nid]
        return b.x, b.y

    # -- Layer 0: storage capacity ------------------------------------------
    def storage_capacity(self, link_id: str) -> int:
        """C_l = floor(L_l * n_l / h_jam)."""
        lk = self.links[link_id]
        return int(math.floor(lk.length * lk.lanes / self.phys.jam_spacing_m))

    # -- serialisation -------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        def ll_node(nid: str) -> list[float]:
            la, lo = self.node_latlon(nid)
            return [round(la, 7), round(lo, 7)]

        return {
            "name": self.name,
            "source": self.source,
            "notes": self.notes,
            "origin": [self.origin_lat, self.origin_lon],
            "forward_bearing": self.forward_bearing,
            "compass": self.compass,
            "phase_names": PHASE_NAMES,
            "intersections": [
                {
                    "id": n.id, "name": n.name, "x": n.x, "y": n.y, "index": n.index,
                    "latlon": ll_node(n.id), "phases": n.phases, "approaches": n.approaches,
                    "crosswalks": [
                        {"id": c.id, "name": c.name, "parallel_phase": c.parallel_phase,
                         "x": c.x, "y": c.y} for c in n.crosswalks
                    ],
                }
                for n in self.intersections
            ],
            "boundaries": [
                {"id": b.id, "name": b.name, "x": b.x, "y": b.y, "kind": b.kind,
                 "latlon": ll_node(b.id), "entry_link": b.entry_link, "exit_link": b.exit_link}
                for b in self.boundaries
            ],
            "links": [
                {
                    "id": lk.id, "from": lk.frm, "to": lk.to, "kind": lk.kind, "role": lk.role,
                    "bound": self.compass.get(lk.role, lk.role),
                    "length": round(lk.length, 1), "lanes": lk.lanes, "v_free": lk.v_free,
                    "capacity": lk.capacity, "x1": lk.x1, "y1": lk.y1, "x2": lk.x2, "y2": lk.y2,
                    "latlon1": ll_node(lk.frm), "latlon2": ll_node(lk.to),
                    "approach_of": lk.approach_of, "out": lk.out,
                    "free_flow_time": round(lk.free_flow_time, 1),
                }
                for lk in self.links.values()
            ],
            "movements": [
                {"idx": m.idx, "id": m.id, "link": m.link, "kind": m.kind, "node": m.node,
                 "role": m.role, "phase": m.phase, "out_link": m.out_link,
                 "sat_flow": m.sat_flow, "share": round(m.share, 3),
                 "label": m.label(self.compass)}
                for m in self.movements
            ],
            "conflicts": self.conflicts,
            "r_block": self.phys.r_block,
            "jam_spacing": self.phys.jam_spacing_m,
        }


# ---------------------------------------------------------------------------
# conflict matrix  C_{m,n}
# ---------------------------------------------------------------------------

def movements_conflict(a: Movement, b: Movement) -> bool:
    """Geometric conflict rule for a four-leg intersection with protected lefts.

    * movements from different axes always conflict (crossing or merging paths);
    * on the same axis the only conflicts are a left turn against the opposing
      through/right movement (it crosses it, or merges into the same exit);
    * everything else on the same axis (T/R of one approach, opposing T/T,
      opposing L/L with dual lefts, an approach's own L vs its T) is compatible.
    """
    if a.idx == b.idx:
        return False
    if AXIS[a.role] != AXIS[b.role]:
        return True
    if a.role == b.role:
        return False
    # opposing approaches on the same axis
    if a.kind == "L" and b.kind in ("T", "R"):
        return True
    if b.kind == "L" and a.kind in ("T", "R"):
        return True
    return False


def conflict_matrix(movements: list[Movement]) -> list[list[int]]:
    n = len(movements)
    mat = [[0] * n for _ in range(n)]
    for a in movements:
        for b in movements:
            if movements_conflict(a, b):
                mat[a.idx][b.idx] = 1
    return mat


def validate_phases(net: Network) -> None:
    """Every phase must be conflict-free (so G_m + G_n <= 1 holds by construction)."""
    for node in net.intersections:
        for p, idxs in enumerate(node.phases):
            for i in idxs:
                for j in idxs:
                    if net.conflicts[i][j]:
                        raise ValueError(
                            f"phase {p} at {node.id} contains conflicting movements "
                            f"{net.movements[i].id} / {net.movements[j].id}"
                        )


# ---------------------------------------------------------------------------
# corridor builder
# ---------------------------------------------------------------------------

@dataclass
class CorridorSpec:
    """Inputs to build a corridor (also what the map-based builder produces)."""

    name: str = "Main St corridor"
    n: int = 3
    names: list[str] = field(default_factory=lambda: ["Oak St", "Pine Ave", "Maple Dr"])
    spacing: list[float] = field(default_factory=lambda: [170.0, 170.0])   # between intersections
    entry_length: float = 230.0         # boundary -> first/last intersection on main street
    side_length: float = 190.0
    main_lanes: int = 3                 # includes the left bay
    side_lanes: int = 2
    main_speed: float | None = None     # m/s (None -> physics default)
    side_speed: float | None = None
    origin: tuple[float, float] = (42.2586, -87.8407)   # illustrative placement only
    forward_bearing: float = 90.0
    boundary_names: dict[str, str] = field(default_factory=dict)
    boundary_kinds: dict[str, str] = field(default_factory=dict)
    source: str = "demo"
    notes: list[str] = field(default_factory=list)


def _sat_flows(role: str, lanes: int, phys: PhysicsParams) -> dict[str, tuple[float, float]]:
    """(saturation flow, lane-equivalents) per movement for an approach with ``lanes`` lanes."""
    thru_lanes = max(1, lanes - 1)
    return {
        "T": (phys.sat_flow_per_lane * thru_lanes, float(thru_lanes)),
        "L": (phys.left_sat_flow, 1.0),
        "R": (phys.right_sat_flow, 0.5),
    }


def build_corridor(spec: CorridorSpec, phys: PhysicsParams | None = None) -> Network:
    phys = phys or PhysicsParams()
    n = spec.n
    if n < 1:
        raise ValueError("a corridor needs at least one intersection")
    if len(spec.spacing) != max(0, n - 1):
        raise ValueError("spacing must have n-1 entries")

    v_main = spec.main_speed or phys.v_free_main
    v_side = spec.side_speed or phys.v_free_side
    frame = LocalFrame(*spec.origin)
    compass = compass_labels(spec.forward_bearing)

    # x positions along the corridor: boundary W at 0, intersections after entry_length
    xs = [0.0, spec.entry_length]
    for s in spec.spacing:
        xs.append(xs[-1] + s)
    xs.append(xs[-1] + spec.entry_length)            # east boundary
    # centre the corridor on the origin
    shift = (xs[0] + xs[-1]) / 2.0
    xs = [x - shift for x in xs]

    names = list(spec.names) + [f"Intersection {i + 1}" for i in range(len(spec.names), n)]
    intersections: list[Intersection] = []
    boundaries: list[Boundary] = []
    links: dict[str, Link] = {}

    def add_boundary(bid: str, default_name: str, x: float, y: float, kind: str = "gate") -> Boundary:
        b = Boundary(bid, spec.boundary_names.get(bid, default_name), x, y,
                     kind=spec.boundary_kinds.get(bid, kind))
        boundaries.append(b)
        return b

    # nodes
    west = add_boundary("B_W", "West end", xs[0], 0.0)
    east = add_boundary("B_E", "East end", xs[-1], 0.0)
    for i in range(1, n + 1):
        nd = Intersection(f"I{i}", names[i - 1], xs[i], 0.0, index=i - 1)
        intersections.append(nd)
        add_boundary(f"B_SL{i}", f"{names[i - 1]} north end", xs[i], spec.side_length)
        add_boundary(f"B_SR{i}", f"{names[i - 1]} south end", xs[i], -spec.side_length)

    def pos(nid: str) -> tuple[float, float]:
        for nd in intersections:
            if nd.id == nid:
                return nd.x, nd.y
        for b in boundaries:
            if b.id == nid:
                return b.x, b.y
        raise KeyError(nid)

    def mk_link(lid: str, frm: str, to: str, role: str, lanes: int, v: float,
                kind: str) -> Link:
        x1, y1 = pos(frm)
        x2, y2 = pos(to)
        length = math.hypot(x2 - x1, y2 - y1)
        lk = Link(lid, frm, to, kind, role, length, lanes, v, x1, y1, x2, y2)
        lk.capacity = int(math.floor(length * lanes / phys.jam_spacing_m))
        lk.turn_base = BASE_TURNS_MAIN if AXIS[role] == "main" else BASE_TURNS_SIDE
        links[lid] = lk
        return lk

    chain = ["B_W"] + [f"I{i}" for i in range(1, n + 1)] + ["B_E"]
    for k in range(n + 1):
        a, b = chain[k], chain[k + 1]
        f_kind = "entry" if k == 0 else ("exit" if k == n else "internal")
        r_kind = "entry" if k == n else ("exit" if k == 0 else "internal")
        mk_link(f"F{k}", a, b, "F", spec.main_lanes, v_main, f_kind)
        mk_link(f"R{k}", b, a, "R", spec.main_lanes, v_main, r_kind)
    for i in range(1, n + 1):
        mk_link(f"SL{i}_in", f"B_SL{i}", f"I{i}", "SL", spec.side_lanes, v_side, "entry")
        mk_link(f"SL{i}_out", f"I{i}", f"B_SL{i}", "SR", spec.side_lanes, v_side, "exit")
        mk_link(f"SR{i}_in", f"B_SR{i}", f"I{i}", "SR", spec.side_lanes, v_side, "entry")
        mk_link(f"SR{i}_out", f"I{i}", f"B_SR{i}", "SL", spec.side_lanes, v_side, "exit")

    # exit links: roles above describe the travel direction.  SL_out carries traffic
    # heading to the left-side boundary, i.e. moving "away from the right", which is
    # the SR *travel* direction; this keeps compass labels consistent per link.
    for b in boundaries:
        if b.id == "B_W":
            b.entry_link, b.exit_link = "F0", "R0"
        elif b.id == "B_E":
            b.entry_link, b.exit_link = f"R{n}", f"F{n}"
        else:
            i = b.id.split("SL")[-1] if "SL" in b.id else b.id.split("SR")[-1]
            side = "SL" if "SL" in b.id else "SR"
            b.entry_link, b.exit_link = f"{side}{i}_in", f"{side}{i}_out"
    west.kind = spec.boundary_kinds.get("B_W", "station")
    east.kind = spec.boundary_kinds.get("B_E", "hospital")

    # entry volumes
    for lk in links.values():
        if lk.kind == "entry":
            lk.base_volume = BASE_VOLUME_MAIN if AXIS[lk.role] == "main" else BASE_VOLUME_SIDE

    # movements + routing tables
    movements: list[Movement] = []
    for nd in intersections:
        i = nd.index + 1
        approach = {
            "F": f"F{i - 1}", "R": f"R{i}", "SL": f"SL{i}_in", "SR": f"SR{i}_in",
        }
        out_link = {
            ("F", "T"): f"F{i}", ("F", "L"): f"SL{i}_out", ("F", "R"): f"SR{i}_out",
            ("R", "T"): f"R{i - 1}", ("R", "L"): f"SR{i}_out", ("R", "R"): f"SL{i}_out",
            ("SL", "T"): f"SR{i}_out", ("SL", "L"): f"F{i}", ("SL", "R"): f"R{i - 1}",
            ("SR", "T"): f"SL{i}_out", ("SR", "L"): f"R{i - 1}", ("SR", "R"): f"F{i}",
        }
        phase_of = {
            ("main", "L"): 1, ("main", "T"): 0, ("main", "R"): 0,
            ("side", "L"): 3, ("side", "T"): 2, ("side", "R"): 2,
        }
        nd.approaches = dict(approach)
        nd.phases = [[], [], [], []]
        for role in ("F", "R", "SL", "SR"):
            lk = links[approach[role]]
            lk.approach_of = nd.id
            flows = _sat_flows(role, lk.lanes, phys)
            total_lane_eq = sum(f[1] for f in flows.values())
            for kind_idx, kind in enumerate(MOVES):
                s, lane_eq = flows[kind]
                mv = Movement(
                    idx=len(movements), id=f"{lk.id}:{kind}", link=lk.id, kind=kind,
                    node=nd.id, role=role, phase=phase_of[(AXIS[role], kind)],
                    out_link=out_link[(role, kind)], sat_flow=s, lanes=lane_eq,
                    share=lane_eq / total_lane_eq, turn_base=lk.turn_base[kind_idx],
                )
                movements.append(mv)
                nd.phases[mv.phase].append(mv.idx)
                lk.out[kind] = mv.out_link
        # crosswalks: across the main street (walk parallel to side traffic, phase 2)
        # and across the side street (walk parallel to main traffic, phase 0)
        nd.crosswalks = [
            Crosswalk(f"{nd.id}_X_main", nd.id, f"{nd.name}: crossing Main St", 2, nd.x - 14.0, nd.y),
            Crosswalk(f"{nd.id}_X_side", nd.id, f"{nd.name}: crossing side street", 0, nd.x, nd.y + 14.0),
        ]

    lat0, lon0 = spec.origin
    th = math.radians(spec.forward_bearing)

    def rotated(x: float, y: float) -> tuple[float, float]:
        # corridor frame: x along the forward bearing, y to its left
        east = x * math.sin(th) - y * math.cos(th)
        north = x * math.cos(th) + y * math.sin(th)
        return frame.to_latlon(east, north)

    for nd in intersections:
        nd.lat, nd.lon = rotated(nd.x, nd.y)
    for b in boundaries:
        b.lat, b.lon = rotated(b.x, b.y)

    net = Network(
        name=spec.name, intersections=intersections, boundaries=boundaries, links=links,
        movements=movements, compass=compass, phys=phys, origin_lat=lat0, origin_lon=lon0,
        forward_bearing=spec.forward_bearing, source=spec.source, notes=list(spec.notes),
    )
    net.conflicts = conflict_matrix(movements)
    validate_phases(net)
    return net


def demo_corridor(phys: PhysicsParams | None = None, n: int = 3) -> Network:
    names = ["Oak St", "Pine Ave", "Maple Dr", "Cedar Ln", "Elm St"][:n]
    spec = CorridorSpec(
        name="Demo corridor — Main St", n=n, names=names,
        spacing=[170.0] * (n - 1),
        boundary_names={
            "B_W": "Station 4 (west)", "B_E": "General Hospital (east)",
            "B_SL1": "Oak St north", "B_SR1": "Oak St south",
            "B_SL2": "Fire Station 2 (Pine Ave north)", "B_SR2": "Lincoln School (Pine Ave south)",
            "B_SL3": "Maple Dr north", "B_SR3": "Riverside Park (Maple Dr south)",
        },
        boundary_kinds={
            "B_W": "station", "B_E": "hospital", "B_SL2": "station", "B_SR2": "school",
            "B_SR3": "gate",
        },
        notes=["Illustrative placement: the demo corridor is fictional and not tied to a real road."],
    )
    return build_corridor(spec, phys)


# ---------------------------------------------------------------------------
# routing
# ---------------------------------------------------------------------------

@dataclass
class RouteStop:
    """One controlled intersection on an emergency route."""

    node: str
    link_in: str
    movement: Movement
    link_out: str
    dist_to_stop: float     # cumulative metres from origin to this approach's stop line


@dataclass
class Route:
    links: list[str]
    nodes: list[str]
    total_length: float
    stops: list[RouteStop]
    cum_ends: list[float] = field(default_factory=list)   # cumulative length at the end of each link

    def locate(self, s: float) -> tuple[str, float]:
        """(link id, fraction along that link) for a distance ``s`` along the route."""
        start = 0.0
        for lid, end in zip(self.links, self.cum_ends):
            if s <= end + 1e-9:
                span = max(end - start, 1e-9)
                return lid, min(1.0, max(0.0, (s - start) / span))
            start = end
        return self.links[-1], 1.0


def find_route(net: Network, origin: str, destination: str) -> Route:
    """Shortest path between two boundary nodes, without U-turns."""
    import heapq

    if origin == destination:
        raise ValueError("origin and destination must differ")
    for nid in (origin, destination):
        if nid not in net._bnd:
            raise ValueError(f"unknown boundary node {nid!r}")
    start_link = net.boundary(origin).entry_link
    goal_node = destination
    # state = link just traversed; edges follow permitted movements
    best: dict[str, float] = {start_link: net.links[start_link].length}
    prev: dict[str, str | None] = {start_link: None}
    heap = [(best[start_link], start_link)]
    end_link: str | None = None
    while heap:
        d, lid = heapq.heappop(heap)
        if d > best.get(lid, math.inf):
            continue
        lk = net.links[lid]
        if lk.to == goal_node:
            end_link = lid
            break
        for out_id in lk.out.values():
            nd = d + net.links[out_id].length
            if nd < best.get(out_id, math.inf):
                best[out_id] = nd
                prev[out_id] = lid
                heapq.heappush(heap, (nd, out_id))
    if end_link is None:
        raise ValueError(f"no route from {origin} to {destination}")
    chain: list[str] = []
    cur: str | None = end_link
    while cur is not None:
        chain.append(cur)
        cur = prev[cur]
    chain.reverse()

    stops: list[RouteStop] = []
    cum = 0.0
    cum_ends: list[float] = []
    for k, lid in enumerate(chain):
        lk = net.links[lid]
        cum += lk.length
        cum_ends.append(cum)
        if lk.approach_of is not None and k + 1 < len(chain):
            nxt = chain[k + 1]
            kind = next(kd for kd, o in lk.out.items() if o == nxt)
            stops.append(RouteStop(lk.approach_of, lid, net.movement_for(lid, kind), nxt, cum))
    nodes = [net.links[chain[0]].frm] + [net.links[c].to for c in chain]
    return Route(chain, nodes, cum, stops, cum_ends)
