import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { ModeRun, Network, LatLon } from "../types";
import { heatColor } from "../lib/heat";

interface Props { net: Network; run: ModeRun; t: number }

/** Shift a lat/lon by (east, north) metres. */
function shift(p: LatLon, east: number, north: number): LatLon {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((p[0] * Math.PI) / 180);
  return [p[0] + north / mLat, p[1] + east / mLon];
}

/** Right-hand-traffic offset of a directional link so both directions are visible. */
function offsetLine(a: LatLon, b: LatLon, metres: number): [LatLon, LatLon] {
  const mLon = 111320 * Math.cos((a[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * mLon;
  const dy = (b[0] - a[0]) * 111320;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len; // right-hand normal in (east, north)
  const ny = -dx / len;
  return [shift(a, nx * metres, ny * metres), shift(b, nx * metres, ny * metres)];
}

const SIG = { G: "#1b9e77", Y: "#f2c230", R: "#c1121f" } as const;

export function GeoMap({ net, run, t }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const lines = useRef<Map<string, L.Polyline>>(new Map());
  const nodes = useRef<Map<string, L.CircleMarker>>(new Map());
  const ev = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
    const all: LatLon[] = [];
    for (const l of net.links) {
      const [a, b] = offsetLine(l.latlon1, l.latlon2, 4);
      const pl = L.polyline([a, b], { color: "#1b9e77", weight: 6, opacity: 0.85 }).addTo(m);
      pl.bindTooltip(`${l.id} · ${l.bound}`);
      lines.current.set(l.id, pl);
      all.push(a, b);
    }
    for (const nd of net.intersections) {
      const mk = L.circleMarker(nd.latlon, { radius: 9, color: "#111", weight: 2, fillColor: "#1b9e77", fillOpacity: 1 }).addTo(m);
      mk.bindTooltip(nd.name, { permanent: true, direction: "top", offset: [0, -8] });
      nodes.current.set(nd.id, mk);
    }
    if (run.ev) {
      const byId = new Map(net.links.map((l) => [l.id, l] as const));
      const pts: LatLon[] = [];
      run.ev.route.links.forEach((id) => { const l = byId.get(id); if (l) { const [a, b] = offsetLine(l.latlon1, l.latlon2, 1.5); pts.push(a, b); } });
      L.polyline(pts, { color: "#7a2fc0", weight: 3, dashArray: "8 6" }).addTo(m);
      ev.current = L.circleMarker(pts[0] ?? net.origin, { radius: 8, color: "#fff", weight: 2, fillColor: "#7a2fc0", fillOpacity: 1 }).addTo(m);
    }
    m.fitBounds(L.latLngBounds(all), { padding: [30, 30] });
    map.current = m;
    const lm = lines.current, nm = nodes.current;
    return () => { m.remove(); map.current = null; lm.clear(); nm.clear(); ev.current = null; };
  }, [net, run.ev]);

  useEffect(() => {
    const frame = run.frames[Math.min(run.frames.length - 1, Math.floor(t))];
    if (!frame) return;
    net.links.forEach((l, i) => {
      const pl = lines.current.get(l.id);
      if (pl) pl.setStyle({ color: heatColor(frame.occ[i] ?? 0, net.r_block), weight: l.kind === "exit" ? 3 : 6, dashArray: (frame.occ[i] ?? 0) >= net.r_block ? "4 4" : undefined });
    });
    net.intersections.forEach((nd, i) => {
      const mk = nodes.current.get(nd.id);
      if (mk) mk.setStyle({ fillColor: SIG[frame.sig[i].s], color: frame.sig[i].pre === "active" || frame.sig[i].pre === "hold" ? "#7a2fc0" : "#111", weight: frame.sig[i].pre === "none" ? 2 : 4 });
    });
    const pv = frame.pv.find((p) => p.kind === "ev");
    if (ev.current && run.ev) {
      if (pv && pv.st === "enroute") {
        const byId = new Map(net.links.map((l) => [l.id, l] as const));
        let start = 0;
        for (let i = 0; i < run.ev.route.links.length; i++) {
          const end = run.ev.route.cum_ends[i];
          if (pv.s <= end + 1e-9 || i === run.ev.route.links.length - 1) {
            const l = byId.get(run.ev.route.links[i])!;
            const f = Math.min(1, Math.max(0, (pv.s - start) / Math.max(1e-9, end - start)));
            const [a, b] = offsetLine(l.latlon1, l.latlon2, 1.5);
            ev.current.setLatLng([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
            break;
          }
          start = end;
        }
        ev.current.setStyle({ opacity: 1, fillOpacity: 1 });
      } else {
        ev.current.setStyle({ opacity: 0, fillOpacity: 0 });
      }
    }
  }, [t, net, run]);

  return <div className="leaflet-wrap tall" ref={el} role="img" aria-label="Geographic map of the simulated corridor with link congestion and signal states" />;
}
