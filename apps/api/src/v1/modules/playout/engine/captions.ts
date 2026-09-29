// Which prepared captions go with each row of a channel's timeline (X2). The item's own caption
// track (the library's, by content ID: `trackIds`) when it has been prepared; else the track embedded in the
// file; else one generated from speech; else none, and the subtitle playlist carries empty WebVTT
// segments over the row so its timeline stays whole. Captions prepared after a row started don't
// go with it (a published segment never changes): the item's next airing has them. The API (the
// subtitle playlist) and the worker (translators that draw captions in) read the same answer.

import { inArray } from "drizzle-orm";
import { schema, type Db } from "@opencast/db";

const PC = schema.preparedCaptions;

export interface CaptionSource {
  key: string;
  /** The folder under `prepared/<key>/` its segments are in. */
  rendition: string;
  /** How many segments were cut (the item's, in the TV band's reference rendition). */
  segments: number;
  language: string | null;
}

export interface CaptionRow {
  id: string;
  kind: string;
  preparedKey: string | null;
  assetId: string | null;
  startsAt: Date;
}

/** The captions for each row that has some, by row ID. */
export async function captionSources(db: Db, trackIds: (itemIds: string[]) => Promise<Map<string, string>>, rows: CaptionRow[]): Promise<Map<string, CaptionSource>> {
  const prepared = rows.filter((r) => r.kind === "prepared" && r.preparedKey && !r.preparedKey.startsWith("slate-"));
  if (!prepared.length) return new Map();
  const keys = [...new Set(prepared.map((r) => r.preparedKey!))];
  const assetIds = [...new Set(prepared.map((r) => r.assetId).filter((a): a is string => Boolean(a)))];
  const [made, trackOf] = await Promise.all([db.select().from(PC).where(inArray(PC.key, keys)), trackIds(assetIds)]);
  const byKey = new Map<string, typeof made>();
  for (const m of made) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const out = new Map<string, CaptionSource>();
  for (const row of prepared) {
    const list = byKey.get(row.preparedKey!)?.filter((m) => m.preparedAt.getTime() <= row.startsAt.getTime());
    if (!list?.length) continue;
    const own = row.assetId ? trackOf.get(row.assetId) : null;
    const pick = (own && list.find((m) => m.contentId === own)) || list.find((m) => m.source === "embedded") || list.find((m) => m.source === "generated");
    if (pick) out.set(row.id, { key: pick.key, rendition: pick.rendition, segments: pick.segments, language: pick.language });
  }
  return out;
}
