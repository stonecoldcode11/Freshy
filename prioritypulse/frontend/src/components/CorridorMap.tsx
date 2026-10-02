import { memo, useMemo } from "react";
import type { Frame, ModeRun, NetLink, Network, PreState, SigSnap } from "../types";
import { PRE_BADGE } from "../lib/format";
import { HEAT_BANDS, heatBand } from "../lib/heat";
import {
  LANE_W, STOP_SETBACK, behindStopLine, boundsOf, locateOnRoute, normalLeft, pointOnLink, queueSlots, unit,
} from "../lib/geometry";

export type ViewMode = "community" | "engineer";

interface Props {
  net: Network;
  run: ModeRun;
  t: number;
  view: ViewMode;
  compact?: boolean;
  title?: string;
}

const rot = (l: NetLink) => {
  const u = unit(l);
  return (Math.atan2(-u.y, u.x) * 180) / Math.PI;
};

const boxHalf = (net: Network) => {
  const main = net.links.find((l) => l.role === "F");
  const side = net.links.find((l) => l.role === "SL");
  return {
    hx: (side ? side.lanes * LANE_W + 1.2 : 8),
    hy: (main ? main.lanes * LANE_W + 1.2 : 11),
  };
};

/* ---------------------------------------------------------------- static layer */
const Roads = memo(function Roads({ net, compact }: { net: Network; compact: boolean }) {
  const { hx, hy } = boxHalf(net);
  return (
    <g>
      <defs>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#c1121f" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#fff" strokeWidth="2" />
        </pattern>
      </defs>
      {net.links.map((l) => {
        const u = unit(l);
        const n = normalLeft(u);
        const off = -(1.2 + (l.lanes * LANE_W) / 2);
        return (
          <line
            key={l.id}
            x1={l.x1 + n.x * off} y1={-(l.y1 + n.y * off)} x2={l.x2 + n.x * off} y2={-(l.y2 + n.y * off)}
            stroke="var(--road)" strokeWidth={l.lanes * LANE_W} strokeLinecap="butt"
          />
        );
      })}
      {net.links.map((l) => (
        <line
          key={`m-${l.id}`} x1={l.x1} y1={-l.y1} x2={l.x2} y2={-l.y2}
          stroke="var(--road-mark)" strokeWidth={0.7} strokeDasharray="5 4" opacity={0.85}
        />
      ))}
      {net.intersections.map((nd) => (
        <g key={nd.id}>
          <rect x={nd.x - hx} y={-nd.y - hy} width={hx * 2} height={hy * 2} fill="var(--road)" />
          {/* zebra crossings on the four legs */}
          {[-1, 1].map((s) => (
            <g key={`zx-${s}`}>
              {Array.from({ length: 9 }).map((_, i) => (
                <rect key={i} x={nd.x + s * (hx + 3.5) - 1.6} y={-nd.y - hy + 1.2 + i * ((hy * 2 - 2.4) / 9)} width={3.2} height={1.5} fill="#fff" opacity={0.9} />
              ))}
            </g>
          ))}
          {[-1, 1].map((s) => (
            <g key={`zy-${s}`}>
              {Array.from({ length: 7 }).map((_, i) => (
                <rect key={i} x={nd.x - hx + 1 + i * ((hx * 2 - 2) / 7)} y={-(nd.y + s * (hy + 3.5)) - 1.6} width={1.5} height={3.2} fill="#fff" opacity={0.9} />
              ))}
            </g>
          ))}
          {!compact && (
            <text x={nd.x} y={-nd.y + hy + 48} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="var(--text)">
              {nd.name}
            </text>
          )}
        </g>
      ))}
    </g>
  );
});

/* ---------------------------------------------------------------- dynamic layers */
function headState(sg: SigSnap, phase: number): "G" | "Y" | "R" {
  if (sg.p !== phase) return "R";
  if (sg.s === "G") return "G";
  if (sg.s === "Y") return "Y";
  return "R";
}

const HEAD_FILL = { G: "#1b9e77", Y: "#f2c230", R: "#c1121f" } as const;

