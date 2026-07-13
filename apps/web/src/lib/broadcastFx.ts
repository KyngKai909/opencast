/**
 * BroadcastFX — the retro interaction layer as gated, reusable utilities.
 * Every effect is a no-op under prefers-reduced-motion, fires on a real event
 * (never looped), and self-cleans on animationend.
 */
import { useCallback, useRef } from "react";

export type FxName = "channel-switch" | "tune-in" | "go-live";
const FX_CLASSES = ["fx-channel-switch", "fx-tune-in", "fx-go-live"];

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fire a BroadcastFX animation on an element. No-op when reduced motion is set. */
export function fireFx(el: HTMLElement | null, name: FxName): void {
  if (!el || prefersReducedMotion()) return;
  const cls = `fx-${name}`;
  FX_CLASSES.forEach((c) => el.classList.remove(c));
  // Force reflow so re-adding the same class restarts the animation.
  void el.offsetWidth;
  el.classList.add(cls);
  const cleanup = () => el.classList.remove(cls);
  el.addEventListener("animationend", cleanup, { once: true });

  // channel-switch also runs a scanline sweep on the same element.
  if (name === "channel-switch") {
    el.classList.add("fx-sweep", "fx-sweep-run");
    window.setTimeout(() => el.classList.remove("fx-sweep-run"), 560);
  }
}

/**
 * Hook: returns a ref to attach to the FX target and a `fire(name)` callback.
 * Fire it from real events (channel change, stream mount, go-live).
 */
export function useBroadcastFx<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const fire = useCallback((name: FxName) => fireFx(ref.current, name), []);
  return { ref, fire };
}
