"""Map-based scenario builder: turn clicked intersections into a simulation graph.

The result is a *simplified* corridor: road geometry is map-based, while lane
counts, speeds, demand and signal timing are configurable estimates.  Nothing
here connects to real signal infrastructure.
"""

from __future__ import annotations

import math
import re
from typing import Any

from .config import PhysicsParams
from .network import (
    CorridorSpec, Network, bearing, build_corridor, demo_corridor, haversine, offset_latlon,
)

MIN_SPACING = 60.0
MAX_SPACING = 700.0
KMH = 1 / 3.6


def spec_from_points(points: list[dict[str, Any]], opts: dict[str, Any] | None = None) -> tuple[CorridorSpec, list[str]]:
    """Return a CorridorSpec (and warnings) for 1-5 ordered intersection points."""
    opts = opts or {}
    warnings: list[str] = []
    if not 1 <= len(points) <= 5:
        raise ValueError("choose between 1 and 5 intersections along the corridor")
    for p in points:
        if not (-90 <= float(p["lat"]) <= 90 and -180 <= float(p["lon"]) <= 180):
            raise ValueError("latitude/longitude out of range")
    n = len(points)
    lats = [float(p["lat"]) for p in points]
    lons = [float(p["lon"]) for p in points]
    spacing: list[float] = []
    for i in range(1, n):
        d = haversine(lats[i - 1], lons[i - 1], lats[i], lons[i])
        if d < MIN_SPACING:
            warnings.append(f"Intersections {i} and {i + 1} are only {d:.0f} m apart; spacing raised to {MIN_SPACING:.0f} m.")
        if d > MAX_SPACING:
            warnings.append(f"Intersections {i} and {i + 1} are {d:.0f} m apart; spacing capped at {MAX_SPACING:.0f} m.")
        spacing.append(min(MAX_SPACING, max(MIN_SPACING, d)))
    fwd = float(opts.get("forward_bearing")) if opts.get("forward_bearing") is not None else (
        bearing(lats[0], lons[0], lats[-1], lons[-1]) if n > 1 else 90.0)
    names = [str(p.get("name") or f"Intersection {i + 1}") for i, p in enumerate(points)]
    spec = CorridorSpec(
        name=str(opts.get("name") or "Custom corridor"), n=n, names=names, spacing=spacing,
        entry_length=float(opts.get("entry_length", 230.0)), side_length=float(opts.get("side_length", 190.0)),
        main_lanes=int(opts.get("main_lanes", 3)), side_lanes=int(opts.get("side_lanes", 2)),
        main_speed=(float(opts["main_speed_kmh"]) * KMH) if opts.get("main_speed_kmh") else None,
        side_speed=(float(opts["side_speed_kmh"]) * KMH) if opts.get("side_speed_kmh") else None,
        origin=(sum(lats) / n, sum(lons) / n), forward_bearing=fwd,
        boundary_names=dict(opts.get("boundary_names") or {}),
        boundary_kinds=dict(opts.get("boundary_kinds") or {}),
        source="map",
        notes=[
            "Road geometry is map-based; lane counts, speeds, demand and signal timing are configurable estimates.",
            "Simplified straight corridor with one side street per intersection. Not connected to live traffic-signal infrastructure.",
        ],
    )
    return spec, warnings


def network_from_points(points: list[dict[str, Any]], opts: dict[str, Any] | None,
                        phys: PhysicsParams | None = None) -> tuple[Network, list[str]]:
    spec, warnings = spec_from_points(points, opts)
    net = build_corridor(spec, phys)
    # snap intersections to the clicked coordinates and hang boundary nodes off them
    th = spec.forward_bearing
    left = (th - 90.0) % 360.0
    right = (th + 90.0) % 360.0
    for nd, p in zip(net.intersections, points):
        nd.lat, nd.lon = float(p["lat"]), float(p["lon"])
    first, last = net.intersections[0], net.intersections[-1]
    by_id = {b.id: b for b in net.boundaries}
    by_id["B_W"].lat, by_id["B_W"].lon = offset_latlon(first.lat, first.lon, (th + 180) % 360, spec.entry_length)
    by_id["B_E"].lat, by_id["B_E"].lon = offset_latlon(last.lat, last.lon, th, spec.entry_length)
    for nd in net.intersections:
        i = nd.index + 1
        by_id[f"B_SL{i}"].lat, by_id[f"B_SL{i}"].lon = offset_latlon(nd.lat, nd.lon, left, spec.side_length)
        by_id[f"B_SR{i}"].lat, by_id[f"B_SR{i}"].lon = offset_latlon(nd.lat, nd.lon, right, spec.side_length)
    net.origin_lat, net.origin_lon = spec.origin
    return net, warnings


