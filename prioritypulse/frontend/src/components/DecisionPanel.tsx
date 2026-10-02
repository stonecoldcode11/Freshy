import { useMemo, useState } from "react";
import type { Decision, ModeRun, Mode } from "../types";
import { MODE_LABEL, mmss } from "../lib/format";
import type { ViewMode } from "./CorridorMap";

interface Props { run: ModeRun; mode: Mode; t: number; view: ViewMode }

const KIND_LABEL: Record<Decision["kind"], string> = {
  preempt: "Emergency", preempt_request: "Emergency", switch: "Phase change", extend: "Green extended",
  fairness: "Fairness", guard: "Spillback guard",
};
const KIND_CLASS: Record<Decision["kind"], string> = {
  preempt: "kind-preempt", preempt_request: "kind-preempt", switch: "kind-switch", extend: "kind-extend",
  fairness: "kind-fairness", guard: "kind-guard",
};
const KIND_CHIP: Record<Decision["kind"], string> = {
  preempt: "ev", preempt_request: "ev", switch: "accent", extend: "", fairness: "warn", guard: "danger",
};

/** Colour-blind-safe colours for the J(a) cost terms. */
const TERM_META: { key: string; label: string; color: string }[] = [
  { key: "ev", label: "Emergency delay", color: "#7a2fc0" },
  { key: "queue", label: "Queue²", color: "#0072b2" },
  { key: "delay", label: "Total delay", color: "#56b4e9" },
  { key: "spillback", label: "Spillback risk", color: "#d55e00" },
  { key: "fairness", label: "Fairness", color: "#e6ab02" },
  { key: "pedestrian", label: "Pedestrians", color: "#009e73" },
  { key: "switch", label: "Phase change", color: "#6b7280" },
];

type Filter = "all" | "emergency" | "guards";

