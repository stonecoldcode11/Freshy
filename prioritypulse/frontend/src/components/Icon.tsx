/** Minimal stroke icon set (no external assets so the app works offline). */
const PATHS: Record<string, string> = {
  ambulance: "M3 16V8h11v8M14 11h4l3 3v2h-3M3 16h1M9 16h5M6 11h4M8 9v4",
  fire: "M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4-.2 1.5.5 2.2 1 2.5C11 8 11 5 12 3z",
  police: "M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z",
  school: "M3 10l9-5 9 5M5 10v8h14v-8M10 18v-4h4v4",
  stadium: "M3 9c0-2 4-3 9-3s9 1 9 3-4 3-9 3-9-1-9-3zM3 9v6c0 2 4 3 9 3s9-1 9-3V9",
  crash: "M12 3l9 17H3L12 3zM12 10v4M12 17v.5",
  snow: "M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9M9 4l3 2 3-2M9 20l3-2 3 2",
  map: "M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  play: "M7 4l13 8-13 8V4z",
  info: "M12 8v.5M12 11v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  pin: "M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  keyboard: "M3 7h18v10H3V7zM7 11h.5M11 11h.5M15 11h.5M7 14h10",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  moon: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z",
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M3 17h6l3-8 5 14 3-9 2 3h7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
