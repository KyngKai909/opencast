// One-off storage steps, run by scripts (report first, then for real; each safe to run again):
//
//   - prepareFromOriginals (`storage:prepare-from-originals`): items stored before 2026-09-29 point
//     at a copy capped at 1280 px wide, and were prepared from it. Each one whose original is still
//     stored has the original prepared, then its file moves to the original (a new file version),
//     and the copy goes (with what was prepared from it) once nothing points at it.
//   - relinkLocations (`storage:relink-locations`): files from before content IDs, keyed by where
//     they were (a disk path or URL; prepared as `loc-…`), are hashed, stored by content ID in
//     Infrequent Access, and their rows point at it. What was prepared under `loc-…` is carried
//     over to the content ID (the same bytes), so nothing is prepared again.
//   - copyPin (`storage:move-off-pinata --copy`): a Pinata pin copied into object storage and
//     verified by hash; every row that used the pin then points at the new content ID.
//
// None of them unpins or deletes anything but the 1280 px copies, which the originals replace.

import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "./context.js";
import { contentIdOf, objectKey, sha256FromCid } from "./storage.js";
import { BAND_RENDITIONS, type Band } from "./modules/playout/engine/ladder.js";
import { queuePreparation, refKey, wantRow } from "./modules/playout/engine/prepare.js";

const F = schema.assetFiles;
const A = schema.assets;
const PI = schema.preparedItems;
const PR = schema.preparedRenditions;
const PC = schema.preparedCaptions;

const seg = (i: number, ext: string) => `seg_${String(i).padStart(5, "0")}.${ext}`;

/** The bands a key is prepared for, in full. */
async function preparedBands(ctx: ModuleContext, key: string): Promise<Band[]> {
  const rows = await ctx.deps.db.select({ rendition: PR.rendition }).from(PR).where(eq(PR.key, key));
  const have = new Set(rows.map((r) => r.rendition));
  return (["tv", "radio"] as const).filter((band) => BAND_RENDITIONS[band].every((r) => have.has(r)));
}

/**
 * Carries what was prepared under one key over to another (the same bytes under a new name): each
 * rendition's playlist and segments and each caption track, copied inside the store, and their rows.
 * Renditions the new key has already are left. Returns the renditions carried.
 */
export async function carryPrepared(ctx: ModuleContext, fromKey: string, toKey: string): Promise<string[]> {
  const { db } = ctx.deps;
  const objects = ctx.deps.storage.objects;
  if (fromKey === toKey) return [];
  const [item] = await db.select().from(PI).where(eq(PI.key, fromKey));
  const renditions = await db.select().from(PR).where(eq(PR.key, fromKey));
  if (!item || !renditions.length) return [];
  const already = new Set((await db.select({ rendition: PR.rendition }).from(PR).where(eq(PR.key, toKey))).map((r) => r.rendition));
  const carried: string[] = [];
  for (const r of renditions) {
    if (already.has(r.rendition)) continue;
    const from = objectKey.prepared(fromKey, r.rendition);
    const to = objectKey.prepared(toKey, r.rendition);
    await objects.copy(`${from}/index.m3u8`, `${to}/index.m3u8`);
    for (let i = 0; i < r.segments; i++) await objects.copy(`${from}/${seg(i, "ts")}`, `${to}/${seg(i, "ts")}`);
    carried.push(r.rendition);
  }
  const captions = await db.select().from(PC).where(eq(PC.key, fromKey));
  const haveCaptions = new Set((await db.select({ contentId: PC.contentId }).from(PC).where(eq(PC.key, toKey))).map((c) => c.contentId));
  for (const c of captions) {
    if (haveCaptions.has(c.contentId)) continue;
    const from = objectKey.prepared(fromKey, c.rendition);
    const to = objectKey.prepared(toKey, c.rendition);
    for (const name of ["index.m3u8", "track.vtt"]) await objects.copy(`${from}/${name}`, `${to}/${name}`).catch(() => undefined);
    for (let i = 0; i < c.segments; i++) await objects.copy(`${from}/${seg(i, "vtt")}`, `${to}/${seg(i, "vtt")}`);
  }
  await db.transaction(async (tx) => {
    const all = [...new Set([...item.renditions, ...renditions.map((r) => r.rendition)])].sort();
    await tx
      .insert(PI)
      .values({ key: toKey, contentId: toKey, kind: "file", sourceLocation: null, mediaKind: item.mediaKind, status: "ready", renditions: all, durationMs: item.durationMs, neededAt: item.neededAt, prepMs: item.prepMs, bytes: item.bytes, preparedAt: item.preparedAt ?? ctx.deps.clock.now() })
      .onConflictDoUpdate({ target: PI.key, set: { renditions: sql`array(select distinct unnest(${PI.renditions} || excluded.renditions) order by 1)` } });
    for (const r of renditions) {
      if (already.has(r.rendition)) continue;
      await tx.insert(PR).values({ key: toKey, rendition: r.rendition, segments: r.segments, segmentMs: r.segmentMs, bytes: r.bytes, preparedAt: r.preparedAt }).onConflictDoNothing();
    }
    for (const c of captions) {
      if (haveCaptions.has(c.contentId)) continue;
      await tx.insert(PC).values({ ...c, key: toKey }).onConflictDoNothing();
    }
  });
  return carried;
}

