import math

import pytest

from app.config import PhysicsParams
from app.geo import network_from_points, parse_maxspeed, pick_main_way, spec_from_points
from app.network import (
    AXIS, CorridorSpec, build_corridor, compass_labels, conflict_matrix, demo_corridor, find_route,
    haversine, movements_conflict,
)


@pytest.mark.parametrize("n", [1, 2, 3, 5])
def test_corridor_structure(n):
    net = demo_corridor(n=n)
    assert len(net.intersections) == n
    assert len(net.movements) == 12 * n                 # L/T/R x four approaches
    # every link either feeds an intersection or is an exit
    for lk in net.links.values():
        assert (lk.kind == "exit") == (lk.approach_of is None)
    # every movement's out link exists and is not its own approach
    for m in net.movements:
        assert m.out_link in net.links and m.out_link != m.link


def test_storage_capacity_formula():
    """C_l = floor(L_l * n_l / h_jam)."""
    net = demo_corridor()
    for lid, lk in net.links.items():
        assert lk.capacity == math.floor(lk.length * lk.lanes / net.phys.jam_spacing_m)
        assert net.storage_capacity(lid) == lk.capacity
    assert net.links["F1"].capacity == math.floor(170 * 3 / 7.5)


def test_storage_capacity_follows_jam_spacing():
    a = demo_corridor(PhysicsParams(jam_spacing_m=7.5))
    b = demo_corridor(PhysicsParams(jam_spacing_m=5.0))
    assert b.links["F1"].capacity > a.links["F1"].capacity


def test_conflict_matrix_symmetric_and_phases_conflict_free():
    net = demo_corridor()
    c = net.conflicts
    n = len(net.movements)
    for i in range(n):
        assert c[i][i] == 0
        for j in range(n):
            assert c[i][j] == c[j][i]
    for nd in net.intersections:
        assert sorted(i for ph in nd.phases for i in ph) == sorted(m.idx for m in net.movements_of(nd.id))
        for ph in nd.phases:
            assert all(c[i][j] == 0 for i in ph for j in ph)


def test_cross_axis_always_conflicts_and_known_pairs():
    net = demo_corridor()
    mv = {m.id: m for m in net.movements}
    eb_t, wb_t = mv["F0:T"], mv["R1:T"]
    eb_l, nb_t = mv["F0:L"], mv["SR1_in:T"]
    assert not movements_conflict(eb_t, wb_t)             # opposing through movements coexist
    assert movements_conflict(eb_l, wb_t)                 # left crosses opposing through
    assert movements_conflict(eb_t, nb_t)                 # cross street
    assert not movements_conflict(eb_t, mv["F0:R"])
    mat = conflict_matrix(net.movements)
    assert mat == net.conflicts


def test_every_phase_has_movements():
    net = demo_corridor()
    for nd in net.intersections:
        assert all(len(ph) > 0 for ph in nd.phases)
        # main-axis movements are phases 0/1, side-axis 2/3
        for p, ph in enumerate(nd.phases):
            for i in ph:
                assert (AXIS[net.movements[i].role] == "main") == (p in (0, 1))


def test_route_through_corridor():
    net = demo_corridor()
    r = find_route(net, "B_W", "B_E")
    assert r.links == ["F0", "F1", "F2", "F3"]
    assert [s.node for s in r.stops] == ["I1", "I2", "I3"]
    assert all(s.movement.kind == "T" for s in r.stops)
    assert r.total_length == pytest.approx(230 + 170 + 170 + 230)
    assert r.stops[0].dist_to_stop == pytest.approx(230)
    assert r.locate(0.0) == ("F0", 0.0)
    assert r.locate(r.total_length)[0] == "F3"


def test_route_with_turns():
    net = demo_corridor()
    r = find_route(net, "B_SL2", "B_SR3")
    kinds = [(s.node, s.movement.kind) for s in r.stops]
    assert kinds == [("I2", "L"), ("I3", "R")]            # left onto Main St, right at Maple Dr


def test_route_errors():
    net = demo_corridor()
    with pytest.raises(ValueError):
        find_route(net, "B_W", "B_W")
    with pytest.raises(ValueError):
        find_route(net, "B_W", "nowhere")


def test_corridor_validation():
    with pytest.raises(ValueError):
        build_corridor(CorridorSpec(n=3, spacing=[100.0]))


def test_compass_labels():
    assert compass_labels(90)["F"] == "EB" and compass_labels(90)["SL"] == "SB"
    assert compass_labels(0)["F"] == "NB" and compass_labels(0)["R"] == "SB"
    assert compass_labels(185)["F"] == "SB"


def test_haversine_known_distance():
    # one degree of latitude is ~111.2 km
    assert haversine(0, 0, 1, 0) == pytest.approx(111_195, rel=0.002)


def test_points_network_uses_haversine_spacing_and_snaps_nodes():
    pts = [{"lat": 41.0, "lon": -87.0}, {"lat": 41.0, "lon": -86.997}, {"lat": 41.0, "lon": -86.994}]
    net, warns = network_from_points(pts, {"main_lanes": 3})
    d = haversine(41.0, -87.0, 41.0, -86.997)
    assert net.links["F1"].length == pytest.approx(d, rel=0.01)
    assert (net.intersections[0].lat, net.intersections[0].lon) == (41.0, -87.0)
    assert net.compass["F"] == "EB"
    assert net.source == "map" and net.notes
    # boundary nodes hang off the clicked points
    west = net.boundary("B_W")
    assert west.lon < -87.0
    assert net.to_dict()["links"][0]["latlon1"]


def test_points_spacing_clamped_with_warning():
    pts = [{"lat": 41.0, "lon": -87.0}, {"lat": 41.0001, "lon": -87.0}]
    spec, warns = spec_from_points(pts)
    assert spec.spacing[0] == 60.0 and warns


def test_points_validation():
    with pytest.raises(ValueError):
        spec_from_points([])
    with pytest.raises(ValueError):
        spec_from_points([{"lat": 100, "lon": 0}])


def test_osm_helpers():
    assert parse_maxspeed("30 mph") == pytest.approx(13.41, rel=0.01)
    assert parse_maxspeed("50") == pytest.approx(13.89, rel=0.01)
    assert parse_maxspeed("none") is None
    ways = [{"tags": {"highway": "residential"}}, {"tags": {"highway": "primary", "name": "Main"}}]
    assert pick_main_way(ways)["name"] == "Main"