def network_from_spec(spec: dict[str, Any] | None, phys: PhysicsParams | None = None) -> Network:
    """Build a Network from the JSON description a client sends with a run request."""
    phys = phys or PhysicsParams()
    if not spec or spec.get("type", "demo") == "demo":
        return demo_corridor(phys, n=int((spec or {}).get("n", 3)))
    if spec["type"] == "points":
        net, _ = network_from_points(spec["points"], spec.get("options"), phys)
        return net
    raise ValueError(f"unknown network type {spec['type']!r}")


# ---------------------------------------------------------------------------
# optional OpenStreetMap enrichment (best-effort; never required)
# ---------------------------------------------------------------------------

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_HIGHWAY_RANK = {"motorway": 7, "trunk": 6, "primary": 5, "secondary": 4, "tertiary": 3,
                 "unclassified": 2, "residential": 1, "service": 0}


def parse_maxspeed(raw: str | None) -> float | None:
    """OSM maxspeed ("50", "30 mph", "none") -> m/s, or None."""
    if not raw:
        return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?\s*$", raw.strip().lower())
    if not m:
        return None
    v = float(m.group(1))
    if m.group(2) == "mph":
        return v * 0.44704
    return v * KMH


def pick_main_way(ways: list[dict[str, Any]]) -> dict[str, Any] | None:
    best, best_rank = None, -1
    for w in ways:
        tags = w.get("tags", {})
        rank = _HIGHWAY_RANK.get(tags.get("highway", ""), -1)
        if rank > best_rank:
            best, best_rank = tags, rank
    return best


def osm_enrich(points: list[dict[str, Any]], timeout: float = 8.0) -> dict[str, Any]:
    """Look up road class / lanes / speed near each point.  Returns suggestions and warnings."""
    import httpx

    suggestions: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        with httpx.Client(timeout=timeout) as client:
            for p in points:
                q = f'[out:json][timeout:{int(timeout)}];way(around:45,{float(p["lat"])},{float(p["lon"])})[highway];out tags;'
                r = client.post(OVERPASS_URL, data={"data": q})
                r.raise_for_status()
                tags = pick_main_way(r.json().get("elements", [])) or {}
                lanes = tags.get("lanes")
                per_dir = None
                if lanes and str(lanes).isdigit():
                    per_dir = max(1, int(lanes) if tags.get("oneway") == "yes" else int(lanes) // 2)
                suggestions.append({
                    "name": tags.get("name"), "highway": tags.get("highway"),
                    "lanes_per_direction": per_dir, "maxspeed_ms": parse_maxspeed(tags.get("maxspeed")),
                })
    except Exception as exc:  # network blocked, rate limit, bad JSON ...
        warnings.append(f"OpenStreetMap lookup unavailable ({type(exc).__name__}); using the defaults you entered.")
        return {"suggestions": [], "warnings": warnings}
    lanes = [s["lanes_per_direction"] for s in suggestions if s["lanes_per_direction"]]
    speeds = [s["maxspeed_ms"] for s in suggestions if s["maxspeed_ms"]]
    return {
        "suggestions": suggestions,
        "main_lanes": (round(sum(lanes) / len(lanes)) + 1) if lanes else None,   # +1: left-turn bay
        "main_speed_kmh": round(sum(speeds) / len(speeds) / KMH) if speeds else None,
        "warnings": warnings,
    }
