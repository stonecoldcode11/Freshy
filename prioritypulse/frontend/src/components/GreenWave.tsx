import type { Frame, Mode, ModeRun, Network } from "../types";
import { evOf, plansOf } from "../lib/derive";
import type { ViewMode } from "./CorridorMap";

interface Props { net: Network; run: ModeRun; mode: Mode; frame: Frame; t: number; view: ViewMode }

/** Corridor green-wave timing diagram: when does each intersection turn green for the emergency vehicle? */
export function GreenWavePanel({ net, run, mode, frame, t, view }: Props) {
  const ev = run.ev;
  if (!ev) return null;
  const plans = plansOf(frame);
  const snap = evOf(frame);
  const nameOf = (id: string) => net.intersections.find((n) => n.id === id)?.name ?? id;
  const horizon = 80;
  const W = 640;
  const m = { l: 110, r: 14, t: 24, b: 26 };
  const w = W - m.l - m.r;
  const rowH = 34;
  const H = m.t + m.b + rowH * ev.route.stops.length;
  const X = (sec: number) => m.l + (Math.min(horizon, Math.max(0, sec)) / horizon) * w;
  const cycle = (run.config.signals.fixed_green as number[]).reduce((a, b) => a + b, 0) + 4 * (run.config.signals.yellow + run.config.signals.all_red);
  const thetas: number[] = [];
  ev.route.stops.forEach((st, j) => {
    thetas.push(j === 0 ? 0 : (thetas[j - 1] + (st.dist - ev.route.stops[j - 1].dist) / ev.speed) % cycle);
  });

  const lines = ev.route.stops.map((st, j) => {
    const passedAt = ev.passed_at[j];
    const passed = passedAt !== null && passedAt <= t;
    const plan = plans.find((p) => p.j === j);
    const nm = nameOf(st.node);
    if (passed) return `${nm}: emergency vehicle has passed`;
    if (mode !== "prioritypulse") return `${nm}: no coordinated green (this mode does not plan for the emergency vehicle)`;
    if (!plan) {
      const lead = run.config.emergency.notice_lead as number;
      return t < ev.t_dispatch - lead
        ? `${nm}: waiting for the dispatch (signals are told about ${lead.toFixed(0)} s before departure)`
        : `${nm}: planning…`;
    }
    if (plan.status === "active") return `${nm}: emergency green ${plan.t_safe > 0 ? "being prepared" : "starts now"}`;
    return `${nm}: emergency green begins in ${Math.max(0, plan.trigger_in).toFixed(0)} seconds`;
  });
  const recovering = net.intersections.map((n, i) => ({ n, pre: frame.sig[i].pre })).filter((x) => x.pre === "recovery");

  return (
    <section className="card" aria-labelledby="gw-h">
      <div className="card-h"><h2 id="gw-h">Corridor green wave</h2>{mode !== "prioritypulse" && <span className="chip">PriorityPulse only</span>}</div>
      <div className="card-b stack">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={lines.join(". ")}>
          {[0, 20, 40, 60, 80].map((s) => (
            <g key={s}>
              <line className="grid-line" x1={X(s)} x2={X(s)} y1={m.t - 4} y2={H - m.b} />
              <text x={X(s)} y={H - 8} textAnchor="middle">{s === 0 ? "now" : `+${s}s`}</text>
            </g>
          ))}
          {ev.route.stops.map((st, j) => {
            const y = m.t + j * rowH;
            const plan = plans.find((p) => p.j === j);
            const passedAt = ev.passed_at[j];
            const passed = passedAt !== null && passedAt <= t;
            const trig = plan ? Math.max(0, plan.trigger_in) : null;
            const eta = plan ? plan.eta_rel : snap ? Math.max(0, (st.dist - snap.s) / ev.speed) : st.dist / ev.speed - t + ev.t_dispatch;
            return (
              <g key={j}>
                <text x={m.l - 8} y={y + 18} textAnchor="end" style={{ fill: "var(--text)", fontWeight: 700 }}>{nameOf(st.node)}</text>
                <rect x={m.l} y={y + 6} width={w} height={18} rx={4} fill="var(--surface-3)" />
                {mode === "prioritypulse" && plan && !passed && trig !== null && (
                  <>
                    <rect x={X(trig)} y={y + 6} width={Math.max(2, X(Math.max(trig, eta)) - X(trig))} height={18} rx={4} fill="var(--ev)" opacity={0.35} />
                    <rect x={X(Math.max(eta, 0))} y={y + 6} width={Math.max(3, X(eta + 4) - X(eta))} height={18} rx={4} fill="var(--ev)" />
                    <text x={X(trig) + 3} y={y + 19} style={{ fill: "var(--text)", fontSize: 10 }}>{trig <= 0.5 ? "preempting" : "start"}</text>
                  </>
                )}
                {passed && <text x={m.l + 6} y={y + 19} style={{ fill: "var(--ok)", fontWeight: 700 }}>✓ passed at {passedAt}s</text>}
                {(!plan || mode !== "prioritypulse") && !passed && <rect x={X(eta)} y={y + 6} width={4} height={18} fill="var(--ev)" />}
              </g>
            );
          })}
        </svg>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        {recovering.length > 0 && (
          <div className="callout ok small" role="status">
            <b>Recovery:</b> emergency route clear at {recovering.map((r) => r.n.name).join(", ")} — restoring coordinated progression.
          </div>
        )}
        {view === "engineer" && (
          <div className="small muted">
            Offsets for the emergency wave: θ<sub>i+1</sub> ≡ θ<sub>i</sub> + L<sub>i,i+1</sub>/v<sub>EV</sub> (mod {cycle.toFixed(0)} s) →{" "}
            {thetas.map((th, j) => `θ${j + 1} = ${th.toFixed(1)} s`).join(", ")}. Purple band = preparation (transition + clearance); solid block = vehicle crossing.
          </div>
        )}
      </div>
    </section>
  );
}
