"""Evaluation metrics (single run) and the three-mode comparison / outcome report."""

from __future__ import annotations

import statistics
from typing import Any, TYPE_CHECKING

from .config import MODES

if TYPE_CHECKING:  # pragma: no cover
    from .simulator import Simulation

CO2_G_PER_IDLE_VEH_S = 0.7      # ASSUMED scenario parameter (grams CO2 per vehicle-second idling)

MODE_LABELS = {"fixed": "Fixed-time", "reactive": "Reactive preemption", "prioritypulse": "PriorityPulse"}


def recovery_time(queue: list[int], t_clear: float | None, q_normal: float) -> float | None:
    """T_recovery = min{ tau >= 0 : Q_network(t_clear + tau) <= Q_normal }  (None: not within the run)."""
    if t_clear is None:
        return None
    start = max(0, int(round(t_clear)))
    for k in range(start, len(queue)):
        if queue[k] <= q_normal:
            return float(k - start)
    return None


def normal_queue(queue: list[int], t_dispatch: float | None) -> float:
    """Reference "normal" network queue: the level seen before the dispatch (+15% + 2 vehicles)."""
    if not queue:
        return 0.0
    end = len(queue) if t_dispatch is None else int(max(10, min(len(queue), t_dispatch)))
    base = statistics.mean(queue[:end]) if end else statistics.mean(queue)
    return 1.15 * base + 2.0


def compile_metrics(sim: "Simulation", q_normal: float | None = None):
    a = sim.acc
    completed_rec = sim.completed - sim._c0
    admitted_rec = sim.admitted - sim._a0
    # every vehicle present at some point in the window: finished + still in the system
    vehicles = max(1, completed_rec + sim.vehicles_in_system())
    ev = sim.ev
    sig_logs = [sg.log for sg in sim.signals]
    safety = sim.monitor.audit(sig_logs)

    ev_m: dict[str, Any] | None = None
    t_clear = None
    t_dispatch = None
    if ev is not None:
        t_dispatch = ev.t_dispatch
        tt = ev.travel_time()
        t_clear = ev.passed_at[-1] if ev.passed_at else None
        ev_m = {
            "travel_time": None if tt is None else round(tt, 1),
            "free_flow_time": round(ev.free_flow_time(), 1),
            "delay": None if tt is None else round(max(0.0, tt - ev.free_flow_time()), 1),
            "stops": ev.stops,
            "stop_seconds": round(ev.stop_seconds, 1),
            "arrived": ev.status == "done",
            "forced_passes": ev.stop_overrides,
            "route_length": round(ev.route.total_length, 0),
            "per_intersection_delay": [round(w, 1) for w in ev.wait_at],
            "passed_at": [None if p is None else round(p, 1) for p in ev.passed_at],
        }

    q_norm = q_normal if q_normal is not None else normal_queue(sim.series["queue"], t_dispatch)
    rec = recovery_time(sim.series["queue"], t_clear, q_norm) if ev is not None else None
    n_spill = sum(sim.spill_events.values())
    buses = [pv for pv in sim.pvs if pv.kind == "bus"]
    bus_m = [{
        "id": b.id, "travel_time": None if b.travel_time() is None else round(b.travel_time(), 1),
        "delay": None if b.delay() is None else round(b.delay(), 1), "stops": b.stops,
        "late_min": b.late_min, "occupancy": b.occupancy,
    } for b in buses]

    served = sum(pd.served for sg in sim.signals for pd in sg.peds)
    return {
        "ev": ev_m,
        "avg_delay_s": round(a["delay"] / vehicles, 2),
        "total_delay_veh_s": round(a["delay"], 0),
        "throughput": int(a["dep"]),
        "completed": int(completed_rec),
        "admitted": int(admitted_rec),
        "vehicles_counted": int(vehicles),
        "max_queue": int(a["max_q"]),
        "max_link_fill_pct": round(100.0 * a["max_occ"], 1),
        "spillback_events": int(n_spill),
        "spillback_seconds": int(a["spill_secs"]),
        "spillback_by_link": dict(sim.spill_events),
        "idling_veh_s": round(a["idle"], 0),
        "idling_veh_min": round(a["idle"] / 60.0, 1),
        "co2_g_assumed": round(a["idle"] * CO2_G_PER_IDLE_VEH_S, 0),
        "max_wait_s": round(a["max_wait"], 0),
        "seconds_over_fair_wait": int(a["wait_over_fair"]),
        "ped_calls_served": int(served),
        "ped_max_wait_s": round(a["ped_max_wait"], 0),
        "recovery_time_s": rec,
        "q_normal": round(q_norm, 1),
        "backlog_peak": int(a["backlog_peak"]),
        "safety_compliance_pct": round(safety.compliance_pct, 1),
        "signal_transitions": safety.transitions,
        "safety_violations": safety.violations[:10],
        "conflict_steps": safety.conflict_steps,
        "buses": bus_m,
    }, safety


