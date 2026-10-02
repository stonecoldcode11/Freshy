import { useMemo } from "react";
import type { CompareRow, Mode, RunResponse } from "../types";
import { MODES } from "../types";
import { fmtNum, MODE_LABEL, MODE_SHORT, MODE_STYLE } from "../lib/format";
import { LineChart } from "./Chart";
import { CorridorMap } from "./CorridorMap";
import type { ViewMode } from "./CorridorMap";
import { evOf } from "../lib/derive";

function cell(row: CompareRow, m: Mode): string {
  const v = row.values[m];
  if (v === null || v === undefined) return row.key === "recovery" ? "not recovered" : "—";
  if (row.key === "avg_delay") return `${v.toFixed(1)}`;
  if (row.key === "safety") return `${v.toFixed(0)}%`;
  return fmtNum(v, Number.isInteger(v) ? 0 : 1);
}

/** The end-of-run comparison card.  Community view: three headline numbers; Engineer view: every metric. */
export function ResultsCard({ run, view }: { run: RunResponse; view: ViewMode }) {
  const cmp = run.comparison;
  if (!cmp) return <div className="callout">Run all three modes to see the comparison.</div>;
  const modes = MODES.filter((m) => run.runs[m]);
  const headline = ["ev_time", "avg_delay", "spill"].map((k) => cmp.rows.find((r) => r.key === k)!).filter(Boolean);
  const units: Record<string, string> = { ev_time: "seconds", avg_delay: "seconds per vehicle", spill: "events" };
  return (
    <section className="card" aria-labelledby="res-h">
      <div className="card-h">
        <h2 id="res-h">Three-mode comparison</h2>
        <span className="chip">seed {run.seed} · identical arrivals</span>
      </div>
      <div className="card-b stack">
        <div className="grid three">
          {headline.map((r) => (
            <div key={r.key} className="stack">
              <h3>{r.label}</h3>
              <div className="stack">
                {modes.map((m) => (
                  <div key={m} className={`kpi${r.best === m ? " best" : ""}`}>
                    <span className="l">{MODE_LABEL[m]}</span>
                    <span className="v">{cell(r, m)} <span className="l" style={{ fontWeight: 600 }}>{units[r.key]}</span></span>
                    {r.best === m && <span className="t">✓ best</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {view === "engineer" ? (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <caption className="sr-only">All metrics by control mode</caption>
              <thead>
                <tr><th scope="col">Metric</th>{modes.map((m) => <th scope="col" className="num" key={m}>{MODE_SHORT[m]}</th>)}</tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>{r.label}{r.unit && <span className="muted small"> ({r.unit})</span>}</th>
                    {modes.map((m) => (
                      <td key={m} className="num" style={r.best === m ? { background: "var(--ok-soft)", fontWeight: 800 } : undefined}>{cell(r, m)}{r.best === m ? " ✓" : ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">Switch to Engineer View for the full table (throughput, maximum queue, recovery time, idling, safety compliance).</p>
        )}
        <p className="small muted">
          Every run is a single seeded simulation, not a forecast. Results vary with the seed; the Technical Model tab lists the assumptions.
        </p>
      </div>
    </section>
  );
}

export function ComparisonCharts({ run, t }: { run: RunResponse; t: number }) {
  const modes = MODES.filter((m) => run.runs[m]);
  const first = run.runs[modes[0]]!;
  const pp = run.runs.prioritypulse;
  const series = modes.map((m) => ({ id: m, label: MODE_LABEL[m], color: MODE_STYLE[m].color, dash: MODE_STYLE[m].dash, values: run.runs[m]!.series.queue }));
  const dispatch = run.dispatch?.t;
  const arrive = pp?.ev?.t_arrive ?? null;
  const markers = [
    ...(dispatch !== undefined && dispatch !== null ? [{ t: dispatch, label: "dispatch", color: "#7a2fc0" }] : []),
  ];
  const shades = dispatch !== undefined && dispatch !== null && arrive ? [{ from: dispatch, to: arrive, label: "emergency run (PriorityPulse)", color: "#7a2fc0" }] : [];
  const detail = pp ?? first;
  const cumSeries = [
    { id: "arrived", label: "Cumulative arrivals A", color: "#0072b2", values: detail.series.arrived },
    { id: "departed", label: "Cumulative departures D", color: "#009e73", dash: "5 3", values: detail.series.departed },
  ];
  const preMarks = (detail.events ?? []).filter((e) => e.kind === "preempt_start" || e.kind === "preempt_release").map((e) => ({
    t: e.t, label: e.kind === "preempt_start" ? "preempt" : "clear", color: e.kind === "preempt_start" ? "#7a2fc0" : "#17753f",
  })).slice(0, 8);
  return (
    <div className="grid two">
      <section className="card" aria-labelledby="qc-h">
        <div className="card-h"><h2 id="qc-h">Network queue over time</h2></div>
        <div className="card-b">
          <LineChart t={first.series.t} series={series} markers={markers} shades={shades} playhead={t} yLabel="vehicles queued" title="Total queued vehicles in the network for each control mode" />
        </div>
      </section>
      <section className="card" aria-labelledby="cc-h">
        <div className="card-h"><h2 id="cc-h">Arrivals, departures &amp; the queue</h2><span className="chip accent">{MODE_LABEL[detail.mode]}</span></div>
        <div className="card-b">
          <LineChart t={detail.series.t} series={cumSeries} band={{ upper: "arrived", lower: "departed", color: "#e6ab02", label: "Vehicles in the network" }}
            markers={preMarks} playhead={t} yLabel="cumulative vehicles" title="Cumulative arrivals and departures; the shaded gap is the number of vehicles in the network" />
          <p className="small muted" style={{ marginTop: 6 }}>Q(t) = A<sub>cum</sub>(t) − D<sub>cum</sub>(t) (shaded). Purple marks: preemption starts; green: emergency vehicle clear.</p>
        </div>
      </section>
    </div>
  );
}

export function SideBySide({ run, t, view }: { run: RunResponse; t: number; view: ViewMode }) {
  const modes = MODES.filter((m) => run.runs[m]);
  return (
    <div className="grid three">
      {modes.map((m) => {
        const r = run.runs[m]!;
        const f = r.frames[Math.min(r.frames.length - 1, Math.floor(t))];
        const ev = evOf(f);
        const evt = r.metrics.ev;
        return (
          <section key={m} className="card" aria-label={MODE_LABEL[m]}>
            <div className="card-h">
              <h3 style={{ color: MODE_STYLE[m].color === "#6b7280" ? "var(--text)" : MODE_STYLE[m].color }}>{MODE_LABEL[m]}</h3>
              {evt && <span className="chip ev">{r.ev && r.ev.t_arrive !== null && t >= r.ev.t_arrive ? `EV ${evt.travel_time?.toFixed(0)} s` : ev ? `EV ${Math.round(ev.v * 3.6)} km/h` : "EV waiting"}</span>}
            </div>
            <div className="card-b">
              <CorridorMap net={run.network} run={r} t={t} view={view} compact title={MODE_LABEL[m]} />
              <div className="row small muted" style={{ marginTop: 6, justifyContent: "space-between" }}>
                <span>Queue: <b className="mono">{f ? f.q.reduce((a, b) => a + b, 0) : 0}</b></span>
                <span>Blocked links: <b className="mono">{f ? f.blk.length : 0}</b></span>
                <span>EV stops: <b className="mono">{ev?.stops ?? evt?.stops ?? 0}</b></span>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function useModes(run: RunResponse | null): Mode[] {
  return useMemo(() => (run ? MODES.filter((m) => run.runs[m]) : []), [run]);
}
