"""Report / export centre: CSV tables and a plain-language Markdown outcome report."""

from __future__ import annotations

import csv
import io
from typing import Any

from .metrics import CO2_G_PER_IDLE_VEH_S, MODE_LABELS

MODE_ORDER = ["fixed", "reactive", "prioritypulse"]


def _modes(run: dict[str, Any]) -> list[str]:
    return [m for m in MODE_ORDER if m in run["runs"]]


def _fmt(v: Any, unit: str = "") -> str:
    if v is None:
        return "not reached"
    if isinstance(v, float):
        v = round(v, 1)
    sep = "" if unit == "%" else " "
    return f"{v}{(sep + unit) if unit else ''}"


def metrics_csv(run: dict[str, Any]) -> str:
    modes = _modes(run)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["metric", "unit", *[MODE_LABELS[m] for m in modes]])
    rows = (run.get("comparison") or {}).get("rows")
    if rows is None:
        from .metrics import COMPARE_ROWS, _get
        rows = [{"label": lbl, "unit": unit, "values": {m: _get(run["runs"][m]["metrics"], path) for m in modes}}
                for _, lbl, unit, _, path in COMPARE_ROWS]
    for r in rows:
        w.writerow([r["label"], r["unit"], *[r["values"].get(m, "") if r["values"].get(m) is not None else "" for m in modes]])
    w.writerow([])
    w.writerow(["seed", run["seed"]])
    w.writerow(["scenario", run["scenario"]["name"]])
    w.writerow(["duration_s", run["duration"]])
    w.writerow(["co2_assumption_g_per_idle_vehicle_second", CO2_G_PER_IDLE_VEH_S])
    return buf.getvalue()


def timeseries_csv(run: dict[str, Any], mode: str) -> str:
    r = run["runs"][mode]
    frames = r["frames"]
    nodes = [n["id"] for n in run["network"]["intersections"]]
    buf = io.StringIO()
    w = csv.writer(buf)
    head = ["t", "network_queue", "source_backlog", "blocked_links", "cum_arrived", "cum_completed", "max_wait_s",
            "ev_position_m", "ev_speed_mps"]
    for n in nodes:
        head += [f"{n}_state", f"{n}_phase", f"{n}_preemption"]
    w.writerow(head)
    s = r["series"]
    for i, f in enumerate(frames):
        ev = next((p for p in f["pv"] if p["kind"] == "ev"), None)
        row = [f["t"], s["queue"][i], s["backlog"][i], s["blocked"][i], s["arrived"][i], s["departed"][i],
               s["maxwait"][i], ev["s"] if ev else "", ev["v"] if ev else ""]
        for sg in f["sig"]:
            row += [sg["s"], sg["p"], sg.get("pre", "")]
        w.writerow(row)
    return buf.getvalue()


def events_csv(run: dict[str, Any], mode: str) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["t", "kind", "severity", "intersection", "text"])
    for e in run["runs"][mode]["events"]:
        w.writerow([e["t"], e["kind"], e["severity"], e.get("node") or "", e["text"]])
    return buf.getvalue()


def decisions_csv(run: dict[str, Any], mode: str) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["t", "intersection", "kind", "decision", "reasons", "selected_cost"])
    for d in run["runs"][mode]["decisions"]:
        sel = next((c["cost"] for c in d.get("candidates", []) if c.get("selected")), "")
        w.writerow([d["t"], d.get("node_name") or d.get("node"), d["kind"], d["title"], " | ".join(d["reasons"]), sel])
    return buf.getvalue()


