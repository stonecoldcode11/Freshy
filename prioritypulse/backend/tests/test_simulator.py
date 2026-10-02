import math

import pytest

from app.scenarios import Incident
from helpers import make_sim


def test_vehicle_conservation_every_step():
    """arrivals = completed + queued + in transit + waiting outside; nothing is created or destroyed."""
    sim = make_sim("fixed", duration=240, warmup=60)
    for _ in range(300):
        sim.step()
        idx = sim.t + sim.warmup                       # steps executed so far
        arrived = int(sim.demand.arrivals[:idx].sum())
        assert arrived == sim.completed + sim.vehicles_in_system()


def test_conservation_holds_under_every_controller():
    for mode in ("fixed", "reactive", "prioritypulse"):
        sim = make_sim(mode, scenario="stadium_exit", duration=240, warmup=60)
        sim.run()
        arrived = int(sim.demand.arrivals[: sim.t + sim.warmup].sum())
        assert arrived == sim.completed + sim.vehicles_in_system(), mode


def test_queues_nonnegative_integers_and_within_storage():
    sim = make_sim("fixed", scenario="stadium_exit", duration=420)
    for _ in range(sim.T + sim.warmup):
        sim.step()
        assert all(isinstance(q, int) and q >= 0 for q in sim.Q)
        for i, c in enumerate(sim.cap_eff):
            assert sim.occ[i] <= c if not sim.is_exit[i] else True
        assert all(0.0 <= cr <= 1.0 + 1e-9 for cr in sim.credit)


def test_departures_never_exceed_saturation_flow():
    sim2 = make_sim("fixed", duration=200, warmup=0)
    cum = [0] * sim2.nm
    for step in range(200):
        sim2.step()
        for m in range(sim2.nm):
            assert sim2.D[m] <= math.ceil(sim2.net.movements[m].sat_flow) + 1
            cum[m] += sim2.D[m]
    for m in range(sim2.nm):
        mv = sim2.net.movements[m]
        assert cum[m] <= mv.sat_flow * 200 + 2           # long-run discharge bounded by s


def _saturate(sim, mv_id, n=200):
    mv = sim.net.movement(mv_id)
    sim.Q[mv.idx] = n
    ni = sim.node_idx[mv.node]
    sg = sim.signals[ni]
    sg.start_in(mv.phase, 0.0, sim.t)
    return mv, sg


def test_saturation_discharge_with_startup_lost_time():
    sim = make_sim("fixed", duration=100, warmup=0, dispatch=False,
                   mutate=lambda sc: setattr(sc, "intensity", 0.05))
    sim.demand.arrivals[:] = 0
    mv, sg = _saturate(sim, "F0:T")
    sim.ctrl.planned = [999.0] * 4                       # keep the green
    out = []
    for _ in range(20):
        sim.step()
        out.append(sim.D[mv.idx])
    s = mv.sat_flow
    assert sum(out[:3]) < 3 * s                          # start-up: not yet at saturation flow
    assert sum(out[5:15]) >= 0.9 * 10 * s                # then ~ s vehicles per second
    assert sum(out) <= 20 * s


def test_no_departure_on_red():
    sim = make_sim("fixed", duration=60, warmup=0, dispatch=False)
    sim.demand.arrivals[:] = 0
    mv = sim.net.movement("SL1_in:T")                    # side-through while main phase is green
    sim.Q[mv.idx] = 15
    sim.signals[0].start_in(0, 0.0, 0)
    sim.ctrl.planned = [999.0] * 4
    for _ in range(15):
        sim.step()
        assert sim.D[mv.idx] == 0


def _fill_downstream(sim, link_id, frac):
    li = sim.li[link_id]
    sim.in_transit[li] = int(math.ceil(frac * sim.cap_eff[li]))
    sim.occ[li] = sim.in_transit[li]


def test_spillback_guard_blocks_inflow_to_nearly_full_link():
    sim = make_sim("prioritypulse", duration=100, warmup=0, dispatch=False)
    sim.demand.arrivals[:] = 0
    mv, sg = _saturate(sim, "F0:T")
    sg.timer = 20.0
    _fill_downstream(sim, "F1", 0.9)                     # above r_block = 0.85
    sim.step()
    assert sim.guard_enabled
    assert sim.D[mv.idx] == 0


def test_without_guard_vehicles_fill_downstream_to_physical_capacity_only():
    sim = make_sim("fixed", duration=100, warmup=0, dispatch=False)
    sim.demand.arrivals[:] = 0
    mv, sg = _saturate(sim, "F0:T")
    sim.ctrl.planned = [999.0] * 4
    _fill_downstream(sim, "F1", 0.9)
    li = sim.li["F1"]
    sent = 0
    for _ in range(25):
        sim.step()
        sent += sim.D[mv.idx]
        assert sim.occ[li] <= sim.cap_eff[li]            # never beyond physical storage
    assert sent > 0                                      # baselines still send until the link is full


def test_guard_not_applied_during_warmup():
    sim = make_sim("prioritypulse", duration=50, warmup=30, dispatch=False)
    sim.step()
    assert not sim.guard_enabled
    for _ in range(40):
        sim.step()
    assert sim.guard_enabled


def test_incident_reduces_capacity_and_discharge():
    inc = Incident("F1", 0, 300, 2)
    sim = make_sim("fixed", duration=200, warmup=0, mutate=lambda sc: sc.incidents.append(inc))
    sim.step()
    li = sim.li["F1"]
    assert sim.cap_eff[li] < sim.cap_base[li]
    assert sim.sat_fac[li] == pytest.approx(1 / 3)
    assert sim.cap_eff[sim.li["F2"]] == sim.cap_base[sim.li["F2"]]


def test_weather_slows_links_and_discharge():
    clear = make_sim("fixed", duration=50, warmup=0, weather="clear")
    snow = make_sim("fixed", duration=50, warmup=0, weather="snow")
    assert snow.tau["F1"] > clear.tau["F1"]
    assert snow.r_s < clear.r_s


def test_all_modes_share_identical_arrivals():
    from app.runner import RunRequest, execute
    out = execute(RunRequest(scenario_id="school_dismissal", seed=21, include_frames=False))
    total = out["demand"]["total_arrivals"]
    for mode, run in out["runs"].items():
        m = run["metrics"]
        assert m["admitted"] <= total                    # nothing is invented
    assert len({r["config"]["seed"] for r in out["runs"].values()}) == 1


def test_recorded_frames_start_at_zero_and_have_expected_shape():
    sim = make_sim("fixed", duration=30, warmup=20)
    sim.run()
    assert [f["t"] for f in sim.frames] == list(range(30))
    f = sim.frames[0]
    assert len(f["q"]) == sim.nm and len(f["occ"]) == sim.nl and len(f["sig"]) == len(sim.signals)
    assert len(f["tr"]) == sim.nl


def test_common_warmup_gives_identical_state_at_t0_for_all_modes():
    states = {}
    for mode in ("fixed", "reactive", "prioritypulse"):
        sim = make_sim(mode, duration=20, warmup=80)
        while sim.t < 0:
            sim.step()
        states[mode] = (list(sim.Q), [s.phase for s in sim.signals], [s.state for s in sim.signals])
    assert states["fixed"] == states["reactive"] == states["prioritypulse"]
