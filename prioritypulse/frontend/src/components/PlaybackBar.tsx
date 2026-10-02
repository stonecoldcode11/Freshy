import type { Playback } from "../lib/playback";
import { SPEEDS } from "../lib/playback";
import { mmss } from "../lib/format";

interface Marker { t: number; label: string; warn?: boolean }

export function PlaybackBar({ pb, duration, markers }: { pb: Playback; duration: number; markers: Marker[] }) {
  return (
    <div className="playbar" role="group" aria-label="Playback controls">
      <button className="btn icon" onClick={pb.restart} aria-label="Restart (R)" title="Restart (R)">⏮</button>
      <button className="btn icon" onClick={() => pb.step(-10)} aria-label="Back 10 seconds (Shift+←)" title="Back 10 s (Shift+←)">⏪</button>
      <button className="btn primary icon" onClick={pb.toggle} aria-label={pb.playing ? "Pause (Space)" : "Play (Space)"} title="Play / pause (Space)" style={{ minWidth: 44 }}>
        {pb.playing ? "⏸" : "▶"}
      </button>
      <button className="btn icon" onClick={() => pb.step(10)} aria-label="Forward 10 seconds (Shift+→)" title="Forward 10 s (Shift+→)">⏩</button>
      <button className="btn" onClick={pb.replay} title="Replay from the start">↻ Replay</button>
      <div className="scrub">
        <input
          type="range" min={0} max={Math.max(1, duration - 1)} step={1} value={Math.floor(pb.t)}
          onChange={(e) => pb.seek(Number(e.target.value))}
          aria-label="Simulation time" aria-valuetext={`${Math.floor(pb.t)} seconds of ${duration}`}
        />
        <div className="ticks" aria-hidden>
          {markers.map((m, i) => (
            <span key={i} className={`tick${m.warn ? " warn" : ""}`} style={{ left: `${(m.t / Math.max(1, duration - 1)) * 100}%` }} title={m.label} />
          ))}
        </div>
      </div>
      <span className="timecode" aria-live="off">{mmss(pb.t)} / {mmss(duration)}</span>
      <label className="row small" style={{ gap: 4 }}>
        <span className="muted">Speed</span>
        <select value={pb.speed} onChange={(e) => pb.setSpeed(Number(e.target.value))} aria-label="Playback speed ([ and ])">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
    </div>
  );
}
