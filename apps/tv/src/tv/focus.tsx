// Spatial navigation with the D-pad (Norigin). Every input (the TV's remote, a phone over Cast,
// the iPhone bridge) arrives as a command, so Norigin's own key handling is switched off and the
// dispatcher moves focus with `moveFocus`. Norigin has no programmatic "press OK", so each
// focusable registers what OK does, and `pressFocused` runs it. One focus ring at a time.

import { useEffect, type RefObject } from "react";
import { FocusContext, getCurrentFocusKey, init, navigateByDirection, setFocus, setKeyMap, useFocusable, type UseFocusableConfig } from "@noriginmedia/norigin-spatial-navigation";

let started = false;
export function startFocus() {
  if (started) return;
  started = true;
  init({ throttle: 0, shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true } });
  // Keys come through the input adapters, never straight to Norigin.
  setKeyMap({ left: [], up: [], right: [], down: [], enter: [] });
}

const onOk = new Map<string, () => void>();

export function moveFocus(dir: "up" | "down" | "left" | "right") {
  void navigateByDirection(dir, {});
}

/** OK on whatever has focus. Returns false when nothing focused takes OK. */
export function pressFocused(): boolean {
  const run = onOk.get(getCurrentFocusKey());
  if (!run) return false;
  run();
  return true;
}

export function focusKey(key: string) {
  void setFocus(key);
}

export { FocusContext };

/**
 * A focusable control. `onSelect` is what OK does. Focus shows as the ring (`.tv-focus`, set by
 * the caller from `focused`), and the DOM node is focused too, for screen readers.
 */
export function useTvFocusable<E extends HTMLElement = HTMLDivElement>(o: { focusKey?: string; onSelect?: () => void; onFocus?: () => void; focusable?: boolean; trackChildren?: boolean; saveLastFocusedChild?: boolean; isFocusBoundary?: boolean; autoFocus?: boolean } = {}) {
  const config: UseFocusableConfig<object> = {
    focusKey: o.focusKey,
    focusable: o.focusable ?? true,
    trackChildren: o.trackChildren,
    saveLastFocusedChild: o.saveLastFocusedChild,
    isFocusBoundary: o.isFocusBoundary,
    onFocus: o.onFocus ? () => o.onFocus?.() : undefined
  };
  const f = useFocusable<object, E>(config);
  useEffect(() => {
    if (!o.onSelect) return;
    onOk.set(f.focusKey, o.onSelect);
    return () => {
      onOk.delete(f.focusKey);
    };
  }, [f.focusKey, o.onSelect]);
  useEffect(() => {
    if (o.autoFocus) f.focusSelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref: f.ref as RefObject<E>, focused: f.focused, focusKey: f.focusKey, focusSelf: f.focusSelf, hasFocusedChild: f.hasFocusedChild };
}
