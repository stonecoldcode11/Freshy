import type { OutcomeVs, RunResponse } from "../types";
import { api } from "../api";
import { Icon } from "./Icon";

function Line({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 8 }}>
      <span aria-hidden style={{ color: ok === null ? "var(--muted)" : ok ? "var(--ok)" : "var(--warn)", fontWeight: 800 }}>{ok === null ? "•" : ok ? "▲" : "▼"}</span>
      <span>{children}</span>
    </li>
  );
}

function Block({ title, o }: { title: string; o: OutcomeVs }) {
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="card-h"><h3>{title}</h3></div>
      <div className="card-b">
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
          {o.ev_time_saved_s !== null && <Line ok={o.ev_time_saved_s > 0}>Emergency travel time {o.ev_time_saved_s >= 0 ? "saved" : "lost"}: <b>{Math.abs(o.ev_time_saved_s).toFixed(0)} s</b>{o.ev_improvement_pct !== null && <> ({o.ev_improvement_pct.toFixed(0)}%)</>}</Line>}
          {o.ev_stops_avoided !== null && <Line ok={o.ev_stops_avoided >= 0}>Emergency stops avoided: <b>{o.ev_stops_avoided}</b></Line>}
          <Line ok={o.max_queue_reduced >= 0}>Maximum queue {o.max_queue_reduced >= 0 ? "reduced" : "increased"} by: <b>{Math.abs(o.max_queue_reduced)}</b> vehicles</Line>
          <Line ok={o.spillback_prevented >= 0}>Spillback events {o.spillback_prevented >= 0 ? "prevented" : "added"}: <b>{Math.abs(o.spillback_prevented)}</b></Line>
          {o.recovery_improved_s !== null
            ? <Line ok={o.recovery_improved_s >= 0}>Network recovery {o.recovery_improved_s >= 0 ? "improved" : "slower"} by: <b>{Math.abs(o.recovery_improved_s).toFixed(0)} s</b></Line>
            : <Line ok={null}>Network recovery: not comparable (a mode did not recover within the run)</Line>}
          <Line ok={o.idling_reduced_veh_min >= 0}>Estimated vehicle idling {o.idling_reduced_veh_min >= 0 ? "reduced" : "increased"} by: <b>{Math.abs(o.idling_reduced_veh_min).toFixed(1)} vehicle-minutes</b></Line>
          <Line ok={o.avg_delay_change_s <= 0}>Average driver delay: <b>{o.avg_delay_change_s > 0 ? "+" : ""}{o.avg_delay_change_s.toFixed(1)} s</b> per vehicle</Line>
        </ul>
      </div>
    </div>
  );
}

export function ReportPanel({ run }: { run: RunResponse }) {
  const rep = run.comparison?.report;
  const pp = run.runs.prioritypulse;
  return (
    <div className="stack">
      <section className="card" aria-labelledby="rep-h">
        <div className="card-h"><h2 id="rep-h">What changed with PriorityPulse?</h2><span className="chip ok">▲ better · ▼ worse</span></div>
        <div className="card-b stack">
          {rep ? (
            <div className="grid two">
              {rep.fixed && <Block title="vs Fixed-time signals" o={rep.fixed} />}
              {rep.reactive && <Block title="vs Reactive preemption" o={rep.reactive} />}
            </div>
          ) : <p className="muted">Run all three modes to see the outcome report.</p>}
          {pp && (
            <div className="callout ok">
              <b>Safety:</b> {pp.safety.compliance_pct}% of {pp.safety.transitions} signal transitions were legal (green → yellow → all-red → green, minimum green, pedestrian clearance, no conflicting movements) as audited by an independent monitor.
              {pp.safety.violations.length > 0 && <ul>{pp.safety.violations.map((v) => <li key={v}>{v}</li>)}</ul>}
            </div>
          )}
          <p className="small muted">
            “Estimated idling reduction” is queued vehicle-time. A CO₂ number would need an emissions factor; the exported CSV states the assumed {rep?.co2_assumption_g_per_veh_s ?? 0.7} g per idling vehicle-second as a scenario parameter, not a measurement.
          </p>
        </div>
      </section>
      <section className="card" aria-labelledby="exp-h">
        <div className="card-h"><h2 id="exp-h">Export center</h2></div>
        <div className="card-b stack">
          <div className="row">
            <a className="btn" href={api.reportUrl(run.run_id, "md")} download><Icon name="download" size={16} /> Report (.md)</a>
            <a className="btn" href={api.exportUrl(run.run_id, "metrics")} download><Icon name="download" size={16} /> Metrics (.csv)</a>
            <a className="btn" href={api.exportUrl(run.run_id, "timeseries", "prioritypulse")} download><Icon name="download" size={16} /> Time series (.csv)</a>
            <a className="btn" href={api.exportUrl(run.run_id, "decisions", "prioritypulse")} download><Icon name="download" size={16} /> Decision log (.csv)</a>
            <a className="btn" href={api.exportUrl(run.run_id, "events", "prioritypulse")} download><Icon name="download" size={16} /> Events (.csv)</a>
            <a className="btn" href={api.reportUrl(run.run_id, "json")} download><Icon name="download" size={16} /> Full JSON</a>
          </div>
          <p className="small muted">Runs are kept in server memory for a short time. Time series, decisions and events export the PriorityPulse run; change <code>mode=</code> in the URL for the others.</p>
        </div>
      </section>
    </div>
  );
}
