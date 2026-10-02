import type { Mode, Network, PreState, SigSnap } from "../types";

export const MODE_LABEL: Record<Mode, string> = {
  fixed: "Fixed-time",
  reactive: "Reactive preemption",
  prioritypulse: "PriorityPulse",
};

export const MODE_SHORT: Record<Mode, string> = { fixed: "Fixed", reactive: "Reactive", prioritypulse: "PriorityPulse" };

/** Colour-blind-safe series colours (Okabe–Ito subset) + dash patterns so lines differ without colour. */
export const MODE_STYLE: Record<Mode, { color: string; dash: string }> = {
  fixed: { color: "#6b7280", dash: "6 4" },
  reactive: { color: "#d55e00", dash: "2 3" },
  prioritypulse: { color: "#0072b2", dash: "" },
};

export function fmtSec(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)} s`;
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const SIGNAL_WORD: Record<SigSnap["s"], string> = { G: "green", Y: "yellow", R: "all-red" };

/** Plain-language summary of one intersection's signal. */
export function describeSignal(net: Network, ni: number, sg: SigSnap): string {
  const name = net.intersections[ni].name;
  const phase = net.phase_names[sg.p]?.toLowerCase() ?? `phase ${sg.p}`;
  let s: string;
  if (sg.s === "G") s = `${phase} green`;
  else if (sg.s === "Y") s = `${phase} yellow, changing to ${net.phase_names[sg.tp]?.toLowerCase()}`;
  else s = `all-red before ${net.phase_names[sg.tp]?.toLowerCase()}`;
  const walking = sg.ped.some((p) => p.st >= 2);
  const waiting = sg.ped.some((p) => p.st === 1);
  const ped = walking ? ", pedestrians crossing" : waiting ? ", pedestrian waiting" : "";
  const pre = PRE_TEXT[sg.pre];
  return `${name}: ${s}${ped}${pre ? `, ${pre}` : ""}`;
}

export const PRE_TEXT: Record<PreState, string> = {
  none: "",
  pending: "emergency preemption pending",
  active: "emergency preemption active",
  hold: "holding emergency green",
  release: "releasing preemption",
  recovery: "restoring coordination",
};

export const PRE_BADGE: Record<PreState, { text: string; icon: string }> = {
  none: { text: "", icon: "" },
  pending: { text: "PREEMPT PENDING", icon: "◔" },
  active: { text: "PREEMPT ACTIVE", icon: "▶" },
  hold: { text: "EMERGENCY GREEN", icon: "★" },
  release: { text: "RELEASING", icon: "↩" },
  recovery: { text: "RECOVERING", icon: "↻" },
};

export const EV_NAME: Record<string, string> = { ambulance: "Ambulance", fire: "Fire truck", police: "Police vehicle" };
