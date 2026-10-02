import { useId } from "react";

export interface ChartSeries { id: string; label: string; color: string; dash?: string; values: number[] }
export interface ChartMarker { t: number; label: string; color: string }
export interface ChartShade { from: number; to: number; label: string; color: string }

interface Props {
  t: number[];
  series: ChartSeries[];
  /** shade between two series (e.g. the queue = arrived - departed) */
  band?: { upper: string; lower: string; color: string; label: string };
  markers?: ChartMarker[];
  shades?: ChartShade[];
  playhead?: number;
  yLabel: string;
  title: string;
  height?: number;
}

const W = 680;

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function LineChart({ t, series, band, markers = [], shades = [], playhead, yLabel, title, height = 220 }: Props) {
  const uid = useId();
  const m = { l: 44, r: 12, t: 12, b: 28 };
  const w = W - m.l - m.r;
  const h = height - m.t - m.b;
  const t0 = t[0] ?? 0;
  const t1 = t[t.length - 1] ?? 1;
  const maxY = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const X = (v: number) => m.l + ((v - t0) / Math.max(1, t1 - t0)) * w;
  const Y = (v: number) => m.t + h - (v / maxY) * h;
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${X(t[i]).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const xTicks: number[] = [];
  const step = (t1 - t0) > 360 ? 60 : 30;
  for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) xTicks.push(v);
  const up = band ? series.find((s) => s.id === band.upper) : undefined;
  const lo = band ? series.find((s) => s.id === band.lower) : undefined;
  const bandPath = up && lo
    ? `${up.values.map((v, i) => `${i === 0 ? "M" : "L"}${X(t[i]).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ")} ${[...lo.values].reverse().map((v, i) => `L${X(t[lo.values.length - 1 - i]).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ")} Z`
    : null;
  const rows = t.map((tv, i) => ({ tv, i })).filter(({ tv }) => tv % 30 === 0);
  const summary = `${title}. ${series.map((s) => `${s.label}: peak ${Math.max(...s.values)}`).join("; ")}.`;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={summary}>
        <title>{title}</title>
        {shades.map((s, i) => (
          <g key={i}>
            <rect x={X(s.from)} y={m.t} width={Math.max(2, X(s.to) - X(s.from))} height={h} fill={s.color} opacity={0.14} />
            <text x={X(s.from) + 3} y={m.t + 10}>{s.label}</text>
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />
            <text x={m.l - 6} y={Y(v) + 4} textAnchor="end">{Math.round(v)}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={X(v)} y={height - 8} textAnchor="middle">{v}s</text>
        ))}
        <line className="axis" x1={m.l} x2={W - m.r} y1={m.t + h} y2={m.t + h} />
        <text x={6} y={m.t + 8} transform={`rotate(-90 6 ${m.t + 8})`} textAnchor="end" style={{ display: "none" }}>{yLabel}</text>
        <text x={m.l} y={10} style={{ fontWeight: 700 }}>{yLabel}</text>
        {bandPath && <path d={bandPath} fill={band!.color} opacity={0.22}><title>{band!.label}</title></path>}
        {series.map((s) => (
          <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dash} strokeLinejoin="round" />
        ))}
        {markers.map((mk, i) => (
          <g key={i}>
            <line x1={X(mk.t)} x2={X(mk.t)} y1={m.t} y2={m.t + h} stroke={mk.color} strokeDasharray="3 3" strokeWidth={1.4} />
            <text x={X(mk.t) + 3} y={m.t + h - 4} style={{ fill: mk.color, fontWeight: 700 }}>{mk.label}</text>
          </g>
        ))}
        {playhead !== undefined && (
          <line x1={X(playhead)} x2={X(playhead)} y1={m.t} y2={m.t + h} stroke="var(--text)" strokeWidth={1.4} />
        )}
        <defs><clipPath id={`${uid}-c`}><rect x={m.l} y={m.t} width={w} height={h} /></clipPath></defs>
      </svg>
      <figcaption className="legend" style={{ marginTop: 4 }}>
        {series.map((s) => (
          <span key={s.id}>
            <svg width="26" height="8" aria-hidden style={{ marginRight: 4 }}>
              <line x1="0" x2="26" y1="4" y2="4" stroke={s.color} strokeWidth="3" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
      </figcaption>
      <details style={{ marginTop: 6 }}>
        <summary className="small">View data table</summary>
        <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Chart data table (scrollable)">
          <table className="tbl">
            <thead>
              <tr><th>Time (s)</th>{series.map((s) => <th key={s.id} className="num">{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(({ tv, i }) => (
                <tr key={tv}><td>{tv}</td>{series.map((s) => <td key={s.id} className="num">{s.values[i]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
