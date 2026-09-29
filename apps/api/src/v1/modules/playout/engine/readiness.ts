// The readiness check: is everything on a station's log prepared, in every rendition its band airs?
// The worker checks the next 48 hours of every station's log every hour (and queues what isn't),
// warns the station and the Network desk about anything not ready an hour before it airs, and the
// log's usual fill airs in its place if it's still missing at air time. Master control's Monitor
// reads the same answer for one station.

import { inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { BAND_RENDITIONS, type Band } from "./ladder.js";
import { refKey } from "./prepare.js";

export interface LogItemReadiness {
  entryId: string;
  itemId: string;
  title: string;
  airsAt: Date;
  key: string | null;
  ready: boolean;
  /** queued, preparing, failed, or null when it was never asked for. */
  status: string | null;
}

/** Which prepared keys are ready in every rendition of a band. */
export async function readyKeys({ deps }: ModuleContext, keys: string[], band: Band): Promise<{ ready: Set<string>; status: Map<string, string> }> {
  const unique = [...new Set(keys)];
  if (!unique.length) return { ready: new Set(), status: new Map() };
  const [renditions, items] = await Promise.all([
    deps.db.select({ key: schema.preparedRenditions.key, rendition: schema.preparedRenditions.rendition }).from(schema.preparedRenditions).where(inArray(schema.preparedRenditions.key, unique)),
    deps.db.select({ key: schema.preparedItems.key, status: schema.preparedItems.status }).from(schema.preparedItems).where(inArray(schema.preparedItems.key, unique))
  ]);
  const have = new Map<string, Set<string>>();
  for (const r of renditions) have.set(r.key, (have.get(r.key) ?? new Set()).add(r.rendition));
  const ready = new Set(unique.filter((k) => BAND_RENDITIONS[band].every((r) => have.get(k)?.has(r))));
  return { ready, status: new Map(items.map((i) => [i.key, i.status])) };
}

/** The items on a station's log between two times, and whether each is prepared. */
export async function logReadiness(ctx: ModuleContext, stationId: string, band: Band, from: Date, to: Date): Promise<LogItemReadiness[]> {
  const { services } = ctx;
  const entries = (await services.log.entries(stationId, from, to)).filter((e) => e.assetId && e.kind === "program" && e.startsAt < to && e.endsAt > from);
  const items = await services.library.itemsByIds(entries.map((e) => e.assetId!));
  const keys = new Map(entries.map((e) => [e.id, (() => { const i = items.get(e.assetId!); return i ? refKey(i) : null; })()]));
  const { ready, status } = await readyKeys(ctx, [...keys.values()].filter((k): k is string => Boolean(k)), band);
  return entries.map((e) => {
    const key = keys.get(e.id) ?? null;
    return { entryId: e.id, itemId: e.assetId!, title: items.get(e.assetId!)?.title ?? "An item", airsAt: e.startsAt, key, ready: Boolean(key && ready.has(key)), status: key ? (status.get(key) ?? null) : null };
  });
}
