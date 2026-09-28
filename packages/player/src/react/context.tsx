import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PlayerEngine, type EngineOptions, type PlayerState } from "../engine/PlayerEngine";
import { startInputs, type InputAdapter } from "../input/types";

const EngineContext = createContext<PlayerEngine | null>(null);

export interface PlayerProviderProps {
  /** Pass an engine to share one (the Cast receiver makes its own); otherwise one is made from `options`. */
  engine?: PlayerEngine;
  options?: EngineOptions;
  /** Inputs to listen to while mounted: keyboard or remote, Cast, the bridge, the lock screen. */
  inputs?: InputAdapter[];
  children: ReactNode;
}

/** Makes the player available below it, and connects its inputs. */
export function PlayerProvider({ engine, options, inputs = [], children }: PlayerProviderProps) {
  // An engine of its own lives exactly as long as the mount: made in an effect and destroyed in
  // its cleanup, so a remount (React's StrictMode does one in development) gets a fresh one.
  const [own, setOwn] = useState<PlayerEngine | null>(null);
  useEffect(() => {
    if (engine) return;
    const made = new PlayerEngine(options);
    setOwn(made);
    return () => {
      made.destroy();
      setOwn((current) => (current === made ? null : current));
    };
  }, [engine, options]);
  const e = engine ?? own;
  useEffect(() => (e ? startInputs(inputs, (command, source) => e.handle(command, source)) : undefined), [e, inputs]);
  if (!e) return null;
  return <EngineContext.Provider value={e}>{children}</EngineContext.Provider>;
}

export function usePlayerEngine(): PlayerEngine {
  const e = useContext(EngineContext);
  if (!e) throw new Error("usePlayer needs a PlayerProvider above it");
  return e;
}

/** The player's state, and the engine to act on it. */
export function usePlayer(): [PlayerState, PlayerEngine] {
  const e = usePlayerEngine();
  const state = useSyncExternalStore(e.subscribe, e.getState, e.getState);
  return [state, e];
}
