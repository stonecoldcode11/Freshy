import type { NetLink, Network } from "../types";

export const STOP_SETBACK = 14; // metres between the stop line and the intersection centre
export const LANE_W = 3.4;
export const VEH_LEN = 4.6;

export interface Pt { x: number; y: number }

export function unit(l: NetLink): Pt {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Left-hand normal of the travel direction (world coordinates, y up). */
export function normalLeft(u: Pt): Pt {
  return { x: -u.y, y: u.x };
}

/** Right-hand traffic: a link's lanes sit to the right of its travel direction. */
export function laneOffset(lane: number, lanes: number): number {
  return -(1.2 + (lane + 0.5) * LANE_W) + 0 * lanes;
}

export function pointOnLink(l: NetLink, distFromStart: number, lane = -1, lanes = 1): Pt {
  const u = unit(l);
  const n = normalLeft(u);
  const off = lane < 0 ? 0 : laneOffset(lane, lanes);
  return { x: l.x1 + u.x * distFromStart + n.x * off, y: l.y1 + u.y * distFromStart + n.y * off };
}

/** Position a distance `back` metres behind the stop line of an approach link. */
export function behindStopLine(l: NetLink, back: number, lane: number): Pt {
  const dist = Math.max(0, l.length - STOP_SETBACK - back);
  return pointOnLink(l, dist, lane, l.lanes);
}

/** World position of a vehicle `s` metres along a route (a list of link ids with cumulative end distances). */
export function locateOnRoute(
  net: Network, linkIds: string[], cumEnds: number[], s: number,
): { x: number; y: number; angle: number; link: string; frac: number } {
  const byId = new Map(net.links.map((l) => [l.id, l] as const));
  let start = 0;
  for (let i = 0; i < linkIds.length; i++) {
    const end = cumEnds[i];
    if (s <= end + 1e-9 || i === linkIds.length - 1) {
      const l = byId.get(linkIds[i])!;
      const frac = Math.min(1, Math.max(0, (s - start) / Math.max(end - start, 1e-9)));
      const p = pointOnLink(l, frac * l.length, 0, l.lanes);
      const u = unit(l);
      return { x: p.x, y: p.y, angle: (Math.atan2(u.y, u.x) * 180) / Math.PI, link: l.id, frac };
    }
    start = end;
  }
  throw new Error("empty route");
}

/** Round-robin lane choice per movement kind: lefts use the inner lane, rights the outer lane. */
export function laneFor(kind: "L" | "T" | "R", lanes: number, k: number): number {
  if (lanes <= 1) return 0;
  if (kind === "L") return 0;
  if (kind === "R") return lanes - 1;
  return 1 + (k % Math.max(1, lanes - 1));
}

/** Stack queued vehicles lane by lane behind the stop line.  Returns [back-distance, lane] per vehicle. */
export function queueSlots(
  counts: { L: number; T: number; R: number }, lanes: number, maxShown: number,
): { kind: "L" | "T" | "R"; back: number; lane: number }[] {
  const fill = new Array(Math.max(1, lanes)).fill(0);
  const out: { kind: "L" | "T" | "R"; back: number; lane: number }[] = [];
  const spacing = VEH_LEN + 2.9; // matches ~7.5 m jam spacing
  for (const kind of ["L", "T", "R"] as const) {
    for (let k = 0; k < counts[kind] && out.length < maxShown; k++) {
      const lane = laneFor(kind, lanes, k);
      out.push({ kind, back: fill[lane] * spacing, lane });
      fill[lane] += 1;
    }
  }
  return out;
}

/** Bounding box of every node and link, padded, for the schematic viewBox. */
export function boundsOf(net: Network, pad = 40): { x: number; y: number; w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const l of net.links) {
    xs.push(l.x1, l.x2);
    ys.push(l.y1, l.y2);
  }
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  // SVG y grows downward; the map is drawn with y flipped, so the box is expressed in flipped space.
  return { x: minX, y: -maxY, w: maxX - minX, h: maxY - minY };
}
