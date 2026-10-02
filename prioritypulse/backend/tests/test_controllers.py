import numpy as np
import pytest

from app.controllers.mpc import Candidate
from app.controllers.prioritypulse import FAIR_MARGIN
from app.runner import RunRequest, execute
from app.scenarios import SCENARIOS
from helpers import make_sim


# ---------------------------------------------------------------------------------------------
# baselines
# ---------------------------------------------------------------------------------------------

def test_fixed_time_follows_its_plan_when_nothing_interferes():
    sim = make_sim("fixed", duration=240, warmup=40, dispatch=False, mutate=lambda sc: setattr(sc, "ped_rate", 0.0))
    sim.run()
    log = sim.signals[0].log
    greens = [(a["t"], b["t"], a["phase"]) for a, b in zip(log, log[1:])
              if a["type"] == "green_start" and b["type"] == "yellow_start"]
    plan = sim.sp.fixed_green
    for start, end, phase in greens[1:]:                 # the first one starts part-way through a phase
        assert end - start == pytest.approx(plan[phase], abs=1.01)
    phases = [p for _, _, p in greens]
    assert phases[:8] == [(phases[0] + k) % 4 for k in range(8)]       # strict 0,1,2,3 cycle


def test_progression_offsets_follow_travel_time():
    sim = make_sim("fixed", duration=10, warmup=0)
    offs = sim.ctrl.offsets
    gap = (170.0 / sim.sp.platoon_speed)
    assert offs[1] - offs[0] == pytest.approx(gap) and offs[2] - offs[1] == pytest.approx(gap)
    sim_n = make_sim("fixed", duration=10, warmup=0)
    assert len(offs) == 3


def test_reactive_preemption_serves_ev_phase_but_only_when_close():
    sim = make_sim("reactive", duration=240, warmup=40)
    sim.run()
    ev = sim.ev
    assert ev.status == "done"
    starts = [e for e in sim.events if e["kind"] == "preempt_start"]
    assert len(starts) == 3
    for e in starts:                                     # detection is within the detector window
        assert "away" in e["text"]
    # a hard-wired baseline behaves differently from the predictive controller
    assert not any(d["kind"] == "preempt" for d in sim.decisions)


# ---------------------------------------------------------------------------------------------
# PriorityPulse: safety is a property of every run
# ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("scenario", list(SCENARIOS))
def test_prioritypulse_is_100_percent_safe_in_every_scenario(scenario):
    out = execute(RunRequest(scenario_id=scenario, seed=4, modes=("prioritypulse",), include_frames=False))
    m = out["runs"]["prioritypulse"]["metrics"]
    assert m["safety_compliance_pct"] == 100.0
    assert m["conflict_steps"] == 0 and m["safety_violations"] == []
    assert m["signal_transitions"] > 10


def test_pedestrian_walk_never_overlaps_a_conflicting_green():
    """For every frame: a pedestrian in walk/FDW/clear has its parallel phase showing green."""
    for scenario in ("school_dismissal", "rush_hour_ambulance"):
        out = execute(RunRequest(scenario_id=scenario, seed=2, modes=("prioritypulse",)))
        net = out["network"]
        xw = [[(c["parallel_phase"]) for c in nd["crosswalks"]] for nd in net["intersections"]]
        seen_walk = 0
        for f in out["runs"]["prioritypulse"]["frames"]:
            for ni, sg in enumerate(f["sig"]):
                for ci, pd in enumerate(sg["ped"]):
                    if pd["st"] >= 2:
                        seen_walk += 1
                        assert sg["s"] == "G" and sg["p"] == xw[ni][ci], (scenario, f["t"], ni, ci)
        assert seen_walk > 0


def test_green_never_ends_inside_pedestrian_clearance_or_min_green():
    """Frame-level audit (independent of the SafetyMonitor): at every G -> Y change the green that
    just ended had run its minimum and no pedestrian interval was still in progress."""
    for scenario in ("school_dismissal", "rush_hour_ambulance"):
        out = execute(RunRequest(scenario_id=scenario, seed=3, modes=("prioritypulse",)))
        frames = out["runs"]["prioritypulse"]["frames"]
        changes = 0
        for ni in range(3):
            for a, b in zip(frames, frames[1:]):
                if a["sig"][ni]["s"] == "G" and b["sig"][ni]["s"] == "Y":
                    changes += 1
                    g_min = 5 if a["sig"][ni]["p"] in (1, 3) else 8
                    assert a["sig"][ni]["tm"] >= g_min, (scenario, a["t"], ni)
                    assert all(p["rem"] == 0 for p in a["sig"][ni]["ped"]), (scenario, a["t"], ni)
        assert changes > 20


