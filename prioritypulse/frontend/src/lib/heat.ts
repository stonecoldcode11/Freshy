/** Storage-ratio heat scale R_l = Q_l / C_l.
 *
 * Colours come from a colour-blind-safe palette and every band also has a text label,
 * an icon and (for the worst band) a hatch pattern, so colour is never the only signal.
 */
export interface HeatBand {
  id: "free" | "growing" | "risk" | "blocked";
  label: string;
  range: string;
  icon: string;
  color: string;
  meaning: string;
}

export const HEAT_BANDS: HeatBand[] = [
  { id: "free", label: "Free", range: "0–40%", icon: "✓", color: "#1b9e77", meaning: "Free-flow or low queue" },
  { id: "growing", label: "Growing", range: "40–65%", icon: "~", color: "#e6ab02", meaning: "Growing congestion" },
  { id: "risk", label: "Spillback risk", range: "65–85%", icon: "!", color: "#e66101", meaning: "Spillback risk" },
  { id: "blocked", label: "Blocked", range: "85%+", icon: "✕", color: "#c1121f", meaning: "Near/full: incoming traffic blocked" },
];

export function heatBand(ratio: number, rBlock = 0.85): HeatBand {
  if (ratio >= rBlock) return HEAT_BANDS[3];
  if (ratio >= 0.65) return HEAT_BANDS[2];
  if (ratio >= 0.4) return HEAT_BANDS[1];
  return HEAT_BANDS[0];
}

export const heatColor = (ratio: number, rBlock = 0.85): string => heatBand(ratio, rBlock).color;
