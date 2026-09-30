// External stations' streams in mock mode (follow-up Phase 6): up unless put down from the console
// or a Playwright flow (`ocMock.externalDown("COLT")`, `ocMock.externalUp("COLT")`). Down, a station
// stays on the dial for its first 5 minutes, then it's off the dial, the guide, search and the
// swipe order until it's back, as the API's minute checks do. Kept in localStorage, so a reload
// keeps it; the dial reads it on each request.

import { now } from "../lib/clock";
import { stationByRef } from "./fixtures/stations";

const KEY = "oc-mock-external-down";
/** Down this long, off the dial (the API's DOWN_AFTER_MS). */
export const DOWN_AFTER_MS = 5 * 60_000;

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function write(down: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(down));
  } catch {
    // Private mode: the outage lasts until the page reloads.
  }
}

/** Since when a station's stream has been down, or null while it's up. */
export function downSince(stationId: string): Date | null {
  const at = read()[stationId];
  return at ? new Date(at) : null;
}

/** Off the dial: down 5 minutes or more. */
export function hiddenExternal(stationId: string, t: Date = now()): boolean {
  const since = downSince(stationId);
  return !!since && t.getTime() - since.getTime() >= DOWN_AFTER_MS;
}

/** Puts a station's stream down, `minutesAgo` minutes ago (5 or more takes it off the dial at once). */
export function externalDown(station: string, minutesAgo = 0) {
  const s = stationByRef(station);
  if (!s || s.ident.kind !== "listed") throw new Error(`${station} isn't an external station`);
  write({ ...read(), [s.ident.id]: new Date(now().getTime() - minutesAgo * 60_000).toISOString() });
}

/** Its stream is back: on the dial again. */
export function externalUp(station: string) {
  const s = stationByRef(station);
  if (!s) return;
  const { [s.ident.id]: _gone, ...rest } = read();
  write(rest);
}
