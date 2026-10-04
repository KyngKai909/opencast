// Preparation for air (prepare once, then assemble), in master control's words. Every item on the
// log is transcoded once into its band's renditions before it airs. The Monitor's "Right now" says
// how many of the next 48 hours' items are ready and names the first that isn't ("12 of 13 items
// ready for the next 48 hours; Late Crate, ep. 15 at 10:00 pm is being prepared"), counting items,
// not log entries (G13), with the item named linked to its airing on the log; the pre-flight offers
// "Go to library" only when an item couldn't be prepared (G14); a library item's "Prepared for air"
// says where its own preparation stands, in place of the old cache line.

import type { ItemHistory, PlayoutStatus, SignOnCheck } from "@opencast/contracts";
import { STATION_TZ } from "../../../lib/clock";
import { broadcastDay, isoDate, timeOn } from "./time";

type Readiness = NonNullable<PlayoutStatus["readiness"]>;
type NotReady = NonNullable<Readiness["firstNotReady"]>;
export type PreparationStatus = NonNullable<ItemHistory["preparation"]>["status"];

const HOUR = 3_600_000;

/** How the first item not ready reads, by its status. */
const NOT_READY: Record<NotReady["status"], string> = {
  queued: "is being prepared",
  preparing: "is being prepared",
  failed: "couldn't be prepared",
  not_asked: "isn't prepared yet"
};

export interface ReadinessLine {
  /** "12 of 13 items ready for the next 48 hours; Late Crate, ep. 15 at 10:00 pm is being prepared" */
  text: string;
  /** Everything ready. */
  good: boolean;
  /** Needs attention (standby): an item couldn't be prepared, or one airs within the hour and isn't ready. */
  attention: boolean;
  /** The line in parts, so the Monitor can link the item named to its airing on the log (G13). */
  parts: { head: string; item: { title: string; entryId: string | null; airsAt: string; rest: string } | null };
}

/** The Monitor's readiness line; null when the log has no items in the next 48 hours (or the API doesn't say). */
export function readinessLine(r: PlayoutStatus["readiness"], now: number, tz = STATION_TZ): ReadinessLine | null {
  if (!r || r.items === 0) return null;
  const head = `${r.ready} of ${r.items} ${r.items === 1 ? "item" : "items"} ready for the next 48 hours`;
  const f = r.firstNotReady;
  if (!f) return { text: head, good: r.ready >= r.items, attention: false, parts: { head, item: null } };
  const soon = Date.parse(f.airsAt) - now < HOUR;
  // G14: a later item that couldn't be prepared needs attention too, not only the first named.
  const failed = f.status === "failed" || (r.failed ?? 0) > 0;
  const rest = ` at ${timeOn(f.airsAt, now, tz)} ${NOT_READY[f.status]}`;
  return {
    text: `${head}; ${f.title}${rest}`,
    good: false,
    attention: failed || soon,
    parts: { head, item: { title: f.title, entryId: f.entryId ?? null, airsAt: f.airsAt, rest } }
  };
}

/**
 * Where the log shows an airing (G13): the Schedule's Log (A246) on its broadcast day, which shows
 * the whole day, with the entry picked out (`?entry=`).
 */
export function logEntryHref(base: string, entryId: string, airsAt: string, tz = STATION_TZ): string {
  const q = new URLSearchParams({ day: isoDate(broadcastDay(airsAt, tz)), entry: entryId });
  return `${base}/schedule?${q}`;
}

/**
 * The pre-flight's fix for "Items prepared for air" (G14): only when an item couldn't be prepared
 * (its file needs replacing), the library item to replace it on. Nothing to do while items are
 * still being prepared.
 */
export function preparedFixHref(check: Pick<SignOnCheck, "key" | "passed" | "preparation">, libraryBase: string): string | null {
  if (check.key !== "items_prepared" || check.passed) return null;
  const f = check.preparation?.firstFailed;
  return check.preparation?.failed && f ? `${libraryBase}/library/items/${f.itemId}` : null;
}

/** A library item's preparation, in the history's words. Null when nothing has asked for it yet. */
export function preparationWords(status: PreparationStatus | undefined): string | null {
  switch (status) {
    case "ready":
      return "Prepared for air";
    case "queued":
    case "preparing":
      return "Being prepared";
    case "failed":
      return "Couldn't be prepared";
    default:
      return null;
  }
}
