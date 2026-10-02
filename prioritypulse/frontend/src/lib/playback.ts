import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "./format";

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;

export interface Playback {
  t: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  step: (dt: number) => void;
  restart: () => void;
  replay: () => void;
  setSpeed: (s: number) => void;
}

/** Playback clock over a recorded run (1 frame per second of simulated time). */
export function usePlayback(duration: number, reducedMotion: boolean): Playback {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const tRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const maxT = Math.max(0, duration - 0.001);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastRender = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      tRef.current = Math.min(maxT, tRef.current + dt * speedRef.current);
      if (now - lastRender >= 33) {
        lastRender = now;
        setT(reducedMotion ? Math.floor(tRef.current) : tRef.current);
      }
      if (tRef.current >= maxT) {
        setT(reducedMotion ? Math.floor(tRef.current) : tRef.current);
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxT, reducedMotion]);

  const seek = useCallback((v: number) => {
    tRef.current = clamp(v, 0, maxT);
    setT(tRef.current);
  }, [maxT]);

  return {
    t,
    playing,
    speed,
    play: () => {
      if (tRef.current >= maxT) tRef.current = 0;
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (!playing && tRef.current >= maxT) {
        tRef.current = 0;
        setT(0);
      }
      setPlaying((p) => !p);
    },
    seek,
    step: (dt: number) => {
      setPlaying(false);
      seek(Math.round(tRef.current) + dt);
    },
    restart: () => {
      setPlaying(false);
      seek(0);
    },
    replay: () => {
      seek(0);
      setPlaying(true);
    },
    setSpeed,
  };
}
