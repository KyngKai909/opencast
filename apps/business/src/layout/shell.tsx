// Pages tell the shell how to frame them: edge to edge (settings), and on the phone the page's
// own title in the top bar.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface ShellOptions {
  /** Main area without padding. */
  flush?: boolean;
  /** Phone: the page's title in the top bar ("Balance", "Spots"). */
  title?: string;
}

const Ctx = createContext<{ options: ShellOptions; set: (o: ShellOptions) => void } | null>(null);

export function ShellOptionsProvider({ children }: { children: ReactNode }) {
  const [options, set] = useState<ShellOptions>({});
  return <Ctx.Provider value={{ options, set }}>{children}</Ctx.Provider>;
}

/** A page calls this to frame itself; the options reset when it leaves. */
export function useShellOptions(o: ShellOptions) {
  const c = useContext(Ctx)!;
  const key = JSON.stringify(o);
  useEffect(() => {
    c.set(o);
    return () => c.set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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
