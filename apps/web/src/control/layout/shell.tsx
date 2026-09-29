// Pages tell the shell how to frame them: edge to edge (settings, the studio view), and on the
// phone the quiet line after the call sign and the actions pinned under the page.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface ShellOptions {
  /** Main area without padding. */
  flush?: boolean;
  /** Phone: the line after the call sign ("Master control", "Go live", "24:10 in"). */
  context?: ReactNode;
  /** Phone: the actions pinned under the page (Cue a break, Sign off). */
  actions?: ReactNode;
  /** Phone: the tally reads standby before a live block (going live from a phone). */
  tally?: "lit" | "standby" | "unlit";
}

const Ctx = createContext<{ options: ShellOptions; set: (o: ShellOptions) => void } | null>(null);

export function ShellOptionsProvider({ children }: { children: ReactNode }) {
  const [options, set] = useState<ShellOptions>({});
  return <Ctx.Provider value={{ options, set }}>{children}</Ctx.Provider>;
}

/** A page calls this to frame itself; the options reset when it leaves. `deps` re-applies them. */
export function useShellOptions(o: ShellOptions, deps: unknown[] = []) {
  const c = useContext(Ctx)!;
  const key = JSON.stringify({ flush: o.flush, tally: o.tally, context: typeof o.context === "string" ? o.context : !!o.context, actions: !!o.actions });
  useEffect(() => {
    c.set(o);
    return () => c.set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
}

export function useShellState(): ShellOptions {
  return useContext(Ctx)!.options;
}

/** Phone or web, by the width the frames draw (phones at 406). */
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
