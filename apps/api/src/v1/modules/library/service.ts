import { promises as fs } from "node:fs";
import path from "node:path";
import { and, asc, eq, ilike, inArray, isNull, max, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { LibraryItem } from "@opencast/contracts";
import { iabContentCategories, isChildrensRating, type ContentRating } from "@opencast/domain";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser, UploadedFile } from "../../http.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { createContent, type Content } from "./content.js";

type LogCode = "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN";

/** What other modules need to know about a library item. */
export interface ItemRef {
  id: string;
  stationId: string;
  programId: string | null;
  title: string;
  episodeNumber: number | null;
  code: LogCode;
  durationMs: number | null;
  status: "preparing" | "ready" | "failed";
  rightsConfirmed: boolean;
  source: "upload" | "link" | "creator_work" | "library";
  mediaKind: "video" | "audio";
  /** The current file's content ID: what playout airs, from the worker's cache. */
  contentId: string | null;
  /** Before content IDs: a disk path or URL playout reads directly. */
  location: string | null;
  /** Its file is locked by a rights claim, or gone: it can't air. */
  contentUnavailable: boolean;
  archived: boolean;
  /** Where the maker allows breaks inside it. */
  breakPointsMs: number[];
}

export interface ProgramRef {
  id: string;
  stationId: string;
  title: string;
  description: string | null;
  category: string | null;
  advisory: "none" | "language" | "mature";
  live: boolean;
  attribution: string | null;
  rightsNote: string | null;
}

export interface LibraryService {
  /** Files by content ID: storing, references, locks, previews, IPFS. */
  content: Content;
  /** Every content ID an item's files point at (all versions, originals too). */
  contentOfItems(itemIds: string[]): Promise<string[]>;
  /** Other stations' items made from the same files (a takedown pulls them too). */
  itemsSharingContent(itemIds: string[]): Promise<string[]>;
  /** Every item's current content ID, for the worker cache. */
  currentContent(itemIds: string[]): Promise<Map<string, string>>;
  /** Publishes the station's own original to IPFS. Public, and it can't be taken back. */
  exportToIpfs(itemId: string): Promise<{ contentId: string; ipfsCid: string; url: string }>;
  titles(input: { itemIds: string[]; programIds: string[] }): Promise<{ items: Map<string, string>; programs: Map<string, string> }>;
  itemsByIds(ids: string[]): Promise<Map<string, ItemRef>>;
  programsByIds(ids: string[]): Promise<Map<string, ProgramRef>>;
  programsForStation(stationId: string): Promise<ProgramRef[]>;
  /** A program's episodes, in episode order. */
  episodes(programId: string): Promise<ItemRef[]>;
  searchPrograms(q: string): Promise<ProgramRef[]>;
  /** For sign-on checks: items and how many have confirmed rights; programs missing a listing. */
  readiness(stationId: string): Promise<{ items: number; rightsConfirmed: number; programsNeedingDescription: number }>;
  hasLinkImports(programId: string): Promise<boolean>;
  /** A station's own station IDs and bumpers, ready for air with rights confirmed. */
  fillers(stationId: string): Promise<{ stationIds: ItemRef[]; bumpers: ItemRef[] }>;
  /** Programs ready to repeat (for filling dead air), most recent first. */
  repeatable(stationId: string, limit: number): Promise<ItemRef[]>;
  /** A claimable station's import of a covered creator work (the file comes later). */
  addCreatorWork(db: Executor, input: { stationId: string; creatorWorkId: string; title: string; durationMs: number | null; sourceUrl: string; programId?: string }): Promise<string>;

  /** A claimable station's rights: the permission or licence record that covers the work. */
  confirmCreatorWorkRights(db: Executor, itemId: string, input: { permissionRecordId?: string; licenceRecordId?: string }): Promise<void>;
  library(stationId: string, filter: { folderId?: string; code?: LogCode; needsAttention?: boolean }): Promise<LibraryView>;
  item(itemId: string): Promise<LibraryItem>;
  stationOfItem(itemId: string): Promise<string>;
  stationOfProgram(programId: string): Promise<string>;
  stationOfFolder(folderId: string): Promise<string>;
  upload(stationId: string, file: UploadedFile, fields: ItemFields): Promise<LibraryItem>;
  updateItem(itemId: string, fields: Partial<ItemFields>): Promise<LibraryItem>;
  archiveItem(itemId: string): Promise<void>;
  /** Removes an item after a claim, whatever it's used in (its airings were already pulled). */
  archiveForClaim(itemId: string): Promise<void>;
  confirmRights(user: CurrentUser, itemId: string, input: { basis: "made_it" | "owner_permission" | "public_domain"; note?: string }): Promise<LibraryItem>;
  importLinks(stationId: string, input: { urls: string[]; expandPlaylists: boolean; code: LogCode; programId?: string }): Promise<ImportJobView>;
  importJob(stationId: string, jobId: string): Promise<ImportJobView>;
  createFolder(stationId: string, input: { name: string; parentFolderId: string | null }): Promise<FolderView>;
  updateFolder(folderId: string, input: { name?: string; parentFolderId?: string | null }): Promise<FolderView>;
  deleteFolder(folderId: string): Promise<void>;
  createProgram(stationId: string, input: { title: string; description?: string; category?: string; advisory: "none" | "language" | "mature"; live: boolean } & Omit<ProgramAdFields, "iabCategories">): Promise<ProgramView>;
  updateProgram(programId: string, input: Partial<{ title: string; description: string | null; category: string | null; advisory: "none" | "language" | "mature"; live: boolean }> & ProgramAdFields): Promise<ProgramView>;
  program(programId: string): Promise<ProgramView>;
  /** Waits for uploads and imports started so far (tests, shutdown). */
  settle(): Promise<void>;
}

