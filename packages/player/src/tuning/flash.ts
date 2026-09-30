// Counting flashes (WCAG 2.3.1, general flash), for the photosensitivity test.
//
// The method: take the whole screen's average relative luminance over time, sampled at a steady
// rate. A transition is a change of at least FLASH_THRESHOLD (10% of the luminance range) from the
// last extreme, in the opposite direction to the transition before it: a slow change counts the
// same as a sudden one, and wobbles smaller than the threshold never count. Then slide a
// FLASH_WINDOW_MS window along and take the most transitions any window holds. The limit is
// FLASH_MAX_CHANGES (3). This is stricter than WCAG itself, which allows three flashes, each a
// pair of opposing changes (six changes), and only counts pairs whose darker side is below 0.80.

import { FLASH_THRESHOLD, FLASH_WINDOW_MS } from "./constants";

/** The times (ms) of each transition in a series of luminance samples taken every `stepMs`. */
export function transitions(samples: readonly number[], stepMs: number, threshold = FLASH_THRESHOLD): number[] {
  const out: number[] = [];
  if (!samples.length) return out;
  let lo = samples[0]!;
  let hi = samples[0]!;
  // 0: no transition yet; -1: the last went up (now tracking the high, looking for a fall); 1: the reverse.
  let looking: -1 | 0 | 1 = 0;
  let ref = samples[0]!;
  for (let i = 1; i < samples.length; i++) {
    const v = samples[i]!;
    const t = i * stepMs;
    if (looking === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= threshold) {
        out.push(t);
        looking = -1;
        ref = v;
      } else if (hi - v >= threshold) {
        out.push(t);
        looking = 1;
        ref = v;
      }
    } else if (looking === -1) {
      ref = Math.max(ref, v);
      if (ref - v >= threshold) {
        out.push(t);
        looking = 1;
        ref = v;
      }
    } else {
      ref = Math.min(ref, v);
      if (v - ref >= threshold) {
        out.push(t);
        looking = -1;
        ref = v;
      }
    }
  }
  return out;
}

/** The most transitions any window of `windowMs` holds (a window is (t − windowMs, t]). */
export function mostInWindow(times: readonly number[], windowMs = FLASH_WINDOW_MS): number {
  let most = 0;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end]! - times[start]! >= windowMs) start++;
    most = Math.max(most, end - start + 1);
  }
  return most;
}
