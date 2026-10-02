import { describe, expect, it } from "vitest";
import { HEAT_BANDS, heatBand } from "./heat";
import { fmtNum, fmtPct, fmtSec, mmss } from "./format";
import { formatValidation } from "../api";
import { laneFor, locateOnRoute, queueSlots, STOP_SETBACK } from "./geometry";
import type { Network, NetLink } from "../types";

const link = (id: string, x1: number, y1: number, x2: number, y2: number, lanes = 3): NetLink => ({
  id, from: "a", to: "b", kind: "internal", role: "F", bound: "EB", length: Math.hypot(x2 - x1, y2 - y1), lanes,
  v_free: 13, capacity: 60, x1, y1, x2, y2, latlon1: [0, 0], latlon2: [0, 0], approach_of: null, out: {}, free_flow_time: 10,
});
const net = { links: [link("F0", 0, 0, 100, 0), link("F1", 100, 0, 300, 0)] } as unknown as Network;

describe("heat scale", () => {
  it("bands follow the 40/65/85 thresholds", () => {
    expect(heatBand(0.0).id).toBe("free");
    expect(heatBand(0.39).id).toBe("free");
    expect(heatBand(0.4).id).toBe("growing");
    expect(heatBand(0.65).id).toBe("risk");
    expect(heatBand(0.849).id).toBe("risk");
    expect(heatBand(0.85).id).toBe("blocked");
    expect(heatBand(1.2).id).toBe("blocked");
  });
  it("every band has a distinct colour and icon (colour is never the only cue)", () => {
    expect(new Set(HEAT_BANDS.map((b) => b.color)).size).toBe(4);
    expect(new Set(HEAT_BANDS.map((b) => b.icon)).size).toBe(4);
  });
  it("respects a custom block threshold", () => {
    expect(heatBand(0.8, 0.7).id).toBe("blocked");
  });
});

describe("formatting", () => {
  it("handles missing values", () => {
    expect(fmtSec(null)).toBe("—");
    expect(fmtSec(12.34, 1)).toBe("12.3 s");
    expect(fmtNum(undefined)).toBe("—");
    expect(fmtPct(47.25, 1)).toBe("47.3%");
    expect(mmss(75.9)).toBe("1:15");
    expect(mmss(-3)).toBe("0:00");
  });
  it("turns FastAPI validation lists into one line", () => {
    expect(formatValidation([{ loc: ["body", "weather"], msg: "bad" }])).toBe("weather: bad");
    expect(formatValidation("nope")).toBeNull();
  });
});

describe("geometry", () => {
  it("locates a vehicle on a multi-link route", () => {
    const a = locateOnRoute(net, ["F0", "F1"], [100, 300], 50);
    expect(a.link).toBe("F0");
    expect(a.frac).toBeCloseTo(0.5);
    expect(a.x).toBeCloseTo(50);
    const b = locateOnRoute(net, ["F0", "F1"], [100, 300], 200);
    expect(b.link).toBe("F1");
    expect(b.x).toBeCloseTo(200);
    const end = locateOnRoute(net, ["F0", "F1"], [100, 300], 999);
    expect(end.frac).toBe(1);
  });
  it("right-hand traffic keeps an eastbound lane south of the centre line", () => {
    const a = locateOnRoute(net, ["F0"], [100], 10);
    expect(a.y).toBeLessThan(0);
  });
  it("assigns lanes by movement", () => {
    expect(laneFor("L", 3, 0)).toBe(0);
    expect(laneFor("R", 3, 5)).toBe(2);
    expect(laneFor("T", 3, 0)).toBe(1);
    expect(laneFor("T", 3, 1)).toBe(2);
    expect(laneFor("T", 1, 4)).toBe(0);
  });
  it("stacks queued vehicles without overlap and respects the display cap", () => {
    const slots = queueSlots({ L: 2, T: 6, R: 2 }, 3, 100);
    expect(slots).toHaveLength(10);
    const keys = new Set(slots.map((s) => `${s.lane}:${s.back}`));
    expect(keys.size).toBe(10);
    expect(queueSlots({ L: 0, T: 50, R: 0 }, 3, 12)).toHaveLength(12);
    expect(STOP_SETBACK).toBeGreaterThan(0);
  });
});
