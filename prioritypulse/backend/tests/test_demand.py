import numpy as np
import pytest

from app.config import SimConfig
from app.demand import K_MAX, K_MIN, demand_profile, generate_demand, sigmoid_turns, split_counts
from app.network import demo_corridor
from app.scenarios import Surge, get_scenario


def _cfg(seed=7, duration=400, **kw):
    cfg = SimConfig(seed=seed, duration=duration, warmup=0)
    cfg.intensity = kw.get("intensity", 0.6)
    return cfg


def test_same_seed_gives_identical_demand():
    net, sc = demo_corridor(), get_scenario("rush_hour_ambulance")
    a = generate_demand(net, _cfg(5), sc)
    b = generate_demand(net, _cfg(5), sc)
    assert np.array_equal(a.arrivals, b.arrivals)
    assert np.array_equal(a.ped_calls, b.ped_calls)
    assert np.array_equal(a.K, b.K)
    c = generate_demand(net, _cfg(6), sc)
    assert not np.array_equal(a.arrivals, c.arrivals)


def test_pedestrian_stream_independent_of_arrivals():
    """Changing the pedestrian rate must not perturb vehicle arrivals (separate RNG streams)."""
    import copy
    net, sc = demo_corridor(), get_scenario("rush_hour_ambulance")
    sc2 = copy.deepcopy(sc)
    sc2.ped_rate = 0.2
    a = generate_demand(net, _cfg(9), sc)
    b = generate_demand(net, _cfg(9), sc2)
    assert np.array_equal(a.arrivals, b.arrivals)
    assert b.ped_calls.sum() > a.ped_calls.sum()


def test_k_stays_bounded_and_tracks_intensity():
    net, sc = demo_corridor(), get_scenario("rush_hour_ambulance")
    for level in (0.3, 0.6, 0.9):
        d = generate_demand(net, _cfg(1, 1200, intensity=level), sc)
        assert d.K.min() >= K_MIN - 1e-6 and d.K.max() <= K_MAX + 1e-6
        assert float(d.K.mean()) == pytest.approx(level, abs=0.12)


def test_poisson_mean_matches_rate():
    net, sc = demo_corridor(), get_scenario("stadium_exit")
    sc.surges, sc.turn_shifts = [], []
    cfg = _cfg(3, 3000, intensity=0.5)
    d = generate_demand(net, cfg, sc)
    e = d.entry_links.index("F0")
    expected = float(d.lam[:, e, :].sum())
    got = int(d.arrivals[:, e, :].sum())
    assert got == pytest.approx(expected, rel=0.06)       # Poisson: sd ~ sqrt(mean)


def test_surge_multiplier_trapezoid():
    sg = Surge(["F0"], start=100, end=200, factor=3.0, ramp=20)
    assert sg.multiplier(50) == 1.0 and sg.multiplier(250) == 1.0
    assert sg.multiplier(100) == pytest.approx(1.0)
    assert sg.multiplier(120) == pytest.approx(3.0)
    assert sg.multiplier(150) == pytest.approx(3.0)
    assert sg.multiplier(190) == pytest.approx(2.0)


def test_surge_raises_arrivals_only_on_target_links():
    net, sc = demo_corridor(), get_scenario("stadium_exit")
    d = generate_demand(net, _cfg(2, 400), sc)
    t = slice(60, 300)
    side = d.entry_links.index("SL3_in")
    main = d.entry_links.index("R3")
    sc_flat = get_scenario("stadium_exit")
    sc_flat.surges, sc_flat.turn_shifts = [], []
    flat = generate_demand(net, _cfg(2, 400), sc_flat)
    assert d.lam[t, side].sum() > 2.0 * flat.lam[t, side].sum()
    assert d.lam[t, main].sum() == pytest.approx(flat.lam[t, main].sum())


def test_turn_proportions_normalised_and_sigmoid_shift():
    base = (0.2, 0.6, 0.2)
    early = sigmoid_turns(base, (0.3, -0.3, 0.0), t=0, t_switch=100, k=0.1)
    late = sigmoid_turns(base, (0.3, -0.3, 0.0), t=300, t_switch=100, k=0.1)
    assert sum(early) == pytest.approx(1.0) and sum(late) == pytest.approx(1.0)
    assert early[0] == pytest.approx(0.2, abs=0.01)
    assert late[0] == pytest.approx(0.5, abs=0.01)
    assert late[1] < early[1]


def test_demand_profile_peaks():
    sc = get_scenario("rush_hour_ambulance")
    sc.peaks = [{"amp": 0.3, "mu": 100, "sigma": 20}]
    assert demand_profile(100, sc, 0.4) == pytest.approx(0.7)
    assert demand_profile(400, sc, 0.4) == pytest.approx(0.4, abs=1e-6)
    assert demand_profile(100, sc, 0.95) == K_MAX


def test_split_counts_conserves_and_matches_proportions():
    acc = [0.0, 0.0, 0.0]
    tot = [0, 0, 0]
    for _ in range(400):
        c = split_counts(1, (0.12, 0.76, 0.12), acc)
        tot = [a + b for a, b in zip(tot, c)]
    assert sum(tot) == 400
    assert tot[1] == pytest.approx(0.76 * 400, abs=2)
    assert tot[0] == pytest.approx(0.12 * 400, abs=2)
    assert split_counts(0, (0.3, 0.4, 0.3), acc) == (0, 0, 0)


def test_weather_lowers_demand_factor():
    net, sc = demo_corridor(), get_scenario("rain_snow")
    snow = SimConfig(seed=4, duration=400, warmup=0, weather="snow")
    snow.intensity = 0.6
    clear = SimConfig(seed=4, duration=400, warmup=0, weather="clear")
    clear.intensity = 0.6
    assert generate_demand(net, snow, sc).lam.sum() < generate_demand(net, clear, sc).lam.sum()
