import type { Boundary, EvType, Priority, Scenario, Weather } from "../types";
import { Icon } from "./Icon";

export interface Overrides { weather?: Weather; intensity?: number; school?: boolean; duration?: number }
export interface DispatchState { enabled: boolean; origin: string; destination: string; etype: EvType; priority: Priority; t: number }

interface Props {
  scenarios: Scenario[];
  scenarioId: string;
  onScenario: (id: string) => void;
  customActive: boolean;
  customName?: string;
  onOpenLocation: () => void;
  onClearCustom: () => void;
  scenario: Scenario | undefined;
  overrides: Overrides;
  onOverrides: (o: Overrides) => void;
  seed: number;
  onSeed: (n: number) => void;
  dispatch: DispatchState;
  onDispatch: (d: DispatchState) => void;
  boundaries: Boundary[];
  loading: boolean;
  onRun: () => void;
  error: string | null;
}

const EV_TYPES: { id: EvType; label: string }[] = [
  { id: "ambulance", label: "Ambulance" },
  { id: "fire", label: "Fire truck" },
  { id: "police", label: "Police" },
];
const PRIORITIES: Priority[] = ["routine", "urgent", "critical"];

export function Sidebar(p: Props) {
  const sc = p.scenario;
  const intensity = p.overrides.intensity ?? sc?.intensity ?? 0.6;
  const weather = p.overrides.weather ?? sc?.weather ?? "clear";
  const school = p.overrides.school ?? sc?.school_zone ?? false;
  const duration = p.overrides.duration ?? sc?.duration ?? 420;
  const levelName = intensity < 0.45 ? "light" : intensity < 0.75 ? "moderate" : "heavy";
  return (
    <aside className="sidebar" aria-label="Simulation setup">
      <section className="card" aria-labelledby="scn-h">
        <div className="card-h"><h2 id="scn-h">1 · Scenario</h2></div>
        <div className="card-b stack">
          <div className="scn-list">
            {p.scenarios.map((s) => (
              <button key={s.id} className="scn" aria-pressed={!p.customActive && s.id === p.scenarioId} onClick={() => p.onScenario(s.id)}>
                <span className="ic"><Icon name={s.icon} /></span>
                <span><b>{s.name}</b><span>{s.tagline}</span></span>
              </button>
            ))}
            <button className="scn" aria-pressed={p.customActive} onClick={p.onOpenLocation}>
              <span className="ic"><Icon name="map" /></span>
              <span><b>Real location…</b><span>{p.customActive ? `Using: ${p.customName ?? "custom corridor"}` : "Pick intersections on a map"}</span></span>
            </button>
          </div>
          {p.customActive && <button className="btn small" onClick={p.onClearCustom}>Back to the demo corridor</button>}
          {sc && !p.customActive && (
            <div className="callout">
              <p>{sc.description}</p>
              {sc.watch_for.length > 0 && (<><b className="small">What to watch</b><ul>{sc.watch_for.map((w) => <li key={w}>{w}</li>)}</ul></>)}
            </div>
          )}
          {p.customActive && (
            <div className="callout warn small">
              <b>Simulation assumptions:</b> road geometry is map-based; traffic demand, lane configuration and signal timing are configurable estimates. Not connected to live traffic-signal infrastructure.
            </div>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="disp-h">
        <div className="card-h">
          <h2 id="disp-h">2 · Dispatch center</h2>
          <label className="check small"><input type="checkbox" checked={p.dispatch.enabled} onChange={(e) => p.onDispatch({ ...p.dispatch, enabled: e.target.checked })} /> Dispatch</label>
        </div>
        <div className="card-b stack">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!p.dispatch.enabled}>
            <legend className="sr-only">Emergency vehicle</legend>
            <div className="field">
              <span className="lbl">Emergency type</span>
              <div className="seg" role="group" aria-label="Emergency type">
                {EV_TYPES.map((e) => (
                  <button key={e.id} aria-pressed={p.dispatch.etype === e.id} onClick={() => p.onDispatch({ ...p.dispatch, etype: e.id })}>{e.label}</button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="origin">Origin</label>
              <select id="origin" value={p.dispatch.origin} onChange={(e) => p.onDispatch({ ...p.dispatch, origin: e.target.value })}>
                {p.boundaries.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="dest">Destination</label>
              <select id="dest" value={p.dispatch.destination} onChange={(e) => p.onDispatch({ ...p.dispatch, destination: e.target.value })}>
                {p.boundaries.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {p.dispatch.origin === p.dispatch.destination && <span className="small" style={{ color: "var(--danger)" }}>Origin and destination must differ.</span>}
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <span className="lbl">Priority</span>
              <div className="seg" role="group" aria-label="Priority">
                {PRIORITIES.map((pr) => (
                  <button key={pr} aria-pressed={p.dispatch.priority === pr} onClick={() => p.onDispatch({ ...p.dispatch, priority: pr })} style={{ textTransform: "capitalize" }}>{pr}</button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="dtime">Departs at (seconds)</label>
              <input id="dtime" type="number" min={30} max={Math.max(60, duration - 60)} step={5} value={p.dispatch.t}
                onChange={(e) => p.onDispatch({ ...p.dispatch, t: Math.max(30, Number(e.target.value) || 30) })} />
            </div>
          </fieldset>
        </div>
      </section>

      <section className="card" aria-labelledby="set-h">
        <div className="card-h"><h2 id="set-h">3 · Conditions</h2></div>
        <div className="card-b stack">
          <div className="field">
            <label htmlFor="intensity">Traffic demand K = {intensity.toFixed(2)} <span className="muted" style={{ textTransform: "none" }}>({levelName})</span></label>
            <input id="intensity" type="range" min={0.2} max={1} step={0.05} value={intensity} disabled={false}
              onChange={(e) => p.onOverrides({ ...p.overrides, intensity: Number(e.target.value) })} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="weather">Weather</label>
              <select id="weather" value={weather} onChange={(e) => p.onOverrides({ ...p.overrides, weather: e.target.value as Weather })}>
                <option value="clear">Clear</option><option value="rain">Rain</option><option value="snow">Snow</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="dur">Length</label>
              <select id="dur" value={duration} onChange={(e) => p.onOverrides({ ...p.overrides, duration: Number(e.target.value) })}>
                <option value={300}>5 min</option><option value={420}>7 min</option><option value={600}>10 min</option>
              </select>
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={school} onChange={(e) => p.onOverrides({ ...p.overrides, school: e.target.checked })} /> School zone (more pedestrians, longer clearance)</label>
          <div className="field">
            <label htmlFor="seed">Random seed</label>
            <div className="row">
              <input id="seed" type="number" min={0} value={p.seed} onChange={(e) => p.onSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ flex: 1 }} />
              <button className="btn" onClick={() => p.onSeed(Math.floor(Math.random() * 9999))} title="Pick a different random world">🎲</button>
            </div>
            <span className="small muted">All three modes get identical arrivals for the same seed.</span>
          </div>
        </div>
      </section>

      <div className="stack">
        <button className="btn primary big" onClick={p.onRun} disabled={p.loading || (p.dispatch.enabled && p.dispatch.origin === p.dispatch.destination)}>
          {p.loading ? <><span className="spinner" aria-hidden /> Simulating three modes…</> : <><Icon name="play" size={18} /> Run simulation</>}
        </button>
        {p.error && <div className="callout danger" role="alert"><b>Couldn’t run the simulation.</b> {p.error}</div>}
      </div>
    </aside>
  );
}
