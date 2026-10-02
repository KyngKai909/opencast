// The radio band's needle: it travels the real distance between two frequencies in SWEEP_MS,
// eased in and out (the reference's cubic-bezier(.45, 0, .2, 1)), passing over the empty band
// between them. A press while it's still moving starts from wherever it is.

import { BAND_MAX_MHZ, BAND_MIN_MHZ, SWEEP_EASING, SWEEP_MS } from "./constants";

export interface Sweep {
  /** Frequencies (MHz). */
  from: number;
  to: number;
  /** When it started (the engine's clock, ms). */
  at: number;
  /** How long it takes: SWEEP_MS, or 0 with reduced motion (the needle jumps). */
  ms: number;
}

/** Where a frequency sits along the band, 0 to 100 (%). */
export function bandPercent(mhz: number, min = BAND_MIN_MHZ, max = BAND_MAX_MHZ): number {
  return Math.max(0, Math.min(100, ((mhz - min) / (max - min)) * 100));
}

/** A radio station's frequency from its channel ("94.7"), or null for anything else. */
export function frequencyOf(channel: string | null | undefined): number | null {
  const f = channel ? parseFloat(channel) : NaN;
  return Number.isFinite(f) && f >= BAND_MIN_MHZ && f <= BAND_MAX_MHZ ? f : null;
}

/** A CSS cubic-bezier timing function, as a function of progress 0 to 1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Solve bx(s) = t by bisection (bx is increasing for x1, x2 in 0..1), then read by(s).
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

export const sweepEase = cubicBezier(...SWEEP_EASING);

/** A sweep from one frequency to another, starting now. */
export function sweep(from: number, to: number, at: number, reduced = false): Sweep {
  return { from, to, at, ms: reduced ? 0 : SWEEP_MS };
}

/** Where the needle is (MHz) at time t. */
export function needleAt(s: Sweep, t: number): number {
  if (s.ms <= 0) return s.to;
  const p = sweepEase(Math.min(1, Math.max(0, (t - s.at) / s.ms)));
  return s.from + (s.to - s.from) * p;
}

/** How far the needle travels (MHz): the real distance, never wrapping round the band. */
export function sweepDistance(s: Sweep): number {
  return Math.abs(s.to - s.from);
}
