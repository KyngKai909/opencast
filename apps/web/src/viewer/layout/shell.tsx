// Pages tell the shell how to frame them: padded or edge to edge, tabs or a back bar, their own
// top bar (the full player). The shell reads it here.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

/** Phone or web, by the width the frames draw (phones at 390). */
export function useIsPhone(): boolean {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}
