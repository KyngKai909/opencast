/**
 * ThemeProvider — the daypart theming engine.
 *
 * Modes: "day" | "dusk" | "night" (manual) and "auto" (follows the local hour,
 * re-evaluated every minute WITHOUT reload). Smooth drift between modes is done
 * in CSS (transitions on themed properties). Choice is persisted in a COOKIE —
 * never localStorage — and defaults to Auto, falling back to Night.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type DaypartMode = "day" | "dusk" | "night";
export type ThemePref = DaypartMode | "auto";

const COOKIE = "opencast_mode";
const DAYPARTS: DaypartMode[] = ["day", "dusk", "night"];

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").reduce((acc, c) => {
    const [k, v] = c.split("=");
    return k === name ? decodeURIComponent(v ?? "") : acc;
  }, "");
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/** Local-hour daypart: day 06–16, dusk 17–19, night 20–05. */
export function daypartNow(date = new Date()): DaypartMode {
  const h = date.getHours();
  if (h >= 6 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

function readInitialPref(): ThemePref {
  const stored = readCookie(COOKIE);
  return stored === "day" || stored === "dusk" || stored === "night" || stored === "auto"
    ? (stored as ThemePref)
    : "auto";
}

interface ThemeContextValue {
  /** The user's preference, including "auto". */
  pref: ThemePref;
  /** The concrete daypart mode currently applied to the document. */
  mode: DaypartMode;
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readInitialPref);
  const [mode, setMode] = useState<DaypartMode>(() =>
    pref === "auto" ? daypartNow() : pref
  );

  // Apply the resolved mode to the root element.
  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
  }, [mode]);

  // Keep the resolved mode in sync with the preference, and — in auto — with the
  // clock: re-evaluate every minute so the network drifts through the dayparts.
  useEffect(() => {
    if (pref !== "auto") {
      setMode(pref);
      return;
    }
    setMode(daypartNow());
    const id = window.setInterval(() => setMode(daypartNow()), 60_000);
    return () => window.clearInterval(id);
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    writeCookie(COOKIE, next);
    setPrefState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ pref, mode, setPref }), [pref, mode, setPref]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider.");
  return ctx;
}

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "dusk", label: "Dusk" },
  { value: "night", label: "Night" },
  { value: "auto", label: "Auto" }
];

export const DAYPART_LABELS = DAYPARTS;
