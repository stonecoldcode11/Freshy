import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Boundary, Mode, Network, RunRequestBody, RunResponse, Scenario } from "./types";
import { MODES } from "./types";
import { clamp, fmtSec, MODE_LABEL, MODE_SHORT } from "./lib/format";
import { usePlayback, SPEEDS } from "./lib/playback";
import { Icon, Logo } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import type { DispatchState, Overrides } from "./components/Sidebar";
import { CorridorMap, HeatLegend } from "./components/CorridorMap";
import type { ViewMode } from "./components/CorridorMap";
import { PlaybackBar } from "./components/PlaybackBar";
import { EmergencyPanel } from "./components/EmergencyPanel";
import { DecisionPanel } from "./components/DecisionPanel";
import { FairnessPanel, PedestrianPanel, SignalSummary, SpillbackPanel, TransitPanel } from "./components/SidePanels";
import { GreenWavePanel } from "./components/GreenWave";
import { ComparisonCharts, ResultsCard, SideBySide } from "./components/ComparePanel";
import { ReportPanel } from "./components/ReportPanel";
import { ModelPanel } from "./components/ModelPanel";
import { LocationPicker } from "./components/LocationPicker";
import type { BuiltNetwork } from "./components/LocationPicker";
import { GeoMap } from "./components/GeoMap";

type Tab = "live" | "compare" | "report" | "model";
type Theme = "light" | "dark";

const MPanel = {
  Emergency: memo(EmergencyPanel),
  Decision: memo(DecisionPanel),
  Fairness: memo(FairnessPanel),
  Pedestrian: memo(PedestrianPanel),
  Spillback: memo(SpillbackPanel),
  GreenWave: memo(GreenWavePanel),
  Signals: memo(SignalSummary),
  Transit: memo(TransitPanel),
  Charts: memo(ComparisonCharts),
};

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences simply don't persist */
  }
}

const prefersDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
const prefersReduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function App() {
  // ---- preferences -----------------------------------------------------------------------------
  const [view, setView] = useState<ViewMode>(() => load<ViewMode>("pp.view", "community"));
  const [theme, setTheme] = useState<Theme>(() => load<Theme>("pp.theme", prefersDark() ? "dark" : "light"));
  const [reduced, setReduced] = useState<boolean>(() => load<boolean>("pp.reduced", prefersReduced()));
  const [contrast, setContrast] = useState<boolean>(() => load<boolean>("pp.contrast", false));
  useEffect(() => { save("pp.view", view); }, [view]);
  useEffect(() => { save("pp.theme", theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { save("pp.reduced", reduced); document.documentElement.classList.toggle("reduce-motion", reduced); }, [reduced]);
  useEffect(() => { save("pp.contrast", contrast); document.documentElement.dataset.contrast = contrast ? "high" : "normal"; }, [contrast]);

  // ---- setup state -------------------------------------------------------------------------------
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [demoNet, setDemoNet] = useState<Network | null>(null);
  const [scenarioId, setScenarioId] = useState("rush_hour_ambulance");
  const [overrides, setOverrides] = useState<Overrides>({});
  const [seed, setSeed] = useState(7);
  const [dispatch, setDispatch] = useState<DispatchState>({ enabled: true, origin: "B_W", destination: "B_E", etype: "ambulance", priority: "critical", t: 70 });
  const [custom, setCustom] = useState<BuiltNetwork | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pedCalls, setPedCalls] = useState<{ t: number; crosswalk: string }[]>([]);

  // ---- run state ------------------------------------------------------------------------------------
  const [run, setRun] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [mode, setMode] = useState<Mode>("prioritypulse");
  const [mapStyle, setMapStyle] = useState<"schematic" | "geo">("schematic");
  const [helpOpen, setHelpOpen] = useState(false);
  const [announce, setAnnounce] = useState("");

  const pb = usePlayback(run?.duration ?? 1, reduced);
  const ti = Math.floor(pb.t);

  const scenario = scenarios.find((s) => s.id === scenarioId);
  const boundaries: Boundary[] = (custom?.network ?? demoNet)?.boundaries ?? [];

  // ---- bootstrap ---------------------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    Promise.all([api.scenarios(), api.demoNetwork()])
      .then(([sc, net]) => {
        if (!alive) return;
        setScenarios(sc);
        setDemoNet(net);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : String(e));
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const applyScenario = useCallback((id: string, list: Scenario[] = scenarios) => {
    const sc = list.find((s) => s.id === id);
    setScenarioId(id);
    setOverrides({});
    setPedCalls([]);
    if (sc?.dispatch) setDispatch({ enabled: true, ...sc.dispatch });
  }, [scenarios]);

  // ---- execute a run ----------------------------------------------------------------------------------------
  const buildBody = useCallback((calls = pedCalls): RunRequestBody => {
    const sc = custom ? undefined : scenarios.find((s) => s.id === scenarioId);
    return {
      scenario_id: custom ? "custom" : scenarioId,
      seed,
      duration: overrides.duration ?? (custom ? 420 : sc?.duration),
      intensity: overrides.intensity,
      weather: overrides.weather,
      school_zone: overrides.school,
      dispatch: dispatch.enabled
        ? { enabled: true, origin: dispatch.origin, destination: dispatch.destination, etype: dispatch.etype, priority: dispatch.priority, t: dispatch.t }
        : { enabled: false },
      network: custom ? custom.spec : undefined,
      ped_calls: calls.length ? calls : undefined,
    };
  }, [custom, scenarios, scenarioId, seed, overrides, dispatch, pedCalls]);

  const execute = useCallback(async (opts?: { keepTime?: boolean; calls?: { t: number; crosswalk: string }[] }) => {
    setLoading(true);
    setError(null);
    const keep = opts?.keepTime ? pb.t : null;
    try {
      const res = await api.run(buildBody(opts?.calls ?? pedCalls));
      setRun(res);
      setMode((m) => (res.runs[m] ? m : "prioritypulse"));
      const start = keep ?? Math.max(0, (res.dispatch?.t ?? 30) - 20);
      pb.seek(clamp(start, 0, res.duration - 1));
      pb.play();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unexpected error while running the simulation.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildBody, pedCalls, pb.t]);

  // First run as soon as the scenario list is available, so the page is never empty.
  const firstRun = useRef(false);
  useEffect(() => {
    if (scenarios.length && demoNet && !firstRun.current) {
      firstRun.current = true;
      applyScenario("rush_hour_ambulance", scenarios);
      const sc = scenarios.find((s) => s.id === "rush_hour_ambulance");
      api.run({
        scenario_id: "rush_hour_ambulance", seed: 7,
        dispatch: sc?.dispatch ? { enabled: true, ...sc.dispatch } : undefined,
      }).then((res) => {
        setRun(res);
        pb.seek(Math.max(0, (res.dispatch?.t ?? 30) - 20));
        pb.play();
      }).catch((e) => setError(e instanceof ApiError ? e.message : String(e))).finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, demoNet]);

  const onScenario = (id: string) => {
    setCustom(null);
    applyScenario(id);
  };

  const onBuilt = (b: BuiltNetwork) => {
    setCustom(b);
    setShowPicker(false);
    setScenarioId("custom");
    setOverrides({});
    setPedCalls([]);
    setDispatch((d) => ({ ...d, enabled: true, origin: "B_W", destination: "B_E", t: 70 }));
    setMapStyle("geo");
  };

  const onPedCall = (crosswalk: string) => {
    const calls = [...pedCalls, { t: Math.max(0, Math.floor(pb.t)), crosswalk }];
    setPedCalls(calls);
    void execute({ keepTime: true, calls });
  };

  // ---- derived -------------------------------------------------------------------------------------------------
  const net = run?.network ?? null;
  const modeRun = run?.runs[mode];
  const frame = modeRun?.frames[Math.min((modeRun?.frames.length ?? 1) - 1, ti)] ?? null;
  const markers = useMemo(() => {
    if (!modeRun) return [];
    const out: { t: number; label: string; warn?: boolean }[] = [];
    if (run?.dispatch) out.push({ t: run.dispatch.t, label: "Emergency vehicle dispatched" });
    if (modeRun.ev?.t_arrive) out.push({ t: modeRun.ev.t_arrive, label: "Emergency vehicle arrives" });
    modeRun.events.filter((e) => e.kind === "guard_on").slice(0, 12).forEach((e) => out.push({ t: e.t, label: e.text, warn: true }));
    return out;
  }, [modeRun, run?.dispatch]);

  const headline = run?.comparison?.report?.fixed;
  const ppEv = run?.runs.prioritypulse?.metrics.ev;
  const fixedEv = run?.runs.fixed?.metrics.ev;

  // ---- screen-reader announcements for the events that matter ---------------------------------------------------
  const lastAnnounced = useRef(-1);
  useEffect(() => {
    if (!modeRun) return;
    if (ti < lastAnnounced.current) lastAnnounced.current = ti - 1;
    const fresh = modeRun.events.filter((e) => e.t > lastAnnounced.current && e.t <= ti && (e.severity === "warn" || e.kind === "preempt_start" || e.kind === "preempt_release"));
    if (fresh.length) setAnnounce(fresh[fresh.length - 1].text);
    const ev = modeRun.ev;
    if (ev?.t_arrive && lastAnnounced.current < ev.t_arrive && ti >= ev.t_arrive) setAnnounce(`The ${ev.etype} has arrived after ${fmtSec(ev.t_arrive - ev.t_dispatch)}.`);
    lastAnnounced.current = ti;
  }, [ti, modeRun]);

  // ---- keyboard shortcuts ----------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inputType = el?.tagName === "INPUT" ? (el as HTMLInputElement).type : "";
      const typing = !!el && (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
        || (el.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes(inputType)));
      if (typing || e.ctrlKey || e.metaKey || e.altKey || showPicker) return;
      const k = e.key;
      const onRange = inputType === "range";
      const onControl = el?.tagName === "BUTTON" || inputType === "checkbox" || inputType === "radio";
      if (k === " " && !onControl && !onRange) { e.preventDefault(); pb.toggle(); }
      else if (k === "ArrowRight" && !onRange) { e.preventDefault(); pb.step(e.shiftKey ? 10 : 1); }
      else if (k === "ArrowLeft" && !onRange) { e.preventDefault(); pb.step(e.shiftKey ? -10 : -1); }
      else if (k === "]") pb.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(pb.speed as (typeof SPEEDS)[number]) + 1)]);
      else if (k === "[") pb.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(pb.speed as (typeof SPEEDS)[number]) - 1)]);
      else if (k === "r" || k === "R") pb.restart();
      else if (k === "1" || k === "2" || k === "3") setMode(MODES[Number(k) - 1]);
      else if (k === "v" || k === "V") setView((v) => (v === "community" ? "engineer" : "community"));
      else if (k === "?") setHelpOpen((o) => !o);
      else if (k === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pb, showPicker]);

  const tabs: [Tab, string][] = [["live", "Live simulation"], ["compare", "Compare modes"], ["report", "Report & export"], ["model", "Technical model"]];
  const customName = custom?.network.intersections.map((n) => n.name).join(" → ");

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to the simulation</a>
      <header className="topbar" role="banner">
        <div className="brand">
          <Logo />
          <h1>PriorityPulse<small>Predictive emergency-vehicle signal priority</small></h1>
        </div>
        <div className="spacer" />
        <a className="btn only-narrow" href="#setup">⚙ Setup</a>
        <div className="seg" role="group" aria-label="Detail level">
          <button aria-pressed={view === "community"} onClick={() => setView("community")} title="Plain language, maps and safety alerts">Community view</button>
          <button aria-pressed={view === "engineer"} onClick={() => setView("engineer")} title="Queues, constraints, controller cost and network state">Engineer view</button>
        </div>
        <button className="btn icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Theme"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
        <label className="check small" title="Turns off flashing beacons and animation"><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduce motion</label>
        <label className="check small"><input type="checkbox" checked={contrast} onChange={(e) => setContrast(e.target.checked)} /> High contrast</label>
        <button className="btn icon" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)"><Icon name="keyboard" /></button>
      </header>

      <div className="layout">
        <Sidebar
          scenarios={scenarios} scenarioId={scenarioId} onScenario={onScenario}
          customActive={Boolean(custom)} customName={customName} onOpenLocation={() => setShowPicker(true)} onClearCustom={() => { setCustom(null); setMapStyle("schematic"); applyScenario("rush_hour_ambulance"); }}
          scenario={scenario} overrides={overrides} onOverrides={setOverrides} seed={seed} onSeed={setSeed}
          dispatch={dispatch} onDispatch={setDispatch} boundaries={boundaries}
          loading={loading} onRun={() => { setPedCalls([]); void execute({ calls: [] }).then(() => { if (window.innerWidth <= 1050) document.getElementById("main")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); }); }} error={error}
        />

        <main id="main" className="content" tabIndex={-1}>
          <div className="card">
            <div className="tabs" role="tablist" aria-label="Views">
              {tabs.map(([id, label]) => (
                <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
          </div>

          {!run && (
            <div className="card empty" role="status">
              {error ? <><b>Could not start.</b><p>{error}</p><p className="small">Start the backend with <code>python -m uvicorn app.main:app --port 8000</code> in <code>prioritypulse/backend</code>.</p></>
                : <><span className="spinner" aria-hidden /> <p>Running the first simulation…</p></>}
            </div>
          )}

          {run && net && modeRun && frame && tab === "live" && (
            <div id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="content">
              <section className="card" aria-labelledby="map-h">
                <div className="card-h">
                  <h2 id="map-h">{run.scenario.name}</h2>
                  <div className="seg" role="tablist" aria-label="Control mode">
                    {MODES.map((m, i) => (
                      <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} title={`Press ${i + 1}`} aria-label={MODE_LABEL[m]}>
                        <span className="full" aria-hidden>{MODE_LABEL[m]}</span><span className="short" aria-hidden>{MODE_SHORT[m]}</span>
                      </button>
                    ))}
                  </div>
                  {net.source === "map" && (
                    <div className="seg" role="group" aria-label="Map style">
                      <button aria-pressed={mapStyle === "schematic"} onClick={() => setMapStyle("schematic")}>Schematic</button>
                      <button aria-pressed={mapStyle === "geo"} onClick={() => setMapStyle("geo")}>Street map</button>
                    </div>
                  )}
                </div>
                <div className="card-b stack">
                  {headline && ppEv && fixedEv && (
                    <div className="row" aria-label="Headline result">
                      <span className="chip ev">Emergency run: PriorityPulse {fmtSec(ppEv.travel_time)} vs fixed-time {fmtSec(fixedEv.travel_time)}{headline.ev_improvement_pct !== null && ` (${headline.ev_improvement_pct.toFixed(0)}% faster)`}</span>
                      <span className="chip">Safety compliance {run.runs.prioritypulse!.metrics.safety_compliance_pct}%</span>
                      {loading && <span className="chip accent"><span className="spinner" aria-hidden style={{ width: 12, height: 12, borderWidth: 2 }} /> re-running…</span>}
                    </div>
                  )}
                  {mapStyle === "geo" && net.source === "map" ? <GeoMap net={net} run={modeRun} t={pb.t} /> : <CorridorMap net={net} run={modeRun} t={pb.t} view={view} title={MODE_LABEL[mode]} />}
                  <HeatLegend />
                  {net.notes.length > 0 && <p className="small muted">{net.notes[0]}</p>}
                </div>
                <PlaybackBar pb={pb} duration={run.duration} markers={markers} />
              </section>

              <div className="split">
                <MPanel.Emergency net={net} run={modeRun} mode={mode} frame={frame} t={ti} view={view} />
                <MPanel.Decision run={modeRun} mode={mode} t={ti} view={view} />
              </div>
              <MPanel.Spillback net={net} run={modeRun} frame={frame} mode={mode} view={view} />
              <MPanel.GreenWave net={net} run={modeRun} mode={mode} frame={frame} t={ti} view={view} />
              <div className="grid two">
                <MPanel.Fairness net={net} run={modeRun} frame={frame} mode={mode} view={view} />
                <MPanel.Pedestrian net={net} run={modeRun} frame={frame} mode={mode} view={view} onPedCall={onPedCall} />
              </div>
              {modeRun.buses.length > 0 && <MPanel.Transit net={net} run={modeRun} frame={frame} t={ti} />}
              <MPanel.Signals net={net} frame={frame} />
            </div>
          )}

          {run && net && tab === "compare" && (
            <div id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" className="content">
              <section className="card" aria-label="Playback">
                <PlaybackBar pb={pb} duration={run.duration} markers={markers} />
              </section>
              <ResultsCard run={run} view={view} />
              <SideBySide run={run} t={pb.t} view={view} />
              <HeatLegend />
              <MPanel.Charts run={run} t={ti} />
            </div>
          )}

          {run && tab === "report" && (
            <div id="panel-report" role="tabpanel" aria-labelledby="tab-report" className="content"><ReportPanel run={run} /></div>
          )}
          {tab === "model" && (
            <div id="panel-model" role="tabpanel" aria-labelledby="tab-model" className="content"><ModelPanel run={run} /></div>
          )}

          <footer className="small muted" style={{ padding: "4px 2px 20px" }}>
            PriorityPulse is a simulation. It is not connected to live traffic-signal infrastructure, and its results depend on the stated assumptions (see the Technical model tab).
          </footer>
        </main>
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>

      {showPicker && (
        <LocationPicker
          initial={custom?.spec.type === "points" ? { points: custom.spec.points, options: custom.spec.options } : null}
          onBuilt={onBuilt} onClose={() => setShowPicker(false)}
        />
      )}
      {helpOpen && (
        <div className="modal-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="help-h" style={{ maxWidth: 560 }}>
            <div className="card-h" style={{ padding: "14px 16px 0" }}><h2 id="help-h">Keyboard shortcuts</h2><button className="btn" onClick={() => setHelpOpen(false)} aria-label="Close">✕</button></div>
            <div className="card-b">
              <table className="tbl"><tbody>
                {[["Space", "Play / pause"], ["← →", "Step 1 second (Shift: 10 seconds)"], ["[  ]", "Slower / faster"], ["R", "Restart"], ["1 2 3", "Fixed / Reactive / PriorityPulse"], ["V", "Community ↔ Engineer view"], ["?", "This help"]].map(([k, d]) => (
                  <tr key={k}><td><span className="kbd">{k}</span></td><td>{d}</td></tr>
                ))}
              </tbody></table>
              <p className="small muted" style={{ marginTop: 10 }}>Every control is reachable with the keyboard. Colour is never the only signal: queue colours also carry icons and hatching, and signal heads use distinct shapes.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
