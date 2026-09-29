// The time the app shows. In mock mode it starts at the reference frames' moment (Saturday,
// September 26, 8:42:12 pm in the Inland Empire) and runs on from there, so every screen reads like
// its frame: the viewer's at the minute, master control's clock with its seconds.

import { useEffect, useState } from "react";
import { config } from "../config";

const started = Date.now();

/**
 * Mock mode only: `?clock=<ISO time>` in the address starts the clock there instead, to open a
 * frame drawn at another moment (live-listings 02.1 stands by at Sunday 6:57:46 pm:
 * `?clock=2026-09-28T01:57:46Z`). Read once, when the app loads.
 */
function fromAddress(): number | null {
  if (!config.mock || typeof window === "undefined") return null;
  const t = Date.parse(new URLSearchParams(window.location.search).get("clock") ?? "");
  return Number.isNaN(t) ? null : t;
}

const pinned = config.mock ? (fromAddress() ?? (config.mockClock ? Date.parse(config.mockClock) : null)) : null;

export function now(): Date {
  return pinned === null ? new Date() : new Date(pinned + (Date.now() - started));
}

/** The market's time zone. One market for now; the API will say per market. */
export const MARKET_TZ = "America/Los_Angeles";

/** The station's time zone (master control). One market for now; the API says per market. */
export const STATION_TZ = MARKET_TZ;

/** The desk's, until a screen has the market's own (Market.timezone). */
export const DEFAULT_TZ = MARKET_TZ;

/** Re-renders every `ms` with the current time. */
export function useNow(ms = 15_000): Date {
  const [t, setT] = useState(now);
  useEffect(() => {
    const i = setInterval(() => setT(now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}
