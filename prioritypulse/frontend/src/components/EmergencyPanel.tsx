import type { Frame, Mode, ModeRun, Network, PlanItem, SigSnap } from "../types";
import { EV_NAME, fmtSec, MODE_LABEL, PRE_TEXT } from "../lib/format";
import { evOf, plansOf } from "../lib/derive";
import type { ViewMode } from "./CorridorMap";

interface Props { net: Network; run: ModeRun; mode: Mode; frame: Frame; t: number; view: ViewMode }

const PRIORITY_CHIP: Record<string, string> = { routine: "accent", urgent: "warn", critical: "danger" };

function Sequence({ sg, evPhase, net }: { sg: SigSnap; evPhase: number; net: Network }) {
  if (sg.p === evPhase && sg.s === "G") {
    return <div className="callout ok small" role="status">✓ Emergency phase is green and being held until the vehicle has passed.</div>;
  }
  // transition under way: Green(p) -> Yellow(p) -> All-red -> Green(EV phase)
  const idx = sg.s === "G" ? 0 : sg.s === "Y" ? 1 : 2;
  const steps = [`${net.phase_names[sg.p] ?? "Current phase"} green`, "Yellow", "All-red", "Emergency green"];
  return (
    <ol className="stepper" aria-label="Safe preemption sequence" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s, i) => (
        <li key={s} className={`st${i < idx ? " done" : ""}${i === idx ? " now" : ""}`} aria-current={i === idx ? "step" : undefined}>
          {i < idx ? "✓ " : i === idx ? "▶ " : ""}{s}
        </li>
      ))}
    </ol>
  );
}

function statusChip(plan: PlanItem | undefined, passed: boolean, mode: Mode, pre: string) {
  if (passed) return <span className="chip ok">✓ Complete</span>;
  if (mode === "prioritypulse" && plan) {
    if (plan.status === "active") return <span className="chip ev">▶ Active</span>;
    if (plan.status === "pending") return <span className="chip accent">◔ Pending</span>;
    return <span className="chip">Planned</span>;
  }
  if (mode === "reactive") {
    return pre === "active" || pre === "hold" ? <span className="chip ev">▶ Preempting</span> : <span className="chip">Waiting for detector</span>;
  }
  if (mode === "fixed") return <span className="chip">No preemption</span>;
  return <span className="chip">Planned</span>;
}

