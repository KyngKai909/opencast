import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { IDENT_LEGACY_CODE, isIdentCode, type CaptionTrack, type IdentCode, type ItemHistory, type LibraryItem } from "@opencast/contracts";
import { guessEpisode, iabContentCategories, isChildrensRating, nextEpisodes, type ContentRating } from "@opencast/domain";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser, UploadedFile } from "../../http.js";
import { badRequest, HttpError, notFound, refused } from "../../errors.js";
import { toWebVtt, vttContentId } from "../../lib/captions.js";
import { createContent, type Content } from "./content.js";
import { probeBackground } from "../playout/engine/background.js";
import { eligible, windowOf, type AirWindowRef, type BumperRole } from "../playout/engine/sequence.js";
import { createBlockOps, type BlockOps } from "./blocks.js";

export type { BlockRef } from "./blocks.js";

export { toWebVtt };

/** A library item's type: a log code, or (A242) an opener, closer or off-air card. */
type LogCode = "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN" | IdentCode;

/** What other modules need to know about a library item. */
export interface ItemRef {
  id: string;
  stationId: string;
  programId: string | null;
  title: string;
  episodeNumber: number | null;
  /** Programming Phase 2: its season, and a multi-part episode's shared words and part number. */
  seasonNumber: number | null;
  partOf: string | null;
  partNumber: number | null;
  /** The episode's description (up to 160 characters). */
  episodeDescription: string | null;
  code: LogCode;
  durationMs: number | null;
  status: "preparing" | "ready" | "failed";
  rightsConfirmed: boolean;
  /** Captions on the file (L7): none, generated or uploaded. */
  captions: "none" | "generated" | "uploaded";
  source: "upload" | "link" | "creator_work" | "library";
  mediaKind: "video" | "audio";
  /** The current file's content ID: the original, which playout prepares for air once. */
  contentId: string | null;
  /** Before content IDs: a disk path or URL playout reads directly. */
  location: string | null;
  /** Its file is locked by a rights claim, or gone: it can't air. */
  contentUnavailable: boolean;
  archived: boolean;
  /** Where the maker allows breaks inside it. */
  breakPointsMs: number[];
  /** A243: a bumper's role (null: Any). */
  bumperRole: BumperRole | null;
  /** A243: when it may air (null: any time). */
  airs: AirWindowRef | null;
  /** A244: the programming block it belongs to (null: the station's own). */
  programBlockId: string | null;
  /** Library order (oldest first). */
  createdAt: Date;
}

/** A244: a programming block's own items that can air: its IDs, bumpers, intros and outros, in library order. */
export interface BlockFillers {
  stationIds: ItemRef[];
  bumpers: ItemRef[];
  intros: ItemRef[];
  outros: ItemRef[];
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
  /** Files by content ID: storing, references, locks, IPFS. */
  content: Content;
  /**
   * Pay-as-you-go (added 2026-09-29): what each station keeps in storage, by content ID: its
   * items' files (originals included), their caption tracks and its relay background, each file
   * once per station however many items point at it, with the bytes of the stored files. The
   * prepared segments' bytes are playout's (`preparedBytes`).
   */
  storageUse(): Promise<Map<string, { originalBytes: number; contentIds: string[] }>>;
  /** A251 Phase 7: programs and other items uploaded (or imported) in a span, and their hours. */
  uploadsBetween(stationIds: string[] | null, from: Date, to: Date): Promise<{ items: number; programItems: number; hours: number }>;
  /** Every content ID an item's files point at (all versions, originals too). */
  contentOfItems(itemIds: string[]): Promise<string[]>;
  /** Other stations' items made from the same files (a takedown pulls them too). */
  itemsSharingContent(itemIds: string[]): Promise<string[]>;
  /** Every item's current content ID. */
  currentContent(itemIds: string[]): Promise<Map<string, string>>;
  /** The desk's station file (added 2026-10-07): every item a station has, archived ones too, newest first, with its rights and program. */
  stationUploads(stationId: string): Promise<Array<{ id: string; title: string; program: string | null; code: string; source: "upload" | "link" | "creator_work" | "library"; sourceUrl: string | null; originalFilename: string | null; mediaKind: "video" | "audio"; durationMs: number | null; status: "preparing" | "ready" | "failed"; addedAt: Date; archivedAt: Date | null; archivedBy: string | null; archivedReason: string | null; rights: { basis: string; note: string | null; confirmedAt: Date } | null; contentId: string | null }>>;
  /**
   * Added 2026-10-07: Opencast archives an item from the desk. It comes off every log from now on
   * (carriers' too) and is archived with who and why; its files stay, unlike a rights claim's takedown.
   */
  archiveByOpencast(itemId: string, by: string, reason: string): Promise<{ stationId: string; title: string; pulled: number }>;
  /**
   * Items to prepare for air (added 2026-09-29, prepare once): ready, rights confirmed, not archived,
   * whose rights were confirmed or whose file changed since `since`.
   */
  preparableSince(since: Date, limit: number): Promise<ItemRef[]>;
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
  /** A claimable station's works from its creator: how many are prepared for air, of how many (N5). */
  creatorWorkImports(stationIds: string[]): Promise<Map<string, { done: number; total: number }>>;
  hasLinkImports(programId: string): Promise<boolean>;
  /**
   * A station's own station IDs and bumpers, ready for air with rights confirmed. A244: a
   * programming block's items are never in the station's; they're in `blocks`, per block (its IDs,
   * bumpers, intros and outros).
   */
  fillers(stationId: string): Promise<{ stationIds: ItemRef[]; bumpers: ItemRef[]; blocks: Map<string, BlockFillers> }>;
  /**
   * A242: a station's own openers, closers and off-air cards, ready for air with rights confirmed,
   * in library order (oldest first, as station IDs and bumpers). An off-air card can be a still
   * (`durationMs` null: a picture, held for the sign-off slate's minute).
   */
  identity(stationId: string): Promise<{ openers: ItemRef[]; closers: ItemRef[]; offAirCards: ItemRef[] }>;
  /**
   * Added 2026-09-29: which of these stations have a station ID of their own ready with its rights
   * confirmed (the rest air a generated one).
   */
  withOwnStationId(stationIds: string[]): Promise<Set<string>>;
  /** A244: programming blocks (the block itself; where it airs is the log's). */
  blocks: BlockOps;
  /** Programs ready to repeat (for filling dead air), most recent first. */
  repeatable(stationId: string, limit: number): Promise<ItemRef[]>;
  /**
   * Programming Phase 2: what the episode walker needs for each of a station's programs: its
   * episodes, which of them can be repeated now, and what aired on the station.
   */
  episodeWalks(stationId: string, programIds: string[]): Promise<Map<string, EpisodeWalk>>;
  /** A claimable station's import of a covered creator work (the file comes later). */
  addCreatorWork(db: Executor, input: { stationId: string; creatorWorkId: string; title: string; durationMs: number | null; sourceUrl: string; programId?: string }): Promise<string>;

