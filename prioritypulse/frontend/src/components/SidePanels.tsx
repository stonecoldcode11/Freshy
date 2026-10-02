import type { Frame, Mode, ModeRun, Network } from "../types";
import { describeSignal, fmtPct } from "../lib/format";
import { linkQueue, pedestrians, plansOf, waitByDirection } from "../lib/derive";
import type { ViewMode } from "./CorridorMap";

interface P { net: Network; run: ModeRun; frame: Frame; mode: Mode; view: ViewMode }

/* ------------------------------------------------------------------ fairness */
export function FairnessPanel({ net, run, frame, mode }: P) {
  const cap = run.config.weights.t_max_allowed as number;
  const fair = run.config.weights.t_fair as number;
  const rows = waitByDirection(net, frame);
  const worst = Math.max(...rows.map((r) => r.seconds), 0);
  return (
    <section className="card" aria-labelledby="fair-h">
      <div className="card-h"><h2 id="fair-h">Fairness monitor</h2>{mode === "prioritypulse" ? <span className="chip ok" title="PriorityPulse forces service of a starved movement before the cap, but pedestrian clearance, emergency preemption and the spillback guard outrank it">{cap}s cap · safety rules outrank</span> : <span className="chip">monitoring only</span>}</div>
      <div className="card-b stack">
        {rows.map((r) => {
          const near = r.seconds >= cap * 0.83;
          const over = r.seconds > cap;
          return (
            <div key={r.bound}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span><b>{{ NB: "Northbound", SB: "Southbound", EB: "Eastbound", WB: "Westbound" }[r.bound] ?? r.bound}</b> <span className="muted small">{r.seconds > 0 ? `· ${r.movement}, ${r.where}` : ""}</span></span>
                <span className="mono">{r.seconds.toFixed(0)} s {over ? "⚠ over cap" : near ? "⚠ near maximum" : ""}</span>
              </div>
              <div className={`bar${over ? " danger" : near ? " warn" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(cap, r.seconds)} aria-label={`${r.bound} longest wait`}>
                <i style={{ width: `${Math.min(100, (r.seconds / cap) * 100)}%` }} />
                <span className="mark" style={{ left: `${(fair / cap) * 100}%` }} title={`soft fairness threshold ${fair}s`} />
              </div>
            </div>
          );
        })}
        <p className="small muted">
          Longest wait right now: <b>{worst.toFixed(0)} s</b> · worst this run: <b>{run.metrics.max_wait_s.toFixed(0)} s</b>. Marker = {fair}s soft threshold; bar full = {cap}s hard cap.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pedestrians */
export function PedestrianPanel({ net, run, frame, mode, onPedCall }: P & { onPedCall?: (crosswalk: string) => void }) {
  const rows = pedestrians(net, frame);
  const plans = plansOf(frame);
  const school = Boolean(run.config.school_zone);
  const evHolds = (cwId: string) => {
    const ni = net.intersections.findIndex((n) => cwId.startsWith(n.id + "_"));
    const plan = plans.find((p) => net.intersections[ni]?.id === p.node);
    return plan && plan.ped_rem > 0 && plan.status !== "far" ? plan : null;
  };
  const active = rows.filter((r) => r.state === "walk" || r.state === "clearing");
  return (
    <section className="card" aria-labelledby="ped-h">
      <div className="card-h">
        <h2 id="ped-h">Pedestrian safety</h2>
        {school && <span className="chip warn">school zone · longer clearance</span>}
      </div>
      <div className="card-b stack">
        <div className="callout ok small">
          Pedestrian clearance is a <b>hard constraint</b>, not a cost: no phase can end, and no preemption can start, until walk + flashing-don’t-walk + clearance has finished.
          Safety compliance this run: <b>{fmtPct(run.metrics.safety_compliance_pct, 0)}</b> of {run.metrics.signal_transitions} signal transitions.
        </div>
        {active.length === 0 && <p className="small muted">No crossing in progress.</p>}
        {rows.map((r) => {
          const hold = evHolds(r.id);
          const tone = r.state === "walk" ? "ok" : r.state === "clearing" ? "warn" : r.state === "waiting" ? "accent" : "";
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div className="small"><b>{r.name}</b> {r.state !== "idle" && <span className={`chip ${tone}`}>{r.state === "walk" ? "🚶 WALK" : r.state === "clearing" ? "✋ CLEARING" : "⏳ CALL"}</span>}</div>
                <div className="small muted">
                  {r.state === "walk" && <>Walk signal: <b>ACTIVE</b> · clearance remaining <b>{r.remaining.toFixed(0)} s</b></>}
                  {r.state === "clearing" && <>Flashing don’t walk · clearance remaining <b>{r.remaining.toFixed(0)} s</b></>}
                  {r.state === "waiting" && <>Button pressed · waiting {r.wait.toFixed(0)} s</>}
                  {r.state === "idle" && "Idle"}
                  {hold && (r.state === "walk" || r.state === "clearing") && <> · Emergency preemption: scheduled after clearance</>}
                </div>
              </div>
              {onPedCall && <button className="btn small" onClick={() => onPedCall(r.id)} title="What-if: press this crosswalk button now and re-run all modes" aria-label={`Press the button at ${r.name} (what-if)`}>Press</button>}
            </div>
          );
        })}
        {mode !== "prioritypulse" && <p className="small muted">The baselines also respect pedestrian clearance; only PriorityPulse plans around it.</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ spillback */
export function SpillbackPanel({ net, run, frame, mode, view }: P) {
  const blocked = frame.blk.map((i) => ({ link: net.links[i], ratio: frame.occ[i] })).filter((b) => b.link && b.link.kind !== "exit");
  const guardOn = mode === "prioritypulse";
  const total = run.metrics.spillback_events;
  return (
    <section className="card" aria-labelledby="spill-h">
      <div className="card-h">
        <h2 id="spill-h">Queue storage &amp; spillback</h2>
        <span className={`chip ${blocked.length ? "danger" : "ok"}`}>{blocked.length ? `${blocked.length} block(s) ≥ ${(net.r_block * 100).toFixed(0)}%` : "all blocks clear"}</span>
      </div>
      <div className="card-b stack" role="status" aria-live="polite">
        {blocked.length === 0 && <p className="small muted">Every link has room for more vehicles. {guardOn ? "The guard stops green from feeding any block that reaches" : "Nothing prevents green from feeding blocks beyond"} {(net.r_block * 100).toFixed(0)}% full.</p>}
        {blocked.map(({ link, ratio }) => {
          const upstream = net.movements.find((m) => m.out_link === link.id);
          const upName = upstream ? net.intersections.find((n) => n.id === upstream.node)?.name : "the network edge";
          return (
            <div key={link.id} className="alert-banner">
              <span aria-hidden style={{ fontSize: 22 }}>⚠</span>
              <div>
                <b>{guardOn ? "SPILLBACK PROTECTION ACTIVE" : "SPILLBACK — NO PROTECTION"}</b>
                <div>{link.bound} block {link.id}: <b>{(ratio * 100).toFixed(0)}%</b> occupied ({Math.round(ratio * link.capacity)}/{link.capacity} vehicles)</div>
                <div className="small">{guardOn ? `Green from ${upName} into this block is denied until it drains below ${((net.r_block - 0.08) * 100).toFixed(0)}%.` : `${upName} keeps sending vehicles into it until it is physically full.`}</div>
              </div>
            </div>
          );
        })}
        <p className="small muted">
          Spillback episodes this run: <b>{total}</b> · seconds with a blocked link: <b>{run.metrics.spillback_seconds}</b> · fullest link: <b>{run.metrics.max_link_fill_pct.toFixed(0)}%</b>.
        </p>
        {view === "engineer" && (
          <table className="tbl">
            <caption className="sr-only">Link storage</caption>
            <thead><tr><th scope="col">Link</th><th scope="col" className="num">Queue</th><th scope="col" className="num">Occupancy</th><th scope="col" className="num">C</th></tr></thead>
            <tbody>
              {net.links.filter((l) => l.kind !== "exit").map((l) => {
                const i = net.links.indexOf(l);
                return (
                  <tr key={l.id}><td>{l.id} <span className="muted small">{l.bound}</span></td><td className="num">{linkQueue(net, frame, l.id)}</td><td className="num">{(frame.occ[i] * 100).toFixed(0)}%</td><td className="num">{l.capacity}</td></tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ plain-text signal state */
export function SignalSummary({ net, frame }: Pick<P, "net" | "frame">) {
  return (
    <section className="card" aria-labelledby="sig-h">
      <div className="card-h"><h2 id="sig-h">Signals right now</h2></div>
      <div className="card-b">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {frame.sig.map((sg, i) => <li key={i}>{describeSignal(net, i, sg)}</li>)}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ transit priority */
export function TransitPanel({ net, run, frame, t }: Pick<P, "net" | "run" | "frame"> & { t: number }) {
  const buses = run.buses;
  if (buses.length === 0) return null;
  const nameOf = (id: string) => net.intersections.find((n) => n.id === id)?.name ?? id;
  return (
    <section className="card" aria-labelledby="bus-h">
      <div className="card-h"><h2 id="bus-h">Transit &amp; school-bus priority</h2><span className="chip">soft priority · below emergency</span></div>
      <div className="card-b stack">
        {buses.map((b, i) => {
          const snap = frame.pv.find((p) => p.id === b.id);
          const m = run.metrics.buses[i];
          const arrived = m?.travel_time !== null && m?.travel_time !== undefined && t >= b.t_dispatch + m.travel_time;
          const decision = [...run.decisions].reverse().find((d) => d.t <= t && d.reasons.some((r) => r.startsWith("Transit priority") && r.includes(b.label)));
          const line = decision?.reasons.find((r) => r.startsWith("Transit priority"));
          const denied = line?.includes("denied") || line?.includes("not applied");
          return (
            <div key={b.id} className="stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{b.label}</b>
                <span className={`chip ${snap && snap.st === "enroute" ? "accent" : ""}`}>{arrived ? "arrived" : snap?.st === "enroute" ? "en route" : t < b.t_dispatch ? `departs in ${Math.max(0, b.t_dispatch - t).toFixed(0)} s` : "waiting"}</span>
              </div>
              <div className="small">{b.late_min.toFixed(0)} minutes behind schedule · passengers onboard: <b>{b.occupancy}</b></div>
              {line ? (
                <div className={`callout small ${denied ? "warn" : "ok"}`}>
                  <b>Priority request: {denied ? "not granted" : "early green approved"}</b>
                  <div>{line.replace(/^Transit priority( denied| not applied)?: /, "")}</div>
                  <div className="muted">at {nameOf(decision!.node)}, {decision!.t.toFixed(0)} s</div>
                </div>
              ) : <p className="small muted">{run.mode === "prioritypulse" ? "No priority request has needed a decision yet." : "This mode gives buses no priority."}</p>}
              {m && (
                <p className="small muted">
                  {m.travel_time !== null ? <>Result in this mode: delay <b>{m.delay?.toFixed(0)} s</b>, {m.stops} stop(s).</> : "Did not finish within the run."}
                  {" "}The request would be denied if it conflicted with an active emergency route, a pedestrian clearance or a spillback block.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