// --- Rows keyed by location ----------------------------------------------------------

export type LocatedRow = { table: "asset_files" | "spot_files" | "order_files"; id: string; location: string; storage: string | null; ipfsCid: string | null };

/** Rows from before content IDs: a disk path or URL, no content ID. */
export async function locatedRows(ctx: ModuleContext): Promise<LocatedRow[]> {
  const { db } = ctx.deps;
  const [assets, spots, orders] = await Promise.all([
    db.select({ id: F.id, location: F.location, storage: F.storage, ipfsCid: F.ipfsCid }).from(F).where(and(isNull(F.contentId), isNotNull(F.location))),
    db.select({ id: schema.spotFiles.id, location: schema.spotFiles.location }).from(schema.spotFiles).where(and(isNull(schema.spotFiles.contentId), isNotNull(schema.spotFiles.location))),
    db.select({ id: schema.orderFiles.id, location: schema.orderFiles.location }).from(schema.orderFiles).where(and(isNull(schema.orderFiles.contentId), isNotNull(schema.orderFiles.location)))
  ]);
  return [
    ...assets.map((r) => ({ table: "asset_files" as const, id: r.id, location: r.location!, storage: r.storage, ipfsCid: r.ipfsCid })),
    ...spots.map((r) => ({ table: "spot_files" as const, id: r.id, location: r.location!, storage: null, ipfsCid: null })),
    ...orders.map((r) => ({ table: "order_files" as const, id: r.id, location: r.location!, storage: null, ipfsCid: null }))
  ];
}

/**
 * Points a row keyed by location at a stored content ID (only while it has none, so running it
 * again changes nothing): its content ID, `storage` the object store, a reference, and what was
 * prepared from its old location carried over.
 */
export async function relinkRow(ctx: ModuleContext, row: LocatedRow, cid: string): Promise<{ relinked: boolean; carried: string[] }> {
  const { db } = ctx.deps;
  const content = ctx.services.library.content;
  const relinked = await db.transaction(async (tx) => {
    let changed: Array<{ id: string }> = [];
    if (row.table === "asset_files") {
      changed = await tx.update(F).set({ contentId: cid, storage: ctx.deps.storage.objects.name }).where(and(eq(F.id, row.id), isNull(F.contentId))).returning({ id: F.id });
      if (changed.length) await content.addRef(tx, cid, "asset_file", row.id);
    } else if (row.table === "spot_files") {
      changed = await tx.update(schema.spotFiles).set({ contentId: cid }).where(and(eq(schema.spotFiles.id, row.id), isNull(schema.spotFiles.contentId))).returning({ id: schema.spotFiles.id });
      if (changed.length) await content.addRef(tx, cid, "spot_file", row.id);
    } else {
      changed = await tx.update(schema.orderFiles).set({ contentId: cid }).where(and(eq(schema.orderFiles.id, row.id), isNull(schema.orderFiles.contentId))).returning({ id: schema.orderFiles.id });
      if (changed.length) await content.addRef(tx, cid, "order_file", row.id);
    }
    return changed.length > 0;
  });
  const locKey = refKey({ location: row.location });
  const carried = relinked && locKey ? await carryPrepared(ctx, locKey, cid) : [];
  return { relinked, carried };
}

