// The time the app shows. In mock mode it starts at the reference frames' moment (Saturday,
// 8:42 pm) and runs on from there, so every screen reads like its frame.

import { useEffect, useState } from "react";
import { config } from "../config";

const started = Date.now();
const pinned = config.mock && config.mockClock ? Date.parse(config.mockClock) : null;

export function now(): Date {
  return pinned === null ? new Date() : new Date(pinned + (Date.now() - started));
}

/** The market's time zone. One market for now; the API will say per market. */
export const MARKET_TZ = "America/Los_Angeles";

/** Re-renders every `ms` with the current time. */
export function useNow(ms = 15_000): Date {
  const [t, setT] = useState(now);
  useEffect(() => {
    const i = setInterval(() => setT(now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}
