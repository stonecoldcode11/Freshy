"""Robustness: random valid requests and non-demo corridors must never crash or break an invariant."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from app.config import SimConfig  # noqa: E402
from app.controllers.fixed import FixedTimeController  # noqa: E402
from app.controllers.prioritypulse import PriorityPulseController  # noqa: E402
from app.demand import generate_demand  # noqa: E402
from app.network import CorridorSpec, build_corridor  # noqa: E402
from app.scenarios import custom_scenario, DispatchSpec  # noqa: E402
from app.simulator import Simulation  # noqa: E402
from fuzz import fuzz  # noqa: E402


def test_fuzz_smoke():
    """A fixed-seed sample of random requests (the full fuzzer is scripts/fuzz.py)."""
    assert fuzz(seed=11, n_requests=12, verbose=False) == []


@pytest.mark.parametrize("n,main_lanes,side_lanes", [(1, 2, 1), (2, 3, 2), (5, 4, 3)])
@pytest.mark.parametrize("controller", [FixedTimeController, PriorityPulseController])
def test_conservation_on_other_corridor_shapes(n, main_lanes, side_lanes, controller):
    spec = CorridorSpec(n=n, names=[f"X{i}" for i in range(n)], spacing=[140.0] * (n - 1),
                        main_lanes=main_lanes, side_lanes=side_lanes)
    cfg = SimConfig(seed=3, duration=200, warmup=40, intensity=0.8)
    net = build_corridor(spec, cfg.physics)
    sc = custom_scenario(intensity=0.8, duration=200)
    demand = generate_demand(net, cfg, sc)
    sim = Simulation(net, cfg, sc, controller(), demand=demand, dispatch=DispatchSpec("B_W", "B_E", t=30))
    sim.run()
    arrived = int(demand.arrivals[: sim.t + sim.warmup].sum())
    assert arrived == sim.completed + sim.vehicles_in_system()
    assert all(q >= 0 for q in sim.Q)
    assert sim.monitor.audit([sg.log for sg in sim.signals]).compliance_pct == 100.0
