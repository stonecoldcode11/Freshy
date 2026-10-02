"""Random valid requests against the in-process API.  Any exception, safety violation, wrong frame count or
negative metric is a bug.

    python scripts/fuzz.py 1 80        # seed, number of requests
"""
from __future__ import annotations

import math
import random
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.runner import RunRequest, execute
from app.scenarios import SCENARIOS

def fuzz(seed: int, n_requests: int, verbose: bool = True) -> list[tuple]:
    rng = random.Random(seed)
    N = n_requests
    fails: list[tuple] = []
    t_start = time.time()
    for i in range(N):
        n = rng.choice([1, 2, 3, 4, 5])
        use_points = rng.random() < 0.6
        if use_points:
            lat0, lon0 = rng.uniform(-60, 60), rng.uniform(-170, 170)
            bearing = rng.uniform(0, 360)
            import math
            pts = []
            for k in range(n):
                d = k * rng.uniform(70, 600) / 111320
                pts.append({"lat": lat0 + d * math.cos(math.radians(bearing)), "lon": lon0 + d * math.sin(math.radians(bearing)) / max(0.2, math.cos(math.radians(lat0))), "name": f"P{k+1}"})
            network = {"type": "points", "points": pts, "options": {"main_lanes": rng.randint(2, 5), "side_lanes": rng.randint(1, 4)}}
            nb = n
            sid = rng.choice(["custom"] + list(SCENARIOS))
        else:
            network = {"type": "demo", "n": n}
            nb = n
            sid = rng.choice(list(SCENARIOS) + ["custom"])
        bnd = ["B_W", "B_E"] + [f"B_{s}{k}" for k in range(1, nb + 1) for s in ("SL", "SR")]
        disp = None
        r = rng.random()
        if r < 0.15:
            disp = {"enabled": False}
        elif r < 0.9:
            o, d = rng.sample(bnd, 2)
            disp = {"origin": o, "destination": d, "etype": rng.choice(["ambulance", "fire", "police"]),
                    "priority": rng.choice(["routine", "urgent", "critical"]), "t": rng.choice([0, 5, 20, 45, 90, 200, 400])}
        duration = rng.choice([120, 200, 300, 420, 600])
        ped = [(rng.randint(0, duration), f"I{rng.randint(1, nb)}_X_{rng.choice(['main', 'side'])}") for _ in range(rng.randint(0, 4))]
        req = RunRequest(scenario_id=sid, seed=rng.randint(0, 10**6), duration=duration,
                         intensity=rng.choice([None, 0.1, 0.3, 0.6, 0.9, 1.0]), weather=rng.choice([None, "clear", "rain", "snow"]),
                         school_zone=rng.choice([None, True, False]), dispatch=disp, network=network, ped_calls=ped or None,
                         include_frames=rng.random() < 0.5)
        try:
            out = execute(req)
            for m, run in out["runs"].items():
                mt = run["metrics"]
                if mt["safety_compliance_pct"] != 100.0 or mt["safety_violations"] or mt["conflict_steps"]:
                    fails.append((i, "SAFETY", m, mt["safety_violations"][:2], req))
                if run["frames"] and len(run["frames"]) != duration:
                    fails.append((i, "FRAMES", m, len(run["frames"]), req))
                if mt["admitted"] < 0 or mt["avg_delay_s"] < 0 or mt["avg_delay_s"] != mt["avg_delay_s"]:
                    fails.append((i, "METRIC", m, mt["avg_delay_s"], req))
        except Exception as e:
            tb = traceback.format_exc().strip().splitlines()
            fails.append((i, "EXC", type(e).__name__, str(e)[:150] + " @ " + tb[-3].strip()[:120], req))
    if verbose:
        print(f"{N} random requests in {time.time() - t_start:.0f}s -> {len(fails)} problems")
        seen = set()
        for f in fails:
            key = (f[1], f[2], f[3] if f[1] == 'EXC' else '')
            if key in seen:
                continue
            seen.add(key)
            i, kind, a, b, req = f
            print(f"#{i} {kind} {a}: {b}\n   scenario={req.scenario_id} dispatch={req.dispatch} net={req.network['type']} dur={req.duration}")
    return fails


if __name__ == "__main__":
    sys.exit(1 if fuzz(int(sys.argv[1]) if len(sys.argv) > 1 else 1, int(sys.argv[2]) if len(sys.argv) > 2 else 60) else 0)
