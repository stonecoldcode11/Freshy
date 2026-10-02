import pytest

from app.config import SignalParams
from app.network import demo_corridor
from app.signals import GREEN, SafetyMonitor, Signal


def make(params=None):
    net = demo_corridor()
    sp = params or SignalParams()
    sg = Signal(net.intersections[0], sp)
    sg.start_in(0, 0.0, 0.0)
    return net, sg, sp


def run(sg, seconds, start=0):
    for t in range(start, start + seconds):
        sg.step(1.0, t + 1.0)


def test_legal_sequence_green_yellow_allred_green():
    net, sg, sp = make()
    run(sg, 8)                                       # reach min green
    assert sg.can_switch()
    assert sg.request_switch(2, 8)
    seen = []
    for t in range(8, 20):
        seen.append((sg.state, sg.phase))
        sg.step(1.0, t + 1.0)
        if sg.state == GREEN:
            break
    states = [s for s, _ in seen]
    assert states[:3] == ["Y", "Y", "Y"] and states[3:5] == ["R", "R"]
    assert sg.state == GREEN and sg.phase == 2
    kinds = [e["type"] for e in sg.log]
    assert kinds == ["green_start", "yellow_start", "allred_start", "green_start"]


def test_cannot_switch_before_min_green():
    net, sg, sp = make()
    run(sg, 3)
    assert not sg.can_switch()
    assert sg.request_switch(2, 3) is False
    assert sg.state == GREEN and sg.denied == 1
    assert [e["type"] for e in sg.log] == ["green_start"]       # nothing illegal was logged


def test_cannot_switch_to_same_or_unknown_phase():
    net, sg, sp = make()
    run(sg, 10)
    assert not sg.request_switch(0, 10)
    assert not sg.request_switch(9, 10)


def test_cannot_request_during_yellow_or_allred():
    net, sg, sp = make()
    run(sg, 10)
    assert sg.request_switch(2, 10)
    assert not sg.request_switch(3, 10)              # still in yellow
    run(sg, 3, 10)
    assert sg.state == "R" and not sg.request_switch(3, 13)


def test_time_until_green_accounts_for_everything():
    net, sg, sp = make()
    run(sg, 3)                                       # 3s into a phase with 8s minimum
    assert sg.time_until_green(0) == 0
    # remaining min green (5) + yellow (3) + all-red (2)
    assert sg.time_until_green(2) == pytest.approx(5 + 3 + 2)
    run(sg, 5, 3)
    assert sg.request_switch(2, 8)
    assert sg.time_until_green(2) == pytest.approx(3 + 2)           # yellow + all-red still to run
    assert sg.time_until_green(3) == pytest.approx(3 + 2 + sg.g_min(2) + 3 + 2)


def test_pedestrian_clearance_blocks_phase_end():
    """A walk that has started must run walk + FDW + clearance before the parallel phase can end."""
    net = demo_corridor()
    sp = SignalParams()
    sg = Signal(net.intersections[0], sp)
    sg.start_in(2, 0.0, 0.0)                         # side-through is parallel to the main-street crosswalk
    sg.ped_call(0)                                   # crosswalk 0 crosses Main St (parallel phase 2)
    assert sg.peds[0].stage == "walk"
    total = sp.ped_walk + sp.ped_fdw + sp.ped_clear
    assert sg.ped_remaining() == pytest.approx(total)
    assert not sg.can_switch()
    run(sg, int(total) - 1)
    assert not sg.can_switch() and sg.ped_remaining() == pytest.approx(1.0)
    run(sg, 1, int(total) - 1)
    assert sg.peds[0].stage == "idle" and sg.can_switch() and sg.peds[0].served == 1


def test_pedestrian_call_waits_for_parallel_phase():
    net, sg, sp = make()                             # phase 0 green; crosswalk 0 needs phase 2
    sg.ped_call(0)
    assert sg.peds[0].call and sg.peds[0].stage == "idle"
    run(sg, 8)
    assert sg.request_switch(2, 8)
    run(sg, 5, 8)                                    # yellow + all-red
    assert sg.phase == 2 and sg.peds[0].stage == "walk" and not sg.peds[0].call
    assert sg.peds[0].served == 0


def test_ped_block_defers_new_walk():
    net, sg, sp = make()
    sg.ped_block = {0}
    sg.start_in(0, 0.0, 0.0)
    sg.ped_call(1)                                   # crosswalk 1 is parallel to phase 0
    assert sg.peds[1].call and sg.peds[1].stage == "idle"
    run(sg, 3)
    assert sg.peds[1].stage == "idle"
    sg.ped_block = set()
    run(sg, 1, 3)
    assert sg.peds[1].stage == "walk"


def test_max_green_values():
    net, sg, sp = make()
    assert sg.g_max(0) == sp.g_max_through_main and sg.g_max(2) == sp.g_max_through_side
    assert sg.g_max(1) == sp.g_max_left and sg.g_min(3) == sp.g_min_left


# ---------------------------------------------------------------------------------------------
# the safety monitor must catch illegal logs (it is independent of the state machine)
# ---------------------------------------------------------------------------------------------

def _monitor():
    net = demo_corridor()
    return SafetyMonitor(SignalParams(), net.conflicts), net


def _legal_log():
    return [
        {"t": 0, "node": "I1", "type": "green_start", "phase": 0, "prev": None, "allred": None},
        {"t": 20, "node": "I1", "type": "yellow_start", "phase": 0, "target": 2, "g_elapsed": 20, "ped_remaining": 0, "g_min": 8},
        {"t": 23, "node": "I1", "type": "allred_start", "phase": 0, "yellow": 3},
        {"t": 25, "node": "I1", "type": "green_start", "phase": 2, "prev": 0, "allred": 2},
    ]


def test_monitor_accepts_legal_log():
    mon, _ = _monitor()
    rep = mon.audit([_legal_log()])
    assert rep.transitions == 1 and rep.legal == 1 and rep.compliance_pct == 100.0 and not rep.violations


@pytest.mark.parametrize("mutate,needle", [
    (lambda log: log[1].update(g_elapsed=3), "min"),                    # green too short
    (lambda log: log[1].update(ped_remaining=6.0), "pedestrian"),       # ended during ped clearance
    (lambda log: log[2].update(yellow=1.0), "yellow"),                  # yellow too short
    (lambda log: log[3].update(allred=0.0), "all-red"),                 # no all-red
    (lambda log: log[3].update(phase=0), "same phase"),                 # re-green same phase
])
def test_monitor_flags_illegal_transitions(mutate, needle):
    mon, _ = _monitor()
    log = _legal_log()
    mutate(log)
    rep = mon.audit([log])
    assert rep.legal == 0 and rep.compliance_pct == 0.0
    assert any(needle in v for v in rep.violations), rep.violations


def test_monitor_flags_green_without_allred():
    mon, _ = _monitor()
    log = [_legal_log()[0], _legal_log()[1], _legal_log()[3]]           # all-red missing
    rep = mon.audit([log])
    assert rep.legal == 0 and rep.violations


def test_monitor_flags_conflicting_movements_served_together():
    mon, net = _monitor()
    mv = {m.id: m.idx for m in net.movements}
    ok = frozenset({mv["F0:T"], mv["R1:T"]})
    bad = frozenset({mv["F0:T"], mv["SR1_in:T"]})
    assert mon.check_active_set(0, "I1", ok)
    assert not mon.check_active_set(1, "I1", bad)
    rep = mon.audit([])
    assert rep.conflict_steps == 1 and rep.violations
