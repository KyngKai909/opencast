// Preparation for air in the mocks (prepare once, then assemble): each item is transcoded once
// into its band's renditions (TV 1080p, 720p, 480p, 360p and audio only; radio AAC 128k and 64k),
// once something wants it on air. The Monitor's readiness (the next 48 hours of the log), the
// sign-on check `items_prepared` (the next 24) and a library item's history read it here.
//
// An item is prepared once its file is ready and its rights are confirmed, and something airs it
// (the log, or a break). Tonight BEAT's Late Crate, ep. 15 (10:00 pm) is still being prepared
// until 9:30 pm on the mock clock, so the Monitor has something to name.

import type { LibraryItem } from "@opencast/contracts";
import { dbStation, getDb, stationLog } from "./db";
import { at } from "./fixtures/time";

export type PreparationStatus = "ready" | "queued" | "preparing" | "failed" | "not_asked";

export interface Preparation {
  status: PreparationStatus;
  renditions: string[];
  preparedAt: string | null;
}

/** What each band airs, best first (the API's ladder). */
export const BAND_RENDITIONS = { tv: ["v1080", "v720", "v480", "v360", "a128"], radio: ["a128", "a64"] } as const;

/** Items still being prepared on the mock clock, until when. */
function stillPreparing(): Record<string, string> {
  return { "Late Crate, ep. 15": at("21:30") };
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Whether anything airs an item: an entry on a log, or a break's fill. */
function wanted(itemId: string): boolean {
  const db = getDb();
  return db.log.some((e) => e.itemId === itemId) || db.breaks.some((b) => b.fills.some((f) => f.itemId === itemId));
}

/** Where an item's preparation for air stands at `t` (ms). */
export function preparationOf(item: LibraryItem, t: number): Preparation {
  const band = dbStation(item.stationId)?.ident.band ?? (item.mediaKind === "audio" ? "radio" : "tv");
  const all = [...BAND_RENDITIONS[band === "radio" ? "radio" : "tv"]];
  if (item.status === "failed") return { status: "failed", renditions: [], preparedAt: null };
  if (item.status === "preparing") return { status: "queued", renditions: [], preparedAt: null };
  if (!item.rights || !wanted(item.id)) return { status: "not_asked", renditions: [], preparedAt: null };
  const until = stillPreparing()[item.title];
  if (until && Date.parse(until) > t) return { status: "preparing", renditions: all.slice(-2), preparedAt: null };
  const preparedAt = until ?? new Date(Math.min(t, Date.parse(item.createdAt) + 10 * MIN)).toISOString();
  return { status: "ready", renditions: all, preparedAt };
}

/** The items on a station's log between `from` and `to` (program entries with an item), and whether each is ready. */
function logItems(stationId: string, from: number, to: number) {
  const items = getDb().library.items;
  return stationLog(stationId, new Date(from).toISOString(), new Date(to).toISOString())
    .filter((e) => e.kind === "program" && e.itemId)
    .map((e) => {
      const item = items.find((i) => i.id === e.itemId);
      const prep = item ? preparationOf(item, from) : null;
      return { entry: e, title: item?.title ?? e.title, status: prep?.status ?? "not_asked" };
    });
}

/** PlayoutStatus.readiness: the next 48 hours, how many are ready, and the first that isn't. */
export function readinessOf(stationId: string, t: number) {
  const rows = logItems(stationId, t, t + 48 * HOUR);
  const notReady = rows.filter((r) => r.status !== "ready").sort((a, b) => a.entry.startsAt.localeCompare(b.entry.startsAt))[0];
  return {
    items: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    firstNotReady: notReady ? { itemId: notReady.entry.itemId!, title: notReady.title, airsAt: notReady.entry.startsAt, status: notReady.status as Exclude<PreparationStatus, "ready"> } : null
  };
}

/** The sign-on check `items_prepared` (never blocking): the next 24 hours, in the API's words. */
export function itemsPreparedCheck(stationId: string, t: number) {
  const rows = logItems(stationId, t, t + 24 * HOUR);
  const ready = rows.filter((r) => r.status === "ready").length;
  return {
    key: "items_prepared" as const,
    label: "Items prepared for air",
    passed: ready === rows.length,
    blocking: false,
    detail: rows.length ? `${ready} of ${rows.length} in the next 24 hours${ready < rows.length ? ". The rest are being prepared; anything not ready at air time airs station ID and bumpers" : ""}` : null
  };
}