function Head({ x, y, st, letter }: { x: number; y: number; st: "G" | "Y" | "R"; letter: string }) {
  // distinct shapes: circle = go, triangle = caution, square = stop
  const c = HEAD_FILL[st];
  return (
    <g transform={`translate(${x} ${y}) scale(1.35)`}>
      <rect x={-5} y={-5} width={10} height={10} rx={2.5} fill="#10151f" stroke="#fff" strokeWidth={0.5} />
      {st === "G" && <circle r={3} fill={c} />}
      {st === "Y" && <path d="M0 -3.2 L3.4 2.8 L-3.4 2.8 Z" fill={c} />}
      {st === "R" && <rect x={-2.8} y={-2.8} width={5.6} height={5.6} fill={c} />}
      <text x={0} y={9.6} textAnchor="middle" fontSize={4.6} fontWeight={800} fill="#fff" className="nostroke" style={{ stroke: "none" }}>
        {letter}
      </text>
    </g>
  );
}

function Signals({ net, frame }: { net: Network; frame: Frame }) {
  const els: JSX.Element[] = [];
  net.intersections.forEach((nd, ni) => {
    const sg = frame.sig[ni];
    for (const role of ["F", "R", "SL", "SR"]) {
      const lid = nd.approaches[role];
      const l = net.links.find((x) => x.id === lid);
      if (!l) continue;
      const mvT = net.movements.find((m) => m.link === lid && m.kind === "T");
      const mvL = net.movements.find((m) => m.link === lid && m.kind === "L");
      if (!mvT || !mvL) continue;
      const base = pointOnLink(l, l.length - STOP_SETBACK - 3, 0, l.lanes);
      const u = unit(l);
      const n = normalLeft(u);
      const off = -(1.2 + l.lanes * LANE_W + 7);
      const cx = base.x + n.x * (off + 0);
      const cy = base.y + n.y * (off + 0);
      // two heads side by side along the travel direction
      const hT = { x: cx - u.x * 0, y: cy - u.y * 0 };
      const hL = { x: cx - u.x * 11, y: cy - u.y * 11 };
      els.push(
        <g key={lid}>
          <Head x={hT.x} y={-hT.y} st={headState(sg, mvT.phase)} letter="T/R" />
          <Head x={hL.x} y={-hL.y} st={headState(sg, mvL.phase)} letter="L" />
        </g>,
      );
    }
  });
  return <g>{els}</g>;
}

function Pedestrians({ net, frame, schoolZone }: { net: Network; frame: Frame; schoolZone: boolean }) {
  const { hx, hy } = boxHalf(net);
  const total = schoolZone ? 27 : 19;
  const els: JSX.Element[] = [];
  net.intersections.forEach((nd, ni) => {
    nd.crosswalks.forEach((cw, ci) => {
      const p = frame.sig[ni].ped[ci];
      const mainX = cw.parallel_phase === 2; // crosses Main St: walks north-south on the west/east legs
      const prog = p.st >= 2 ? 1 - p.rem / total : 0;
      const color = p.st === 2 ? "#1b9e77" : p.st === 3 ? "#f2c230" : p.st === 1 ? "#e66101" : "transparent";
      if (p.st === 0) return;
      const legs = mainX ? [-1, 1] : [-1, 1];
      legs.forEach((s) => {
        if (mainX) {
          const x = nd.x + s * (hx + 3.5);
          els.push(
            <g key={`${cw.id}-${s}`}>
              <rect x={x - 3} y={-nd.y - hy} width={6} height={hy * 2} fill="none" stroke={color} strokeWidth={1.2} className={p.st === 3 ? "pulse" : undefined} />
              {p.st >= 2 && <circle cx={x} cy={-nd.y + hy - prog * hy * 2} r={2.1} fill="#fff" stroke="#111" strokeWidth={0.8} />}
              {p.st === 1 && s === 1 && <text x={x + 6} y={-nd.y - hy - 3} fontSize={8} fill="#e66101" className="nostroke" style={{ stroke: "none" }}>✋</text>}
            </g>,
          );
        } else {
          const y = nd.y + s * (hy + 3.5);
          els.push(
            <g key={`${cw.id}-${s}`}>
              <rect x={nd.x - hx} y={-y - 3} width={hx * 2} height={6} fill="none" stroke={color} strokeWidth={1.2} className={p.st === 3 ? "pulse" : undefined} />
              {p.st >= 2 && <circle cx={nd.x - hx + prog * hx * 2} cy={-y} r={2.1} fill="#fff" stroke="#111" strokeWidth={0.8} />}
            </g>,
          );
        }
      });
    });
  });
  return <g>{els}</g>;
}

