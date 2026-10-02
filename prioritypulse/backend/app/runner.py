"""Build a run (network + scenario + demand), execute it under one or more modes,
and assemble the comparison.  All modes share a single DemandTable, so they face
exactly the same exogenous arrivals and pedestrian calls."""

from __future__ import annotations

import copy
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from .config import MODES, SimConfig, validate_weights
from .demand import generate_demand
from .geo import network_from_spec
from .metrics import MODE_LABELS, compare, compile_metrics
from .network import Network
from .scenarios import DispatchSpec, Scenario, custom_scenario, get_scenario
from .simulator import RunResult, Simulation


def make_controller(mode: str):
    if mode == "fixed":
        from .controllers.fixed import FixedTimeController
        return FixedTimeController()
    if mode == "reactive":
        from .controllers.reactive import ReactiveController
        return ReactiveController()
    if mode == "prioritypulse":
        from .controllers.prioritypulse import PriorityPulseController
        return PriorityPulseController()
    raise ValueError(f"unknown mode {mode!r}")


@dataclass
class RunRequest:
    scenario_id: str = "rush_hour_ambulance"
    seed: int = 7
    modes: tuple[str, ...] = MODES
    duration: int | None = None
    intensity: float | None = None
    weather: str | None = None
    school_zone: bool | None = None
    dispatch: dict[str, Any] | None = None       # origin, destination, etype, priority, t  (or {"enabled": False})
    network: dict[str, Any] | None = None        # network spec (demo / points)
    ped_calls: list[tuple[int, str]] | None = None
    weights: dict[str, float] | None = None
    fixed_offsets: str | None = None
    include_frames: bool = True


def resolve_scenario(req: RunRequest) -> Scenario:
    if req.scenario_id == "custom":
        sc = custom_scenario(
            intensity=req.intensity or 0.65, duration=req.duration or 420,
            weather=req.weather or "clear", school_zone=bool(req.school_zone),
        )
    else:
        sc = get_scenario(req.scenario_id)
    return sc


def resolve_dispatch(sc: Scenario, req: RunRequest, net: Network) -> DispatchSpec | None:
    d = req.dispatch
    if d is None:
        spec = sc.dispatch
        if spec is not None:
            _check_stations(net, spec.origin, spec.destination, "the scenario's default dispatch")
        return spec
    if d.get("enabled") is False:
        return None
    base = sc.dispatch
    spec = DispatchSpec(
        origin=d.get("origin") or (base.origin if base else "B_W"),
        destination=d.get("destination") or (base.destination if base else "B_E"),
        etype=d.get("etype") or (base.etype if base else "ambulance"),
        priority=d.get("priority") or (base.priority if base else "critical"),
        t=float(d.get("t", base.t if base else 60.0)),
    )
    _check_stations(net, spec.origin, spec.destination, "the dispatch")
    return spec


def _check_stations(net: Network, origin: str, destination: str, what: str) -> None:
    valid = [b.id for b in net.boundaries]
    for role, bid in (("origin", origin), ("destination", destination)):
        if bid not in valid:
            raise ValueError(f"{what} uses {role} {bid!r}, which is not on this network. Valid stations: {', '.join(valid)}")


def build_config(req: RunRequest, sc: Scenario, mode: str) -> SimConfig:
    cfg = SimConfig(scenario_id=sc.id, mode=mode, seed=req.seed)
    cfg.duration = int(req.duration or sc.duration)
    cfg.intensity = req.intensity if req.intensity is not None else sc.intensity
    cfg.weather = req.weather or sc.weather
    cfg.school_zone = sc.school_zone if req.school_zone is None else req.school_zone
    if req.weights:
        for k, v in validate_weights(req.weights).items():       # defence in depth: also checked in the schema
            setattr(cfg.weights, k, type(getattr(cfg.weights, k))(v))
    if req.fixed_offsets in ("progression", "none"):
        cfg.signals.fixed_offsets = req.fixed_offsets
    return cfg