def test_ev_never_forced_through_a_red_in_normal_runs():
    for scenario in ("rush_hour_ambulance", "fire_station_dispatch", "school_dismissal"):
        out = execute(RunRequest(scenario_id=scenario, seed=1, modes=("prioritypulse",), include_frames=False))
        assert out["runs"]["prioritypulse"]["metrics"]["ev"]["forced_passes"] == 0


# ---------------------------------------------------------------------------------------------
# emergency trigger arithmetic:  t_trigger = ETA - (T_clear + T_safe + T_buffer)
# ---------------------------------------------------------------------------------------------

def test_trigger_formula_in_every_frame():
    out = execute(RunRequest(scenario_id="rush_hour_ambulance", seed=3, modes=("prioritypulse",)))
    frames = out["runs"]["prioritypulse"]["frames"]
    n_plans = 0
    for f in frames:
        for pl in f["ctl"].get("plan", []):
            n_plans += 1
            assert pl["t_prep"] == pytest.approx(pl["t_clear"] + pl["t_safe"] + pl["t_buffer"], abs=0.2)
            assert pl["trigger_in"] == pytest.approx(pl["eta_free"] - pl["t_prep"], abs=0.2)
            if pl["status"] == "pending":
                assert pl["trigger_in"] > -0.2
    assert n_plans > 50


def test_preemption_starts_before_the_vehicle_arrives_not_after():
    """Active preemption must begin while the EV is still far enough to finish the clearance."""
    out = execute(RunRequest(scenario_id="rush_hour_ambulance", seed=5, modes=("prioritypulse",)))
    run = out["runs"]["prioritypulse"]
    for e in (e for e in run["events"] if e["kind"] == "preempt_start"):
        assert e["t"] <= run["ev"]["passed_at"][int(e["node"][1:]) - 1]
    assert run["metrics"]["ev"]["stops"] == 0


def test_dispatch_notice_lead_is_respected():
    sim = make_sim("prioritypulse", duration=200, warmup=40)
    t_notice = sim.ev.t_dispatch - sim.cfg.emergency.notice_lead
    while sim.t < t_notice - 2:
        sim.step()
    assert not sim.ctrl.plan                             # the signals know nothing yet
    while sim.t < t_notice + 2:
        sim.step()
    assert sim.ctrl.plan


# ---------------------------------------------------------------------------------------------
# MPC pieces
# ---------------------------------------------------------------------------------------------

def _ready_sim(**kw):
    sim = make_sim("prioritypulse", duration=100, warmup=0, dispatch=False, **kw)
    sim.demand.arrivals[:] = 0
    sim.demand.lam[:] = 0
    sg = sim.signals[1]
    sg.start_in(0, 20.0, 0)                              # main-through green, past its minimum
    return sim, sg


def _decide_costs(sim, ni=1):
    sg = sim.signals[ni]
    ctrl = sim.ctrl
    ctx = ctrl._context(sim, ni, sg, 0)
    cands, removed, forced = ctrl._candidates(sim, ni, sg, 0, ctx, None)
    res = ctrl._evaluate(sim, ni, sg, ctx, cands)
    return ctx, cands, removed, forced, res


def test_mpc_prefers_switching_when_current_phase_is_empty_and_other_is_queued():
    sim, sg = _ready_sim()
    for m in sim.net.movements_of("I2"):
        if m.link == "SL2_in" and m.kind == "T":
            sim.Q[m.idx] = 14
    ctx, cands, removed, forced, res = _decide_costs(sim)
    best = cands[int(np.argmin(res["total"]))]
    assert best.kind == "switch" and best.target == 2 and best.start == 0
    hold = next(i for i, c in enumerate(cands) if c.kind == "hold")
    assert res["total"][hold] > res["total"].min()


def test_mpc_prefers_holding_when_current_phase_is_busy():
    sim, sg = _ready_sim()
    for m in sim.net.movements_of("I2"):
        if m.link in ("F1", "R2") and m.kind == "T":
            sim.Q[m.idx] = 18
        if m.link == "SL2_in" and m.kind == "T":
            sim.Q[m.idx] = 1
    ctx, cands, removed, forced, res = _decide_costs(sim)
    best = cands[int(np.argmin(res["total"]))]
    assert best.kind == "hold" or best.start > 0


def test_phases_without_demand_are_not_candidates():
    sim, sg = _ready_sim()
    for m in sim.net.movements_of("I2"):
        if m.link == "SL2_in" and m.kind == "T":
            sim.Q[m.idx] = 6
    ctx, cands, removed, forced, res = _decide_costs(sim)
    targets = {c.target for c in cands if c.kind == "switch"}
    assert targets == {2}
    assert any("no vehicles" in r["why"] for r in removed)