  /** A claimable station's rights: the permission or licence record that covers the work. */
  confirmCreatorWorkRights(db: Executor, itemId: string, input: { permissionRecordId?: string; licenceRecordId?: string }): Promise<void>;
  library(stationId: string, filter: { folderId?: string; code?: LogCode; needsAttention?: boolean; bumperRole?: BumperRole; programBlockId?: string }): Promise<LibraryView>;
  item(itemId: string): Promise<LibraryItem>;
  stationOfItem(itemId: string): Promise<string>;
  stationOfProgram(programId: string): Promise<string>;
  stationOfFolder(folderId: string): Promise<string>;
  /** With `captions` (WebVTT or SRT text, added 2026-09-29), the item gets its caption track at once. */
  /**
   * `options.id` (a direct upload, added 2026-09-30): the new item's ID, so completing it again after
   * a restart finds the item it made. A direct upload (`file.stored`) is kept before this returns.
   */
  upload(stationId: string, file: UploadedFile, fields: ItemFields & { captions?: string; captionLanguage?: string }, options?: { id?: string }): Promise<LibraryItem>;
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
  /** L1: a program's format, from its episodes and its maker's log. */
  format(programId: string): Promise<ProgramFormat>;
  /** L5: where an item is scheduled and aired, and whether it's ready. */
  history(itemId: string): Promise<ItemHistory>;
  /** L6: a new file for an item, through the same checks and preparation as an upload. */
  replaceFile(itemId: string, file: UploadedFile | null): Promise<LibraryItem>;
  /** L7: a program's captions mode and language. */
  setProgramCaptions(programId: string, captions: { mode: "none" | "generated_live" | "generated" | "uploaded"; language: string | null }): Promise<{ mode: "none" | "generated_live" | "generated" | "uploaded"; language: string | null }>;
  /** L7: an item's caption track. */
  captionTrack(itemId: string): Promise<CaptionTrack>;
  putCaptionTrack(itemId: string, userId: string | null, input: { language: string; text: string; source: "uploaded" | "edited" }): Promise<CaptionTrack>;
  removeCaptionTrack(itemId: string): Promise<void>;
  /** X2 (playout): the caption tracks of the items whose current file is `contentId`, to prepare with it. */
  captionTracksForContent(contentId: string): Promise<Array<{ itemId: string; language: string; vtt: string; contentId: string }>>;
  /** X2 (playout): items whose caption track was put since `since`. */
  captionTracksChangedSince(since: Date): Promise<string[]>;
  /** X2 (playout): each item's caption track, by the WebVTT's content ID. */
  captionTrackIds(itemIds: string[]): Promise<Map<string, string>>;
  /** X2 (playout): the language most of a station's programs are captioned in, or null. */
  stationCaptionLanguage(stationId: string): Promise<string | null>;
  /** Waits for uploads and imports started so far (tests, shutdown). */
  settle(): Promise<void>;
}

export interface ItemFields {
  title?: string;
  code?: LogCode;
  programId?: string | null;
  folderId?: string | null;
  episodeNumber?: number | null;
  /** Programming Phase 2: guessed at upload when not sent (season and episode from the file's name, the part from the title). */
  seasonNumber?: number | null;
  partOf?: string | null;
  partNumber?: number | null;
  episodeDescription?: string | null;
  breakPointsMs?: number[];
  /** A243: a bumper's role (null: Any). */
  bumperRole?: BumperRole | null;
  /** A243: when it may air (null: any time). */
  airs?: AirWindowRef | null;
  /** A244: the programming block it belongs to (null: the station's). */
  programBlockId?: string | null;
}

/** Programming Phase 2: one program's episodes on a station, for the walker (`@opencast/domain`'s `walkEpisodes`). */
export interface EpisodeWalk {
  /** Its programs (`PGM`), not archived, in episode order. */
  episodes: ItemRef[];
  /** Those that can be repeated now: ready, rights confirmed, a length, the file available, not taken off air. */
  repeatable: Set<string>;
  /** Its episodes' airings on the station, oldest first (the as-run log: the last 5,000 rows of the programs read together). */
  aired: string[];
}

/** Where each episode comes in its program's walk, In order from what aired (0 airs next), and what airs next. */
export function upNextOf(walk: EpisodeWalk): { ranks: Map<string, number>; next: Set<string> } {
  const ranks = new Map<string, number>();
  const next = new Set<string>();
  const episodes = walk.episodes.map((e) => ({ ...e, ready: walk.repeatable.has(e.id) }));
  for (const [i, airing] of nextEpisodes({ episodes, order: "in_order", seed: "", position: walk.aired }, episodes.length).entries()) {
    if (ranks.has(airing.episodes[0].id)) break;
    for (const e of airing.episodes) {
      ranks.set(e.id, ranks.size);
      if (i === 0) next.add(e.id);
    }
  }
  return { ranks, next };
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
  /** L7: null until the station says. */
  captions: { mode: "none" | "generated_live" | "generated" | "uploaded"; language: string | null } | null;
}

