import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type { FromPointsResponse, MapPoint, Network, NetworkSpec, PointsOptions } from "../types";

export interface BuiltNetwork { spec: NetworkSpec; network: Network; warnings: string[]; note: string[] }

interface Props {
  initial: { points: MapPoint[]; options: PointsOptions } | null;
  onBuilt: (b: BuiltNetwork) => void;
  onClose: () => void;
}

const MIN_CLICK_ZOOM = 14;       // street level: below this, clicks are too coarse to be an intersection
const MAX_SPACING_M = 1500;      // a single signalised corridor, not a city

const DEFAULT_OPTS: PointsOptions = { main_lanes: 3, side_lanes: 2, main_speed_kmh: null, side_speed_kmh: null };

export function haversine(a: MapPoint, b: MapPoint): number {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface SearchHit { display_name: string; lat: string; lon: string }

export function LocationPicker({ initial, onBuilt, onClose }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [points, setPoints] = useState<MapPoint[]>(initial?.points ?? []);
  const [opts, setOpts] = useState<PointsOptions>(initial?.options ?? DEFAULT_OPTS);
  const [enrich, setEnrich] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ---- map setup (once) ------------------------------------------------------------------
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = L.map(mapEl.current, { zoomControl: true }).setView(initial?.points?.[0] ? [initial.points[0].lat, initial.points[0].lon] : [39.5, -98.35], initial?.points?.length ? 17 : 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (m.getZoom() < MIN_CLICK_ZOOM) {
        setMsg("Zoom in to street level first (search an address, or use the + button), then click each intersection.");
        return;
      }
      setMsg(null);
      setPoints((prev) => (prev.length >= 5 ? prev : [...prev, { lat: e.latlng.lat, lon: e.latlng.lng, name: `Intersection ${prev.length + 1}` }]));
    });
    map.current = m;
    setTimeout(() => m.invalidateSize(), 80);
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keep markers in sync -------------------------------------------------------------------
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    points.forEach((p, i) => {
      const mk = L.marker([p.lat, p.lon], {
        draggable: true, keyboard: false,
        icon: L.divIcon({ className: "", html: `<div class="pt-marker">${i + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
      });
      mk.on("dragend", () => {
        const ll = mk.getLatLng();
        setPoints((prev) => prev.map((q, j) => (j === i ? { ...q, lat: ll.lat, lon: ll.lng } : q)));
      });
      mk.addTo(g);
    });
    if (points.length > 1) L.polyline(points.map((p) => [p.lat, p.lon] as [number, number]), { color: "#0b5cab", weight: 4, opacity: 0.7, dashArray: "6 6" }).addTo(g);
  }, [points]);

  // ---- keyboard: Esc closes -----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setMsg(null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as SearchHit[];
      setHits(data);
      if (data.length === 0) setMsg("No matches. Try a street and city, e.g. “Main St & Oak Ave, Springfield”.");
    } catch {
      setMsg("Address search is unavailable (offline or blocked). You can still click the map to place intersections.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const spacings = points.slice(1).map((p, i) => haversine(points[i], p));
  const tooFar = spacings.some((d) => d > MAX_SPACING_M);

  const build = async () => {
    setBuilding(true);
    setErr(null);
    try {
      const res: FromPointsResponse = await api.fromPoints(points, opts, enrich);
      const notes = [...(res.enrichment?.warnings ?? [])];
      if (res.enrichment?.main_lanes) notes.push(`OpenStreetMap suggests ${res.enrichment.main_lanes} lanes (incl. turn bay) and ${res.enrichment.main_speed_kmh ?? "?"} km/h.`);
      onBuilt({ spec: { type: "points", points, options: res.options }, network: res.network, warnings: res.warnings, note: notes });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not build the network.");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="loc-h" tabIndex={-1} ref={dialogRef}>
        <div className="card-h" style={{ padding: "14px 16px 0" }}>
          <h2 id="loc-h">Simulate a real location</h2>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-b stack">
          <div className="callout warn small">
            <b>Simulation assumptions:</b> road geometry is map-based. Traffic demand, lane configuration and signal timing are configurable estimates. This is not connected to live traffic-signal infrastructure and does not import every turn lane or signal plan.
          </div>
          <div className="grid two" style={{ alignItems: "start" }}>
            <div className="stack">
              <form className="row" onSubmit={(e) => { e.preventDefault(); void search(); }} role="search">
                <label className="sr-only" htmlFor="addr">Search address or intersection</label>
                <input id="addr" type="search" placeholder="Search an address or intersection…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minHeight: 36, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)" }} />
                <button className="btn" type="submit" disabled={searching}>{searching ? "Searching…" : "Search"}</button>
              </form>
              {hits.length > 0 && (
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {hits.map((h) => (
                    <li key={h.display_name}>
                      <button className="btn small" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                        onClick={() => { map.current?.setView([Number(h.lat), Number(h.lon)], 17); setHits([]); }}>{h.display_name}</button>
                    </li>
                  ))}
                </ul>
              )}
              {msg && <p className="small muted" role="status">{msg}</p>}
              <div className="leaflet-wrap tall" ref={mapEl} aria-label="Map. Click to place intersections in order along the corridor." />
              <p className="small muted">Zoom to street level, then click to place 1–5 intersections in order along one main street. Drag a marker to adjust it.</p>
            </div>
            <div className="stack">
              <h3>Intersections ({points.length}/5)</h3>
              {points.length === 0 && <p className="muted small">None yet — click the map.</p>}
              <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
                {points.map((p, i) => (
                  <li key={i}>
                    <div className="row">
                      <input aria-label={`Name of intersection ${i + 1}`} type="text" value={p.name ?? ""} maxLength={40}
                        onChange={(e) => setPoints((prev) => prev.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))}
                        style={{ flex: 1, minHeight: 34, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)" }} />
                      <button className="btn small" onClick={() => setPoints((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove intersection ${i + 1}`}>Remove</button>
                    </div>
                    {i > 0 && (
                      <div className="small" style={{ color: spacings[i - 1] < 60 || spacings[i - 1] > 700 ? "var(--warn)" : "var(--muted)" }}>
                        {spacings[i - 1].toFixed(0)} m from the previous one{spacings[i - 1] < 60 ? " (will be raised to 60 m)" : spacings[i - 1] > 700 ? " (will be capped at 700 m)" : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="divider" />
              <h3>Confirm road assumptions</h3>
              <div className="grid two">
                <div className="field"><label htmlFor="ml">Main street lanes (incl. left bay)</label>
                  <input id="ml" type="number" min={2} max={5} value={opts.main_lanes} onChange={(e) => setOpts({ ...opts, main_lanes: Math.min(5, Math.max(2, Number(e.target.value) || 3)) })} /></div>
                <div className="field"><label htmlFor="sl">Side street lanes</label>
                  <input id="sl" type="number" min={1} max={4} value={opts.side_lanes} onChange={(e) => setOpts({ ...opts, side_lanes: Math.min(4, Math.max(1, Number(e.target.value) || 2)) })} /></div>
                <div className="field"><label htmlFor="ms">Main speed (km/h)</label>
                  <input id="ms" type="number" min={10} max={100} placeholder="48" value={opts.main_speed_kmh ?? ""} onChange={(e) => setOpts({ ...opts, main_speed_kmh: e.target.value ? Number(e.target.value) : null })} /></div>
                <div className="field"><label htmlFor="ss">Side speed (km/h)</label>
                  <input id="ss" type="number" min={10} max={80} placeholder="40" value={opts.side_speed_kmh ?? ""} onChange={(e) => setOpts({ ...opts, side_speed_kmh: e.target.value ? Number(e.target.value) : null })} /></div>
              </div>
              <label className="check small"><input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} /> Try to read lanes / speed limit from OpenStreetMap (optional; needs internet)</label>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Every intersection gets four legs, protected left turns and pedestrian crossings.</li>
                <li>Boundary gates at both ends and on each side street can be used as dispatch origins and destinations.</li>
              </ul>
              {tooFar && <div className="callout danger" role="alert">Some intersections are more than {MAX_SPACING_M / 1000} km apart. Place them along one main street, within about 1.5 km.</div>}
              {err && <div className="callout danger" role="alert">{err}</div>}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn primary" disabled={points.length === 0 || building || tooFar} onClick={() => void build()}>
                  {building ? "Building…" : "Build simulation network"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
