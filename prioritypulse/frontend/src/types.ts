/** Types mirroring the PriorityPulse backend payloads. */

export type Mode = "fixed" | "reactive" | "prioritypulse";
export const MODES: Mode[] = ["fixed", "reactive", "prioritypulse"];
export type Weather = "clear" | "rain" | "snow";
export type EvType = "ambulance" | "fire" | "police";
export type Priority = "routine" | "urgent" | "critical";

export interface Surge { links: string[]; start: number; end: number; factor: number; ramp: number }
export interface Incident { link: string; start: number; end: number; lanes_closed: number; label: string }
export interface DispatchSpec { origin: string; destination: string; etype: EvType; priority: Priority; t: number }
export interface BusSpec { id: string; origin: string; destination: string; t: number; late_min: number; occupancy: number; school: boolean }

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  intensity: number;
  duration: number;
  weather: Weather;
  school_zone: boolean;
  ped_rate: number;
  surges: Surge[];
  incidents: Incident[];
  dispatch: DispatchSpec | null;
  buses: BusSpec[];
  watch_for: string[];
}

export type LatLon = [number, number];

export interface Crosswalk { id: string; name: string; parallel_phase: number; x: number; y: number }
export interface NetNode {
  id: string; name: string; x: number; y: number; index: number; latlon: LatLon;
  phases: number[][]; approaches: Record<string, string>; crosswalks: Crosswalk[];
}
export interface Boundary {
  id: string; name: string; x: number; y: number; kind: string; latlon: LatLon;
  entry_link: string; exit_link: string;
}
export interface NetLink {
  id: string; from: string; to: string; kind: "entry" | "internal" | "exit"; role: string; bound: string;
  length: number; lanes: number; v_free: number; capacity: number;
  x1: number; y1: number; x2: number; y2: number; latlon1: LatLon; latlon2: LatLon;
  approach_of: string | null; out: Record<string, string>; free_flow_time: number;
}
export interface NetMovement {
  idx: number; id: string; link: string; kind: "L" | "T" | "R"; node: string; role: string; phase: number;
  out_link: string; sat_flow: number; share: number; label: string;
}
export interface Network {
  name: string; source: string; notes: string[]; origin: LatLon; forward_bearing: number;
  compass: Record<string, string>; phase_names: string[];
  intersections: NetNode[]; boundaries: Boundary[]; links: NetLink[]; movements: NetMovement[];
  conflicts: number[][]; r_block: number; jam_spacing: number;
}

export interface PedSnap { st: number; rem: number; w: number }
export interface SigSnap { s: "G" | "Y" | "R"; p: number; tp: number; tm: number; ped: PedSnap[]; pre: PreState }
export type PreState = "none" | "pending" | "active" | "hold" | "release" | "recovery";

export interface PVSnap {
  id: string; kind: "ev" | "bus"; label: string; st: string; s: number; v: number; j: number;
  ahead: number | null; held: number; stops: number; etype: string;
}
export interface PlanItem {
  j: number; node: string; phase: number; mv: string; eta_rel: number; eta_free: number; eta_abs: number;
  queue: number; ahead: number; t_clear: number; t_safe: number; t_buffer: number; t_prep: number;
  trigger_in: number; status: "far" | "pending" | "active"; exp_delay: number; ped_rem: number;
}
export interface Frame {
  t: number;
  sig: SigSnap[];
  q: number[];
  occ: number[];
  tr: number[][];
  w: number[];
  pv: PVSnap[];
  bl: number;
  blk: number[];
  cum: [number, number];
  ctl: { plan?: PlanItem[] };
}

export interface CandidateRow {
  label: string; kind: string; cost: number; terms: Record<string, number>; selected: boolean; tags: string[];
}
export interface ConstraintRow { name: string; ok: boolean; detail: string }
export interface Decision {
  t: number; node: string; node_name?: string; mode: string;
  kind: "switch" | "preempt" | "extend" | "fairness" | "guard" | "preempt_request";
  title: string; reasons: string[]; constraints: ConstraintRow[]; candidates: CandidateRow[];
  from_phase?: number; to_phase?: number;
}
export interface SimEvent {
  t: number; kind: string; node: string | null; text: string; severity: "info" | "warn";
  link?: string; ratio?: number;
}