export interface ProgramFormat {
  kind: "series" | "one_off";
  cadence: "weekly" | "nightly" | "weeknights" | null;
  episodeLengthMs: number | null;
  bands: Array<"tv" | "radio">;
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

/** A242: an off-air card that's a picture: no length, nothing to prepare (it airs held, as a slate). */
const isStill = (r: { code: string; durationMs: number | null }) => r.code === "OFF" && r.durationMs === null;

/** A243: the types that can have a window (when they may air). */
const WINDOWED: string[] = ["BMP", "SID", "OPN", "CLS"];

/** A243: an item's window as columns (none: nothing to change), checked. */
function airingFields(code: string | null, fields: { airs?: AirWindowRef | null }): Partial<Pick<typeof A.$inferInsert, "airsFrom" | "airsUntil" | "dailyFrom" | "dailyUntil">> {
  if (fields.airs === undefined) return {};
  const w = fields.airs;
  if (w && (w.from || w.until || w.dailyFrom || w.dailyUntil) && code && !WINDOWED.includes(code)) {
    throw badRequest("Only bumpers, station IDs, openers and closers have times they air.", { airs: "Not for this type" });
  }
  if (!w) return { airsFrom: null, airsUntil: null, dailyFrom: null, dailyUntil: null };
  if (w.from && w.until && w.until < w.from) throw badRequest("The last day is before the first.", { "airs.until": "Before the first day" });
  if (Boolean(w.dailyFrom) !== Boolean(w.dailyUntil)) throw badRequest("Say both times of day, or neither.", { [w.dailyFrom ? "airs.dailyUntil" : "airs.dailyFrom"]: "Required" });
  if (w.dailyFrom && w.dailyFrom === w.dailyUntil) throw badRequest("The times of day can't be the same.", { "airs.dailyUntil": "Same as the start" });
  return { airsFrom: w.from, airsUntil: w.until, dailyFrom: w.dailyFrom, dailyUntil: w.dailyUntil };
}

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
      seasonNumber: r.seasonNumber,
      partOf: r.partOf,
      partNumber: r.partNumber,
      episodeDescription: r.episodeDescription,
      code: r.code,
      durationMs: r.durationMs,
      status: r.status,
      rightsConfirmed: confirmed.has(r.id),
      captions: r.captions,
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
      breakPointsMs: pointsBy.get(r.id) ?? [],
      bumperRole: r.bumperRole ?? null,
      airs: windowOf(r),
      programBlockId: r.programBlockId ?? null,
      createdAt: r.createdAt
    }));
  }

  async function toItems(rows: Array<typeof A.$inferSelect>): Promise<LibraryItem[]> {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const [rights, breakPoints, files, tracks] = await Promise.all([
      db.select().from(R).where(inArray(R.assetId, ids)),
      db.select().from(schema.assetBreakPoints).where(inArray(schema.assetBreakPoints.assetId, ids)),
      currentFiles(ids),
      db.select({ assetId: schema.captionTracks.assetId, language: schema.captionTracks.language }).from(schema.captionTracks).where(inArray(schema.captionTracks.assetId, ids))
    ]);
    const trackLanguage = new Map(tracks.map((t) => [t.assetId, t.language]));
    const info = await content.info([...files.values()].flatMap((f) => [f.contentId, f.originalContentId]).filter((v): v is string => Boolean(v)));
    const names = await services.accounts.displayNames(rights.map((r) => r.confirmedBy).filter((v): v is string => Boolean(v)));
    const rightsBy = new Map(rights.map((r) => [r.assetId, r]));
    const pointsBy = new Map<string, number[]>();
    for (const p of breakPoints) pointsBy.set(p.assetId, [...(pointsBy.get(p.assetId) ?? []), p.offsetMs].sort((a, b) => a - b));
    // A243: whether an item with a window is inside it now (the market's time).
    const windowed = [...new Set(rows.filter((r) => windowOf(r)).map((r) => r.stationId))];
    const zones = new Map(await Promise.all(windowed.map(async (id) => [id, await services.stations.timezoneOf(id)] as const)));
    const now = deps.clock.now().getTime();
    return rows.map((r) => {
      const right = rightsBy.get(r.id);
      const airs = windowOf(r);
      return {
        id: r.id,
        stationId: r.stationId,
        programId: r.programId,
        folderId: r.folderId,
        title: r.title,
        episodeNumber: r.episodeNumber,
        episodeDescription: r.episodeDescription,
        // A242: an opener, closer or off-air card keeps an old code for apps built before it.
        code: isIdentCode(r.code) ? IDENT_LEGACY_CODE[r.code] : r.code,
        identCode: isIdentCode(r.code) ? r.code : null,
        ...(isStill(r) ? { still: true } : {}),
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
          const stored = file?.contentId ? info.get(file.contentId) : undefined;
          if (!file?.contentId || !stored) return null;
          // Files from before 2026-09-29 point at a 1280 px copy, with the original beside it.
          const original = file.originalContentId ? info.get(file.originalContentId) : undefined;
          return {
            contentId: stored.cid,
            bytes: stored.bytes,
            // Stations whose items point at the same file (it's stored once).
            sharedWith: Math.max(0, stored.references - 1),
            locked: stored.locked,
            ipfs: original?.ipfs ?? stored.ipfs ?? null
          };
        })(),
        audioLayout: audioLayoutOf(r.audioChannels),
        captionLanguage: trackLanguage.get(r.id) ?? null,
        bumperRole: r.code === "BMP" ? (r.bumperRole ?? null) : null,
        airs,
        airingNow: airs ? eligible({ airs }, now, zones.get(r.stationId) ?? "UTC") : true,
        programBlockId: r.programBlockId ?? null,
        seasonNumber: r.seasonNumber,
        partOf: r.partOf,
        partNumber: r.partNumber,
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
          childDirected: p.childDirected,
          captions: p.captionsMode ? { mode: p.captionsMode, language: p.captionsLanguage } : null
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
    // A244: a block's items are its station's own, on a block that isn't archived.
    if (fields.programBlockId) {
      const [block] = await db.select({ stationId: schema.programBlocks.stationId, archivedAt: schema.programBlocks.archivedAt }).from(schema.programBlocks).where(eq(schema.programBlocks.id, fields.programBlockId));
      if (!block || block.stationId !== stationId || block.archivedAt) throw notFound("That block");
    }
  }

  /** A244: the types that can belong to a programming block (its bumpers, ID, intro and outro). */
  const BLOCK_KINDS: string[] = ["BMP", "SID", "OPN", "CLS"];

  /**
   * Keeps the upload: the original, stored once by its content ID in Infrequent Access. Playout
   * prepares it for air from this original (the fixed ladder, loudness levelled, captions), once;
   * nothing else is made from it here. Its loudness is measured from it for the library.
   */
  /**
   * What an upload is: video or audio with a length, or (A242, an off-air card only) a picture:
   * PNG, JPEG or WebP, with no length. Null when it's none of them.
   */
  async function probeItem(file: string, code: LogCode | undefined): Promise<Awaited<ReturnType<typeof deps.media.probe>> | null> {
    if (code === "OFF") {
      const picture = await probeBackground(file).catch(() => null);
      if (picture && !("error" in picture) && picture.kind === "image") return { durationMs: null, mediaKind: "video", width: picture.width, height: picture.height, audioChannels: null };
    }
    const probe = await deps.media.probe(file).catch(() => null);
    return probe && probe.durationMs !== null ? probe : null;
  }

  async function storeInBackground(itemId: string, stationId: string, file: string | UploadedFile, replacing?: { probe: Awaited<ReturnType<typeof deps.media.probe>>; originalName: string }) {
    try {
      await db.update(A).set({ prepProgress: 10 }).where(eq(A.id, itemId));
      // A direct upload (follow-up Phase 4) is in the store already: measured where it's staged
      // (Standard), then moved to its content ID in Infrequent Access. One read each, in that order.
      const [original, loudness] =
        typeof file === "string"
          ? await Promise.all([content.store(file, { storageClass: "infrequent" }), deps.media.loudness(file).catch(() => null)])
          : await deps.media
              .loudness(file.path)
              .catch(() => null)
              .then(async (lufs) => [await content.keep(file, { storageClass: "infrequent" }), lufs] as const);
      await db.transaction(async (tx) => {
        const [{ version }] = await tx.select({ version: max(F.version) }).from(F).where(eq(F.assetId, itemId));
        // `content_id` is the original. (`original_content_id` was for when it pointed at a copy; left empty now.)
        const [row] = await tx
          .insert(F)
          .values({ assetId: itemId, version: (version ?? 0) + 1, contentId: original.cid })
          .returning();
        await content.addRef(tx, original.cid, "asset_file", row.id);
        await tx.update(A).set({ status: "ready", prepProgress: 100, loudnessLufs: loudness }).where(eq(A.id, itemId));
        // L6: the new file's length and picture take over once it airs, not before.
        if (replacing) {
          const p = replacing.probe;
          await tx
            .update(A)
            .set({ durationMs: p.durationMs, mediaKind: p.mediaKind, widthPx: p.width, heightPx: p.height, audioChannels: p.audioChannels ?? null, originalFilename: replacing.originalName })
            .where(eq(A.id, itemId));
        }
      });
      // The local copy was only for the work; the store has it now.
      if (typeof file === "string") await fs.rm(file, { force: true });
      await afterReady(itemId, stationId, original.cid);
      // A direct upload starts its preparation for air now (the worker prepares it after what airs
      // within the hour); a form upload's waits until something needs it, as before.
      if (typeof file !== "string") {
        const [row] = await db.select({ code: A.code, mediaKind: A.mediaKind, durationMs: A.durationMs }).from(A).where(eq(A.id, itemId));
        const band = (await services.stations.idents([stationId])).get(stationId)?.band ?? "tv";
        // A still off-air card (A242) has nothing to prepare.
        if (row && !isStill(row)) await services.playout.previews([{ contentId: original.cid, mediaKind: row.mediaKind, band: row.mediaKind === "audio" ? "radio" : band, durationMs: row.durationMs }], { prepare: true });
      }
    } catch (error) {
      // A replacement that fails leaves the item as it was: the old file still airs.
      await db.update(A).set(replacing ? { status: "ready", prepProgress: 100 } : { status: "failed", prepProgress: null }).where(eq(A.id, itemId));
      throw error;
    }
  }

  /** The Opencast catalog is published to IPFS on purpose (the original); items in an open offer get their preview prepared. */
  async function afterReady(itemId: string, stationId: string, cid: string) {
    const [row] = await db.select({ title: A.title, programId: A.programId, mediaKind: A.mediaKind, durationMs: A.durationMs }).from(A).where(eq(A.id, itemId));
    if ((await services.stations.kindOf(stationId)) === "catalog" && deps.storage.ipfs.configured) {
      await content.publishToIpfs(cid, "catalog", row?.title ?? itemId).catch((error) => console.error("[library] catalog publish failed", error));
    }
    const offerId = row?.programId ? await services.catalog.openOfferFor(row.programId) : null;
    if (offerId && row) {
      const band = (await services.stations.idents([stationId])).get(stationId)?.band ?? "tv";
      await services.playout.previews([{ contentId: cid, mediaKind: row.mediaKind, band: row.mediaKind === "audio" ? "radio" : band, durationMs: row.durationMs }], { prepare: true });
    }
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
          .set({ mediaKind: probe.mediaKind, durationMs: probe.durationMs, widthPx: probe.width, heightPx: probe.height, audioChannels: probe.audioChannels ?? null, title: item.title ?? title })
          .where(eq(A.id, row.id));
        item.status = "processing";
        await setItems(items, "running");
        await storeInBackground(row.id, stationId, file);
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
    blocks: createBlockOps(ctx, content),

    async uploadsBetween(stationIds, from, to) {
      const A = schema.assets;
      const [r] = await db
        .select({ items: sql<number>`count(*)::int`, programItems: sql<number>`count(*) filter (where ${A.code} = 'PGM')::int`, ms: sql<number>`coalesce(sum(${A.durationMs}), 0)::float` })
        .from(A)
        .where(and(gte(A.createdAt, from), sql`${A.createdAt} < ${to}`, ...(stationIds ? [inArray(A.stationId, stationIds.length ? stationIds : ["00000000-0000-0000-0000-000000000000"])] : [])));
      return { items: r?.items ?? 0, programItems: r?.programItems ?? 0, hours: Math.round(((r?.ms ?? 0) / 3_600_000) * 10) / 10 };
    },

    async storageUse() {
      const CR = schema.contentRefs;
      const C = schema.contents;
      const rows = await db.execute<{ station_id: string; cid: string; bytes: string }>(sql`
        select distinct x.station_id, c.cid, c.bytes from (
          select a.station_id, r.cid from ${CR} r join ${F} f on f.id = r.owner_id join ${A} a on a.id = f.asset_id
            where r.owner in ('asset_file', 'asset_original')
          union
          select a.station_id, r.cid from ${CR} r join ${A} a on a.id = r.owner_id where r.owner = 'caption_track'
          union
          select r.owner_id as station_id, r.cid from ${CR} r where r.owner = 'relay_background'
        ) x join ${C} c on c.cid = x.cid and c.deleted_at is null`);
      const out = new Map<string, { originalBytes: number; contentIds: string[] }>();
      for (const r of rows.rows) {
        const entry = out.get(r.station_id) ?? { originalBytes: 0, contentIds: [] };
        entry.originalBytes += Number(r.bytes);
        entry.contentIds.push(r.cid);
        out.set(r.station_id, entry);
      }
      return out;
    },

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

    async stationUploads(stationId) {
      const rows = await db
        .select({
          id: A.id,
          title: A.title,
          program: P.title,
          code: A.code,
          source: A.source,
          sourceUrl: A.sourceUrl,
          originalFilename: A.originalFilename,
          mediaKind: A.mediaKind,
          durationMs: A.durationMs,
          status: A.status,
          addedAt: A.createdAt,
          archivedAt: A.archivedAt,
          archivedBy: A.archivedBy,
          archivedReason: A.archivedReason,
          basis: R.basis,
          note: R.note,
          confirmedAt: R.confirmedAt
        })
        .from(A)
        .leftJoin(P, eq(P.id, A.programId))
        .leftJoin(R, eq(R.assetId, A.id))
        .where(eq(A.stationId, stationId))
        .orderBy(sql`${A.createdAt} desc`);
      const content = await service.currentContent(rows.map((r) => r.id));
      return rows.map(({ basis, note, confirmedAt, ...r }) => ({
        ...r,
        code: String(r.code),
        source: r.source as "upload" | "link" | "creator_work" | "library",
        status: (r.status ?? "preparing") as "preparing" | "ready" | "failed",
        rights: basis && confirmedAt ? { basis: String(basis), note, confirmedAt } : null,
        contentId: content.get(r.id) ?? null
      }));
    },

    async currentContent(itemIds) {
      const files = await currentFiles(itemIds);
      return new Map([...files].flatMap(([id, f]) => (f.contentId ? [[id, f.contentId] as [string, string]] : [])));
    },

    async preparableSince(since, limit) {
      const rows = await db
        .selectDistinct({ asset: A })
        .from(A)
        .innerJoin(R, eq(R.assetId, A.id))
        .innerJoin(F, eq(F.assetId, A.id))
        .where(and(eq(A.status, "ready"), isNull(A.archivedAt), or(gte(R.confirmedAt, since), gte(F.createdAt, since))))
        .limit(limit);
      // A still off-air card (A242) has nothing to prepare: it airs as a slate.
      return (await toRefs(rows.map((r) => r.asset))).filter((r) => r.rightsConfirmed && (r.contentId || r.location) && !r.contentUnavailable && !isStill(r));
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

    async creatorWorkImports(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select({ stationId: A.stationId, total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${A.status} = 'ready')::int` })
        .from(A)
        .where(and(inArray(A.stationId, stationIds), eq(A.source, "creator_work"), isNull(A.archivedAt)))
        .groupBy(A.stationId);
      return new Map(rows.map((r) => [r.stationId, { done: r.done, total: r.total }]));
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
        .where(and(eq(A.stationId, stationId), inArray(A.code, ["SID", "BMP"]), eq(A.status, "ready"), isNull(A.archivedAt), isNull(A.programBlockId)))
        .orderBy(asc(A.createdAt), asc(A.id));
      const refs = (await toRefs(rows)).filter((r) => r.rightsConfirmed && (r.contentId || r.location) && !r.contentUnavailable && r.durationMs);
      // A244: a block's items air only during the block (its intros and outros are A242's types).
      const own = refs.filter((r) => !r.programBlockId);
      const blocks = new Map<string, BlockFillers>();
      const inBlocks = await db
        .select()
        .from(A)
        .where(and(eq(A.stationId, stationId), sql`${A.programBlockId} is not null`, inArray(A.code, ["SID", "BMP", "OPN", "CLS"]), eq(A.status, "ready"), isNull(A.archivedAt)))
        .orderBy(asc(A.createdAt), asc(A.id));
      for (const r of (await toRefs(inBlocks)).filter((r) => r.rightsConfirmed && (r.contentId || r.location) && !r.contentUnavailable && r.durationMs)) {
        const b = blocks.get(r.programBlockId!) ?? { stationIds: [], bumpers: [], intros: [], outros: [] };
        (r.code === "SID" ? b.stationIds : r.code === "BMP" ? b.bumpers : r.code === "OPN" ? b.intros : b.outros).push(r);
        blocks.set(r.programBlockId!, b);
      }
      return { stationIds: own.filter((r) => r.code === "SID"), bumpers: own.filter((r) => r.code === "BMP"), blocks };
    },

    async identity(stationId) {
      const rows = await db
        .select()
        .from(A)
        // A244: a block's intros and outros are the block's, never the station's openers and closers.
        .where(and(eq(A.stationId, stationId), inArray(A.code, ["OPN", "CLS", "OFF"]), eq(A.status, "ready"), isNull(A.archivedAt), isNull(A.programBlockId)))
        .orderBy(asc(A.createdAt), asc(A.id));
      // A still off-air card has no length; everything else needs one.
      const refs = (await toRefs(rows)).filter((r) => r.rightsConfirmed && (r.contentId || r.location) && !r.contentUnavailable && (r.durationMs || isStill(r)));
      return { openers: refs.filter((r) => r.code === "OPN"), closers: refs.filter((r) => r.code === "CLS"), offAirCards: refs.filter((r) => r.code === "OFF") };
    },

    async withOwnStationId(stationIds) {
      if (!stationIds.length) return new Set();
      const rows = await db
        .selectDistinct({ stationId: A.stationId })
        .from(A)
        .innerJoin(R, eq(R.assetId, A.id))
        .where(and(inArray(A.stationId, stationIds), eq(A.code, "SID"), eq(A.status, "ready"), isNull(A.archivedAt), isNull(A.programBlockId)));
      return new Set(rows.map((r) => r.stationId));
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

    async episodeWalks(stationId, programIds) {
      const ids = [...new Set(programIds)];
      if (!ids.length) return new Map();
      const rows = await db
        .select()
        .from(A)
        .where(and(eq(A.stationId, stationId), inArray(A.programId, ids), eq(A.code, "PGM"), isNull(A.archivedAt)))
        .orderBy(sql`${A.seasonNumber} nulls last`, sql`${A.episodeNumber} nulls last`, asc(A.createdAt), asc(A.id));
      const refs = await toRefs(rows);
      const [offAir, aired] = await Promise.all([
        services.trust.offAirItems(refs.map((r) => r.id)),
        refs.length
          ? db
              .select({ assetId: schema.asRun.assetId })
              .from(schema.asRun)
              .where(and(eq(schema.asRun.stationId, stationId), inArray(schema.asRun.assetId, refs.map((r) => r.id))))
              .orderBy(desc(schema.asRun.startedAt), desc(schema.asRun.id))
              .limit(5000)
          : Promise.resolve([])
      ]);
      const history = aired.map((a) => a.assetId!).reverse();
      const walks = new Map<string, EpisodeWalk>();
      for (const programId of ids) {
        const episodes = refs.filter((r) => r.programId === programId);
        const mine = new Set(episodes.map((e) => e.id));
        walks.set(programId, {
          episodes,
          repeatable: new Set(episodes.filter((r) => r.status === "ready" && r.rightsConfirmed && r.durationMs && !r.contentUnavailable && !offAir.has(r.id)).map((r) => r.id)),
          aired: history.filter((id) => mine.has(id))
        });
      }
      return walks;
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
      // A243: bumpers with a role (Any includes bumpers without one).
      if (filter.bumperRole) {
        conditions.push(eq(A.code, "BMP"));
        conditions.push(filter.bumperRole === "any" ? or(isNull(A.bumperRole), eq(A.bumperRole, "any"))! : eq(A.bumperRole, filter.bumperRole));
      }
      // A244: a programming block's items.
      if (filter.programBlockId) conditions.push(eq(A.programBlockId, filter.programBlockId));
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
      // Programming Phase 2: what the station's as-run log says about each item, and where each
      // program's episodes come in its walk (In order, as dead-air fill and repeats choose).
      const ids = items.map((i) => i.id);
      const [lastAired, walks] = await Promise.all([
        ids.length
          ? db
              .select({ assetId: schema.asRun.assetId, at: max(schema.asRun.startedAt) })
              .from(schema.asRun)
              .where(and(eq(schema.asRun.stationId, stationId), inArray(schema.asRun.assetId, ids)))
              .groupBy(schema.asRun.assetId)
          : Promise.resolve([]),
        service.episodeWalks(stationId, items.filter((i) => i.code === "PGM" && i.programId).map((i) => i.programId!))
      ]);
      const last = new Map(lastAired.map((r) => [r.assetId!, r.at]));
      const ranks = new Map<string, number>();
      const next = new Set<string>();
      for (const walk of walks.values()) {
        const up = upNextOf(walk);
        for (const [id, rank] of up.ranks) ranks.set(id, rank);
        for (const id of up.next) next.add(id);
      }
      items = items.map((i) => ({ ...i, neverAired: !last.get(i.id), lastAiredAt: last.get(i.id)?.toISOString() ?? null, upNext: ranks.get(i.id) ?? null, nextEpisode: next.has(i.id) }));
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

    async upload(stationId, file, fields, options = {}) {
      if (!file) throw badRequest("Choose a file to upload.", { file: "Required" });
      await checkOwnership(stationId, fields);
      // Pay-as-you-go: storage at its monthly cap takes nothing new until the month ends or the cap goes up.
      await services.billing.requireStorage(stationId);
      // A caption file sent with it is checked before anything is stored.
      if (fields.captions !== undefined && !toWebVtt(fields.captions)) throw refused("not_captions", "That isn't WebVTT or SRT captions.");
      // A direct upload picked up again after a restart: the item it made already.
      if (options.id && (await db.select({ id: A.id }).from(A).where(eq(A.id, options.id))).length) return service.item(options.id);
      const timing = airingFields(fields.code ?? null, fields);
      const probe = await probeItem(file.path, fields.code);
      if (!probe) throw refused("unreadable_file", fields.code === "OFF" ? "That file can't be read as a picture, video or audio." : "That file can't be read as video or audio.");
      // Keep the upload past the request: multer's temp file is removed when it ends. (A direct
      // upload is in the store already.)
      let kept: string | null = null;
      if (!file.stored) {
        const keep = path.join(deps.config.storageRoot, "uploads", stationId, "originals");
        await fs.mkdir(keep, { recursive: true });
        kept = path.join(keep, `${path.basename(file.path)}${path.extname(file.originalName)}`);
        await fs.copyFile(file.path, kept);
      }

      const title = fields.title ?? file.originalName.replace(/\.[^.]+$/, "");
      // Programming Phase 2: a program's season and episode from the file's name, and its part from
      // the title, unless they were sent. The station corrects them on the item's page.
      const guess = (fields.code ?? guessCode(probe.durationMs)) === "PGM" ? guessEpisode(file.originalName, title) : null;
      const numbered = fields.seasonNumber !== undefined || fields.episodeNumber !== undefined;
      const parted = fields.partOf !== undefined || fields.partNumber !== undefined;
      const item = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(A)
          .values({
            ...(options.id ? { id: options.id } : {}),
            stationId,
            programId: fields.programId ?? null,
            folderId: fields.folderId ?? null,
            title,
            episodeNumber: numbered ? (fields.episodeNumber ?? null) : (guess?.episodeNumber ?? null),
            seasonNumber: numbered ? (fields.seasonNumber ?? null) : (guess?.seasonNumber ?? null),
            partOf: parted ? (fields.partOf ?? null) : (guess?.partOf ?? null),
            partNumber: parted ? (fields.partNumber ?? null) : (guess?.partNumber ?? null),
            episodeDescription: fields.episodeDescription ?? null,
            code: fields.code ?? guessCode(probe.durationMs),
            source: "upload",
            mediaKind: probe.mediaKind,
            durationMs: probe.durationMs,
            widthPx: probe.width,
            heightPx: probe.height,
            audioChannels: probe.audioChannels ?? null,
            originalFilename: file.originalName,
            status: "preparing",
            prepProgress: 0,
            // A243: a role or window sent with it (a type guessed as a bumper takes a role too).
            ...(fields.bumperRole !== undefined && (fields.code ?? guessCode(probe.durationMs)) === "BMP" ? { bumperRole: fields.bumperRole } : {}),
            // A244: uploaded straight into a block (its bumper, ID, intro or outro).
            ...(fields.programBlockId && BLOCK_KINDS.includes(fields.code ?? guessCode(probe.durationMs)) ? { programBlockId: fields.programBlockId } : {}),
            ...timing
          })
          .returning();
        if (fields.breakPointsMs?.length) await setBreakPoints(tx, row.id, fields.breakPointsMs);
        return row;
      });
      if (fields.captions) {
        const [program] = item.programId ? await db.select({ language: P.captionsLanguage }).from(P).where(eq(P.id, item.programId)) : [];
        await service.putCaptionTrack(item.id, null, { language: fields.captionLanguage ?? program?.language ?? "en", text: fields.captions, source: "uploaded" });
      }
      if (kept) background(storeInBackground(item.id, stationId, kept));
      else await storeInBackground(item.id, stationId, file);
      return service.item(item.id);
    },

    async updateItem(itemId, fields) {
      const row = await itemRow(itemId);
      await checkOwnership(row.stationId, fields);
      if (fields.code && fields.code !== row.code) {
        // A242: a picture can only be an off-air card; openers, closers and off-air cards don't go on the log.
        if (isStill(row)) throw refused("still_image", "It's a picture, so it can only be an off-air card. Upload a clip to use it as something else.");
        if (isIdentCode(fields.code) && (await services.log.itemUsage(itemId)).upcoming > 0) {
          throw new HttpError(409, "on_the_log", "It's on the log. Take it off the log first: openers, closers and off-air cards air at sign-off and sign-on, not from the log.");
        }
      }
      // A243: a role is a bumper's, and a window a bumper's, station ID's, opener's or closer's. A
      // new type that can't have them clears them.
      const code = fields.code ?? row.code;
      if (fields.bumperRole != null && code !== "BMP") throw badRequest("Only a bumper has a role.", { bumperRole: "Not a bumper" });
      // A244: bumpers, station IDs, openers and closers can belong to a block.
      if (fields.programBlockId && !BLOCK_KINDS.includes(code)) throw badRequest("Only bumpers, station IDs, openers and closers can be part of a block.", { programBlockId: "Not for this type" });
      const timing = airingFields(code, fields);
      await db.transaction(async (tx) => {
        const patch: Partial<typeof A.$inferInsert> = { ...timing };
        for (const key of ["title", "code", "programId", "folderId", "episodeNumber", "seasonNumber", "partOf", "partNumber", "episodeDescription", "bumperRole", "programBlockId"] as const) {
          if (fields[key] !== undefined) (patch as Record<string, unknown>)[key] = fields[key];
        }
        if (code !== "BMP" && row.bumperRole !== null) patch.bumperRole = null;
        if (!BLOCK_KINDS.includes(code) && row.programBlockId !== null) patch.programBlockId = null;
        if (!WINDOWED.includes(code) && windowOf(row)) Object.assign(patch, { airsFrom: null, airsUntil: null, dailyFrom: null, dailyUntil: null });
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

    async archiveByOpencast(itemId, by, reason) {
      const row = await itemRow(itemId);
      const pulled = await services.log.pullItem(itemId);
      await db.update(A).set({ archivedAt: deps.clock.now(), archivedBy: by, archivedReason: reason }).where(eq(A.id, itemId));
      return { stationId: row.stationId, title: row.title, pulled: pulled.reduce((t, p) => t + p.entries, 0) };
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
      await services.billing.requireStorage(stationId);
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

    async format(programId) {
      const [row] = await db.select().from(P).where(eq(P.id, programId));
      if (!row) throw notFound("That program");
      const [episodes, cadence, idents] = await Promise.all([service.episodes(programId), services.log.cadence(row.stationId, programId), services.stations.idents([row.stationId])]);
      const lengths = episodes.map((e) => e.durationMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
      const median = lengths.length ? lengths[Math.floor((lengths.length - 1) / 2)] : null;
      const band = idents.get(row.stationId)?.band ?? null;
      const allAudio = episodes.length > 0 && episodes.every((e) => e.mediaKind === "audio");
      return {
        kind: episodes.length > 1 || row.isLive ? "series" : "one_off",
        cadence,
        episodeLengthMs: median,
        bands: allAudio ? ["radio"] : band ? [band] : ["tv"]
      };
    },

    async history(itemId) {
      const row = await itemRow(itemId);
      const [[ref], schedule, aired, track, program, carriers, terms] = await Promise.all([
        toRefs([row]),
        services.log.itemSchedule(itemId, 50),
        services.playout.airedItem(itemId, 200),
        db.select().from(schema.captionTracks).where(eq(schema.captionTracks.assetId, itemId)),
        row.programId ? db.select().from(P).where(eq(P.id, row.programId)) : Promise.resolve([]),
        row.programId ? services.catalog.carrierCount(row.programId) : Promise.resolve(0),
        row.programId && row.source !== "link" ? services.catalog.openOfferTerms(row.programId) : Promise.resolve(null)
      ]);
      const idents = await services.stations.idents([row.stationId, ...schedule.entries.map((e) => e.stationId), ...aired.map((a) => a.stationId)]);
      const preparation = ref && (ref.contentId || ref.location) ? await services.playout.preparation(ref, idents.get(row.stationId)?.band ?? "tv") : { status: "not_asked" as const, renditions: [], preparedAt: null, converted: [] };
      const agreements = await services.catalog.agreementsByIds(aired.map((a) => a.carriageAgreementId).filter((v): v is string => Boolean(v)));
      const term = terms?.[0];
      return {
        itemId,
        scheduled: schedule.entries.flatMap((e) => {
          const station = idents.get(e.stationId);
          return station ? [{ entryId: e.entryId, startsAt: e.startsAt, station, note: e.localNote }] : [];
        }),
        aired: aired.flatMap((a) => {
          const station = idents.get(a.stationId);
          if (!station) return [];
          const agreement = a.carriageAgreementId ? agreements.get(a.carriageAgreementId) : undefined;
          return [
            {
              startedAt: a.startedAt.toISOString(),
              station,
              carried: a.stationId !== row.stationId,
              audioOnly: row.mediaKind === "audio" || station.band === "radio" || Boolean(agreement?.audioOnly),
              note: a.reason === "dead_air_fill" ? "Filled dead air" : null
            }
          ];
        }),
        logEntries: schedule.total,
        carriers,
        // Prepared for air (prepare once): the worker has nothing else to fetch.
        cachedForAir: preparation.status === "ready" && !ref?.contentUnavailable,
        preparation,
        audioLayout: audioLayoutOf(row.audioChannels),
        captionLanguage: track[0]?.language ?? program[0]?.captionsLanguage ?? null,
        carriage: {
          offered: Boolean(terms),
          program: program[0]?.title ?? null,
          terms: term ? (term === "cash_plus_barter" ? "cash_and_barter" : term) : null
        }
      };
    },

    async replaceFile(itemId, file) {
      if (!file) throw badRequest("Choose a file to upload.", { file: "Required" });
      const row = await itemRow(itemId);
      if (row.source !== "upload") throw new HttpError(409, "not_an_upload", row.source === "link" ? "It came from a link: import it again instead." : "Only uploads can be replaced here.");
      const [ref] = await toRefs([row]);
      if (ref?.contentUnavailable) throw new HttpError(409, "claim_open", "A rights claim is open against this file. Answer the claim first.");
      if (row.status === "preparing") throw new HttpError(409, "preparing", "It's still being prepared. Try again when it's ready.");
      // The same checks as an upload: it has to read as video or audio.
      // An off-air card (A242) can be a picture or a clip, and change from one to the other.
      const probe = await probeItem(file.path, row.code);
      if (!probe) throw refused("unreadable_file", row.code === "OFF" ? "That file can't be read as a picture, video or audio." : "That file can't be read as video or audio.");
      if (row.code !== "OFF" && probe.mediaKind !== row.mediaKind) throw refused("wrong_kind", row.mediaKind === "video" ? "That's audio. Replace a video with a video." : "That's video. Replace audio with audio.");
      // It has to fit every slot it's already on the log in.
      const { shortestSlotMs } = await services.log.itemSchedule(itemId, 1);
      if (shortestSlotMs !== null && probe.durationMs !== null && probe.durationMs > shortestSlotMs + 1000) {
        throw refused("too_long_for_log", "The new file is longer than a slot it's on the log in. Make the slot longer first, or use a shorter cut.");
      }
      // The current file airs until the new one is ready.
      if (file.stored) {
        await db.update(A).set({ status: "preparing", prepProgress: 0 }).where(eq(A.id, itemId));
        await storeInBackground(itemId, row.stationId, file, { probe, originalName: file.originalName });
        return service.item(itemId);
      }
      const keep = path.join(deps.config.storageRoot, "uploads", row.stationId, "originals");
      await fs.mkdir(keep, { recursive: true });
      const kept = path.join(keep, `${path.basename(file.path)}${path.extname(file.originalName)}`);
      await fs.copyFile(file.path, kept);
      await db.update(A).set({ status: "preparing", prepProgress: 0 }).where(eq(A.id, itemId));
      background(storeInBackground(itemId, row.stationId, kept, { probe, originalName: file.originalName }));
      return service.item(itemId);
    },

    async setProgramCaptions(programId, captions) {
      await db.update(P).set({ captionsMode: captions.mode, captionsLanguage: captions.language }).where(eq(P.id, programId));
      return captions;
    },

    async captionTrack(itemId) {
      await itemRow(itemId);
      const [track] = await db.select().from(schema.captionTracks).where(eq(schema.captionTracks.assetId, itemId));
      if (!track) throw notFound("Its caption track");
      return { itemId, language: track.language, source: track.source, vtt: track.vtt, updatedAt: track.updatedAt.toISOString() };
    },

    async putCaptionTrack(itemId, userId, input) {
      await itemRow(itemId);
      const vtt = toWebVtt(input.text);
      if (!vtt) throw refused("not_captions", "That isn't WebVTT or SRT captions.");
      // Stored by content ID, like media (the text stays in the row too, for editing). The worker
      // cuts it into the item's segments when it prepares the item, or within a minute if it has.
      const { cid } = vttContentId(vtt);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-captions-"));
      try {
        const file = path.join(dir, "track.vtt");
        await fs.writeFile(file, vtt);
        await content.store(file, { storageClass: "standard", contentType: "text/vtt" });
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
      const [before] = await db.select({ contentId: schema.captionTracks.contentId }).from(schema.captionTracks).where(eq(schema.captionTracks.assetId, itemId));
      const values = { assetId: itemId, language: input.language, vtt, contentId: cid, source: input.source, updatedBy: userId, updatedAt: deps.clock.now() };
      await db.transaction(async (tx) => {
        await tx.insert(schema.captionTracks).values(values).onConflictDoUpdate({ target: schema.captionTracks.assetId, set: values });
        await tx.update(A).set({ captions: "uploaded" }).where(eq(A.id, itemId));
        await content.addRef(tx, cid, "caption_track", itemId);
      });
      if (before?.contentId && before.contentId !== cid) await content.releaseOne(before.contentId, "caption_track", itemId);
      return service.captionTrack(itemId);
    },

    async removeCaptionTrack(itemId) {
      await itemRow(itemId);
      await db.transaction(async (tx) => {
        await tx.delete(schema.captionTracks).where(eq(schema.captionTracks.assetId, itemId));
        await tx.update(A).set({ captions: "none" }).where(eq(A.id, itemId));
      });
      await content.release("caption_track", [itemId]);
    },

    async captionTracksForContent(contentId) {
      const files = await db.selectDistinct({ assetId: F.assetId }).from(F).where(eq(F.contentId, contentId));
      if (!files.length) return [];
      const current = await service.currentContent(files.map((f) => f.assetId));
      const ids = files.map((f) => f.assetId).filter((id) => current.get(id) === contentId);
      if (!ids.length) return [];
      const rows = await db.select().from(schema.captionTracks).where(inArray(schema.captionTracks.assetId, ids));
      const out = [];
      for (const r of rows) {
        let cid = r.contentId;
        // Tracks from before content IDs get theirs, so the playlists can find them.
        if (!cid) {
          cid = vttContentId(r.vtt).cid;
          await db.update(schema.captionTracks).set({ contentId: cid }).where(eq(schema.captionTracks.assetId, r.assetId));
        }
        out.push({ itemId: r.assetId, language: r.language, vtt: r.vtt, contentId: cid });
      }
      return out;
    },

    async captionTracksChangedSince(since) {
      const rows = await db.select({ assetId: schema.captionTracks.assetId }).from(schema.captionTracks).where(gt(schema.captionTracks.updatedAt, since));
      return rows.map((r) => r.assetId);
    },

    async captionTrackIds(itemIds) {
      const ids = [...new Set(itemIds)];
      if (!ids.length) return new Map();
      const rows = await db.select({ assetId: schema.captionTracks.assetId, contentId: schema.captionTracks.contentId }).from(schema.captionTracks).where(inArray(schema.captionTracks.assetId, ids));
      return new Map(rows.flatMap((r) => (r.contentId ? [[r.assetId, r.contentId] as [string, string]] : [])));
    },

    async stationCaptionLanguage(stationId) {
      const [top] = await db
        .select({ language: P.captionsLanguage })
        .from(P)
        .where(and(eq(P.stationId, stationId), sql`${P.captionsLanguage} is not null`))
        .groupBy(P.captionsLanguage)
        .orderBy(sql`count(*) desc`, P.captionsLanguage)
        .limit(1);
      return top?.language ?? null;
    },

    async settle() {
      await content.settle();
      while (jobs.size) await Promise.all([...jobs]);
    }
  };
  return service;
}

/** L5: the audio layout from the file's channels. */
function audioLayoutOf(channels: number | null): "mono" | "stereo" | "surround" | null {
  if (!channels) return null;
  return channels === 1 ? "mono" : channels === 2 ? "stereo" : "surround";
}