/** Where a row's bytes are: a URL, a path as written, or a path under the storage root. */
async function resolveLocation(ctx: ModuleContext, location: string): Promise<{ kind: "url"; url: string } | { kind: "file"; file: string } | null> {
  if (/^https?:\/\//.test(location)) return { kind: "url", url: location };
  const root = ctx.deps.config.storageRoot;
  for (const candidate of [location, path.join(root, location), path.join(root, location.replace(/^\/+/, ""))]) {
    if (await fs.access(candidate).then(() => true, () => false)) return { kind: "file", file: candidate };
  }
  return null;
}

async function download(url: string, dest: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url);
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(dest));
}

export interface LocationEntry {
  table: LocatedRow["table"];
  id: string;
  location: string;
  /** Report mode: whether its bytes can be read. */
  reachable?: boolean;
  /** Prepared under its old location (`loc-…`), in these renditions. */
  preparedAs?: { key: string; renditions: number };
  contentId?: string;
  relinked?: boolean;
  carried?: string[];
  error?: string;
}

/**
 * Rows keyed by location. Report mode (the default) says what it would do; with `relink`, each
 * row's bytes are read, stored by content ID (Infrequent Access: it's an original) and the row
 * relinked. Rows whose bytes can't be read are reported and left.
 */
export async function relinkLocations(ctx: ModuleContext, options: { relink: boolean; fetcher?: typeof fetch }): Promise<{ rows: number; relinked: number; unreachable: number; entries: LocationEntry[] }> {
  const rows = await locatedRows(ctx);
  const entries: LocationEntry[] = [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-relink-"));
  try {
    for (const row of rows) {
      const entry: LocationEntry = { table: row.table, id: row.id, location: row.location };
      const locKey = refKey({ location: row.location })!;
      const renditions = await ctx.deps.db.select({ rendition: PR.rendition }).from(PR).where(eq(PR.key, locKey));
      if (renditions.length) entry.preparedAs = { key: locKey, renditions: renditions.length };
      try {
        const where = await resolveLocation(ctx, row.location);
        if (!options.relink) {
          entry.reachable = where?.kind === "file" ? true : where?.kind === "url" ? await (options.fetcher ?? fetch)(where.url, { method: "HEAD" }).then((r) => r.ok, () => false) : false;
        } else {
          if (!where) throw new Error("its file isn't where the row says");
          let file: string;
          if (where.kind === "url") {
            file = path.join(dir, createHash("sha256").update(row.id).digest("hex"));
            await download(where.url, file, options.fetcher);
          } else file = where.file;
          const stored = await ctx.services.library.content.store(file, { storageClass: "infrequent" });
          entry.contentId = stored.cid;
          Object.assign(entry, await relinkRow(ctx, row, stored.cid));
          if (where.kind === "url") await fs.rm(file, { force: true });
        }
      } catch (error) {
        entry.error = (error as Error).message;
      }
      entries.push(entry);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return {
    rows: rows.length,
    relinked: entries.filter((e) => e.relinked).length,
    unreachable: entries.filter((e) => e.reachable === false || (options.relink && e.error)).length,
    entries
  };
}

// --- Pinata ------------------------------------------------------------------------------

/** Rows that used a pin: a legacy asset file stored on IPFS under it, or any row whose location names it. */
export async function rowsUsingPin(ctx: ModuleContext, ipfsCid: string): Promise<LocatedRow[]> {
  const pattern = `%${ipfsCid.replace(/[%_\\]/g, "")}%`;
  const { db } = ctx.deps;
  const [assets, spots, orders] = await Promise.all([
    db
      .select({ id: F.id, location: F.location, storage: F.storage, ipfsCid: F.ipfsCid })
      .from(F)
      .where(and(isNull(F.contentId), or(eq(F.ipfsCid, ipfsCid), like(F.location, pattern)))),
    db.select({ id: schema.spotFiles.id, location: schema.spotFiles.location }).from(schema.spotFiles).where(and(isNull(schema.spotFiles.contentId), like(schema.spotFiles.location, pattern))),
    db.select({ id: schema.orderFiles.id, location: schema.orderFiles.location }).from(schema.orderFiles).where(and(isNull(schema.orderFiles.contentId), like(schema.orderFiles.location, pattern)))
  ]);
  return [
    ...assets.map((r) => ({ table: "asset_files" as const, id: r.id, location: r.location ?? `ipfs://${ipfsCid}`, storage: r.storage, ipfsCid: r.ipfsCid })),
    ...spots.map((r) => ({ table: "spot_files" as const, id: r.id, location: r.location!, storage: null, ipfsCid: null })),
    ...orders.map((r) => ({ table: "order_files" as const, id: r.id, location: r.location!, storage: null, ipfsCid: null }))
  ];
}

export interface PinCopy {
  ipfsCid: string;
  name: string | null;
  bytes: number;
  contentId?: string;
  verified?: boolean;
  /** Rows now pointing at the content ID. */
  relinked?: Array<{ table: LocatedRow["table"]; id: string; carried: string[] }>;
  error?: string;
}

/**
 * Copies one pin into object storage (Infrequent Access, by its content ID: the raw bytes' CIDv1,
 * which differs from the pin's CID for files over about 1 MiB, since IPFS chunks those), reads the
 * copy back and checks its hash, and only then points every row that used the pin at the content
 * ID. Never unpins.
 */
export async function copyPin(ctx: ModuleContext, pin: { ipfsCid: string; name: string | null; bytes: number }, gateway: string, fetcher: typeof fetch = fetch): Promise<PinCopy> {
  const entry: PinCopy = { ipfsCid: pin.ipfsCid, name: pin.name, bytes: pin.bytes };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pinata-move-"));
  try {
    const file = path.join(dir, "pin");
    await download(`${gateway.replace(/\/+$/, "")}/${pin.ipfsCid}`, file, fetcher);
    const stored = await ctx.services.library.content.store(file, { storageClass: "infrequent" });
    // Verify: read the copy back from storage and hash it.
    const back = path.join(dir, "back");
    await ctx.deps.storage.objects.download(objectKey.file(stored.cid), back);
    const readBack = (await contentIdOf(back)).sha256;
    entry.contentId = stored.cid;
    entry.verified = readBack.equals(sha256FromCid(stored.cid)) && readBack.equals(createHash("sha256").update(await fs.readFile(file)).digest());
    if (entry.verified) {
      entry.relinked = [];
      for (const row of await rowsUsingPin(ctx, pin.ipfsCid)) {
        const done = await relinkRow(ctx, row, stored.cid);
        if (done.relinked) entry.relinked.push({ table: row.table, id: row.id, carried: done.carried });
      }
    }
  } catch (error) {
    entry.error = (error as Error).message;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return entry;
}

// --- Prepared from the copy: prepared again from the original ------------------------------------

export interface OriginalEntry {
  itemId: string;
  title: string;
  copy: string;
  original: string;
  /** What the copy was prepared for (the original is prepared for the same). */
  bands: Band[];
  /**
   * Report mode: `to_prepare` (its original isn't prepared yet) or `ready_to_move`. Applied:
   * `queued`, `moved`, or `failed` (the original couldn't be prepared: the copy stays).
   * `no_original`: the original isn't stored (or a claim holds it): the item stays on its copy.
   */
  state: "no_original" | "to_prepare" | "ready_to_move" | "queued" | "moved" | "failed";
  error?: string;
}

/**
 * Items whose current file is the 1280 px copy, with their original stored. Report mode (the
 * default) lists them. With `apply`: an original not prepared yet for the bands its copy was is
 * queued (the worker prepares it, soon after what airs within the hour); an original that is gets
 * the item moved onto it (a new file version, so the item's history keeps the copy's), its
 * uploaded caption track cut again for it, the catalog's pinned (IPFS), and the copy released:
 * gone once nothing else points at it, with what was prepared from it. Run it again until nothing
 * is left waiting.
 */
export async function prepareFromOriginals(ctx: ModuleContext, options: { apply: boolean }): Promise<{ items: number; toPrepare: number; readyToMove: number; queued: number; moved: number; failed: number; noOriginal: number; copyBytes: number; entries: OriginalEntry[] }> {
  const { db } = ctx.deps;
  const content = ctx.services.library.content;
  const rows = await db
    .select({ file: F, asset: A })
    .from(F)
    .innerJoin(A, eq(A.id, F.assetId))
    .where(and(isNotNull(F.originalContentId), isNotNull(F.contentId), sql`${F.originalContentId} <> ${F.contentId}`, isNull(A.archivedAt)))
    .orderBy(desc(F.version));
  // Only each item's current file.
  const latest = new Map<string, number>();
  const assetIds = [...new Set(rows.map((r) => r.asset.id))];
  if (assetIds.length) {
    for (const r of await db.select({ assetId: F.assetId, version: sql<number>`max(${F.version})::int` }).from(F).where(inArray(F.assetId, assetIds)).groupBy(F.assetId)) latest.set(r.assetId, r.version);
  }
  const current = rows.filter((r) => latest.get(r.asset.id) === r.file.version && r.asset.status === "ready");
  const info = await content.info(current.flatMap((r) => [r.file.contentId!, r.file.originalContentId!]));
  const entries: OriginalEntry[] = [];
  let copyBytes = 0;
  for (const { file, asset } of current) {
    const copy = file.contentId!;
    const original = file.originalContentId!;
    const o = info.get(original);
    const bands = await preparedBands(ctx, copy);
    const entry: OriginalEntry = { itemId: asset.id, title: asset.title, copy, original, bands, state: "to_prepare" };
    copyBytes += info.get(copy)?.bytes ?? 0;
    if (!o || o.deleted || o.locked || !(await ctx.deps.storage.objects.has(objectKey.file(original)))) {
      entry.state = "no_original";
      entries.push(entry);
      continue;
    }
    const ready = await preparedBands(ctx, original);
    const missing = bands.filter((b) => !ready.includes(b));
    if (!options.apply) {
      entry.state = missing.length ? "to_prepare" : "ready_to_move";
      entries.push(entry);
      continue;
    }
    try {
      if (missing.length) {
        const [queued] = await db.select({ status: PI.status }).from(PI).where(eq(PI.key, original));
        await queuePreparation(
          db,
          [missing.reduce<typeof PI.$inferInsert | undefined>((row, band) => wantRow({ contentId: original, mediaKind: asset.mediaKind, band, durationMs: asset.durationMs, neededAt: new Date(ctx.deps.clock.now().getTime() + 3_600_000) }, original, row), undefined)!]
        );
        entry.state = queued?.status === "failed" ? "failed" : "queued";
        if (queued?.status === "failed") entry.error = "the original couldn't be prepared: the copy stays";
        entries.push(entry);
        continue;
      }
      const moved = await db.transaction(async (tx) => {
        const [{ version }] = await tx.select({ version: sql<number>`max(${F.version})::int` }).from(F).where(eq(F.assetId, asset.id));
        // Someone replaced the file meanwhile: leave it.
        if (version !== file.version) return false;
        const [row] = await tx.insert(F).values({ assetId: asset.id, version: version + 1, contentId: original }).returning();
        await content.addRef(tx, original, "asset_file", row.id);
        // Its uploaded captions are cut again for the original (the worker picks this up within a minute).
        await tx.update(schema.captionTracks).set({ updatedAt: ctx.deps.clock.now() }).where(eq(schema.captionTracks.assetId, asset.id));
        return true;
      });
      if (!moved) {
        entries.push(entry);
        continue;
      }
      if ((await ctx.services.stations.kindOf(asset.stationId)) === "catalog" && ctx.deps.storage.ipfs.configured && !o.ipfs) {
        await content.publishToIpfs(original, "catalog", asset.title).catch((error) => (entry.error = `catalog publish: ${(error as Error).message}`));
      }
      // The copy goes once nothing else points at it (a station that aired it lately keeps its segments until the sweep).
      await content.release("asset_file", [file.id]);
      entry.state = "moved";
    } catch (error) {
      entry.error = (error as Error).message;
    }
    entries.push(entry);
  }
  return {
    items: entries.length,
    toPrepare: entries.filter((e) => e.state === "to_prepare").length,
    readyToMove: entries.filter((e) => e.state === "ready_to_move").length,
    queued: entries.filter((e) => e.state === "queued").length,
    moved: entries.filter((e) => e.state === "moved").length,
    failed: entries.filter((e) => e.state === "failed").length,
    noOriginal: entries.filter((e) => e.state === "no_original").length,
    copyBytes,
    entries
  };
}
