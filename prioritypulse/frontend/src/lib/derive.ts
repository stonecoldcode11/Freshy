import type { Decision, Frame, ModeRun, NetLink, Network, PlanItem, PVSnap, SimEvent } from "../types";

export const frameIndex = (frames: Frame[], t: number): number => Math.min(frames.length - 1, Math.max(0, Math.floor(t)));

export function currentFrame(run: ModeRun | undefined, t: number): Frame | null {
  if (!run || run.frames.length === 0) return null;
  return run.frames[frameIndex(run.frames, t)];
}

export function networkQueue(frame: Frame): number {
  return frame.q.reduce((a, b) => a + b, 0);
}

export function evOf(frame: Frame | null): PVSnap | null {
  return frame?.pv.find((p) => p.kind === "ev") ?? null;
}

export function decisionsUpTo(decisions: Decision[], t: number): Decision[] {
  return decisions.filter((d) => d.t <= t);
}

export function eventsUpTo(events: SimEvent[], t: number): SimEvent[] {
  return events.filter((e) => e.t <= t);
}

/** Latest decision of a given kind at or before `t`. */
export function latestDecision(decisions: Decision[], t: number, kinds?: Decision["kind"][]): Decision | null {
  for (let i = decisions.length - 1; i >= 0; i--) {
    const d = decisions[i];
    if (d.t <= t && (!kinds || kinds.includes(d.kind))) return d;
  }
  return null;
}

export interface LinkState { link: NetLink; ratio: number; occ: number }

export function linkStates(net: Network, frame: Frame): LinkState[] {
  return net.links.map((l, i) => ({ link: l, ratio: frame.occ[i] ?? 0, occ: Math.round((frame.occ[i] ?? 0) * l.capacity) }));
}

export interface WaitRow { role: string; bound: string; seconds: number; where: string; movement: string }

/** Longest current wait per approach direction (Northbound / Southbound / ...). */
export function waitByDirection(net: Network, frame: Frame): WaitRow[] {
  const best = new Map<string, WaitRow>();
  for (const m of net.movements) {
    const w = frame.w[m.idx] ?? 0;
    const bound = net.compass[m.role] ?? m.role;
    const cur = best.get(bound);
    if (!cur || w > cur.seconds) {
      const node = net.intersections.find((n) => n.id === m.node)?.name ?? m.node;
      best.set(bound, { role: m.role, bound, seconds: w, where: node, movement: m.label });
    }
  }
  const order = ["NB", "SB", "EB", "WB"];
  return [...best.values()].sort((a, b) => order.indexOf(a.bound) - order.indexOf(b.bound));
}

export interface PedRow { id: string; name: string; state: "idle" | "waiting" | "walk" | "clearing"; remaining: number; wait: number }

export function pedestrians(net: Network, frame: Frame): PedRow[] {
  const rows: PedRow[] = [];
  net.intersections.forEach((nd, ni) => {
    nd.crosswalks.forEach((cw, ci) => {
      const p = frame.sig[ni].ped[ci];
      const walking = p.st >= 2;
      rows.push({
        id: cw.id, name: cw.name,
        state: p.st === 2 ? "walk" : p.st === 3 ? "clearing" : p.st === 1 ? "waiting" : "idle",
        remaining: walking ? p.rem : 0, wait: p.st === 1 ? p.w : 0,
      });
    });
  });
  return rows;
}

export function plansOf(frame: Frame | null): PlanItem[] {
  return frame?.ctl.plan ?? [];
}

/** Total vehicles currently queued on the approaches of one link. */
export function linkQueue(net: Network, frame: Frame, linkId: string): number {
  return net.movements.filter((m) => m.link === linkId).reduce((a, m) => a + (frame.q[m.idx] ?? 0), 0);
}

/** Stats for the cumulative arrival/departure chart: queue = A_cum - D_cum. */
export function cumulative(run: ModeRun): { t: number[]; arrived: number[]; departed: number[] } {
  return { t: run.series.t, arrived: run.series.arrived, departed: run.series.departed };
}

export function nearestFrameTime(events: SimEvent[], kind: string): number | null {
  const e = events.find((x) => x.kind === kind);
  return e ? e.t : null;
}