def report_markdown(run: dict[str, Any]) -> str:
    modes = _modes(run)
    sc = run["scenario"]
    lines: list[str] = []
    lines.append(f"# PriorityPulse outcome report — {sc['name']}")
    lines.append("")
    lines.append(f"*{sc['tagline']}*")
    lines.append("")
    lines.append(f"- Seed: `{run['seed']}` (identical arrivals and pedestrian calls in every mode)")
    lines.append(f"- Duration: {run['duration']} s after a {run['warmup']} s warm-up under the fixed-time plan")
    cfg = run["runs"][modes[0]]["config"]
    lines.append(f"- Weather: {cfg['weather']}, demand intensity K = {cfg['intensity']}")
    if run.get("dispatch"):
        d = run["dispatch"]
        lines.append(f"- Dispatch: {d['etype']} ({d['priority']}) {d['origin']} → {d['destination']} at t = {d['t']:.0f} s")
    lines.append("")
    rep = (run.get("comparison") or {}).get("report")
    if rep:
        lines.append("## What changed with PriorityPulse?")
        lines.append("")
        for base in ("fixed", "reactive"):
            if base not in rep:
                continue
            b = rep[base]
            lines.append(f"### vs {MODE_LABELS[base]}")
            lines.append("")
            if b["ev_time_saved_s"] is not None:
                lines.append(f"- Emergency travel time saved: **{b['ev_time_saved_s']:.0f} s** "
                             f"({_fmt(b['ev_improvement_pct'], '%')})")
            if b["ev_stops_avoided"] is not None:
                lines.append(f"- Emergency stops avoided: **{b['ev_stops_avoided']}**")
            lines.append(f"- Maximum queue reduced by: **{b['max_queue_reduced']}** vehicles")
            lines.append(f"- Spillback events prevented: **{b['spillback_prevented']}**")
            if b["recovery_improved_s"] is not None:
                lines.append(f"- Network recovery improved by: **{b['recovery_improved_s']:.0f} s**")
            lines.append(f"- Estimated idling reduced by: **{b['idling_reduced_veh_min']} vehicle-minutes**")
            lines.append(f"- Average driver delay change: **{b['avg_delay_change_s']:+.1f} s** per vehicle")
            lines.append("")
        lines.append(f"- Signal-safety compliance (PriorityPulse): **{rep['safety_compliance_pct']}%**")
        lines.append("")
    lines.append("## Three-mode comparison")
    lines.append("")
    rows = (run.get("comparison") or {}).get("rows", [])
    if rows:
        lines.append("| Metric | " + " | ".join(MODE_LABELS[m] for m in modes) + " |")
        lines.append("|---|" + "---|" * len(modes))
        for r in rows:
            cells = []
            for m in modes:
                v = r["values"].get(m)
                txt = _fmt(v, r["unit"] if r["unit"] not in ("", "%") else "")
                if r["unit"] == "%" and v is not None:
                    txt = f"{v}%"
                if r.get("best") == m:
                    txt = f"**{txt}**"
                cells.append(txt)
            lines.append(f"| {r['label']} | " + " | ".join(cells) + " |")
        lines.append("")
    lines.append("## Method and assumptions")
    lines.append("")
    lines.append("- Discrete-time (1 s) corridor simulation: Poisson arrivals, queue conservation, saturation discharge "
                 "with start-up lost time, downstream storage limits, signal state machine (green → yellow → all-red).")
    lines.append("- Hard constraints (never traded against cost): minimum green, pedestrian walk + flashing-don't-walk + "
                 "clearance, yellow/all-red, conflict-free phases. An independent monitor audits every transition.")
    lines.append("- Fixed-time and reactive baselines share the arrivals, warm-up state and pedestrian calls; reactive "
                 "preemption only reacts when the vehicle is a few seconds from the stop line.")
    lines.append("- PriorityPulse is told about the call ahead of departure (crew turnout lead time) and plans from the route.")
    lines.append(f"- Idling-reduction uses vehicle-seconds queued; any CO2 figure assumes {CO2_G_PER_IDLE_VEH_S} g per "
                 "idling vehicle-second (a scenario parameter, not a measurement).")
    for n in run["network"].get("notes", []):
        lines.append(f"- {n}")
    lines.append("- This is a simulation. It is not connected to live traffic-signal infrastructure.")
    lines.append("")
    return "\n".join(lines)