def run_mode(net: Network, cfg: SimConfig, sc: Scenario, mode: str, demand, dispatch, ped_calls,
             include_frames: bool = True, q_normal: float | None = None) -> RunResult:
    cfg = copy.deepcopy(cfg)
    cfg.mode = mode
    ctrl = make_controller(mode)
    t0 = time.perf_counter()
    sim = Simulation(net, cfg, sc, ctrl, demand=demand, dispatch=dispatch if dispatch else False,
                     extra_ped_calls=ped_calls)
    sim.run()
    metrics, safety = compile_metrics(sim, q_normal)
    ev = sim.ev
    ev_info = None
    if ev is not None:
        ev_info = {
            "id": ev.id, "label": ev.label, "etype": ev.etype, "priority": ev.priority,
            "t_dispatch": ev.t_dispatch, "speed": round(ev.speed, 2),
            "route": {
                "links": ev.route.links, "nodes": ev.route.nodes, "length": round(ev.route.total_length, 1),
                "cum_ends": [round(c, 1) for c in ev.route.cum_ends],
                "stops": [
                    {"node": s.node, "link_in": s.link_in, "movement": s.movement.id,
                     "kind": s.movement.kind, "phase": s.movement.phase, "link_out": s.link_out,
                     "dist": round(s.dist_to_stop, 1)}
                    for s in ev.route.stops
                ],
            },
            "passed_at": [None if p is None else round(p, 1) for p in ev.passed_at],
            "t_arrive": None if ev.t_arrive is None else round(ev.t_arrive, 1),
        }
    buses = []
    for pv in sim.pvs:
        if pv.kind == "bus":
            buses.append({"id": pv.id, "label": pv.label, "t_dispatch": pv.t_dispatch,
                          "route": {"links": pv.route.links, "length": round(pv.route.total_length, 1),
                                    "cum_ends": [round(c, 1) for c in pv.route.cum_ends]},
                          "late_min": pv.late_min, "occupancy": pv.occupancy})
    cfg_dict = cfg.to_dict()
    return RunResult(
        mode=mode, config=cfg_dict, frames=sim.frames if include_frames else [],
        events=sim.events, decisions=sim.decisions, metrics=metrics, series=sim.series,
        ev=ev_info, buses=buses,
        safety={"transitions": safety.transitions, "legal": safety.legal,
                "violations": safety.violations[:10], "steps_checked": safety.steps_checked,
                "conflict_steps": safety.conflict_steps, "compliance_pct": round(safety.compliance_pct, 1)},
        elapsed_s=round(time.perf_counter() - t0, 2),
    )


def execute(req: RunRequest) -> dict[str, Any]:
    sc = resolve_scenario(req)
    base_cfg = build_config(req, sc, "fixed")
    net = network_from_spec(req.network, base_cfg.physics)
    dispatch = resolve_dispatch(sc, req, net)
    demand = generate_demand(net, base_cfg, sc)
    results: dict[str, RunResult] = {}
    q_normal: float | None = None
    for mode in sorted(req.modes, key=MODES.index):      # fixed first: it defines "normal" for recovery
        results[mode] = run_mode(net, base_cfg, sc, mode, demand, dispatch, req.ped_calls,
                                 include_frames=req.include_frames, q_normal=q_normal)
        if mode == "fixed":
            q_normal = results[mode].metrics["q_normal"]
    comparison = compare({m: r.metrics for m, r in results.items()}) if len(results) > 1 else None
    return {
        "run_id": uuid.uuid4().hex[:12],
        "scenario": sc.to_dict(),
        "network": net.to_dict(),
        "dispatch": None if not dispatch else {
            "origin": dispatch.origin, "destination": dispatch.destination, "etype": dispatch.etype,
            "priority": dispatch.priority, "t": dispatch.t},
        "seed": req.seed,
        "duration": base_cfg.duration,
        "warmup": base_cfg.warmup,
        "demand": {"total_arrivals": demand.total_arrivals,
                   "mean_K": round(float(demand.K.mean()), 3)},
        "mode_labels": MODE_LABELS,
        "runs": {m: _result_to_dict(r) for m, r in results.items()},
        "comparison": comparison,
    }


def _result_to_dict(r: RunResult) -> dict[str, Any]:
    return {
        "mode": r.mode, "config": r.config, "frames": r.frames, "events": r.events,
        "decisions": r.decisions, "metrics": r.metrics, "series": r.series, "ev": r.ev,
        "buses": r.buses, "safety": r.safety, "elapsed_s": r.elapsed_s,
    }


# ---------------------------------------------------------------------------
# in-memory run store (for exports)
# ---------------------------------------------------------------------------

class RunStore:
    def __init__(self, capacity: int = 8) -> None:       # ~14 MB per stored run
        self.capacity = capacity
        self._items: "OrderedDict[str, dict[str, Any]]" = OrderedDict()

    def put(self, run: dict[str, Any]) -> None:
        self._items[run["run_id"]] = run
        self._items.move_to_end(run["run_id"])
        while len(self._items) > self.capacity:
            self._items.popitem(last=False)

    def get(self, run_id: str) -> dict[str, Any] | None:
        return self._items.get(run_id)


STORE = RunStore()
