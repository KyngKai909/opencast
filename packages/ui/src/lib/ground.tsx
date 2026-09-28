// The two grounds. Dark is the default; light follows the system setting; a person can override
// either, and the choice is remembered on the device (the style guide's "oc-ground").

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Ground = "dark" | "light";
export type GroundChoice = Ground | "system";

const STORAGE_KEY = "oc-ground";

interface GroundState {
  /** What's on screen now. */
  ground: Ground;
  /** What the person chose: a ground, or the system's. */
  choice: GroundChoice;
  setChoice(choice: GroundChoice): void;
}

const GroundContext = createContext<GroundState | null>(null);

function readChoice(): GroundChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}

function systemGround(): Ground {
  // Dark unless the system asks for light: dark is the default when there's no preference.
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Keeps `data-theme` on <html> in step with the person's choice. With "system" the attribute is
 * removed and tokens.css follows the media query.
 */
export function GroundProvider({ children, root }: { children: ReactNode; root?: HTMLElement }) {
  const [choice, setChoiceState] = useState<GroundChoice>(() => (typeof window === "undefined" ? "system" : readChoice()));
  const [system, setSystem] = useState<Ground>(() => systemGround());

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystem(mq.matches ? "light" : "dark");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const el = root ?? document.documentElement;
    if (choice === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", choice);
  }, [choice, root]);

  const setChoice = useCallback((next: GroundChoice) => {
    setChoiceState(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private windows); the choice still holds for this visit.
    }
  }, []);

  const value = useMemo<GroundState>(
    () => ({ ground: choice === "system" ? system : choice, choice, setChoice }),
    [choice, system, setChoice]
  );
  return <GroundContext.Provider value={value}>{children}</GroundContext.Provider>;
}

export function useGround(): GroundState {
  const ctx = useContext(GroundContext);
  if (!ctx) throw new Error("useGround needs a GroundProvider above it");
  return ctx;
}