export interface ItemFields {
  title?: string;
  code?: LogCode;
  programId?: string | null;
  folderId?: string | null;
  episodeNumber?: number | null;
  episodeDescription?: string | null;
  breakPointsMs?: number[];
}

export interface FolderView {
  id: string;
  name: string;
  parentFolderId: string | null;
  itemCount: number;
}

export interface ProgramView extends Omit<ProgramRef, "stationId"> {
  station: import("@opencast/contracts").StationIdent;
  episodeCount: number;
  listingStatus: "complete" | "needs_description" | "from_the_maker";
  /** For ads from partners: IAB Content Taxonomy 3.0 ids (its own, or derived), a rating, and whether it's made for children. */
  iabCategories: string[];
  rating: ContentRating | null;
  childDirected: boolean;
}

type ProgramAdFields = { rating?: ContentRating | null; childDirected?: boolean; iabCategories?: string[] | null };

export interface LibraryView {
  items: LibraryItem[];
  folders: FolderView[];
  programs: ProgramView[];
  needsAttention: { rightsToConfirm: number; preparing: number };
  importedFromLinks: number;
}

export interface ImportJobView {
  id: string;
  status: "queued" | "expanding" | "running" | "completed" | "partial" | "failed" | "canceled";
  requestedUrls: string[];
  items: Array<{ sourceUrl: string; title: string | null; status: string; progressPct: number; assetId: string | null }>;
  error: string | null;
  createdAt: string;
}

const A = schema.assets;
const F = schema.assetFiles;
const R = schema.rightsConfirmations;
const P = schema.programs;

/** Anything under a minute is guessed as a bumper; the station can change it. */
const guessCode = (durationMs: number | null): LogCode => (durationMs !== null && durationMs < 60_000 ? "BMP" : "PGM");