# ---------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------

def _get(m: dict, path: str) -> Any:
    cur: Any = m
    for part in path.split("."):
        if cur is None:
            return None
        if isinstance(cur, list):
            cur = cur[int(part)] if part.isdigit() and int(part) < len(cur) else None
        else:
            cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


COMPARE_ROWS = [
    # key, label, unit, lower-is-better, path
    ("ev_time", "Emergency travel time", "s", True, "ev.travel_time"),
    ("ev_delay", "Emergency delay vs free-flow", "s", True, "ev.delay"),
    ("ev_stops", "Emergency stops", "", True, "ev.stops"),
    ("avg_delay", "Average driver delay", "s", True, "avg_delay_s"),
    ("throughput", "Throughput (stop-line departures)", "veh", False, "throughput"),
    ("max_queue", "Maximum queue", "veh", True, "max_queue"),
    ("spill", "Spillback events", "", True, "spillback_events"),
    ("spill_s", "Seconds of blocked links", "s", True, "spillback_seconds"),
    ("recovery", "Network recovery time", "s", True, "recovery_time_s"),
    ("bus_delay", "Late bus delay", "s", True, "buses.0.delay"),
    ("idling", "Idling (vehicle-minutes)", "veh·min", True, "idling_veh_min"),
    ("max_wait", "Longest movement wait", "s", True, "max_wait_s"),
    ("safety", "Safety compliance", "%", False, "safety_compliance_pct"),
]


def compare(metrics_by_mode: dict[str, dict]) -> dict[str, Any]:
    rows = []
    for key, label, unit, lower, path in COMPARE_ROWS:
        vals = {m: _get(metrics_by_mode[m], path) for m in metrics_by_mode}
        present = {m: v for m, v in vals.items() if v is not None}
        if key == "bus_delay" and not present:
            continue                                   # scenarios without a bus have no transit row
        best = None
        if present:
            target = min(present.values()) if lower else max(present.values())
            winners = [m for m, v in present.items() if v == target]
            best = winners[0] if len(winners) == 1 else None
        rows.append({"key": key, "label": label, "unit": unit, "lower_is_better": lower,
                     "values": vals, "best": best})
    out: dict[str, Any] = {"rows": rows, "report": outcome_report(metrics_by_mode)}
    return out


def _improvement(base: float | None, new: float | None) -> float | None:
    if base is None or new is None or base <= 0:
        return None
    return round(100.0 * (base - new) / base, 1)


def outcome_report(mm: dict[str, dict]) -> dict[str, Any] | None:
    """"What changed?" — PriorityPulse vs each baseline, in plain numbers."""
    if "prioritypulse" not in mm:
        return None
    pp = mm["prioritypulse"]
    rep: dict[str, Any] = {}
    for base in ("fixed", "reactive"):
        if base not in mm:
            continue
        b = mm[base]
        t_b, t_p = _get(b, "ev.travel_time"), _get(pp, "ev.travel_time")
        rec_b, rec_p = b.get("recovery_time_s"), pp.get("recovery_time_s")
        rep[base] = {
            "ev_time_saved_s": None if t_b is None or t_p is None else round(t_b - t_p, 1),
            "ev_improvement_pct": _improvement(t_b, t_p),
            "ev_stops_avoided": None if _get(b, "ev.stops") is None else _get(b, "ev.stops") - _get(pp, "ev.stops"),
            "max_queue_reduced": b["max_queue"] - pp["max_queue"],
            "spillback_prevented": b["spillback_events"] - pp["spillback_events"],
            "recovery_improved_s": None if rec_b is None or rec_p is None else round(rec_b - rec_p, 1),
            "idling_reduced_veh_min": round(b["idling_veh_min"] - pp["idling_veh_min"], 1),
            "avg_delay_change_s": round(pp["avg_delay_s"] - b["avg_delay_s"], 2),
            "throughput_change": pp["throughput"] - b["throughput"],
        }
    rep["safety_compliance_pct"] = pp["safety_compliance_pct"]
    rep["pedestrian_constraints_satisfied_pct"] = pp["safety_compliance_pct"]
    rep["co2_assumption_g_per_veh_s"] = CO2_G_PER_IDLE_VEH_S
    return rep


__all__ = ["compile_metrics", "compare", "MODE_LABELS", "MODES", "recovery_time", "normal_queue"]
