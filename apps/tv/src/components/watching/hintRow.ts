// The hint row teaches the remote, then gets out of the way: after a week of use the key hints
// hide themselves (device-local: the first day this TV was used). The "Playing from…" and
// "Mirrored from…" chips never hide: on cast and mirror they're the only way to know where the
// controls are. A Cast receiver keeps nothing, so there it never hides. Behind live (paused, or
// playing after a pause), the remote's "Hold OK, Back to live" joins them, and doesn't hide: it's
// the only way a remote has back to live, and it's seldom needed.

import type { Hint } from "@opencast/player";

export const WEEK_MS = 7 * 86_400_000;
const KEY = "oc-tv-first-use";

/** Whether a week has passed since the first use. */
export function keyHintsHidden(firstUse: number | null, now: number): boolean {
  return firstUse !== null && now - firstUse >= WEEK_MS;
}

/** The hints to draw: chips always, key hints until the week is up. */
export function visibleHints(hints: Hint[], hidden: boolean): Hint[] {
  return hidden ? hints.filter((h) => h.kind === "chip") : hints;
}

export function readFirstUse(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Notes the first use (once). */
export function recordFirstUse(now: number) {
  try {
    if (readFirstUse() === null) localStorage.setItem(KEY, String(now));
  } catch {
    /* storage off: the hints stay */
  }
}

/** The remote's way back to live: holding OK on the picture. */
export const LIVE_HINT: Hint = { kind: "key", key: "OK", label: "Back to live", hold: true };

/** The hints to draw, with "Hold OK, Back to live" last while behind live on a remote. */
export function hintsFor(hints: Hint[], o: { hidden: boolean; behindLive: boolean; remote: boolean }): Hint[] {
  const shown = visibleHints(hints, o.hidden);
  return o.behindLive && o.remote ? [...shown, LIVE_HINT] : shown;
}