function HeatStrips({ net, frame }: { net: Network; frame: Frame }) {
  return (
    <g>
      {net.links.map((l, i) => {
        if (l.kind === "exit") return null;
        const ratio = frame.occ[i] ?? 0;
        const band = heatBand(ratio, net.r_block);
        const u = unit(l);
        const n = normalLeft(u);
        const off = -(1.2 + l.lanes * LANE_W + 1.1);
        const x1 = l.x1 + n.x * off, y1 = l.y1 + n.y * off, x2 = l.x2 + n.x * off, y2 = l.y2 + n.y * off;
        const midx = (x1 + x2) / 2 + n.x * -5, midy = (y1 + y2) / 2 + n.y * -5;
        return (
          <g key={l.id}>
            <line x1={x1} y1={-y1} x2={x2} y2={-y2} stroke={band.color} strokeWidth={2} />
            {band.id === "blocked" && <line x1={x1} y1={-y1} x2={x2} y2={-y2} stroke="url(#hatch)" strokeWidth={2} />}
            {band.id !== "free" && (
              <g transform={`translate(${midx} ${-midy})`}>
                <circle r={4.6} fill={band.color} stroke="#fff" strokeWidth={0.8} />
                <text y={2} textAnchor="middle" fontSize={6.2} fontWeight={800} fill="#fff" className="nostroke" style={{ stroke: "none" }}>
                  {band.icon}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Vehicles({ net, frame, f, linkMoves }: { net: Network; frame: Frame; f: number; linkMoves: Map<string, Record<string, number>> }) {
  const rects: JSX.Element[] = [];
  net.links.forEach((l, li) => {
    if (l.kind === "exit") return;
    const mv = linkMoves.get(l.id);
    if (!mv) return;
    const counts = { L: frame.q[mv.L] ?? 0, T: frame.q[mv.T] ?? 0, R: frame.q[mv.R] ?? 0 };
    const maxShown = Math.max(4, Math.floor((l.length - STOP_SETBACK - 8) / 7.5) * Math.max(1, l.lanes - 1));
    const slots = queueSlots(counts, l.lanes, maxShown);
    let queueLen = 0;
    slots.forEach((s, k) => {
      queueLen = Math.max(queueLen, s.back + 7.5);
      const p = behindStopLine(l, s.back, s.lane);
      const wait = frame.w[mv[s.kind]] ?? 0;
      const fill = wait >= 100 ? "var(--veh-stuck)" : wait >= 60 ? "var(--veh-wait)" : "var(--veh)";
      rects.push(<rect key={`${l.id}-q${k}`} x={-3.3} y={-1.8} width={6.6} height={3.6} rx={1} fill={fill} transform={`translate(${p.x} ${-p.y}) rotate(${rot(l)})`} />);
    });
    const tr = frame.tr[li] ?? [];
    const tau = tr.length;
    if (tau === 0) return;
    for (let i = 0; i < tau; i++) {
      const c = tr[i] ?? 0;
      for (let k = 0; k < c; k++) {
        const remaining = i + 1 - f;
        const back = Math.max(queueLen, (remaining / tau) * (l.length - STOP_SETBACK) + k * 3.2);
        if (back > l.length - STOP_SETBACK) continue;
        const p = behindStopLine(l, back, (i + k) % Math.max(1, l.lanes));
        rects.push(<rect key={`${l.id}-t${i}-${k}`} x={-3.3} y={-1.8} width={6.6} height={3.6} rx={1} fill="var(--veh)" opacity={0.78} transform={`translate(${p.x} ${-p.y}) rotate(${rot(l)})`} />);
      }
    }
  });
  return <g>{rects}</g>;
}

function EvMarker({ net, run, frame, f, reduceMotion }: { net: Network; run: ModeRun; frame: Frame; f: number; reduceMotion: boolean }) {
  const out: JSX.Element[] = [];
  const draw = (pvKind: "ev" | "bus", links: string[], cum: number[], s: number, label: string, key: string) => {
    const pos = locateOnRoute(net, links, cum, s);
    const isEv = pvKind === "ev";
    out.push(
      <g key={key} transform={`translate(${pos.x} ${-pos.y})`}>
        {isEv && <circle r={13} fill="var(--ev)" opacity={0.2} className={reduceMotion ? undefined : "pulse"} />}
        <g transform={`rotate(${-pos.angle})`}>
          <rect x={-7} y={-3.2} width={14} height={6.4} rx={1.6} fill={isEv ? "#fff" : "#f2c230"} stroke={isEv ? "var(--ev)" : "#111"} strokeWidth={1} />
          {isEv ? (
            <>
              <rect x={-1} y={-2.4} width={2} height={4.8} fill="#c1121f" />
              <rect x={-2.4} y={-1} width={4.8} height={2} fill="#c1121f" />
              <circle cx={3.6} cy={-1.6} r={1.2} fill="#c1121f" className={reduceMotion ? undefined : "beacon-a"} />
              <circle cx={3.6} cy={1.6} r={1.2} fill="#0b5cab" className={reduceMotion ? undefined : "beacon-b"} />
            </>
          ) : (
            <rect x={-5} y={-1.6} width={8} height={1.6} fill="#fff" />
          )}
        </g>
        <text y={-11} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={isEv ? "var(--ev)" : "var(--text)"}>
          {label}
        </text>
      </g>,
    );
  };
  for (const pv of frame.pv) {
    if (pv.st !== "enroute") continue;
    const s = pv.s + Math.max(0, pv.v) * f;
    if (pv.kind === "ev" && run.ev) {
      draw("ev", run.ev.route.links, run.ev.route.cum_ends, Math.min(s, run.ev.route.length), ({ ambulance: "AMB", fire: "FIRE", police: "POL" } as Record<string, string>)[pv.etype] ?? "EV", pv.id);
    } else if (pv.kind === "bus") {
      const b = run.buses.find((x) => x.id === pv.id);
      if (b) draw("bus", b.route.links, b.route.cum_ends, Math.min(s, b.route.length), pv.label, pv.id);
    }
  }
  return <g>{out}</g>;
}

function RouteLine({ net, run }: { net: Network; run: ModeRun }) {
  if (!run.ev) return null;
  const byId = new Map(net.links.map((l) => [l.id, l] as const));
  return (
    <g>
      {run.ev.route.links.map((id) => {
        const l = byId.get(id);
        if (!l) return null;
        const u = unit(l);
        const n = normalLeft(u);
        const off = -(1.2 + LANE_W * 0.6);
        return (
          <line
            key={id} x1={l.x1 + n.x * off} y1={-(l.y1 + n.y * off)} x2={l.x2 + n.x * off} y2={-(l.y2 + n.y * off)}
            stroke="var(--ev)" strokeWidth={1.6} strokeDasharray="7 4" opacity={0.9}
          />
        );
      })}
    </g>
  );
}

function Badges({ net, frame }: { net: Network; frame: Frame }) {
  const { hy } = boxHalf(net);
  return (
    <g>
      {net.intersections.map((nd, ni) => {
        const pre = frame.sig[ni].pre as PreState;
        const b = PRE_BADGE[pre];
        if (!b.text) return null;
        const w = b.text.length * 5.6 + 22;
        const hot = pre === "active" || pre === "hold";
        return (
          <g key={nd.id} transform={`translate(${nd.x} ${-nd.y - hy - 22})`}>
            <rect x={-w / 2} y={-8} width={w} height={16} rx={8} fill={hot ? "var(--ev)" : "var(--surface)"} stroke="var(--ev)" strokeWidth={1.2} />
            <text textAnchor="middle" y={3.5} fontSize={8.6} fontWeight={800} fill={hot ? "#fff" : "var(--ev)"} className="nostroke" style={{ stroke: "none" }}>
              {b.icon} {b.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function BoundaryLabels({ net }: { net: Network }) {
  const glyph: Record<string, string> = { station: "S", hospital: "H", school: "Sch", gate: "" };
  return (
    <g>
      {net.boundaries.map((b) => {
        const g = glyph[b.kind] ?? "";
        const left = b.id === "B_W";
        const right = b.id === "B_E";
        const top = b.id.startsWith("B_SL");
        const anchor = left ? "start" : right ? "end" : "middle";
        const dx = left ? 6 : right ? -6 : 0;
        const dy = left || right ? -(10) : top ? -9 : 15;
        const important = b.kind !== "gate";
        return (
          <g key={b.id} transform={`translate(${b.x + dx} ${-b.y + dy})`} opacity={important ? 1 : 0.7}>
            <text textAnchor={anchor} fontSize={important ? 9 : 8} fontWeight={important ? 800 : 600} fill="var(--text)">
              {g ? `${g} · ` : ""}{b.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function EngineerOverlay({ net, frame, linkMoves }: { net: Network; frame: Frame; linkMoves: Map<string, Record<string, number>> }) {
  return (
    <g>
      {net.links.map((l, i) => {
        if (l.kind === "exit") return null;
        const mv = linkMoves.get(l.id);
        const q = mv ? (frame.q[mv.L] ?? 0) + (frame.q[mv.T] ?? 0) + (frame.q[mv.R] ?? 0) : 0;
        const u = unit(l);
        const n = normalLeft(u);
        const p = pointOnLink(l, l.length - STOP_SETBACK - 30, 0, l.lanes);
        const off = -(1.2 + l.lanes * LANE_W + 6.5);
        return (
          <text key={l.id} x={p.x + n.x * off} y={-(p.y + n.y * off)} textAnchor="middle" fontSize={6.6} fontWeight={700} fill="var(--text)">
            Q{q} · {Math.round((frame.occ[i] ?? 0) * 100)}%
          </text>
        );
      })}
    </g>
  );
}

/* ---------------------------------------------------------------- component */
function CorridorMapBase({ net, run, t, view, compact = false, title }: Props) {
  const frames = run.frames;
  const idx = Math.min(frames.length - 1, Math.max(0, Math.floor(t)));
  const frame = frames[idx];
  const f = t - Math.floor(t);
  const box = useMemo(() => boundsOf(net, compact ? 34 : 52), [net, compact]);
  const linkMoves = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const mv of net.movements) {
      const cur = m.get(mv.link) ?? {};
      cur[mv.kind] = mv.idx;
      m.set(mv.link, cur);
    }
    return m;
  }, [net]);
  const reduceMotion = typeof document !== "undefined" && document.documentElement.classList.contains("reduce-motion");
  if (!frame) return null;
  const summary = net.intersections
    .map((nd, i) => `${nd.name}: ${net.phase_names[frame.sig[i].p]} ${frame.sig[i].s === "G" ? "green" : frame.sig[i].s === "Y" ? "yellow" : "all red"}`)
    .join("; ");
  return (
    <div className="map-wrap">
      <svg
        className="map-svg"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        role="img"
        aria-label={`${title ?? run.mode} corridor map at ${Math.floor(t)} seconds. ${summary}.`}
      >
        <Roads net={net} compact={compact} />
        <RouteLine net={net} run={run} />
        <HeatStrips net={net} frame={frame} />
        <Pedestrians net={net} frame={frame} schoolZone={Boolean(run.config.school_zone)} />
        <Vehicles net={net} frame={frame} f={f} linkMoves={linkMoves} />
        <Signals net={net} frame={frame} />
        {!compact && <BoundaryLabels net={net} />}
        <Badges net={net} frame={frame} />
        {view === "engineer" && !compact && <EngineerOverlay net={net} frame={frame} linkMoves={linkMoves} />}
        <EvMarker net={net} run={run} frame={frame} f={f} reduceMotion={reduceMotion} />
      </svg>
    </div>
  );
}

export const CorridorMap = memo(CorridorMapBase);

export function HeatLegend() {
  return (
    <div className="legend" aria-label="Queue storage legend">
      {HEAT_BANDS.map((b) => (
        <span key={b.id}>
          <i style={{ background: b.color }} aria-hidden>{b.icon}</i>
          {b.label} <span className="muted">{b.range}</span>
        </span>
      ))}
      <span><i style={{ background: "#10151f" }} aria-hidden>●</i>Signal: ● go · ▲ caution · ■ stop</span>
    </div>
  );
}
