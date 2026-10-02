import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import type { RunResponse } from "../types";

const tex = (s: string) => katex.renderToString(s, { displayMode: true, throwOnError: false, output: "htmlAndMathml" });

interface Eq { title: string; layer: string; tex: string[]; note: string }

const EQUATIONS: Eq[] = [
  {
    layer: "Layer 0", title: "Network and storage",
    tex: [
      String.raw`C_\ell=\left\lfloor \frac{L_\ell\, n_\ell}{h_{\text{jam}}}\right\rfloor \qquad R_\ell(t)=\frac{Q_\ell(t)}{C_\ell}`,
      String.raw`R_\ell(t)\ge r_{\text{block}}=0.85\;\Rightarrow\;\text{block incoming discharge}`,
    ],
    note: "Each link has a physical storage capacity. Green is never sent into a block that is nearly full.",
  },
  {
    layer: "Layer 1", title: "Stochastic demand",
    tex: [
      String.raw`Z(t)\sim\mathrm{Beta}(\mu\phi,(1-\mu)\phi)`,
      String.raw`K(t)=K_{\min}+Z(t)\,(K_{\max}-K_{\min})`,
      String.raw`\lambda_{i,m}(t)=q_i\,K(t)\,\widehat{\pi}_{i,m}(t)\,M_i(t)`,
      String.raw`A_{i,m}(t)\sim\mathrm{Poisson}(\lambda_{i,m}\Delta t)`,
      String.raw`\pi_{i,m}(t)=\pi^{\text{base}}_{i,m}+\frac{\Delta\pi_{i,m}}{1+e^{-k(t-t^{\text{switch}})}}`,
    ],
    note: "Arrivals are drawn once from a seed, so all three controllers face exactly the same traffic.",
  },
  {
    layer: "Layer 2", title: "Queue physics",
    tex: [
      String.raw`Q_{i,m}(t{+}\Delta t)=\min\!\big[C,\ \max\!\big(0,\ Q_{i,m}+A_{i,m}-D_{i,m}\big)\big]`,
      String.raw`D_{i,m}=\min\!\big[Q+A,\ s_{\text{eff}}\Delta t,\ C_{\text{down}}-Q_{\text{down}}\big]\cdot G_{i,m}\cdot B_{i,m}`,
      String.raw`s_{\text{eff}}(t)=s\left[1-e^{-t_{\text{green}}/\tau_{\text{startup}}}\right]`,
    ],
    note: "Vehicles cannot depart without a queue, above saturation flow, into a full link, or on red.",
  },
  {
    layer: "Layer 3", title: "Emergency preemption trigger",
    tex: [
      String.raw`T_{\text{prep},j}=T_{\text{clear},j}+T_{\text{safe},j}+T_{\text{buffer}}`,
      String.raw`t_{\text{trigger},j}=\mathrm{ETA}_j-\big(T_{\text{clear},j}+T_{\text{safe},j}+T_{\text{buffer}}\big)`,
      String.raw`T_{\text{clear}}=\frac{Q_{\text{ahead}}}{s_{\text{eff}}+\varepsilon}\qquad T_{\text{safe}}=T_{\text{yellow}}+T_{\text{all-red}}+T_{\text{ped-clear}}`,
    ],
    note: "Preemption starts early enough for a safe transition and for the queue ahead of the vehicle to discharge.",
  },
  {
    layer: "Layer 4", title: "Predictive control (receding horizon)",
    tex: [
      String.raw`\begin{aligned}J(a)&=w_{EV}D_{EV}+w_Q\sum_{k}\sum_{i,m}\widehat Q^2+w_D\sum_{k}\sum_{i,m}\widehat Q\,\Delta t\\&\quad+w_S\sum_{k}\sum_{\ell}\Big(\tfrac{Q_\ell}{C_\ell}\Big)^{\eta}+w_F F+w_C P_{\text{switch}}\end{aligned}`,
      String.raw`a^{*}(t)=\arg\min_{a\in\mathcal{A}_{\text{safe}}(t)}J(a),\qquad u(t)=a^{*}(t)\ \text{(first action only)}`,
      String.raw`\text{Green}(p)\to\text{Yellow}(p)\to\text{AllRed}\to\text{Green}(p')`,
      String.raw`g_p\ge g_{p,\min},\qquad t_{\text{ped}}\ge t_{\text{walk}}+t_{\text{FDW}}+t_{\text{clear}}`,
    ],
    note: "Only legal actions are ever scored; safety constraints are filters, not costs.",
  },
  {
    layer: "Layer 5", title: "Corridor coordination and fairness",
    tex: [
      String.raw`\theta_{i+1}\equiv\theta_i+\frac{L_{i,i+1}}{v}\pmod C`,
      String.raw`Q_\ell(t)\le r_{\text{block}}C_\ell\quad\text{or}\quad u_{\text{upstream}}(t)=0`,
      String.raw`F(t)=\max_{i,m}t_{\text{wait},i,m}\le t_{\max},\qquad \mathrm{Fair}=\sum_{i,m}\Big[\max\!\Big(0,\tfrac{t_{\text{wait}}-t_{\text{fair}}}{t_{\text{fair}}}\Big)\Big]^2`,
    ],
    note: "A green wave must not push a platoon into a full block, and no street can be starved for ever.",
  },
  {
    layer: "Metrics", title: "How results are measured",
    tex: [
      String.raw`\mathrm{EVImprovement}=\frac{T_{\text{baseline}}-T_{\text{PriorityPulse}}}{T_{\text{baseline}}}\times100\%`,
      String.raw`\overline{D}=\frac{\sum_t\sum_{i,m}Q_{i,m}\Delta t}{N},\qquad N_{\text{spillback}}=\#\{\text{episodes with }Q_\ell\ge r_{\text{block}}C_\ell\}`,
      String.raw`T_{\text{recovery}}=\min\{\tau\ge0:\ Q_{\text{network}}(t_{\text{EV clear}}+\tau)\le Q_{\text{normal}}\}`,
    ],
    note: "Spillback events are counted as episodes (a link must drain well below the threshold before a new one begins).",
  },
];

