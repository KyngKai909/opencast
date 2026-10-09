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
//   - prepareCleanerPictures (`storage:cleaner-pictures`, added 2026-10-09, programming Phase 1):
//     items prepared before HDR tonemapping and deinterlacing are probed, and the HDR or interlaced
//     ones prepared again beside their first copy (`<key>-p2`), which airs until the new one is ready.
//
// None of them unpins or deletes anything but the 1280 px copies, which the originals replace.
//
// Since 2026-09-29 the desk runs them too (Settings, Storage maintenance: modules/maintenance), in
// the background inside the API, a check (report only) or an apply; the scripts stay for local use.

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
import { baseKey, PICTURE_PIPELINE, probe, queuePreparation, refKey, versionedKey, wantRow, type Picture } from "./modules/playout/engine/prepare.js";

const F = schema.assetFiles;
const A = schema.assets;
const PI = schema.preparedItems;
const PR = schema.preparedRenditions;
const PC = schema.preparedCaptions;

const seg = (i: number, ext: string) => `seg_${String(i).padStart(5, "0")}.${ext}`;

/** Told after each row, pin or item: how many are done of how many (the desk shows it while a run goes). */
export type Progress = (done: number, total: number) => void | Promise<void>;

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
export async function relinkLocations(ctx: ModuleContext, options: { relink: boolean; fetcher?: typeof fetch; onProgress?: Progress }): Promise<{ rows: number; relinked: number; unreachable: number; entries: LocationEntry[] }> {
  const rows = await locatedRows(ctx);
  await options.onProgress?.(0, rows.length);
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
      await options.onProgress?.(entries.length, rows.length);
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

/** A pin on Pinata, as listed. */
export interface Pin {
  ipfsCid: string;
  bytes: number;
  name: string | null;
  /** How the script unpins it (`--unpin`, never from here): a v3 file id, or the legacy pin (by CID). */
  unpin: { kind: "v3"; network: "public" | "private"; id: string } | { kind: "legacy" };
}

/** A Pinata account this API can read (PINATA_JWT): what's pinned, and where to fetch it. It can't unpin. */
export interface PinataAccount {
  /** The gateway pins are fetched from (PINATA_GATEWAY_BASE). */
  gateway: string;
  /** Every pin the key can list, and which listings it could read ("read", or why not: a scoped key may not read them all). */
  listPins(): Promise<{ pins: Pin[]; listings: Record<string, string> }>;
}

/** Pinata by its API (only GETs): the v3 files on both networks, and anything pinned through the legacy pinning API. */
export function pinataAccount(config: { jwt: string; gatewayBase?: string; apiBase?: string; fetcher?: typeof fetch }): PinataAccount {
  const api = (config.apiBase ?? "https://api.pinata.cloud").replace(/\/+$/, "");
  const fetcher = config.fetcher ?? fetch;
  async function get(url: string) {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${config.jwt}` } });
    if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
    return response.json();
  }
  return {
    gateway: (config.gatewayBase ?? "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, ""),
    async listPins() {
      const listings: Record<string, string> = {};
      const pins = new Map<string, Pin>();
      // Files uploaded through the v3 API (what the old API used), both networks.
      for (const network of ["public", "private"] as const) {
        let token: string | undefined;
        do {
          const page = (await get(`${api}/v3/files/${network}?limit=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`).catch((error: Error) => {
            listings[`v3 ${network}`] = error.message;
            return null;
          })) as { data?: { files?: Array<{ id: string; cid: string; size: number; name: string | null }>; next_page_token?: string } } | null;
          for (const f of page?.data?.files ?? []) pins.set(f.cid, { ipfsCid: f.cid, bytes: f.size, name: f.name, unpin: { kind: "v3", network, id: f.id } });
          if (page) listings[`v3 ${network}`] ??= "read";
          token = page?.data?.next_page_token || undefined;
        } while (token);
      }
      // Anything pinned through the legacy pinning API.
      for (let offset = 0; ; offset += 1000) {
        const page = (await get(`${api}/data/pinList?status=pinned&pageLimit=1000&pageOffset=${offset}`).catch((error: Error) => {
          listings.legacy = error.message;
          return null;
        })) as { rows: Array<{ ipfs_pin_hash: string; size: number; metadata?: { name?: string } }> } | null;
        if (!page) break;
        listings.legacy ??= "read";
        for (const r of page.rows) if (!pins.has(r.ipfs_pin_hash)) pins.set(r.ipfs_pin_hash, { ipfsCid: r.ipfs_pin_hash, bytes: r.size, name: r.metadata?.name ?? null, unpin: { kind: "legacy" } });
        if (page.rows.length < 1000) break;
      }
      return { pins: [...pins.values()], listings };
    }
  };
}

/** Pinata from the environment (PINATA_JWT, PINATA_GATEWAY_BASE), or null when it isn't connected here. */
export function pinataFromEnv(env: NodeJS.ProcessEnv): PinataAccount | null {
  const jwt = env.PINATA_JWT?.trim();
  return jwt ? pinataAccount({ jwt, gatewayBase: env.PINATA_GATEWAY_BASE || undefined }) : null;
}

/** Published prices (per GB-month). R2 has no charge for reads (egress); Infrequent Access adds a retrieval fee and a 30-day minimum. */
const R2 = { standard: 0.015, infrequent: 0.01, infrequentRetrievalPerGb: 0.01 };
const GB = 1024 ** 3;

export interface PinataMove {
  at: string;
  store: string;
  listings: Record<string, string>;
  pinned: { files: number; gb: number };
  moving: { files: number; gb: number };
  stayingOnIpfs: { files: number; gb: number; cids: string[] };
  monthly: { pinataBefore: number | string; r2After: number; r2AfterIfAllStandard: number; pinataAfter: number | string };
  copies: Array<PinCopy & Record<string, unknown>>;
}

/**
 * Pinata's pins, and what moving off it costs. Every pin but the catalog's (pinned for good:
 * `contents.ipfs_reason` "catalog", or `keep`) is moving. With `copy`, each moving pin is copied
 * in, checked by hash and its rows relinked (`copyPin`); `afterCopy` is the script's hook for
 * `--unpin`. Nothing here unpins.
 */
export async function moveOffPinata(
  ctx: ModuleContext,
  pinata: PinataAccount,
  options: { copy: boolean; keep?: string[]; pinataMonthly?: number; fetcher?: typeof fetch; onProgress?: Progress; afterCopy?: (pin: Pin, entry: PinCopy & Record<string, unknown>) => Promise<void> }
): Promise<{ report: PinataMove; counts: { pins: number; moving: number; movingBytes: number; staying: number; stayingBytes: number; copied: number; relinked: number; errors: number } }> {
  const catalog = new Set([
    ...(options.keep ?? []),
    ...(await ctx.deps.db.select({ cid: schema.contents.ipfsCid, reason: schema.contents.ipfsReason }).from(schema.contents).where(isNotNull(schema.contents.ipfsCid)))
      .filter((r) => r.reason === "catalog")
      .map((r) => r.cid!)
  ]);
  const { pins, listings } = await pinata.listPins();
  const total = pins.reduce((sum, p) => sum + p.bytes, 0);
  const moving = pins.filter((p) => !catalog.has(p.ipfsCid));
  const staying = pins.filter((p) => catalog.has(p.ipfsCid));
  const movingBytes = moving.reduce((sum, p) => sum + p.bytes, 0);
  const stayingBytes = staying.reduce((sum, p) => sum + p.bytes, 0);
  const report: PinataMove = {
    at: ctx.deps.clock.now().toISOString(),
    store: ctx.deps.storage.objects.name,
    listings,
    pinned: { files: pins.length, gb: +(total / GB).toFixed(3) },
    moving: { files: moving.length, gb: +(movingBytes / GB).toFixed(3) },
    stayingOnIpfs: { files: staying.length, gb: +(stayingBytes / GB).toFixed(3), cids: staying.map((p) => p.ipfsCid) },
    monthly: {
      pinataBefore: options.pinataMonthly ?? "your Pinata plan's price",
      // Originals move to Infrequent Access until an asset points at them as its prepared file.
      r2After: +((movingBytes / GB) * R2.infrequent).toFixed(2),
      r2AfterIfAllStandard: +((movingBytes / GB) * R2.standard).toFixed(2),
      pinataAfter: staying.length ? "the smallest plan that holds the catalog" : 0
    },
    copies: []
  };
  if (options.copy) {
    await options.onProgress?.(0, moving.length);
    for (const pin of moving) {
      // Copied, verified by hash, and the rows that used it relinked to the content ID (never unpinned here).
      const entry: PinCopy & Record<string, unknown> = { ...(await copyPin(ctx, pin, pinata.gateway, options.fetcher)) };
      await options.afterCopy?.(pin, entry);
      report.copies.push(entry);
      await options.onProgress?.(report.copies.length, moving.length);
    }
  }
  return {
    report,
    counts: {
      pins: pins.length,
      moving: moving.length,
      movingBytes,
      staying: staying.length,
      stayingBytes,
      copied: report.copies.filter((c) => c.verified).length,
      relinked: report.copies.reduce((sum, c) => sum + (c.relinked?.length ?? 0), 0),
      errors: report.copies.filter((c) => c.error || c.verified === false).length
    }
  };
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
export async function prepareFromOriginals(ctx: ModuleContext, options: { apply: boolean; onProgress?: Progress }): Promise<{ items: number; toPrepare: number; readyToMove: number; queued: number; moved: number; failed: number; noOriginal: number; copyBytes: number; entries: OriginalEntry[] }> {
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
  await options.onProgress?.(0, current.length);
  for (const { file, asset } of current) {
    if (entries.length) await options.onProgress?.(entries.length, current.length);
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
  await options.onProgress?.(entries.length, current.length);
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

// --- Cleaner pictures: HDR and interlaced items prepared again ---------------------------------

export interface PictureEntry {
  /** The prepared item's key (its file's content ID). */
  key: string;
  /** Titles of the library items whose file it is, for the report. */
  titles: string[];
  hdr: "pq" | "hlg" | null;
  interlaced: boolean;
  dolbyVision: boolean;
  /**
   * `unchanged` (SDR and progressive: it keeps its segments), `unreadable` (the probe couldn't
   * read the original). Report mode: `to_prepare` (HDR or interlaced, no newer copy yet). Applied:
   * `queued` (the newer copy is waiting for the worker or being made). Either mode: `ready` (the
   * newer copy has taken over), `failed` (it couldn't be prepared: the first copy stays on air).
   */
  state: "unchanged" | "unreadable" | "to_prepare" | "queued" | "ready" | "failed";
  error?: string;
}

/**
 * Items prepared before picture pipeline 2 (programming Phase 1): each video file is probed (from
 * object storage, a presigned URL where the store has them, so only what's read is fetched), and
 * one that's HDR or interlaced is prepared again under `<key>-p2`, beside its first copy, with the
 * same renditions. The first copy airs until the new one is ready in all of them, then the new
 * one does (`refKey`); nothing else is touched. Report mode (the default) probes and counts and
 * changes nothing: `toPrepare` is how many items it would prepare again. With `apply`, what the
 * probe found is kept on each item (a rerun doesn't probe again) and those items are queued, after
 * anything airing soon. Run it again until nothing is `queued`; it's safe to rerun.
 */
export async function prepareCleanerPictures(
  ctx: ModuleContext,
  options: { apply: boolean; onProgress?: Progress }
): Promise<{ items: number; probed: number; hdr: number; interlaced: number; unchanged: number; unreadable: number; toPrepare: number; queued: number; ready: number; failed: number; entries: PictureEntry[] }> {
  const { db } = ctx.deps;
  // Files prepared for TV before pipeline 2 (sound alone has no picture to change; old locations are relinked first).
  const rows = await db
    .select()
    .from(PI)
    .where(and(eq(PI.kind, "file"), eq(PI.mediaKind, "video"), isNotNull(PI.contentId), sql`${PI.key} = ${PI.contentId}`, sql`${PI.pipeline} < ${PICTURE_PIPELINE}`, sql`exists (select 1 from ${PR} r where r.key = ${PI.key} and r.rendition like 'v%')`))
    .orderBy(PI.key);
  const keys = rows.map((r) => r.key);
  const [newer, done, titles] = keys.length
    ? await Promise.all([
        db.select().from(PI).where(inArray(PI.key, keys.map(versionedKey))),
        db.select({ key: PR.key, rendition: PR.rendition }).from(PR).where(inArray(PR.key, [...keys, ...keys.map(versionedKey)])),
        db.selectDistinct({ key: F.contentId, title: A.title }).from(F).innerJoin(A, eq(A.id, F.assetId)).where(inArray(F.contentId, keys))
      ])
    : [[], [], []];
  const newerOf = new Map(newer.map((r) => [baseKey(r.key), r]));
  const renditionsOf = new Map<string, Set<string>>();
  for (const r of done) renditionsOf.set(r.key, (renditionsOf.get(r.key) ?? new Set()).add(r.rendition));
  const titlesOf = new Map<string, string[]>();
  for (const t of titles) titlesOf.set(t.key!, [...(titlesOf.get(t.key!) ?? []), t.title]);
  const entries: PictureEntry[] = [];
  let probed = 0;
  await options.onProgress?.(0, rows.length);
  for (const row of rows) {
    if (entries.length) await options.onProgress?.(entries.length, rows.length);
    const entry: PictureEntry = { key: row.key, titles: titlesOf.get(row.key) ?? [], hdr: null, interlaced: false, dolbyVision: false, state: "unchanged" };
    entries.push(entry);
    try {
      let picture = row.picture;
      if (!picture) {
        picture = await probeOriginal(ctx, row.key);
        probed++;
        if (!picture) {
          entry.state = "unreadable";
          continue;
        }
        if (options.apply) await db.update(PI).set({ picture }).where(eq(PI.key, row.key));
      }
      Object.assign(entry, { hdr: picture.hdr, interlaced: picture.interlaced, dolbyVision: picture.dolbyVision });
      if (!picture.hdr && !picture.interlaced) continue;
      const first = renditionsOf.get(row.key) ?? new Set<string>();
      const made = renditionsOf.get(versionedKey(row.key)) ?? new Set<string>();
      const copy = newerOf.get(row.key);
      if (copy && made.size && [...first].every((r) => made.has(r))) {
        entry.state = "ready";
        continue;
      }
      if (copy?.status === "failed") {
        entry.state = "failed";
        entry.error = copy.error ?? undefined;
        continue;
      }
      if (!options.apply) {
        entry.state = copy ? "queued" : "to_prepare";
        continue;
      }
      // The same renditions as the first copy (and any it's still waiting for), after what airs soon.
      await queuePreparation(db, [
        { key: versionedKey(row.key), contentId: row.key, kind: "file", sourceLocation: null, mediaKind: "video", status: "queued", renditions: [...new Set([...first, ...row.renditions])].sort(), durationMs: row.durationMs, neededAt: null }
      ]);
      entry.state = "queued";
    } catch (error) {
      entry.state = "unreadable";
      entry.error = (error as Error).message.slice(0, 300);
    }
  }
  await options.onProgress?.(entries.length, rows.length);
  const count = (state: PictureEntry["state"]) => entries.filter((e) => e.state === state).length;
  return {
    items: entries.length,
    probed,
    hdr: entries.filter((e) => e.hdr).length,
    interlaced: entries.filter((e) => e.interlaced).length,
    unchanged: count("unchanged"),
    unreadable: count("unreadable"),
    toPrepare: count("to_prepare"),
    queued: count("queued"),
    ready: count("ready"),
    failed: count("failed"),
    entries
  };
}

/** The probe's picture for a stored original: read where it is (a presigned URL or a local path), else from a download. */
async function probeOriginal(ctx: ModuleContext, cid: string): Promise<Picture | null> {
  const objects = ctx.deps.storage.objects;
  if (!(await objects.has(objectKey.file(cid)))) throw new Error("the original isn't stored");
  if (objects.readUrl) return (await probe(await objects.readUrl(objectKey.file(cid), 3_600))).picture;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-probe-"));
  try {
    const file = path.join(dir, "source");
    await objects.download(objectKey.file(cid), file, sha256FromCid(cid));
    return (await probe(file)).picture;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