def test_spillback_guard_denies_green_extension():
    sim, sg = _ready_sim()
    li = sim.li["F2"]                                    # downstream of I2's eastbound through
    sim.in_transit[li] = sim.cap_eff[li]
    sim.occ[li] = sim.cap_eff[li]
    for m in sim.net.movements_of("I2"):
        if m.link == "F1" and m.kind == "T":
            sim.Q[m.idx] = 10
        if m.link == "SL2_in" and m.kind == "T":
            sim.Q[m.idx] = 5
    ctx, cands, removed, forced, res = _decide_costs(sim)
    assert ctx["blocked_all"] and forced == "guard"
    assert all(c.kind == "switch" and c.start == 0 for c in cands)
    assert any("Spillback protection" in r["why"] for r in removed)


def test_hard_fairness_forces_service_of_a_starved_movement():
    sim, sg = _ready_sim()
    for m in sim.net.movements_of("I2"):
        if m.link in ("F1", "R2") and m.kind == "T":
            sim.Q[m.idx] = 18                            # busy current phase would normally win
        if m.link == "SL2_in" and m.kind == "L":
            sim.Q[m.idx] = 2
            sim.wait[m.idx] = sim.cfg.weights.t_max_allowed - FAIR_MARGIN + 1
    ctx, cands, removed, forced, res = _decide_costs(sim)
    assert forced == "fairness" and ctx["starved_phase"] == 3
    assert [c.target for c in cands] == [3]


def test_pedestrian_call_adds_demand_for_parallel_phase():
    sim, sg = _ready_sim()
    sg.ped_call(0)                                       # crossing Main St: parallel phase 2
    ctx, cands, removed, forced, res = _decide_costs(sim)
    assert 2 in ctx["ped_phases"]
    assert any(c.target == 2 for c in cands if c.kind == "switch")


def test_ev_term_makes_serving_the_ev_phase_cheaper_than_leaving_it():
    sim = make_sim("prioritypulse", duration=200, warmup=0)
    checked = 0
    while sim.t < sim.ev.t_dispatch + 40 and checked == 0:
        sim.step()
        for ni in range(3):
            sg = sim.signals[ni]
            if sg.state != "G":
                continue
            ctx = sim.ctrl._context(sim, ni, sg, sim.t)
            if not ctx["tracked"] or ctx["tracked"][0].eta < 3:
                continue
            ev_phase = 0                                 # the demo EV drives east along the main street
            other = 2 if sg.phase == ev_phase else ev_phase
            cands = [Candidate("switch", other, 0, "other"), Candidate("hold", None, 10 ** 6, "hold")]
            res = sim.ctrl._evaluate(sim, ni, sg, ctx, cands)
            serves_ev = 1 if sg.phase == ev_phase else 0           # hold serves the EV only if already green
            assert res["terms"]["ev"][serves_ev] <= res["terms"]["ev"][1 - serves_ev]
            checked += 1
    assert checked > 0


# ---------------------------------------------------------------------------------------------
# comparative behaviour (statistical, over several seeds)
# ---------------------------------------------------------------------------------------------

def test_prioritypulse_gets_the_ev_through_faster_than_both_baselines():
    for scenario in ("rush_hour_ambulance", "fire_station_dispatch", "rain_snow"):
        tt = {"fixed": [], "reactive": [], "prioritypulse": []}
        for seed in (1, 2, 3):
            out = execute(RunRequest(scenario_id=scenario, seed=seed, include_frames=False))
            for m, r in out["runs"].items():
                tt[m].append(r["metrics"]["ev"]["travel_time"])
        mean = {m: sum(v) / len(v) for m, v in tt.items()}
        assert mean["prioritypulse"] < mean["reactive"] < mean["fixed"], (scenario, mean)
        assert mean["prioritypulse"] < 0.8 * mean["fixed"], (scenario, mean)


def test_prioritypulse_does_not_buy_ev_speed_with_driver_delay():
    worse = 0
    for scenario in ("rush_hour_ambulance", "stadium_exit", "fire_station_dispatch"):
        out = execute(RunRequest(scenario_id=scenario, seed=2, include_frames=False))
        ms = {m: r["metrics"] for m, r in out["runs"].items()}
        if ms["prioritypulse"]["avg_delay_s"] > 1.10 * ms["fixed"]["avg_delay_s"]:
            worse += 1
    assert worse == 0