const DEVIATIONS: string[] = [
  "Vehicles are integers. Fractional saturation flow is carried in a per-movement credit; yellow discharges at 50% of saturation flow.",
  "A movement's wait clock only runs while someone is actually queued (an empty movement is not “waiting”).",
  "T_clear is arrival-adjusted (vehicles that join the queue during the safe transition) and includes the start-up lost time; T_safe also includes the remaining minimum green and any pedestrian interval still running, so minimum green stays a hard rule even during preemption.",
  "The trigger uses the free-flow ETA. The displayed ETA adds an expected upstream signal delay, but an over-estimated delay can therefore never make preemption late.",
  "PriorityPulse is told the call 20 s before the vehicle departs (crew turnout); the baselines are not. All modes are warmed up under the same fixed-time plan, so they start from an identical network state.",
  "An emergency vehicle may pass with one vehicle still ahead of it (it pulls aside); otherwise it waits for the queue ahead to discharge. If held at the stop line with a clear path for 15 s it is forced through (counted separately; 0 in the normal scenarios).",
  "Pedestrian walks may be deferred when there is no time to finish one before preemption; a walk already in progress is never cut short.",
  "The MPC is decentralised (one per intersection) with a 24 s horizon; candidates are hold, extend 5/10 s then switch to any phase, and switch now. Downstream room is treated independently per movement inside the predictor, the simulator then applies the exact rules.",
  "Queue spill beyond an entry link waits “outside” in a virtual queue that still counts as delay. The fixed-time baseline uses progression offsets, which makes it a fairer (stronger) baseline than a plain zero-offset plan.",
  "Fairness: the 120 s cap is enforced by forcing service starting 32 s earlier, but pedestrian clearance, emergency preemption and the spillback guard outrank it, so it can be exceeded (most often in the school-zone scenario).",
];

export function ModelPanel({ run }: { run: RunResponse | null }) {
  const html = useMemo(() => EQUATIONS.map((e) => ({ ...e, html: e.tex.map(tex) })), []);
  const cfg = run?.runs.prioritypulse?.config;
  return (
    <div className="stack">
      <section className="card" aria-labelledby="model-h">
        <div className="card-h"><h2 id="model-h">Technical model</h2></div>
        <div className="card-b stack">
          <p>
            Every second PriorityPulse predicts how many vehicles will arrive, how long queues will take to clear, when an emergency vehicle will reach each intersection, and whether downstream roads have room.
            It then chooses the <b>safest legal</b> signal action that reduces emergency delay without creating gridlock or starving other traffic.
          </p>
          <div className="grid two">
            {html.map((e) => (
              <article className="eqn-card" key={e.title}>
                <div className="row"><span className="chip accent">{e.layer}</span><h3>{e.title}</h3></div>
                {e.html.map((h, i) => <div className="eqn" key={i} dangerouslySetInnerHTML={{ __html: h }} />)}
                <p className="small muted">{e.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="card" aria-labelledby="dev-h">
        <div className="card-h"><h2 id="dev-h">Where this implementation differs from the blueprint</h2></div>
        <div className="card-b">
          <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{DEVIATIONS.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      </section>
      {cfg && (
        <section className="card" aria-labelledby="par-h">
          <div className="card-h"><h2 id="par-h">Parameters used in this run</h2></div>
          <div className="card-b" style={{ overflowX: "auto" }}>
            <table className="tbl">
              <caption className="sr-only">Controller weights and signal timing</caption>
              <tbody>
                {Object.entries(cfg.weights as Record<string, number | number[]>).map(([k, v]) => (
                  <tr key={k}><th scope="row" style={{ textAlign: "left" }} className="mono">{k}</th><td className="num mono">{Array.isArray(v) ? v.join(", ") : v}</td></tr>
                ))}
                {Object.entries(cfg.signals as Record<string, number | number[] | string>).map(([k, v]) => (
                  <tr key={k}><th scope="row" style={{ textAlign: "left" }} className="mono">signals.{k}</th><td className="num mono">{Array.isArray(v) ? v.join(", ") : v}</td></tr>
                ))}
                {Object.entries(cfg.physics as Record<string, number>).map(([k, v]) => (
                  <tr key={k}><th scope="row" style={{ textAlign: "left" }} className="mono">physics.{k}</th><td className="num mono">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