export function createLibraryService(ctx: ModuleContext): LibraryService {
  const { deps, services } = ctx;
  const { db } = deps;
  const content = createContent(ctx);
  const jobs = new Set<Promise<unknown>>();
  const background = (work: Promise<unknown>) => {
    const tracked = work.catch((error) => console.error("[library] background job failed", error)).finally(() => jobs.delete(tracked));
    jobs.add(tracked);
  };

  async function currentFiles(itemIds: string[]) {
    if (!itemIds.length) return new Map<string, typeof F.$inferSelect>();
    const rows = await db.select().from(F).where(inArray(F.assetId, itemIds));
    const latest = new Map<string, typeof F.$inferSelect>();
    for (const row of rows) {
      const current = latest.get(row.assetId);
      if (!current || row.version > current.version) latest.set(row.assetId, row);
    }
    return latest;
  }

  async function toRefs(rows: Array<typeof A.$inferSelect>): Promise<ItemRef[]> {
    const ids = rows.map((r) => r.id);
    const [files, rights, points] = await Promise.all([
      currentFiles(ids),
      ids.length ? db.select({ id: R.assetId }).from(R).where(inArray(R.assetId, ids)) : Promise.resolve([]),
      ids.length ? db.select().from(schema.assetBreakPoints).where(inArray(schema.assetBreakPoints.assetId, ids)) : Promise.resolve([])
    ]);
    const confirmed = new Set(rights.map((r) => r.id));
    const pointsBy = new Map<string, number[]>();
    for (const p of points) pointsBy.set(p.assetId, [...(pointsBy.get(p.assetId) ?? []), p.offsetMs].sort((a, b) => a - b));
    const info = await content.info([...files.values()].map((f) => f.contentId).filter((v): v is string => Boolean(v)));
    return rows.map((r) => ({
      id: r.id,
      stationId: r.stationId,
      programId: r.programId,
      title: r.title,
      episodeNumber: r.episodeNumber,
      code: r.code,
      durationMs: r.durationMs,
      status: r.status,
      rightsConfirmed: confirmed.has(r.id),
      source: r.source,
      mediaKind: r.mediaKind,
      contentId: files.get(r.id)?.contentId ?? null,
      location: files.get(r.id)?.location ?? null,
      contentUnavailable: (() => {
        const cid = files.get(r.id)?.contentId;
        const i = cid ? info.get(cid) : undefined;
        return Boolean(cid && (!i || i.locked || i.deleted));
      })(),
      archived: r.archivedAt !== null,
      breakPointsMs: pointsBy.get(r.id) ?? []
    }));
  }

  async function toItems(rows: Array<typeof A.$inferSelect>): Promise<LibraryItem[]> {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const [rights, breakPoints, files] = await Promise.all([
      db.select().from(R).where(inArray(R.assetId, ids)),
      db.select().from(schema.assetBreakPoints).where(inArray(schema.assetBreakPoints.assetId, ids)),
      currentFiles(ids)
    ]);
    const info = await content.info([...files.values()].flatMap((f) => [f.contentId, f.originalContentId]).filter((v): v is string => Boolean(v)));
    const names = await services.accounts.displayNames(rights.map((r) => r.confirmedBy).filter((v): v is string => Boolean(v)));
    const rightsBy = new Map(rights.map((r) => [r.assetId, r]));
    const pointsBy = new Map<string, number[]>();
    for (const p of breakPoints) pointsBy.set(p.assetId, [...(pointsBy.get(p.assetId) ?? []), p.offsetMs].sort((a, b) => a - b));
    return rows.map((r) => {
      const right = rightsBy.get(r.id);
      return {
        id: r.id,
        stationId: r.stationId,
        programId: r.programId,
        folderId: r.folderId,
        title: r.title,
        episodeNumber: r.episodeNumber,
        episodeDescription: r.episodeDescription,
        code: r.code,
        source: r.source,
        sourceUrl: r.sourceUrl,
        mediaKind: r.mediaKind,
        durationMs: r.durationMs,
        status: r.status,
        prepProgress: r.prepProgress,
        picture: r.widthPx && r.heightPx ? { width: r.widthPx, height: r.heightPx } : null,
        loudnessLufs: r.loudnessLufs,
        captions: r.captions,
        originalFilename: r.originalFilename,
        rights: right
          ? {
              basis: right.basis,
              confirmedBy: right.confirmedBy ? (names.get(right.confirmedBy) ?? null) : null,
              confirmedAt: right.confirmedAt.toISOString(),
              note: right.note
            }
          : null,
        offerable: r.source !== "link",
        breakPointsMs: pointsBy.get(r.id) ?? [],
        storage: (() => {
          const file = files.get(r.id);
          const prepared = file?.contentId ? info.get(file.contentId) : undefined;
          if (!file?.contentId || !prepared) return null;
          const original = file.originalContentId ? info.get(file.originalContentId) : undefined;
          return {
            contentId: prepared.cid,
            bytes: prepared.bytes,
            // Stations whose items point at the same file (it's stored once).
            sharedWith: Math.max(0, prepared.references - 1),
            locked: prepared.locked,
            ipfs: original?.ipfs ?? prepared.ipfs ?? null
          };
        })(),
        createdAt: r.createdAt.toISOString()
      };
    });
  }

  async function itemRow(itemId: string) {
    const [row] = await db.select().from(A).where(and(eq(A.id, itemId), isNull(A.archivedAt)));
    if (!row) throw notFound("That item");
    return row;
  }

  function programRef(p: typeof P.$inferSelect): ProgramRef {
    return {
      id: p.id,
      stationId: p.stationId,
      title: p.title,
      description: p.description,
      category: p.category,
      advisory: p.advisory,
      live: p.isLive,
      attribution: p.attribution,
      rightsNote: p.rightsNote
    };
  }

  async function programViews(rows: Array<typeof P.$inferSelect>): Promise<ProgramView[]> {
    if (!rows.length) return [];
    const [idents, profiles, counts] = await Promise.all([
      services.stations.idents(rows.map((r) => r.stationId)),
      services.stations.profiles(rows.map((r) => r.stationId)),
      db
        .select({ programId: A.programId, n: sql<number>`count(*)::int` })
        .from(A)
        .where(and(inArray(A.programId, rows.map((r) => r.id)), isNull(A.archivedAt)))
        .groupBy(A.programId)
    ]);
    const countBy = new Map(counts.map((c) => [c.programId, c.n]));
    return rows.flatMap((p) => {
      const station = idents.get(p.stationId);
      if (!station) return [];
      const { stationId: _stationId, ...ref } = programRef(p);
      return [
        {
          ...ref,
          station,
          episodeCount: countBy.get(p.id) ?? 0,
          listingStatus: p.description ? ("complete" as const) : ("needs_description" as const),
          iabCategories: iabContentCategories({ override: p.iabCategories, category: p.category, fallbackCategory: profiles.get(p.stationId)?.category }),
          rating: p.rating,
          childDirected: p.childDirected
        }
      ];
    });
  }

  async function setBreakPoints(tx: Executor, itemId: string, points: number[]) {
    await tx.delete(schema.assetBreakPoints).where(eq(schema.assetBreakPoints.assetId, itemId));
    const unique = [...new Set(points.map((p) => Math.round(p)))];
    if (unique.length) await tx.insert(schema.assetBreakPoints).values(unique.map((offsetMs) => ({ assetId: itemId, offsetMs })));
  }

  async function checkOwnership(stationId: string, fields: Partial<ItemFields>) {
    if (fields.programId) {
      const [program] = await db.select({ stationId: P.stationId }).from(P).where(eq(P.id, fields.programId));
      if (!program || program.stationId !== stationId) throw badRequest("That program isn't this station's.");
    }
    if (fields.folderId) {
      const [folder] = await db.select({ stationId: schema.assetFolders.stationId }).from(schema.assetFolders).where(eq(schema.assetFolders.id, fields.folderId));
      if (!folder || folder.stationId !== stationId) throw badRequest("That folder isn't this station's.");
    }
  }

  async function prepareInBackground(itemId: string, stationId: string, file: string, mediaKind: "video" | "audio") {
    try {
      await db.update(A).set({ prepProgress: 10 }).where(eq(A.id, itemId));
      const [prepared, loudness] = await Promise.all([deps.media.prepare(file, { scope: stationId, itemId, mediaKind }), deps.media.loudness(file).catch(() => null)]);
      // Stored by content ID: the file playout airs in Standard, the original in Infrequent Access.
      const [ready, original] = await Promise.all([content.store(prepared.file, { storageClass: "standard" }), content.store(file, { storageClass: "infrequent" })]);
      await db.transaction(async (tx) => {
        const [{ version }] = await tx.select({ version: max(F.version) }).from(F).where(eq(F.assetId, itemId));
        const [row] = await tx
          .insert(F)
          .values({ assetId: itemId, version: (version ?? 0) + 1, contentId: ready.cid, originalContentId: original.cid, compression: prepared.compression })
          .returning();
        await content.addRef(tx, ready.cid, "asset_file", row.id);
        await content.addRef(tx, original.cid, "asset_original", row.id);
        // Prepared for air: levelled to broadcast loudness by the compression profile.
        await tx.update(A).set({ status: "ready", prepProgress: 100, loudnessLufs: loudness }).where(eq(A.id, itemId));
      });
      // The local copies were only for the work; the store has them now.
      await Promise.all([fs.rm(prepared.file, { force: true }), fs.rm(file, { force: true })]);
      await afterReady(itemId, stationId, ready.cid);
    } catch (error) {
      await db.update(A).set({ status: "failed", prepProgress: null }).where(eq(A.id, itemId));
      throw error;
    }
  }

  /** The Opencast catalog is published to IPFS on purpose; items in an open offer get a preview. */
  async function afterReady(itemId: string, stationId: string, cid: string) {
    const [row] = await db.select({ title: A.title, programId: A.programId }).from(A).where(eq(A.id, itemId));
    if ((await services.stations.kindOf(stationId)) === "catalog" && deps.storage.ipfs.configured) {
      await content.publishToIpfs(cid, "catalog", row?.title ?? itemId).catch((error) => console.error("[library] catalog publish failed", error));
    }
    const offerId = row?.programId ? await services.catalog.openOfferFor(row.programId) : null;
    if (offerId) await content.needPreview([cid], "offer", offerId);
  }

  async function jobView(row: typeof schema.importJobs.$inferSelect): Promise<ImportJobView> {
    return {
      id: row.id,
      status: row.status,
      requestedUrls: row.requestedUrls,
      items: (row.items as ImportJobView["items"]) ?? [],
      error: row.error,
      createdAt: row.createdAt.toISOString()
    };
  }

  async function runImport(jobId: string, stationId: string, input: { urls: string[]; expandPlaylists: boolean; code: LogCode; programId?: string }) {
    const J = schema.importJobs;
    const setItems = (items: ImportJobView["items"], status: ImportJobView["status"], error: string | null = null) =>
      db
        .update(J)
        .set({ items, status, error, finishedAt: ["completed", "partial", "failed"].includes(status) ? deps.clock.now() : null })
        .where(eq(J.id, jobId));
    let urls = input.urls;
    if (input.expandPlaylists) {
      await db.update(J).set({ status: "expanding" }).where(eq(J.id, jobId));
      const expanded = await Promise.all(urls.map((u) => deps.media.expandLinks(u).catch(() => [u])));
      urls = [...new Set(expanded.flat())];
    }
    const items: ImportJobView["items"] = urls.map((sourceUrl) => ({ sourceUrl, title: null, status: "queued", progressPct: 0, assetId: null }));
    await setItems(items, "running");
    const dir = path.join(deps.config.storageRoot, "uploads", stationId, "imports");
    for (const item of items) {
      try {
        item.status = "downloading";
        await setItems(items, "running");
        const [row] = await db
          .insert(A)
          .values({ stationId, programId: input.programId ?? null, title: item.sourceUrl, code: input.code, source: "link", sourceUrl: item.sourceUrl, mediaKind: "video" })
          .returning();
        item.assetId = row.id;
        const file = await deps.media.importLink(item.sourceUrl, dir, row.id);
        const probe = await deps.media.probe(file);
        const title = path.basename(file).replace(/\.[^.]+$/, "");
        await db
          .update(A)
          .set({ mediaKind: probe.mediaKind, durationMs: probe.durationMs, widthPx: probe.width, heightPx: probe.height, title: item.title ?? title })
          .where(eq(A.id, row.id));
        item.status = "processing";
        await setItems(items, "running");
        await prepareInBackground(row.id, stationId, file, probe.mediaKind);
        item.status = "completed";
        item.progressPct = 100;
      } catch (error) {
        item.status = "failed";
        console.warn(`[library] import of ${item.sourceUrl} failed`, error);
      }
      await setItems(items, "running");
    }
    const failed = items.filter((i) => i.status === "failed").length;
    await setItems(items, failed === 0 ? "completed" : failed === items.length ? "failed" : "partial");
  }

  async function cidsOf(itemIds: string[]) {
    if (!itemIds.length) return [];
    const rows = await db.select({ a: F.contentId, b: F.originalContentId }).from(F).where(inArray(F.assetId, itemIds));
    return [...new Set(rows.flatMap((r) => [r.a, r.b]).filter((v): v is string => Boolean(v)))];
  }

  const service: LibraryService = {
    content,

    contentOfItems: cidsOf,

    async itemsSharingContent(itemIds) {
      const cids = await cidsOf(itemIds);
      if (!cids.length) return [];
      const rows = await db
        .selectDistinct({ id: F.assetId })
        .from(F)
        .where(sql`(${inArray(F.contentId, cids)} or ${inArray(F.originalContentId, cids)})`);
      return rows.map((r) => r.id).filter((id) => !itemIds.includes(id));
    },

    async currentContent(itemIds) {
      const files = await currentFiles(itemIds);
      return new Map([...files].flatMap(([id, f]) => (f.contentId ? [[id, f.contentId] as [string, string]] : [])));
    },

    async exportToIpfs(itemId) {
      const row = await itemRow(itemId);
      if (row.source !== "upload") throw refused("not_yours", "Only a station's own uploads can be exported to IPFS.");
      const file = (await currentFiles([itemId])).get(itemId);
      const cid = file?.originalContentId ?? file?.contentId;
      if (!cid) throw refused("not_ready", "It's still being prepared.");
      const published = await content.publishToIpfs(cid, "export", row.originalFilename ?? row.title);
      return { contentId: cid, ...published };
    },

    async titles({ itemIds, programIds }) {
      const [items, programs] = await Promise.all([
        itemIds.length ? db.select({ id: A.id, title: A.title }).from(A).where(inArray(A.id, itemIds)) : [],
        programIds.length ? db.select({ id: P.id, title: P.title }).from(P).where(inArray(P.id, programIds)) : []
      ]);
      return { items: new Map(items.map((r) => [r.id, r.title])), programs: new Map(programs.map((r) => [r.id, r.title])) };
    },

    async itemsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(A).where(inArray(A.id, [...new Set(ids)]));
      return new Map((await toRefs(rows)).map((r) => [r.id, r]));
    },

    async programsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(P).where(inArray(P.id, [...new Set(ids)]));
      return new Map(rows.map((r) => [r.id, programRef(r)]));
    },

    async programsForStation(stationId) {
      const rows = await db.select().from(P).where(eq(P.stationId, stationId)).orderBy(asc(P.title));
      return rows.map(programRef);
    },

    async episodes(programId) {
      const rows = await db
        .select()
        .from(A)
        .where(and(eq(A.programId, programId), isNull(A.archivedAt)))
        .orderBy(sql`${A.episodeNumber} nulls last`, asc(A.createdAt));
      return toRefs(rows);
    },

    async searchPrograms(q) {
      const rows = await db
        .select()
        .from(P)
        .where(ilike(P.title, `%${q.replace(/[%_]/g, "")}%`))
        .limit(20);
      return rows.map(programRef);
    },

    async readiness(stationId) {
      const [items] = await db
        .select({
          items: sql<number>`count(*)::int`,
          rightsConfirmed: sql<number>`count(${R.assetId})::int`
        })
        .from(A)
        .leftJoin(R, eq(R.assetId, A.id))
        .where(and(eq(A.stationId, stationId), isNull(A.archivedAt)));
      const [programs] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(P)
        .where(and(eq(P.stationId, stationId), sql`coalesce(${P.description}, '') = ''`));
      return { items: items.items, rightsConfirmed: items.rightsConfirmed, programsNeedingDescription: programs.n };
    },

    async hasLinkImports(programId) {
      const [row] = await db.select({ id: A.id }).from(A).where(and(eq(A.programId, programId), eq(A.source, "link"))).limit(1);
      return Boolean(row);
    },

    async fillers(stationId) {
      const rows = await db
        .select()
        .from(A)
        .where(and(eq(A.stationId, stationId), inArray(A.code, ["SID", "BMP"]), eq(A.status, "ready"), isNull(A.archivedAt)))
        .orderBy(asc(A.createdAt));
      const refs = (await toRefs(rows)).filter((r) => r.rightsConfirmed && (r.contentId || r.location) && !r.contentUnavailable && r.durationMs);
      return { stationIds: refs.filter((r) => r.code === "SID"), bumpers: refs.filter((r) => r.code === "BMP") };
    },

    async repeatable(stationId, limit) {
      const rows = await db
        .select()
        .from(A)
        .where(and(eq(A.stationId, stationId), eq(A.code, "PGM"), eq(A.status, "ready"), isNull(A.archivedAt)))
        .orderBy(sql`${A.createdAt} desc`)
        .limit(limit * 3);
      const offAir = await services.trust.offAirItems(rows.map((r) => r.id));
      return (await toRefs(rows)).filter((r) => r.rightsConfirmed && r.durationMs && !r.contentUnavailable && !offAir.has(r.id)).slice(0, limit);
    },

    async addCreatorWork(tx, input) {
      const [row] = await tx
        .insert(A)
        .values({
          stationId: input.stationId,
          programId: input.programId ?? null,
          title: input.title,
          code: "PGM",
          source: "creator_work",
          sourceUrl: input.sourceUrl,
          creatorWorkId: input.creatorWorkId,
          mediaKind: "video",
          durationMs: input.durationMs,
          status: "preparing"
        })
        .returning({ id: A.id });
      return row.id;
    },

    async confirmCreatorWorkRights(tx, itemId, input) {
      await tx.insert(R).values({
        assetId: itemId,
        basis: input.permissionRecordId ? "permission_record" : "licence_record",
        permissionRecordId: input.permissionRecordId ?? null,
        licenceRecordId: input.licenceRecordId ?? null,
        note: input.permissionRecordId ? "Permission from the owner" : "Published under a licence",
        confirmedAt: deps.clock.now()
      });
    },

    async library(stationId, filter) {
      const conditions = [eq(A.stationId, stationId), isNull(A.archivedAt)];
      if (filter.folderId) conditions.push(eq(A.folderId, filter.folderId));
      if (filter.code) conditions.push(eq(A.code, filter.code));
      const [rows, folders, programs, all] = await Promise.all([
        db.select().from(A).where(and(...conditions)).orderBy(asc(A.title)),
        db.select().from(schema.assetFolders).where(eq(schema.assetFolders.stationId, stationId)).orderBy(asc(schema.assetFolders.name)),
        db.select().from(P).where(eq(P.stationId, stationId)).orderBy(asc(P.title)),
        db
          .select({ id: A.id, folderId: A.folderId, status: A.status, source: A.source, rights: R.assetId })
          .from(A)
          .leftJoin(R, eq(R.assetId, A.id))
          .where(and(eq(A.stationId, stationId), isNull(A.archivedAt)))
      ]);
      let items = await toItems(rows);
      if (filter.needsAttention) items = items.filter((i) => !i.rights || i.status !== "ready");
      const perFolder = new Map<string, number>();
      for (const row of all) if (row.folderId) perFolder.set(row.folderId, (perFolder.get(row.folderId) ?? 0) + 1);
      return {
        items,
        folders: folders.map((f) => ({ id: f.id, name: f.name, parentFolderId: f.parentFolderId, itemCount: perFolder.get(f.id) ?? 0 })),
        programs: await programViews(programs),
        needsAttention: {
          rightsToConfirm: all.filter((r) => !r.rights).length,
          preparing: all.filter((r) => r.status === "preparing").length
        },
        importedFromLinks: all.filter((r) => r.source === "link").length
      };
    },

    async item(itemId) {
      const [item] = await toItems([await itemRow(itemId)]);
      return item;
    },

    async stationOfItem(itemId) {
      return (await itemRow(itemId)).stationId;
    },

    async stationOfProgram(programId) {
      const [row] = await db.select({ stationId: P.stationId }).from(P).where(eq(P.id, programId));
      if (!row) throw notFound("That program");
      return row.stationId;
    },

    async stationOfFolder(folderId) {
      const [row] = await db.select({ stationId: schema.assetFolders.stationId }).from(schema.assetFolders).where(eq(schema.assetFolders.id, folderId));
      if (!row) throw notFound("That folder");
      return row.stationId;
    },

    async upload(stationId, file, fields) {
      if (!file) throw badRequest("Choose a file to upload.", { file: "Required" });
      await checkOwnership(stationId, fields);
      const probe = await deps.media.probe(file.path).catch(() => null);
      if (!probe || probe.durationMs === null) throw refused("unreadable_file", "That file can't be read as video or audio.");
      // Keep the upload past the request: multer's temp file is removed when it ends.
      const keep = path.join(deps.config.storageRoot, "uploads", stationId, "originals");
      await fs.mkdir(keep, { recursive: true });
      const kept = path.join(keep, `${path.basename(file.path)}${path.extname(file.originalName)}`);
      await fs.copyFile(file.path, kept);

      const item = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(A)
          .values({
            stationId,
            programId: fields.programId ?? null,
            folderId: fields.folderId ?? null,
            title: fields.title ?? file.originalName.replace(/\.[^.]+$/, ""),
            episodeNumber: fields.episodeNumber ?? null,
            episodeDescription: fields.episodeDescription ?? null,
            code: fields.code ?? guessCode(probe.durationMs),
            source: "upload",
            mediaKind: probe.mediaKind,
            durationMs: probe.durationMs,
            widthPx: probe.width,
            heightPx: probe.height,
            originalFilename: file.originalName,
            status: "preparing",
            prepProgress: 0
          })
          .returning();
        if (fields.breakPointsMs?.length) await setBreakPoints(tx, row.id, fields.breakPointsMs);
        return row;
      });
      background(prepareInBackground(item.id, stationId, kept, probe.mediaKind));
      return service.item(item.id);
    },

    async updateItem(itemId, fields) {
      const row = await itemRow(itemId);
      await checkOwnership(row.stationId, fields);
      await db.transaction(async (tx) => {
        const patch: Partial<typeof A.$inferInsert> = {};
        for (const key of ["title", "code", "programId", "folderId", "episodeNumber", "episodeDescription"] as const) {
          if (fields[key] !== undefined) (patch as Record<string, unknown>)[key] = fields[key];
        }
        if (Object.keys(patch).length) await tx.update(A).set(patch).where(eq(A.id, itemId));
        if (fields.breakPointsMs) await setBreakPoints(tx, itemId, fields.breakPointsMs);
      });
      return service.item(itemId);
    },

    async archiveItem(itemId) {
      const row = await itemRow(itemId);
      const usage = await services.log.itemUsage(itemId);
      const carriers = row.programId ? await services.catalog.carrierCount(row.programId) : 0;
      if (usage.upcoming > 0 || carriers > 0) {
        const parts = [
          usage.upcoming ? `It's in ${usage.upcoming} log ${usage.upcoming === 1 ? "entry" : "entries"}` : null,
          carriers ? `carried by ${carriers} ${carriers === 1 ? "station" : "stations"}` : null
        ].filter(Boolean);
        throw refused("in_use", `Can't be deleted yet: ${parts.join(" and ")}.`);
      }
      await db.update(A).set({ archivedAt: deps.clock.now() }).where(eq(A.id, itemId));
      // Its files go too, unless another item, spot or order points at them, or a claim holds them.
      const fileIds = (await db.select({ id: F.id }).from(F).where(eq(F.assetId, itemId))).map((f) => f.id);
      await content.release("asset_file", fileIds);
      await content.release("asset_original", fileIds);
    },

    async archiveForClaim(itemId) {
      await db.update(A).set({ archivedAt: deps.clock.now() }).where(eq(A.id, itemId));
      // Resolved against it: the files leave storage, wherever else they're used.
      await content.takeDown(await cidsOf([itemId]));
    },

    async confirmRights(user, itemId, input) {
      await itemRow(itemId);
      await db
        .insert(R)
        .values({ assetId: itemId, basis: input.basis, confirmedBy: user.id, note: input.note ?? null, confirmedAt: deps.clock.now() })
        .onConflictDoUpdate({ target: R.assetId, set: { basis: input.basis, confirmedBy: user.id, note: input.note ?? null, confirmedAt: deps.clock.now() } });
      return service.item(itemId);
    },

    async importLinks(stationId, input) {
      if (input.programId) await checkOwnership(stationId, { programId: input.programId });
      const [row] = await db
        .insert(schema.importJobs)
        .values({ stationId, requestedUrls: input.urls, expandPlaylists: input.expandPlaylists, status: "queued", items: [] })
        .returning();
      background(runImport(row.id, stationId, input));
      return jobView(row);
    },

    async importJob(stationId, jobId) {
      const [row] = await db
        .select()
        .from(schema.importJobs)
        .where(and(eq(schema.importJobs.id, jobId), eq(schema.importJobs.stationId, stationId)));
      if (!row) throw notFound("That import");
      return jobView(row);
    },

    async createFolder(stationId, input) {
      if (input.parentFolderId && (await service.stationOfFolder(input.parentFolderId)) !== stationId) {
        throw badRequest("That folder isn't this station's.");
      }
      const [row] = await db.insert(schema.assetFolders).values({ stationId, name: input.name, parentFolderId: input.parentFolderId }).returning();
      return { id: row.id, name: row.name, parentFolderId: row.parentFolderId, itemCount: 0 };
    },

    async updateFolder(folderId, input) {
      const stationId = await service.stationOfFolder(folderId);
      if (input.parentFolderId) {
        const folders = await db.select().from(schema.assetFolders).where(eq(schema.assetFolders.stationId, stationId));
        const byId = new Map(folders.map((f) => [f.id, f]));
        if (!byId.has(input.parentFolderId)) throw badRequest("That folder isn't this station's.");
        for (let cursor: string | null = input.parentFolderId; cursor; cursor = byId.get(cursor)?.parentFolderId ?? null) {
          if (cursor === folderId) throw badRequest("A folder can't go inside itself.");
        }
      }
      const [row] = await db
        .update(schema.assetFolders)
        .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.parentFolderId !== undefined ? { parentFolderId: input.parentFolderId } : {}) })
        .where(eq(schema.assetFolders.id, folderId))
        .returning();
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.folderId, folderId), isNull(A.archivedAt)));
      return { id: row.id, name: row.name, parentFolderId: row.parentFolderId, itemCount: n };
    },

    async deleteFolder(folderId) {
      const [folder] = await db.select().from(schema.assetFolders).where(eq(schema.assetFolders.id, folderId));
      if (!folder) throw notFound("That folder");
      await db.transaction(async (tx) => {
        await tx.update(A).set({ folderId: null }).where(eq(A.folderId, folderId));
        await tx.update(schema.assetFolders).set({ parentFolderId: folder.parentFolderId }).where(eq(schema.assetFolders.parentFolderId, folderId));
        await tx.delete(schema.assetFolders).where(eq(schema.assetFolders.id, folderId));
      });
    },

    async createProgram(stationId, input) {
      const [row] = await db
        .insert(P)
        .values({
          stationId,
          title: input.title,
          description: input.description ?? null,
          category: input.category ?? null,
          advisory: input.advisory,
          isLive: input.live,
          rating: input.rating ?? null,
          // A children's rating makes it child-directed unless it says otherwise.
          childDirected: input.childDirected ?? isChildrensRating(input.rating)
        })
        .returning();
      return service.program(row.id);
    },

    async updateProgram(programId, input) {
      const patch: Partial<typeof P.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.category !== undefined) patch.category = input.category;
      if (input.advisory !== undefined) patch.advisory = input.advisory;
      if (input.live !== undefined) patch.isLive = input.live;
      if (input.rating !== undefined) patch.rating = input.rating;
      if (input.childDirected !== undefined) patch.childDirected = input.childDirected;
      else if (isChildrensRating(input.rating)) patch.childDirected = true;
      if (input.iabCategories !== undefined) patch.iabCategories = input.iabCategories ? [...new Set(input.iabCategories)] : null;
      if (Object.keys(patch).length) await db.update(P).set(patch).where(eq(P.id, programId));
      return service.program(programId);
    },

    async program(programId) {
      const rows = await db.select().from(P).where(eq(P.id, programId));
      const [view] = await programViews(rows);
      if (!view) throw notFound("That program");
      return view;
    },

    async settle() {
      await content.settle();
      while (jobs.size) await Promise.all([...jobs]);
    }
  };
  return service;
}