export interface EvMetrics {
  travel_time: number | null; free_flow_time: number; delay: number | null; stops: number; stop_seconds: number;
  arrived: boolean; forced_passes: number; route_length: number; per_intersection_delay: number[];
  passed_at: (number | null)[];
}
export interface BusMetrics { id: string; travel_time: number | null; delay: number | null; stops: number; late_min: number; occupancy: number }
export interface RunMetrics {
  ev: EvMetrics | null;
  avg_delay_s: number; total_delay_veh_s: number; throughput: number; completed: number; admitted: number;
  vehicles_counted: number; max_queue: number; max_link_fill_pct: number;
  spillback_events: number; spillback_seconds: number; spillback_by_link: Record<string, number>;
  idling_veh_s: number; idling_veh_min: number; co2_g_assumed: number;
  max_wait_s: number; seconds_over_fair_wait: number; ped_calls_served: number; ped_max_wait_s: number;
  recovery_time_s: number | null; q_normal: number; backlog_peak: number;
  safety_compliance_pct: number; signal_transitions: number; safety_violations: string[]; conflict_steps: number;
  buses: BusMetrics[];
}
export interface RouteInfo {
  links: string[]; nodes: string[]; length: number; cum_ends: number[];
  stops: { node: string; link_in: string; movement: string; kind: string; phase: number; link_out: string; dist: number }[];
}
export interface EvInfo {
  id: string; label: string; etype: EvType; priority: Priority; t_dispatch: number; speed: number;
  route: RouteInfo; passed_at: (number | null)[]; t_arrive: number | null;
}
export interface BusInfo {
  id: string; label: string; t_dispatch: number; late_min: number; occupancy: number;
  route: { links: string[]; length: number; cum_ends: number[] };
}
export interface Series { t: number[]; queue: number[]; backlog: number[]; blocked: number[]; arrived: number[]; departed: number[]; maxwait: number[] }
export interface SafetyInfo {
  transitions: number; legal: number; violations: string[]; steps_checked: number; conflict_steps: number; compliance_pct: number;
}
export interface ModeRun {
  mode: Mode; config: Record<string, any>; frames: Frame[]; events: SimEvent[]; decisions: Decision[];
  metrics: RunMetrics; series: Series; ev: EvInfo | null; buses: BusInfo[]; safety: SafetyInfo; elapsed_s: number;
}
export interface CompareRow {
  key: string; label: string; unit: string; lower_is_better: boolean;
  values: Partial<Record<Mode, number | null>>; best: Mode | null;
}
export interface OutcomeVs {
  ev_time_saved_s: number | null; ev_improvement_pct: number | null; ev_stops_avoided: number | null;
  max_queue_reduced: number; spillback_prevented: number; recovery_improved_s: number | null;
  idling_reduced_veh_min: number; avg_delay_change_s: number; throughput_change: number;
}
export interface OutcomeReport {
  fixed?: OutcomeVs; reactive?: OutcomeVs; safety_compliance_pct: number;
  pedestrian_constraints_satisfied_pct: number; co2_assumption_g_per_veh_s: number;
}
export interface RunResponse {
  run_id: string;
  scenario: Scenario;
  network: Network;
  dispatch: DispatchSpec | null;
  seed: number;
  duration: number;
  warmup: number;
  demand: { total_arrivals: number; mean_K: number };
  mode_labels: Record<Mode, string>;
  runs: Partial<Record<Mode, ModeRun>>;
  comparison: { rows: CompareRow[]; report: OutcomeReport | null } | null;
}

/** Request bodies */
export interface MapPoint { lat: number; lon: number; name?: string }
export interface PointsOptions {
  name?: string; main_lanes: number; side_lanes: number; main_speed_kmh?: number | null; side_speed_kmh?: number | null;
}
export type NetworkSpec = { type: "demo"; n: number } | { type: "points"; points: MapPoint[]; options: PointsOptions };
export interface RunRequestBody {
  scenario_id: string; seed: number; modes?: Mode[]; duration?: number; intensity?: number; weather?: Weather;
  school_zone?: boolean; dispatch?: Partial<DispatchSpec> & { enabled?: boolean };
  network?: NetworkSpec; ped_calls?: { t: number; crosswalk: string }[]; include_frames?: boolean;
}
export interface FromPointsResponse {
  network: Network; warnings: string[]; options: PointsOptions;
  enrichment: { suggestions: unknown[]; main_lanes?: number | null; main_speed_kmh?: number | null; warnings: string[] } | null;
}