def test_spillback_guard_reduces_time_spent_blocked_in_stress_scenarios():
    out = execute(RunRequest(scenario_id="stadium_exit", seed=2, include_frames=False))
    ms = {m: r["metrics"] for m, r in out["runs"].items()}
    assert ms["prioritypulse"]["spillback_seconds"] < ms["fixed"]["spillback_seconds"]


def test_run_is_deterministic():
    a = execute(RunRequest(scenario_id="rush_hour_ambulance", seed=9, include_frames=False))
    b = execute(RunRequest(scenario_id="rush_hour_ambulance", seed=9, include_frames=False))
    for m in a["runs"]:
        assert a["runs"][m]["metrics"] == b["runs"][m]["metrics"]


# ---------------------------------------------------------------------------------------------
# transit priority (soft preference below the emergency vehicle)
# ---------------------------------------------------------------------------------------------

def test_scheduled_bus_runs_in_every_mode_even_with_an_emergency_dispatch():
    for mode in ("fixed", "reactive", "prioritypulse"):
        sim = make_sim(mode, scenario="school_dismissal", duration=300, warmup=40)
        assert sim.ev is not None and any(pv.kind == "bus" for pv in sim.pvs), mode


def test_late_bus_is_helped_by_prioritypulse_but_never_at_the_emergency_vehicles_expense():
    bus_delay = {"fixed": [], "prioritypulse": []}
    ev_time = {"fixed": [], "prioritypulse": []}
    for seed in (1, 2, 3, 4):
        out = execute(RunRequest(scenario_id="school_dismissal", seed=seed, modes=("fixed", "prioritypulse"), include_frames=False))
        for m, r in out["runs"].items():
            bus_delay[m].append(r["metrics"]["buses"][0]["delay"])
            ev_time[m].append(r["metrics"]["ev"]["travel_time"])
    assert sum(bus_delay["prioritypulse"]) < 0.7 * sum(bus_delay["fixed"])
    assert sum(ev_time["prioritypulse"]) < sum(ev_time["fixed"])


def test_transit_priority_is_explained_and_scenarios_without_a_bus_have_no_transit_row():
    out = execute(RunRequest(scenario_id="school_dismissal", seed=2, modes=("fixed", "prioritypulse"), include_frames=False))
    reasons = [r for d in out["runs"]["prioritypulse"]["decisions"] for r in d["reasons"] if r.startswith("Transit priority")]
    assert reasons and "late" in reasons[0]
    assert any(r["key"] == "bus_delay" for r in out["comparison"]["rows"])
    plain = execute(RunRequest(scenario_id="rush_hour_ambulance", seed=2, modes=("fixed", "prioritypulse"), include_frames=False))
    assert not any(r["key"] == "bus_delay" for r in plain["comparison"]["rows"])


# ---------------------------------------------------------------------------------------------
# detour rule: leaving the emergency phase must leave enough time to clear the queue that builds
# ---------------------------------------------------------------------------------------------

def _detour_targets(arrival_rate: float, eta_free: float = 31.0):
    """Currently showing side-through green; only the side-left phase has waiting vehicles, so a detour
    to phase 3 is the one candidate, and the emergency phase (0) would stay red for the whole detour."""
    sim, sg = _ready_sim()
    ni = 1
    ctrl = sim.ctrl
    sg.start_in(2, 20.0, 0)
    for m in sim.net.movements_of("I2"):
        if m.link == "SL2_in" and m.kind == "L":
            sim.Q[m.idx] = 12
    ctx = ctrl._context(sim, ni, sg, 0)
    st = ctrl.statics[ni]
    loc = st.mids.index(sim.net.movement("F1:T").idx)
    ctx["A"][:, loc] = arrival_rate                    # forecast arrivals on the emergency movement
    ctx["ev_pending"] = {"phase": 0, "eta_rel": eta_free, "eta_free": eta_free, "t_clear": 3.0, "t_buffer": 3.0,
                         "queue": 3, "loc": loc, "s_m": 1.0}
    cands, removed, forced = ctrl._candidates(sim, ni, sg, 0, ctx, None)
    return {c.target for c in cands if c.kind == "switch" and c.target != 0}, removed


def test_detour_is_refused_when_the_queue_would_grow_beyond_what_can_be_cleared():
    allowed, removed = _detour_targets(arrival_rate=0.0)
    assert allowed                                   # quiet approach: a short detour still leaves time
    refused, removed = _detour_targets(arrival_rate=1.2)
    assert not refused                               # surge: every detour would leave the vehicle waiting
    assert any("would grow" in r["why"] for r in removed)


def test_detour_is_refused_when_the_vehicle_is_close():
    near, removed = _detour_targets(arrival_rate=0.0, eta_free=12.0)
    assert not near