export function DecisionPanel({ run, mode, t, view }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [pinned, setPinned] = useState<number | null>(null);
  const list = useMemo(() => {
    const up = run.decisions.map((d, i) => ({ d, i })).filter(({ d }) => d.t <= t);
    const f = up.filter(({ d }) =>
      filter === "all" ? true : filter === "emergency" ? d.kind === "preempt" || d.kind === "preempt_request" : d.kind === "guard" || d.kind === "fairness");
    return f.slice().reverse().slice(0, 60);
  }, [run.decisions, t, filter]);
  const latestIdx = useMemo(() => {
    for (let i = run.decisions.length - 1; i >= 0; i--) if (run.decisions[i].t <= t) return i;
    return -1;
  }, [run.decisions, t]);
  const shownIdx = pinned !== null && pinned < run.decisions.length ? pinned : latestIdx;
  const dec = shownIdx >= 0 ? run.decisions[shownIdx] : null;

  if (mode === "fixed") {
    return (
      <section className="card why" aria-labelledby="why-h">
        <div className="card-h"><h2 id="why-h">Why did it change?</h2></div>
        <div className="card-b"><p className="muted">Fixed-time signals follow a pre-set plan, so there is no decision to explain. Switch to <b>PriorityPulse</b> to see the reasoning behind every signal change.</p></div>
      </section>
    );
  }

  const maxCost = dec ? Math.max(...dec.candidates.map((c) => c.cost), 1) : 1;
  return (
    <section className="card why" aria-labelledby="why-h">
      <div className="card-h">
        <h2 id="why-h">Why did it change?</h2>
        <div className="seg" role="group" aria-label="Filter decisions">
          {([["all", "All"], ["emergency", "Emergency"], ["guards", "Guards"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card-b stack">
        {dec ? (
          <div className="callout" style={{ background: "var(--surface-2)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row"><span className={`chip ${KIND_CHIP[dec.kind]}`}>{KIND_LABEL[dec.kind]}</span><span className="muted small">{mmss(dec.t)} · {dec.node_name ?? dec.node}</span></div>
              {pinned !== null && <button className="btn ghost small" onClick={() => setPinned(null)}>Follow live</button>}
            </div>
            <h3 style={{ margin: "6px 0 2px", fontSize: "1.02rem" }}>Decision: {dec.title}</h3>
            <div className="why">
              <b className="small">Why:</b>
              <ul>
                {(view === "engineer" ? dec.reasons : dec.reasons.slice(0, 5)).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            {dec.constraints.length > 0 && (
              <details open={view === "engineer"} style={{ marginTop: 8 }}>
                <summary className="small">Safety checks ({dec.constraints.filter((c) => c.ok).length}/{dec.constraints.length} satisfied)</summary>
                {dec.constraints.map((c) => (
                  <div className="constraint" key={c.name}>
                    <span className={c.ok ? "ok" : "bad"} aria-label={c.ok ? "satisfied" : "violated"}>{c.ok ? "✓" : "✕"}</span>
                    <span><b>{c.name}.</b> {c.detail}</span>
                  </div>
                ))}
              </details>
            )}
            {dec.candidates.length > 0 && (
              <details open style={{ marginTop: 8 }}>
                <summary className="small">Candidate actions and predicted cost J(a)</summary>
                <div role="table" aria-label="Candidate action costs" style={{ marginTop: 4 }}>
                  {dec.candidates.map((c) => {
                    const total = Object.values(c.terms).reduce((a, b) => a + b, 0) || 1;
                    return (
                      <div key={c.label} className={`cand${c.selected ? " sel" : ""}`} role="row">
                        <div role="cell">
                          {c.selected ? "▶ " : ""}{c.label}{c.selected ? " ← selected" : ""}
                          <div className="stackbar" style={{ width: `${Math.max(6, (c.cost / maxCost) * 100)}%` }} aria-hidden>
                            {TERM_META.map((tm) => (
                              <span key={tm.key} className="seg-term" title={`${tm.label}: ${c.terms[tm.key]?.toFixed(1)}`} style={{ width: `${((c.terms[tm.key] ?? 0) / total) * 100}%`, background: tm.color }} />
                            ))}
                          </div>
                        </div>
                        <div role="cell" className="mono" style={{ textAlign: "right" }}>{c.cost.toFixed(1)}</div>
                      </div>
                    );
                  })}
                </div>
                {view === "engineer" && (
                  <>
                    <div className="legend" style={{ marginTop: 6 }}>
                      {TERM_META.map((tm) => <span key={tm.key}><i style={{ background: tm.color }} aria-hidden /> {tm.label}</span>)}
                    </div>
                    <p className="small muted" style={{ marginTop: 6 }}>
                      J(a) = w<sub>EV</sub>D<sub>EV</sub> + w<sub>Q</sub>ΣQ² + w<sub>D</sub>ΣQΔt + w<sub>S</sub>Σ(Q/C)<sup>η</sup> + w<sub>F</sub>Fairness + w<sub>P</sub>Ped + w<sub>C</sub>Switch. Lower is better; the first action of the cheapest legal candidate is applied, then the controller re-plans.
                    </p>
                  </>
                )}
              </details>
            )}
          </div>
        ) : (
          <p className="muted">No decisions yet. Press play — each signal change is explained here as it happens.</p>
        )}
        <div className="feed" role="list" aria-label={`Decision history, ${MODE_LABEL[mode]}`}>
          {list.map(({ d, i }) => (
            <button key={i} className={KIND_CLASS[d.kind]} role="listitem" aria-current={i === shownIdx ? "true" : undefined} onClick={() => setPinned(i === latestIdx && pinned === null ? null : i)}>
              <span className="tm">{mmss(d.t)}</span>
              <span><b className="small">{d.node_name ?? d.node}</b> <span className="muted small">· {KIND_LABEL[d.kind]}</span><br />{d.title}</span>
            </button>
          ))}
          {list.length === 0 && <p className="muted small">Nothing matches this filter yet.</p>}
        </div>
      </div>
    </section>
  );
}
