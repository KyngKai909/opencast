// A light haptic tick (A245; swipe home 08): when the drag crosses the detent and when it snaps.
// The apps tap Capacitor's Haptics (a light impact); browsers vibrate where they can (Android's);
// iPhone browsers have no way, so nothing. Off with reduced motion (the drag itself still works).

import { prefersReducedMotion } from "@opencast/player";
import { isNative } from "./platform";

/** How long a browser's vibration lasts, in ms: a tick, not a buzz. */
export const TICK_MS = 8;

let haptics: Promise<typeof import("@capacitor/haptics")> | null = null;

export function tick(): void {
  if (prefersReducedMotion()) return;
  if (isNative()) {
    haptics ??= import("@capacitor/haptics");
    void haptics.then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
    return;
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(TICK_MS);
  } catch {
    // A browser that won't vibrate now (no gesture yet, a frame): nothing to do.
  }
}
