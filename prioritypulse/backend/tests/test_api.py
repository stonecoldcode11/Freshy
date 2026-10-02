import csv
import io

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_and_meta():
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    assert meta["modes"] == ["fixed", "reactive", "prioritypulse"]
    assert "snow" in meta["weather"] and "critical" in meta["priorities"]
    assert meta["defaults"]["physics"]["r_block"] == 0.85


def test_scenario_library():
    sc = client.get("/api/scenarios").json()
    ids = [s["id"] for s in sc]
    assert ids == ["rush_hour_ambulance", "school_dismissal", "stadium_exit", "crash_diversion",
                   "fire_station_dispatch", "rain_snow"]
    assert all(s["watch_for"] and s["description"] for s in sc)


def test_demo_network_endpoint():
    net = client.get("/api/network/demo?n=3").json()
    assert len(net["intersections"]) == 3 and len(net["movements"]) == 36
    assert {b["id"] for b in net["boundaries"]} >= {"B_W", "B_E", "B_SL2"}
    assert client.get("/api/network/demo?n=9").status_code == 422


@pytest.fixture(scope="module")
def run():
    r = client.post("/api/runs", json={"scenario_id": "rush_hour_ambulance", "seed": 5})
    assert r.status_code == 200
    return r.json()


def test_run_payload_shape(run):
    assert set(run["runs"]) == {"fixed", "reactive", "prioritypulse"}
    pp = run["runs"]["prioritypulse"]
    assert len(pp["frames"]) == run["duration"]
    assert pp["metrics"]["ev"]["travel_time"] is not None
    assert run["comparison"]["rows"] and run["comparison"]["report"]["fixed"]["ev_time_saved_s"] is not None
    assert run["network"]["links"] and run["scenario"]["id"] == "rush_hour_ambulance"
    assert pp["decisions"] and pp["events"]
    assert pp["safety"]["compliance_pct"] == 100.0


def test_single_mode_run_has_no_comparison():
    r = client.post("/api/runs", json={"modes": ["fixed"], "include_frames": False, "duration": 150}).json()
    assert list(r["runs"]) == ["fixed"] and r["comparison"] is None
    assert r["runs"]["fixed"]["frames"] == []


def test_overrides_are_applied():
    r = client.post("/api/runs", json={
        "scenario_id": "rush_hour_ambulance", "seed": 2, "modes": ["fixed"], "weather": "snow",
        "intensity": 0.3, "duration": 200, "include_frames": False,
        "dispatch": {"origin": "B_E", "destination": "B_W", "etype": "police", "priority": "urgent", "t": 50},
    }).json()
    cfg = r["runs"]["fixed"]["config"]
    assert cfg["weather"] == "snow" and cfg["intensity"] == 0.3 and cfg["duration"] == 200
    assert r["dispatch"] == {"origin": "B_E", "destination": "B_W", "etype": "police", "priority": "urgent", "t": 50.0}


def test_dispatch_can_be_disabled():
    r = client.post("/api/runs", json={"modes": ["prioritypulse"], "dispatch": {"enabled": False},
                                       "include_frames": False, "duration": 150}).json()
    assert r["dispatch"] is None and r["runs"]["prioritypulse"]["metrics"]["ev"] is None


def test_what_if_pedestrian_call_is_injected():
    r = client.post("/api/runs", json={
        "scenario_id": "rush_hour_ambulance", "modes": ["prioritypulse"], "duration": 200,
        "ped_calls": [{"t": 30, "crosswalk": "I2_X_main"}],
    }).json()
    frames = r["runs"]["prioritypulse"]["frames"]
    assert any(p["st"] >= 1 for f in frames[30:100] for p in f["sig"][1]["ped"])


@pytest.mark.parametrize("body,code", [
    ({"scenario_id": "nope"}, 404),
    ({"dispatch": {"origin": "B_W", "destination": "B_W"}}, 422),
    ({"dispatch": {"origin": "B_W", "destination": "nowhere"}}, 422),
    ({"weather": "hail"}, 422),
    ({"modes": []}, 422),
    ({"duration": 10}, 422),
    ({"intensity": 5}, 422),
    ({"network": {"type": "points", "points": []}}, 422),
    ({"modes": ["warp"]}, 422),
])
def test_validation_errors(body, code):
    assert client.post("/api/runs", json=body).status_code == code


def test_exports(run):
    rid = run["run_id"]
    csv_text = client.get(f"/api/runs/{rid}/export.csv?kind=metrics").text
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[0][:3] == ["metric", "unit", "Fixed-time"]
    assert any(r[0] == "Emergency travel time" for r in rows)
    ts = client.get(f"/api/runs/{rid}/export.csv?kind=timeseries&mode=prioritypulse")
    assert ts.status_code == 200 and ts.text.count("\n") == run["duration"] + 1
    assert client.get(f"/api/runs/{rid}/export.csv?kind=events&mode=fixed").status_code == 200
    dec = client.get(f"/api/runs/{rid}/export.csv?kind=decisions&mode=prioritypulse").text
    assert "Hold" in dec or "Transition" in dec
    md = client.get(f"/api/runs/{rid}/report.md")
    assert md.status_code == 200 and "What changed with PriorityPulse?" in md.text and "not connected to live" in md.text
    js = client.get(f"/api/runs/{rid}/report.json").json()
    assert js["runs"]["fixed"]["frames"] == []
    assert len(client.get(f"/api/runs/{rid}/report.json?frames=true").json()["runs"]["fixed"]["frames"]) > 0