export function EmergencyPanel({ net, run, mode, frame, t, view }: Props) {
  const ev = run.ev;
  if (!ev) {
    return (
      <section className="card" aria-labelledby="ev-h">
        <div className="card-h"><h2 id="ev-h">Emergency vehicle</h2></div>
        <div className="card-b"><p className="muted">No emergency vehicle is dispatched in this run. Use the Dispatch Center to send one.</p></div>
      </section>
    );
  }
  const snap = evOf(frame);
  const plans = plansOf(frame);
  const nameOf = (id: string) => net.intersections.find((n) => n.id === id)?.name ?? id;
  const dispatched = t >= ev.t_dispatch;
  const arrived = ev.t_arrive !== null && t >= ev.t_arrive;
  const remaining = Math.max(0, ev.route.length - (snap?.s ?? 0));
  const nextJ = ev.route.stops.findIndex((_, j) => ev.passed_at[j] === null || (ev.passed_at[j] as number) > t);
  const nextStop = nextJ >= 0 ? ev.route.stops[nextJ] : null;
  const nextPlan = plans.find((p) => p.j === nextJ);
  const ni = nextStop ? net.intersections.findIndex((n) => n.id === nextStop.node) : -1;
  const speedKmh = snap ? snap.v * 3.6 : 0;

  const fixedEta = (j: number) => {
    const s = snap?.s ?? 0;
    if (!dispatched) return ev.t_dispatch - t + ev.route.stops[j].dist / ev.speed;
    return Math.max(0, (ev.route.stops[j].dist - s) / ev.speed);
  };

  return (
    <section className="card" aria-labelledby="ev-h">
      <div className="card-h">
        <h2 id="ev-h">Emergency vehicle</h2>
        <span className={`chip ${PRIORITY_CHIP[ev.priority]}`}>{ev.priority}</span>
        <span className="chip ev">{EV_NAME[ev.etype]}</span>
      </div>
      <div className="card-b stack">
        <p className="small muted">{ev.label} · {MODE_LABEL[mode]}</p>
        {!dispatched && <div className="callout ev">Dispatch in <b>{fmtSec(ev.t_dispatch - t)}</b>.{mode === "prioritypulse" && " PriorityPulse is told the route a few seconds before departure (crew turnout)."}</div>}
        {arrived && (
          <div className="callout ok">
            <b>Arrived</b> after <b>{fmtSec(ev.t_arrive! - ev.t_dispatch, 0)}</b> (free-flow {fmtSec(run.metrics.ev?.free_flow_time ?? null, 0)}) with <b>{snap?.stops ?? run.metrics.ev?.stops ?? 0}</b> stop(s).
          </div>
        )}
        {dispatched && !arrived && snap && (
          <div className="row" style={{ gap: 14 }}>
            <div className="kpi"><span className="v">{speedKmh.toFixed(0)}</span><span className="l">km/h</span></div>
            <div className="kpi"><span className="v">{remaining.toFixed(0)}</span><span className="l">m to destination</span></div>
            <div className="kpi"><span className="v">{snap.stops}</span><span className="l">stops so far</span></div>
            {snap.ahead !== null && <div className="kpi"><span className="v">{snap.ahead}</span><span className="l">vehicles ahead in queue</span></div>}
          </div>
        )}

        {/* the plain-language display from the dispatch concept */}
        {nextStop && mode === "prioritypulse" && nextPlan && !arrived && (
          <div className="callout ev" aria-live="off">
            <div><b>Next intersection:</b> {nameOf(nextStop.node)} ({net.movements.find((m) => m.id === nextStop.movement)?.label})</div>
            <div>Emergency ETA: <b>{fmtSec(nextPlan.eta_rel)}</b></div>
            <div>Queue clearance estimate: <b>{fmtSec(nextPlan.t_clear)}</b> ({nextPlan.queue} vehicles queued)</div>
            <div>Safety transition requirement: <b>{fmtSec(nextPlan.t_safe)}</b>{nextPlan.ped_rem > 0 && ` (includes ${nextPlan.ped_rem.toFixed(0)} s pedestrian clearance)`}</div>
            <div>
              System action:{" "}
              <b>
                {nextPlan.status === "active"
                  ? ni >= 0 && frame.sig[ni].p === nextPlan.phase && frame.sig[ni].s === "G" ? "Holding emergency green" : "Preemption under way"
                  : nextPlan.trigger_in > 0 ? `Begin preemption in ${nextPlan.trigger_in.toFixed(0)} s` : "Begin preemption now"}
              </b>
            </div>
          </div>
        )}
        {nextStop && mode !== "prioritypulse" && !arrived && dispatched && (
          <div className="callout">
            <div><b>Next intersection:</b> {nameOf(nextStop.node)} — ETA {fmtSec(fixedEta(nextJ))}</div>
            <div className="muted small">
              {mode === "fixed" ? "Fixed-time signals do not know the vehicle is coming." : `The detector only reacts about ${run.config.emergency.reactive_detect_s} s before the stop line; queues ahead are not considered.`}
            </div>
          </div>
        )}
        {nextStop && ni >= 0 && mode === "prioritypulse" && nextPlan && nextPlan.status === "active" && (
          <Sequence sg={frame.sig[ni]} evPhase={nextPlan.phase} net={net} />
        )}

        {view === "engineer" ? (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <caption className="sr-only">Emergency route, per intersection</caption>
              <thead>
                <tr>
                  <th scope="col">Intersection</th>
                  <th scope="col" className="num">ETA</th>
                  <th scope="col" className="num">Queue</th>
                  <th scope="col" className="num">T_clear</th>
                  <th scope="col" className="num">T_safe</th>
                  <th scope="col" className="num">T_prep</th>
                  <th scope="col" className="num">Start in</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {ev.route.stops.map((st, j) => {
                  const passedAt = ev.passed_at[j];
                  const passed = passedAt !== null && passedAt <= t;
                  const plan = plans.find((p) => p.j === j);
                  const nIdx = net.intersections.findIndex((n) => n.id === st.node);
                  return (
                    <tr key={j}>
                      <th scope="row" style={{ textAlign: "left" }}>{nameOf(st.node)}<div className="muted small">{st.kind === "T" ? "through" : st.kind === "L" ? "left" : "right"} · {PRE_TEXT[frame.sig[nIdx].pre] || "—"}</div></th>
                      <td className="num">{passed ? `✓ ${passedAt}s` : plan ? plan.eta_rel.toFixed(1) : fixedEta(j).toFixed(1)}</td>
                      <td className="num">{plan && !passed ? plan.queue : "—"}</td>
                      <td className="num">{plan && !passed ? plan.t_clear.toFixed(1) : "—"}</td>
                      <td className="num">{plan && !passed ? plan.t_safe.toFixed(1) : "—"}</td>
                      <td className="num">{plan && !passed ? plan.t_prep.toFixed(1) : "—"}</td>
                      <td className="num">{plan && !passed ? (plan.trigger_in > 0 ? `in ${plan.trigger_in.toFixed(1)}s` : "now") : "—"}</td>
                      <td>{statusChip(plan, passed, mode, frame.sig[nIdx].pre)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 6 }}>
              All times in seconds. T_prep = T_clear + T_safe + T_buffer (T_buffer = {plans[0]?.t_buffer ?? run.config.emergency.t_buffer}), and t_trigger = ETA − T_prep. The trigger uses the free-flow ETA so an upstream delay estimate can never make preemption late.
            </p>
          </div>
        ) : (
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ev.route.stops.map((st, j) => {
              const passedAt = ev.passed_at[j];
              const passed = passedAt !== null && passedAt <= t;
              const plan = plans.find((p) => p.j === j);
              const nIdx = net.intersections.findIndex((n) => n.id === st.node);
              return (
                <li key={j} className="row" style={{ justifyContent: "space-between" }}>
                  <span><b>{nameOf(st.node)}</b>{!passed && <span className="muted small"> · ETA {plan ? plan.eta_rel.toFixed(0) : fixedEta(j).toFixed(0)} s</span>}{passed && <span className="muted small"> · passed at {passedAt}s, waited {fmtSec(run.metrics.ev?.per_intersection_delay[j] ?? 0)}</span>}</span>
                  {statusChip(plan, passed, mode, frame.sig[nIdx].pre)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
