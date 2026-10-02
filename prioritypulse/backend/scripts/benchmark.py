"""Reproducible benchmark: every scenario x several seeds x all three modes.

    python scripts/benchmark.py --seeds 1-10            # markdown to stdout
    python scripts/benchmark.py --seeds 1-5 --scenarios rush_hour_ambulance,stadium_exit

Each (scenario, seed) shares one demand table, so the three modes see identical arrivals.
"""

from __future__ import annotations

import argparse
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.metrics import MODE_LABELS  # noqa: E402
from app.runner import RunRequest, execute  # noqa: E402
from app.scenarios import SCENARIOS  # noqa: E402

MODES = ("fixed", "reactive", "prioritypulse")


def parse_seeds(text: str) -> list[int]:
    if "-" in text:
        a, b = text.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in text.split(",")]


def ev_time(m: dict, cap: float) -> float:
    """EV travel time; a vehicle that has not arrived by the end of the run is censored at the time it
    has been travelling (a lower bound), never dropped from the average."""
    return m["ev"]["travel_time"] if m["ev"]["travel_time"] is not None else cap


def mean(xs: list[float]) -> float:
    xs = [x for x in xs if x is not None]
    return st.fmean(xs) if xs else float("nan")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="1-10")
    ap.add_argument("--scenarios", default=",".join(SCENARIOS))
    args = ap.parse_args()
    seeds = parse_seeds(args.seeds)
    scenarios = args.scenarios.split(",")

    print(f"Mean over {len(seeds)} seeds ({seeds[0]}..{seeds[-1]}); identical arrivals per seed across modes. An emergency vehicle that has not arrived by the end of the run is counted at its travel time so far (a lower bound).\n")
    print("| Scenario | Mode | EV time (s) | EV stops | Driver delay (s/veh) | Max queue | Spillback episodes | Blocked-link s | Longest wait (s) | Safety |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    wins = {m: 0 for m in MODES}
    summary = []
    for sc in scenarios:
        rows: dict[str, list[dict]] = {m: [] for m in MODES}
        caps: list[float] = []
        for seed in seeds:
            out = execute(RunRequest(scenario_id=sc, seed=seed, include_frames=False))
            caps.append(out["duration"] - out["dispatch"]["t"])
            for m in MODES:
                rows[m].append(out["runs"][m]["metrics"])
        for m in MODES:
            ms = rows[m]
            dnf = sum(x["ev"]["travel_time"] is None for x in ms)
            evt = f"{mean([ev_time(x, c) for x, c in zip(ms, caps)]):.1f}" + (f" ({dnf} did not arrive)" if dnf else "")
            print(
                f"| {SCENARIOS[sc].name} | {MODE_LABELS[m]} | {evt} | "
                f"{mean([x['ev']['stops'] for x in ms]):.1f} | {mean([x['avg_delay_s'] for x in ms]):.1f} | "
                f"{mean([x['max_queue'] for x in ms]):.1f} | {mean([x['spillback_events'] for x in ms]):.1f} | "
                f"{mean([x['spillback_seconds'] for x in ms]):.0f} | {mean([x['max_wait_s'] for x in ms]):.0f} | "
                f"{min(x['safety_compliance_pct'] for x in ms):.0f}% |"
            )
        ev = {m: mean([ev_time(x, c) for x, c in zip(rows[m], caps)]) for m in MODES}
        t = {m: [ev_time(x, c) for x, c in zip(rows[m], caps)] for m in MODES}
        faster = sum(a < b for a, b in zip(t["prioritypulse"], t["fixed"]))
        faster_r = sum(a < b for a, b in zip(t["prioritypulse"], t["reactive"]))
        summary.append((SCENARIOS[sc].name, 100 * (ev["fixed"] - ev["prioritypulse"]) / ev["fixed"],
                        100 * (ev["reactive"] - ev["prioritypulse"]) / ev["reactive"], faster, faster_r, len(seeds)))
    print("\n| Scenario | EV time vs fixed | EV time vs reactive | PriorityPulse faster than fixed | …than reactive |")
    print("|---|---:|---:|---:|---:|")
    for name, vf, vr, f, fr, n in summary:
        print(f"| {name} | {vf:.0f}% faster | {vr:.0f}% faster | {f}/{n} seeds | {fr}/{n} seeds |")


if __name__ == "__main__":
    main()
