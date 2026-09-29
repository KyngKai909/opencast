// The time the desk shows. In mock mode it starts at the reference's moment (Saturday, September
// 26, 8:42 pm in the Inland Empire, as the other apps' mocks) and runs on from there.

import { config } from "../config";

const started = Date.now();

/** Mock mode only: `?clock=<ISO time>` starts the clock there instead. Read once, at load. */
function fromAddress(): number | null {
  if (!config.mock || typeof window === "undefined") return null;
  const t = Date.parse(new URLSearchParams(window.location.search).get("clock") ?? "");
  return Number.isNaN(t) ? null : t;
}

const pinned = config.mock ? (fromAddress() ?? (config.mockClock ? Date.parse(config.mockClock) : null)) : null;

export function now(): Date {
  return pinned === null ? new Date() : new Date(pinned + (Date.now() - started));
}

/** The market's time zone, until a screen has the market's own (Market.timezone). */
export const DEFAULT_TZ = "America/Los_Angeles";
