import type { FromPointsResponse, MapPoint, Network, PointsOptions, RunRequestBody, RunResponse, Scenario } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  } catch {
    throw new ApiError(0, "Cannot reach the PriorityPulse server. Is the backend running on port 8000?");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : formatValidation(body.detail) ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** FastAPI validation errors arrive as a list of {loc, msg}; turn them into one readable line. */
export function formatValidation(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null;
  return detail
    .map((d: { loc?: (string | number)[]; msg?: string }) => `${(d.loc ?? []).filter((p) => p !== "body").join(".")}: ${d.msg ?? "invalid"}`)
    .join("; ");
}

export const api = {
  scenarios: () => request<Scenario[]>("/api/scenarios"),
  demoNetwork: () => request<Network>("/api/network/demo?n=3"),
  run: (body: RunRequestBody) => request<RunResponse>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  fromPoints: (points: MapPoint[], options: PointsOptions, enrich: boolean) =>
    request<FromPointsResponse>("/api/network/from-points", { method: "POST", body: JSON.stringify({ points, options, enrich }) }),
  exportUrl: (runId: string, kind: "metrics" | "timeseries" | "events" | "decisions", mode = "prioritypulse") =>
    `/api/runs/${runId}/export.csv?kind=${kind}&mode=${mode}`,
  reportUrl: (runId: string, fmt: "md" | "json") => `/api/runs/${runId}/report.${fmt}`,
};
