// Pages tell the shell how to frame them: padded or edge to edge, tabs or a back bar, their own
// top bar (the full player). The shell reads it here.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isNative } from "../native/platform";

export interface ShellOptions {
  padded?: boolean;
  /** Phone: hide the four tabs (settings sections, sign-in). */
  tabs?: boolean;
  /** Phone: a back bar in place of the top bar. */
  back?: { title: ReactNode; href?: string; onBack?: () => void };
  /** Phone: replaces the top bar (the full player's). */
  top?: ReactNode;
  /** Hide the player bar or mini player (the tuned-in page is the player). */
  player?: boolean;
  /** Phone and tablet: the page is the picture (the swipe home), full bleed under the floating bar. */
  picture?: boolean;
  /** The floating bar fades with the picture's buttons (landscape, after 3 seconds). */
  barHidden?: boolean;
  /** No floating bar (a phone on its side). */
  noBar?: boolean;
}

const Ctx = createContext<{ options: ShellOptions; set: (o: ShellOptions) => void } | null>(null);

export function ShellOptionsProvider({ children }: { children: ReactNode }) {
  const [options, set] = useState<ShellOptions>({});
  return <Ctx.Provider value={{ options, set }}>{children}</Ctx.Provider>;
}

/** A page calls this to frame itself; the options reset when it leaves. */
export function useShellOptions(o: ShellOptions) {
  const c = useContext(Ctx)!;
  const key = JSON.stringify({ ...o, back: o.back ? { title: typeof o.back.title === "string" ? o.back.title : "", href: o.back.href } : undefined, top: !!o.top });
  useEffect(() => {
    c.set(o);
    return () => c.set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useShellState(): ShellOptions {
  return useContext(Ctx)!.options;
}

/** Whether a media query matches, kept current. */
function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Phones by the width the frames draw (390), any window that narrow, and a touch phone on its side (no taller than 600). */
const PHONE_Q = "(max-width: 767px), (hover: none) and (pointer: coarse) and (max-height: 600px)";
/** A tablet: a touch screen with no hover (iPad, Android tablets), in a browser or the app. */
const TOUCH_Q = "(hover: none) and (pointer: coarse)";

export type ViewerLayout = "phone" | "tablet" | "web";

/**
 * Which viewer the device gets (A245): phones and tablets, in the app or a browser, get the swipe
 * home and the floating bar; a computer's browser gets the web shell and the dial page. TV mode is
 * its own app.
 */
export function useViewerLayout(): ViewerLayout {
  const phone = useMedia(PHONE_Q);
  const touch = useMedia(TOUCH_Q);
  return phone ? "phone" : touch || isNative() ? "tablet" : "web";
}

/**
 * The phone and tablet viewer (the phone shell, sheets, the swipe home), or the web's. Named for
 * the phone, which it was first; tablets share it (A245).
 */
export function useIsPhone(): boolean {
  return useViewerLayout() !== "web";
}

/** On its side: wider than tall. */
export function useLandscape(): boolean {
  return useMedia("(orientation: landscape)");
}
