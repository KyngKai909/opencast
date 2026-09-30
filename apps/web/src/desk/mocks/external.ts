// External stations' health on the mocks (follow-up Phase 6). There's no worker checking streams
// here, so time moves it on when the desk asks (a stream down 5 minutes leaves the dial, a new
// listing is checked after a minute), and mock mode puts a listing down or back up for demos
// (`ocMock.externalDown("COLT", 6)`, `ocMock.externalUp("COLT")` in the browser console).
// A215: what the desk does to a listing (changed so it waits for evidence, taken off the dial for
// good, put back) reaches the viewer's mock dial by call sign ("oc-mock-external-off").

import { now } from "../../lib/clock";
import type { DbListed } from "./fixtures/listed";
import { getDb, newId, saveDb, stationById } from "./db";

const MIN = 60_000;
/** Down this long, a listing leaves the dial (the API's DOWN_AFTER_MS). */
export const DOWN_AFTER_MS = 5 * MIN;

/** The listing whose station has this call sign. */
function byCallSign(callSign: string): DbListed | undefined {
  const cs = callSign.trim().toUpperCase();
  return getDb().listed.find((l) => stationById(l.stationId)?.ident.callSign === cs);
}

/**
 * What the minute's checks would have done by now: a listing down 5 minutes is hidden (its outage
 * says when), and one added more than a minute ago with its evidence in place is checked and up.
 */
export function advanceHealth(at: Date = now(), mayPlay: (l: DbListed) => boolean = () => true): void {
  let changed = false;
  for (const l of getDb().listed) {
    if (l.health.state === "down" && l.health.since && at.getTime() - Date.parse(l.health.since) >= DOWN_AFTER_MS) {
      const hiddenAt = new Date(Date.parse(l.health.since) + DOWN_AFTER_MS).toISOString();
      l.health = { ...l.health, state: "hidden", lastCheckedAt: at.toISOString() };
      const open = l.outages.find((o) => !o.backAt);
      if (open && !open.hiddenAt) open.hiddenAt = hiddenAt;
      changed = true;
    }
    if (l.health.state === "unchecked" && l.addedAt && at.getTime() - Date.parse(l.addedAt) >= MIN && mayPlay(l)) {
      l.health = { state: "up", since: at.toISOString(), lastCheckedAt: at.toISOString(), detail: null };
      changed = true;
    }
  }
  if (changed) saveDb();
}

/**
 * Mock mode: a listing's stream went down `minutesAgo` minutes ago (0: just now). Down 5 minutes or
 * more, it's off the dial. Returns false when no listing has that call sign.
 */
export function deskExternalDown(callSign: string, minutesAgo = 0, detail = "HTTP 503"): boolean {
  const l = byCallSign(callSign);
  if (!l) return false;
  const at = now();
  const downSince = new Date(at.getTime() - Math.max(0, minutesAgo) * MIN);
  const hidden = at.getTime() - downSince.getTime() >= DOWN_AFTER_MS;
  const hiddenAt = hidden ? new Date(downSince.getTime() + DOWN_AFTER_MS).toISOString() : null;
  const open = l.outages.find((o) => !o.backAt);
  if (open) Object.assign(open, { downSince: downSince.toISOString(), hiddenAt, detail });
  else l.outages.unshift({ id: newId(), downSince: downSince.toISOString(), hiddenAt, backAt: null, detail });
  l.health = { state: hidden ? "hidden" : "down", since: downSince.toISOString(), lastCheckedAt: at.toISOString(), detail };
  saveDb();
  return true;
}

/** Mock mode: a listing's stream is back. Its outage closes and it's on the dial again. */
export function deskExternalUp(callSign: string): boolean {
  const l = byCallSign(callSign);
  if (!l) return false;
  const at = now().toISOString();
  for (const o of l.outages) if (!o.backAt) o.backAt = at;
  l.health = { state: "up", since: at, lastCheckedAt: at, detail: null };
  saveDb();
  return true;
}

/** The viewer's mock reads this: call signs off the dial for something other than their stream ("removed" or "waiting"). */
export const EXTERNAL_OFF_KEY = "oc-mock-external-off";

/**
 * A215: tells the viewer's mock which external stations the desk has taken off the dial for good,
 * or has waiting for evidence after a change, so the viewer's dial, guide, search and station page
 * follow. `waitingOf` is the listed handler's (passed in to keep this file free of it).
 */
export function publishExternalOff(waiting: (l: DbListed) => string | null): void {
  const off: Record<string, "removed" | "waiting"> = {};
  for (const l of getDb().listed) {
    const cs = stationById(l.stationId)?.ident.callSign;
    if (!cs) continue;
    if (l.removed) off[cs] = "removed";
    else if (waiting(l) && waiting(l) !== "down") off[cs] = "waiting";
  }
  try {
    localStorage.setItem(EXTERNAL_OFF_KEY, JSON.stringify(off));
    window.dispatchEvent(new Event("oc-mock-changed"));
  } catch {
    // Private mode, or no window (unit tests): the viewer's mock keeps its own world.
  }
}