def test_export_errors(run):
    assert client.get("/api/runs/doesnotexist/report.md").status_code == 404
    assert client.get(f"/api/runs/{run['run_id']}/export.csv?kind=bogus").status_code == 422
    assert client.get(f"/api/runs/{run['run_id']}/export.csv?kind=events&mode=warp").status_code == 404


def test_from_points_endpoint_and_run_on_custom_network():
    pts = [{"lat": 42.2586, "lon": -87.8407, "name": "A St"}, {"lat": 42.2586, "lon": -87.8386, "name": "B St"}]
    r = client.post("/api/network/from-points", json={"points": pts, "options": {"main_lanes": 3}})
    assert r.status_code == 200
    body = r.json()
    assert len(body["network"]["intersections"]) == 2 and body["network"]["source"] == "map"
    assert body["network"]["intersections"][0]["name"] == "A St"
    run = client.post("/api/runs", json={
        "scenario_id": "custom", "seed": 1, "duration": 240, "include_frames": False,
        "network": {"type": "points", "points": pts},
        "dispatch": {"origin": "B_W", "destination": "B_E", "t": 70},
    })
    assert run.status_code == 200
    assert run.json()["runs"]["prioritypulse"]["metrics"]["safety_compliance_pct"] == 100.0


def test_from_points_rejects_bad_input():
    assert client.post("/api/network/from-points", json={"points": []}).status_code == 422
    assert client.post("/api/network/from-points", json={"points": [{"lat": 99, "lon": 0}]}).status_code == 422


def test_osm_enrich_degrades_gracefully(monkeypatch):
    class Boom:
        def __init__(self, *a, **k):
            raise OSError("blocked")

    monkeypatch.setattr("httpx.Client", Boom)
    out = client.post("/api/osm/enrich", json={"points": [{"lat": 42.0, "lon": -87.0}]}).json()
    assert out["suggestions"] == [] and "unavailable" in out["warnings"][0]
    r = client.post("/api/network/from-points", json={"points": [{"lat": 42.0, "lon": -87.0}], "enrich": True})
    assert r.status_code == 200 and r.json()["enrichment"]["warnings"]


@pytest.mark.parametrize("weights", [{"horizon": 200}, {"horizon": 2}, {"bogus": 1}, {"w_s": -1}, {"switch_delays": 3}])
def test_weight_overrides_are_bounded(weights):
    r = client.post("/api/runs", json={"weights": weights, "modes": ["prioritypulse"], "duration": 150, "include_frames": False})
    assert r.status_code == 422


def test_valid_weight_override_is_applied():
    r = client.post("/api/runs", json={"weights": {"horizon": 16, "w_s": 10}, "modes": ["prioritypulse"],
                                       "duration": 150, "include_frames": False}).json()
    w = r["runs"]["prioritypulse"]["config"]["weights"]
    assert w["horizon"] == 16 and w["w_s"] == 10


def test_run_store_is_bounded():
    from app.runner import RunStore
    store = RunStore(capacity=3)
    for i in range(5):
        store.put({"run_id": str(i)})
    assert store.get("0") is None and store.get("1") is None and store.get("4") is not None


def test_library_scenario_on_a_smaller_custom_network_degrades_gracefully():
    """A scenario's scheduled bus is skipped (not a crash) when its route is not on the network."""
    pts = [{"lat": 42.0, "lon": -87.0}]
    r = client.post("/api/runs", json={
        "scenario_id": "school_dismissal", "seed": 1, "duration": 150, "include_frames": False, "modes": ["fixed"],
        "network": {"type": "points", "points": pts}, "dispatch": {"origin": "B_W", "destination": "B_E", "t": 40},
    })
    assert r.status_code == 200
    assert any(e["kind"] == "bus_skipped" for e in r.json()["runs"]["fixed"]["events"])


def test_dispatch_to_a_station_that_does_not_exist_names_the_valid_ones():
    r = client.post("/api/runs", json={"network": {"type": "demo", "n": 1}, "dispatch": {"origin": "B_SR3", "destination": "B_E"}})
    assert r.status_code == 422
    assert "B_SR3" in r.json()["detail"] and "Valid stations" in r.json()["detail"]
    r = client.post("/api/runs", json={"scenario_id": "fire_station_dispatch", "network": {"type": "demo", "n": 1}})
    assert r.status_code == 422 and "default dispatch" in r.json()["detail"]
