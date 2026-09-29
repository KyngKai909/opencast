// Preparation for air (prepare once, then assemble), in master control's words. Every item on the
// log is transcoded once into its band's renditions before it airs. The Monitor's "Right now" says
// how many of the next 48 hours' items are ready and names the first that isn't ("12 of 13 items
// ready for the next 48 hours; Late Crate, ep. 15 at 10:00 pm is being prepared"); a library
// item's "Prepared for air" says where its own preparation stands, in place of the old cache line.

import type { ItemHistory, PlayoutStatus } from "@opencast/contracts";
import { STATION_TZ } from "../../../lib/clock";
import { timeOn } from "./time";

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
}

/** The Monitor's readiness line; null when the log has no items in the next 48 hours (or the API doesn't say). */
export function readinessLine(r: PlayoutStatus["readiness"], now: number, tz = STATION_TZ): ReadinessLine | null {
  if (!r || r.items === 0) return null;
  const head = `${r.ready} of ${r.items} ${r.items === 1 ? "item" : "items"} ready for the next 48 hours`;
  const f = r.firstNotReady;
  if (!f) return { text: head, good: r.ready >= r.items, attention: false };
  const soon = Date.parse(f.airsAt) - now < HOUR;
  return { text: `${head}; ${f.title} at ${timeOn(f.airsAt, now, tz)} ${NOT_READY[f.status]}`, good: false, attention: f.status === "failed" || soon };
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
