"""FastAPI service for PriorityPulse.

    python -m uvicorn app.main:app --reload --port 8000

Serves the compiled frontend from ../frontend/dist when it exists, so a single
process can run the whole demo.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import MODES, SimConfig, WEATHER_FACTORS
from .geo import network_from_points, network_from_spec, osm_enrich
from .metrics import MODE_LABELS
from .network import demo_corridor
from .report import decisions_csv, events_csv, metrics_csv, report_markdown, timeseries_csv
from .runner import STORE, execute
from .scenarios import SCENARIOS
from .schemas import EnrichIn, FromPointsIn, RunIn

app = FastAPI(title="PriorityPulse API", version=__version__,
              description="Predictive emergency-vehicle signal priority simulator.")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("PP_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__}


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    cfg = SimConfig()
    return {
        "version": __version__,
        "modes": list(MODES),
        "mode_labels": MODE_LABELS,
        "weather": sorted(WEATHER_FACTORS),
        "priorities": list(cfg.emergency.v_ev),
        "emergency_types": ["ambulance", "fire", "police"],
        "defaults": cfg.to_dict(),
    }


@app.get("/api/scenarios")
def scenarios() -> list[dict[str, Any]]:
    return [s.to_dict() for s in SCENARIOS.values()]


@app.get("/api/network/demo")
def demo_network(n: int = Query(3, ge=1, le=5)) -> dict[str, Any]:
    return demo_corridor(n=n).to_dict()


@app.post("/api/network/from-points")
def network_from_map(body: FromPointsIn) -> dict[str, Any]:
    pts = [p.model_dump() for p in body.points]
    opts = body.options.model_dump()
    out: dict[str, Any] = {"enrichment": None}
    if body.enrich:
        enr = osm_enrich(pts)
        out["enrichment"] = enr
        if enr.get("main_lanes") and "main_lanes" not in body.options.model_fields_set:
            opts["main_lanes"] = max(2, min(5, enr["main_lanes"]))
        if enr.get("main_speed_kmh") and "main_speed_kmh" not in body.options.model_fields_set:
            opts["main_speed_kmh"] = enr["main_speed_kmh"]
    try:
        net, warnings = network_from_points(pts, opts)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out.update({"network": net.to_dict(), "warnings": warnings, "options": opts})
    return out


@app.post("/api/osm/enrich")
def enrich(body: EnrichIn) -> dict[str, Any]:
    return osm_enrich([p.model_dump() for p in body.points])


@app.post("/api/runs")
def create_run(body: RunIn) -> dict[str, Any]:
    try:
        run = execute(body.to_request())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown scenario {exc.args[0]!r}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    STORE.put(run)
    return run


def _stored(run_id: str) -> dict[str, Any]:
    run = STORE.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found (runs are kept in memory and may have expired)")
    return run


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    return _stored(run_id)


@app.get("/api/runs/{run_id}/export.csv")
def export_csv(run_id: str, kind: str = Query("metrics", pattern="^(metrics|timeseries|events|decisions)$"),
               mode: str = "prioritypulse") -> Response:
    run = _stored(run_id)
    if kind == "metrics":
        body = metrics_csv(run)
    else:
        if mode not in run["runs"]:
            raise HTTPException(status_code=404, detail=f"mode {mode!r} was not part of this run")
        if kind == "timeseries":
            if not run["runs"][mode]["frames"]:
                raise HTTPException(status_code=409, detail="this run was created without frames")
            body = timeseries_csv(run, mode)
        elif kind == "events":
            body = events_csv(run, mode)
        else:
            body = decisions_csv(run, mode)
    name = f"prioritypulse_{run['scenario']['id']}_{kind}{'' if kind == 'metrics' else '_' + mode}.csv"
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/runs/{run_id}/report.md")
def export_report(run_id: str) -> PlainTextResponse:
    run = _stored(run_id)
    return PlainTextResponse(report_markdown(run), media_type="text/markdown",
                             headers={"Content-Disposition": f'attachment; filename="prioritypulse_{run["scenario"]["id"]}_report.md"'})


@app.get("/api/runs/{run_id}/report.json")
def export_json(run_id: str, frames: bool = False) -> JSONResponse:
    run = _stored(run_id)
    if not frames:
        run = {**run, "runs": {m: {**r, "frames": []} for m, r in run["runs"].items()}}
    return JSONResponse(run, headers={"Content-Disposition": f'attachment; filename="prioritypulse_{run["scenario"]["id"]}.json"'})


# --- optional: serve the built frontend -------------------------------------------------------------
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        f = (_DIST / path).resolve()
        if path and f.is_file() and _DIST in f.parents:
            return FileResponse(f)
        return FileResponse(_DIST / "index.html")
