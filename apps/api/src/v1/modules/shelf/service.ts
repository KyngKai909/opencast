// The catalog's shelf (added 2026-09-29, follow-up Phase 0 item 10): Opencast's own series, each
// built from items (a library file by content ID) with their own rights record, checked by two
// people with evidence, and composed into episodes. Owns the catalog.shelf_* tables; series are
// programs on a catalog station (the library's), offered through the syndication market (catalog).
//
// When an item fails (a renewal turns up, a rights claim), it comes out of every episode it's in,
// and only those episodes are composed again. Each composed episode is a new version of its library
// item, so playout prepares only what changed, once, and carriers air it from their next airing.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ChecklistLine, ChecklistLineName, DeskPerson, EpisodeView, LineState, RebuildView, Shelf, ShelfItem, ShelfItemRow, ShelfSeries, ShelfSeriesRow, StationIdent } from "@opencast/contracts";
import { SHELF_BASIS_LABELS } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser, UploadedFile } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { basisLine, basisOf, checklistFor, readPublicDomain, type ItemFacts } from "./publicDomain.js";
import { composeFiles, compositionKey, scratch } from "./compose.js";

export interface ShelfService {
  shelf(user: CurrentUser): Promise<Shelf>;
  createSeries(user: CurrentUser, input: { title: string; description?: string; rightsBasis: ShelfSeries["rightsBasis"]; basisNote?: string; notes?: string; mediaKind: "video" | "audio"; episodeLengthMs?: number; colour?: string; coming?: boolean; stationId?: string }): Promise<ShelfSeries>;
  series(user: CurrentUser, seriesId: string): Promise<ShelfSeries>;
  libraryChoices(seriesId: string): Promise<Array<{ libraryItemId: string; title: string; contentId: string; lengthMs: number | null; mediaKind: "video" | "audio" }>>;
  addItem(user: CurrentUser, seriesId: string, input: { libraryItemId: string; title?: string; source: string; workKind: "film" | "sound_recording"; publishedYear?: number; country: string; usGovernment?: boolean }): Promise<ShelfItem>;
  item(user: CurrentUser, itemId: string): Promise<ShelfItem>;
  setCheck(user: CurrentUser, itemId: string, line: ChecklistLineName, input: { state: LineState; detail?: string | null; record?: string | null }): Promise<ShelfItem>;
  addEvidence(user: CurrentUser, itemId: string, line: ChecklistLineName, file: UploadedFile | null): Promise<ShelfItem>;
  send(user: CurrentUser, itemId: string): Promise<ShelfItem>;
  secondCheck(user: CurrentUser, itemId: string, input: { decision: "confirm" | "return" | "fail"; note?: string }): Promise<ShelfItem>;
  fail(user: CurrentUser, itemId: string, reason: string): Promise<{ item: ShelfItem; rebuild: RebuildView }>;
  setEpisode(user: CurrentUser, seriesId: string, number: number, input: { title?: string | null; itemIds: string[] }): Promise<EpisodeView>;
  rebuild(user: CurrentUser | null, seriesId: string, reason?: string, itemId?: string | null): Promise<RebuildView>;
  /** Waits for episodes being composed (tests, shutdown). */
  settle(): Promise<void>;
  /** Catalog sponsors (added 2026-09-29): every series that isn't "coming", by the program it's offered as. */
  catalogSeries(): Promise<Array<{ id: string; title: string; colour: string | null; programId: string; stationId: string }>>;
}

const EVIDENCE_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp|heic)|text\/plain)$/;
const EVIDENCE_EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp|heic|txt)$/i;
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_TOO_BIG = "Attach a file of 20 MB or less.";
const LINES: ChecklistLineName[] = ["source", "published", "renewal", "soundtrack", "trademarks"];
/** Lines that count as answered: yes (with evidence), yes with a caution (with evidence), or not needed by the rules. */
const ANSWERED = new Set<LineState>(["ok", "warn", "not_needed"]);

export function createShelfService({ deps, services }: ModuleContext): ShelfService {
  const { db } = deps;
  const S = schema.shelfSeries;
  const I = schema.shelfItems;
  const CK = schema.shelfItemChecks;
  const EV = schema.shelfItemEvidence;
  const E = schema.shelfEpisodes;
  const EI = schema.shelfEpisodeItems;
  const RB = schema.shelfRebuilds;

  const jobs = new Set<Promise<unknown>>();
  const background = (work: Promise<unknown>) => {
    const tracked = work.catch((error) => console.error("[shelf] composing failed", error)).finally(() => jobs.delete(tracked));
    jobs.add(tracked);
  };

  async function people(ids: Array<string | null | undefined>): Promise<Map<string, DeskPerson>> {
    const found = await services.accounts.peopleByIds(ids.filter((i): i is string => !!i));
    return new Map([...found].map(([id, p]) => [id, { userId: id, name: p.name }]));
  }

  async function rules(at: Date) {
    const [works, sound] = await Promise.all([services.settings.valueAt("rights.public_domain_us", at), services.settings.valueAt("rights.sound_recordings_us", at)]);
    return { works, sound };
  }

  const factsOf = (item: typeof I.$inferSelect): ItemFacts => ({ workKind: item.workKind, publishedYear: item.publishedYear, country: item.country, usGovernment: item.basis === "us_government" });

  async function seriesRow(seriesId: string) {
    const [row] = await db.select().from(S).where(eq(S.id, seriesId));
    if (!row) throw notFound("That series");
    return row;
  }

  async function itemRow(itemId: string) {
    const [row] = await db.select().from(I).where(eq(I.id, itemId));
    if (!row) throw notFound("That item");
    return row;
  }

  function itemRowView(item: typeof I.$inferSelect, reading: ReturnType<typeof readPublicDomain>, who: Map<string, DeskPerson>): ShelfItemRow {
    const person = (id: string | null) => (id ? (who.get(id) ?? { userId: id, name: "Someone on the team" }) : null);
    return {
      id: item.id,
      title: item.title,
      source: item.source,
      workKind: item.workKind,
      publishedYear: item.publishedYear,
      basisLine: item.state === "passed" || item.state === "second_check" ? basisLine(item.basis, item.publishedYear, reading) : item.state === "failed" ? (item.failedReason ?? "Failed its check") : reading.line,
      lengthMs: item.durationMs,
      state: item.state,
      firstCheck: item.firstCheckedBy && item.firstCheckedAt ? { by: person(item.firstCheckedBy)!, at: item.firstCheckedAt.toISOString() } : null,
      secondCheck: item.secondCheckedBy && item.secondCheckedAt ? { by: person(item.secondCheckedBy)!, at: item.secondCheckedAt.toISOString() } : null,
      failed: item.failedAt ? { by: person(item.failedBy), at: item.failedAt.toISOString(), reason: item.failedReason ?? "" } : null
    };
  }

  /** Why the checklist can't be sent yet, or null. */
  function cantSend(lines: ChecklistLine[], basisFound: boolean, reading: ReturnType<typeof readPublicDomain>): string | null {
    for (const l of lines) {
      if (l.state === "fail") return `"${l.title}" says it isn't free to air.`;
      if (!ANSWERED.has(l.state)) return `"${l.title}" isn't answered yet.`;
      if (l.state !== "not_needed" && !l.evidence.length && !l.record?.trim()) return `"${l.title}" has no evidence: attach a file or write down the record.`;
    }
    if (!basisFound) return `The rules don't make it public domain: ${reading.line}.`;
    return null;
  }

  async function itemView(user: CurrentUser, itemId: string): Promise<ShelfItem> {
    const item = await itemRow(itemId);
    const now = deps.clock.now();
    const [series, checks, evidence, episodeRows, ruleSet, mayEdit] = await Promise.all([
      seriesRow(item.seriesId),
      db.select().from(CK).where(eq(CK.itemId, itemId)),
      db.select().from(EV).where(eq(EV.itemId, itemId)).orderBy(asc(EV.createdAt)),
      db.select({ episodeId: EI.episodeId, removedAt: EI.removedAt, number: E.number }).from(EI).innerJoin(E, eq(E.id, EI.episodeId)).where(eq(EI.itemId, itemId)).orderBy(asc(E.number)),
      rules(now),
      services.settings.mayDesk(user, "rights")
    ]);
    const reading = readPublicDomain(factsOf(item), ruleSet, now);
    const who = await people([item.firstCheckedBy, item.secondCheckedBy, item.failedBy, ...checks.map((c) => c.setBy), ...evidence.map((e) => e.uploadedBy)]);
    const urls = new Map(await Promise.all(evidence.map(async (e) => [e.id, await services.library.content.url(e.contentId)] as const)));
    const checklist: ChecklistLine[] = checklistFor(factsOf(item), reading).map((t) => {
      const row = checks.find((c) => c.line === t.line);
      return {
        line: t.line,
        title: t.title,
        help: t.help,
        state: row?.state ?? t.prefill?.state ?? "todo",
        detail: row?.detail ?? t.prefill?.detail ?? null,
        record: row?.record ?? null,
        evidence: evidence
          .filter((e) => e.line === t.line)
          .map((e) => ({
            id: e.id,
            fileName: e.fileName,
            contentType: e.contentType,
            bytes: e.bytes,
            contentId: e.contentId,
            url: urls.get(e.id) ?? "",
            uploadedBy: who.get(e.uploadedBy) ?? { userId: e.uploadedBy, name: "Someone on the team" },
            at: e.createdAt.toISOString()
          })),
        prefilled: !!row && row.setBy === null && row.state !== "todo",
        setBy: row?.setBy ? (who.get(row.setBy) ?? null) : null,
        setAt: row?.setAt?.toISOString() ?? null
      };
    });
    const renewal = checklist.find((l) => l.line === "renewal")?.state ?? "todo";
    const basisFound = item.basis === "us_government" || basisOf(reading, renewal) !== null;
    return {
      ...itemRowView(item, reading, who),
      seriesId: series.id,
      seriesTitle: series.title,
      country: item.country,
      basis: item.basis,
      contentId: item.contentId,
      libraryItemId: item.libraryItemId,
      checklist,
      publicDomain: reading,
      cantSendBecause: item.state === "checking" ? cantSend(checklist, basisFound, reading) : null,
      canSecondCheck: item.state === "second_check" && mayEdit && item.firstCheckedBy !== user.id,
      canEdit: mayEdit,
      episodes: episodeRows.map((r) => ({ episodeId: r.episodeId, number: r.number, removed: r.removedAt !== null }))
    };
  }

  async function episodeViews(seriesId: string): Promise<EpisodeView[]> {
    const eps = await db.select().from(E).where(eq(E.seriesId, seriesId)).orderBy(asc(E.number));
    if (!eps.length) return [];
    const links = await db
      .select()
      .from(EI)
      .where(
        inArray(
          EI.episodeId,
          eps.map((e) => e.id)
        )
      );
    const items = links.length ? await db.select().from(I).where(inArray(I.id, [...new Set(links.map((l) => l.itemId))])) : [];
    const now = deps.clock.now();
    const ruleSet = await rules(now);
    const who = await people(items.flatMap((i) => [i.firstCheckedBy, i.secondCheckedBy]));
    const byId = new Map(items.map((i) => [i.id, i]));
    return eps.map((e) => {
      const mine = links
        .filter((l) => l.episodeId === e.id)
        .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || (a.removedAt?.getTime() ?? 0) - (b.removedAt?.getTime() ?? 0));
      const rows = mine.flatMap((l) => {
        const item = byId.get(l.itemId);
        if (!item) return [];
        const reading = readPublicDomain(factsOf(item), ruleSet, now);
        return [
          {
            itemId: item.id,
            title: item.title,
            source: item.source,
            publishedYear: item.publishedYear,
            basisLine: l.removedAt ? (item.failedReason ?? "Taken out") : basisLine(item.basis, item.publishedYear, reading),
            lengthMs: item.durationMs,
            position: l.position,
            removedAt: l.removedAt?.toISOString() ?? null,
            removedReason: l.removedReason,
            checkedBy: [item.firstCheckedBy, item.secondCheckedBy].flatMap((id) => (id && who.get(id) ? [who.get(id)!.name] : []))
          }
        ];
      });
      return {
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        version: e.version,
        lengthMs: rows.filter((r) => r.position !== null).reduce((sum, r) => sum + (r.lengthMs ?? 0), 0),
        error: e.error,
        composedAt: e.composedAt?.toISOString() ?? null,
        libraryItemId: e.libraryItemId,
        items: rows
      };
    });
  }

  async function rebuildViews(seriesId: string, limit = 10): Promise<RebuildView[]> {
    const rows = await db.select().from(RB).where(eq(RB.seriesId, seriesId)).orderBy(desc(RB.at), desc(RB.seq)).limit(limit);
    const itemIds = rows.map((r) => r.itemId).filter((i): i is string => !!i);
    const items = itemIds.length ? await db.select({ id: I.id, title: I.title }).from(I).where(inArray(I.id, itemIds)) : [];
    const who = await people(rows.map((r) => r.by));
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      by: r.by ? (who.get(r.by) ?? null) : null,
      reason: r.reason,
      item: r.itemId ? (items.find((i) => i.id === r.itemId) ?? null) : null,
      episodes: r.episodes,
      unchanged: r.unchanged
    }));
  }

  /** Stations airing each series: under an agreement, or with its episodes on their log (the catalog station itself is "home"). */
  async function carriersOf(seriesRows: Array<typeof S.$inferSelect>) {
    const programIds = seriesRows.map((s) => s.programId);
    const agreements = await services.catalog.carriersOf(programIds);
    const eps = seriesRows.length
      ? await db
          .select({ seriesId: E.seriesId, libraryItemId: E.libraryItemId })
          .from(E)
          .where(
            inArray(
              E.seriesId,
              seriesRows.map((s) => s.id)
            )
          )
      : [];
    const out = new Map<string, Map<string, "agreement" | "log" | "home">>();
    for (const s of seriesRows) {
      const found = new Map<string, "agreement" | "log" | "home">();
      for (const id of agreements.get(s.programId) ?? []) found.set(id, "agreement");
      for (const e of eps.filter((x) => x.seriesId === s.id && x.libraryItemId)) {
        const { entries } = await services.log.itemSchedule(e.libraryItemId!, 200);
        for (const entry of entries) if (!found.has(entry.stationId)) found.set(entry.stationId, entry.stationId === s.stationId ? "home" : "log");
      }
      out.set(s.id, found);
    }
    return out;
  }

  async function seriesRows(rows: Array<typeof S.$inferSelect>, carriers: Map<string, Map<string, "agreement" | "log" | "home">>): Promise<ShelfSeriesRow[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [items, eps, idents, offers] = await Promise.all([
      db.select({ seriesId: I.seriesId, state: I.state }).from(I).where(inArray(I.seriesId, ids)),
      db.select({ seriesId: E.seriesId, status: E.status }).from(E).where(inArray(E.seriesId, ids)),
      services.stations.idents(rows.map((r) => r.stationId)),
      Promise.all(rows.map(async (r) => [r.id, !!(await services.catalog.openOfferFor(r.programId))] as const)).then((e) => new Map(e))
    ]);
    return rows.flatMap((r) => {
      const station = idents.get(r.stationId);
      if (!station) return [];
      const inReview = items.filter((i) => i.seriesId === r.id && i.state === "second_check").length;
      const mine = eps.filter((e) => e.seriesId === r.id);
      const state = r.state === "coming" ? "coming" : inReview ? "in_review" : offers.get(r.id) ? "offered" : "building";
      return [
        {
          id: r.id,
          title: r.title,
          description: r.description,
          colour: r.colour,
          mediaKind: r.mediaKind,
          episodeLengthMs: r.episodeLengthMs,
          rightsBasis: r.rightsBasis,
          basisLabel: SHELF_BASIS_LABELS[r.rightsBasis],
          basisNote: r.basisNote,
          episodesReady: mine.filter((e) => e.status === "ready").length,
          episodesTotal: mine.length,
          carriers: carriers.get(r.id)?.size ?? 0,
          state,
          inReview,
          station,
          programId: r.programId
        } satisfies ShelfSeriesRow
      ];
    });
  }

  async function requireRights(user: CurrentUser) {
    await services.settings.requireDesk(user, "rights");
  }

  /** Composes one episode from its items as they are now, into a new version of its library item. */
  async function compose(episodeId: string, key: string, user: CurrentUser | null) {
    const [episode] = await db.select().from(E).where(eq(E.id, episodeId));
    if (!episode) return;
    const series = await seriesRow(episode.seriesId);
    const links = await db
      .select({ itemId: EI.itemId, position: EI.position })
      .from(EI)
      .where(and(eq(EI.episodeId, episodeId), isNull(EI.removedAt)))
      .orderBy(asc(EI.position));
    const items = links.length ? await db.select().from(I).where(inArray(I.id, links.map((l) => l.itemId))) : [];
    const ordered = links.map((l) => items.find((i) => i.id === l.itemId)!).filter(Boolean);
    try {
      await scratch(deps.config.storageRoot, async (dir) => {
        const files: string[] = [];
        for (const [i, item] of ordered.entries()) {
          const dest = path.join(dir, `item-${i}`);
          await services.library.content.fetch(item.contentId, dest);
          files.push(dest);
        }
        const ext = series.mediaKind === "video" ? "mp4" : "m4a";
        const out = path.join(dir, `episode.${ext}`);
        await composeFiles(deps.media, files, series.mediaKind, out);
        const stat = await fs.stat(out);
        const title = episode.title ?? `${series.title}, episode ${episode.number}`;
        const file: UploadedFile = { path: out, originalName: `${title}.${ext}`, size: stat.size, mimeType: series.mediaKind === "video" ? "video/mp4" : "audio/mp4" };
        let libraryItemId = episode.libraryItemId;
        if (!libraryItemId) {
          const made = await services.library.upload(series.stationId, file, { title, programId: series.programId, episodeNumber: episode.number, code: "PGM" });
          libraryItemId = made.id;
          const confirmer = user ?? (await services.accounts.currentUser(series.createdBy ?? ""));
          if (confirmer) await services.library.confirmRights(confirmer, libraryItemId, { basis: "public_domain", note: "Opencast catalog: every item in it checked by two people" });
        } else {
          // The last version has to be stored before the next replaces it.
          await services.library.settle();
          await services.library.replaceFile(libraryItemId, file);
        }
        await db
          .update(E)
          .set({ status: "ready", version: episode.version + 1, composition: key, composedAt: deps.clock.now(), error: null, libraryItemId })
          .where(eq(E.id, episodeId));
      });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : error instanceof Error ? error.message : "Composing failed.";
      await db.update(E).set({ status: "failed", error: message }).where(eq(E.id, episodeId));
      throw error;
    }
  }

  const service: ShelfService = {
    async catalogSeries() {
      const rows = await db.select().from(S).orderBy(asc(S.createdAt));
      return rows.filter((r) => r.state !== "coming").map((r) => ({ id: r.id, title: r.title, colour: r.colour, programId: r.programId, stationId: r.stationId }));
    },

    async shelf(user) {
      const rows = await db.select().from(S).orderBy(asc(S.createdAt));
      const carriers = await carriersOf(rows);
      const list = await seriesRows(rows, carriers);
      const now = deps.clock.now();
      const [passed, waiting, ruleSet, catalogIds, mayEdit] = await Promise.all([
        db.select({ id: I.id }).from(I).where(eq(I.state, "passed")),
        db.select({ id: I.id }).from(I).where(eq(I.state, "second_check")),
        rules(now),
        services.stations.idsOfKinds(["catalog"]),
        services.settings.mayDesk(user, "rights")
      ]);
      let readyMs = 0;
      for (const r of rows) for (const e of await episodeViews(r.id)) if (e.status === "ready") readyMs += e.lengthMs;
      const carrierIds = new Set([...carriers.values()].flatMap((m) => [...m.keys()]));
      const idents = await services.stations.idents([...carrierIds, ...catalogIds]);
      const reading = readPublicDomain({ workKind: "film", publishedYear: null, country: "US", usGovernment: false }, ruleSet, now);
      return {
        stats: {
          itemsPassed: passed.length,
          readyMs,
          carrierStations: carrierIds.size,
          carrierMarkets: new Set([...carrierIds].map((id) => idents.get(id)?.marketSlug).filter(Boolean)).size,
          awaitingSecondCheck: waiting.length
        },
        series: list,
        catalogStations: catalogIds.map((id) => idents.get(id)).filter((s): s is StationIdent => !!s),
        publicDomain: { asOf: now.toISOString(), cutoffYear: reading.cutoffYear, soundRecordingsCutoffYear: reading.soundRecordingsCutoffYear },
        canEdit: mayEdit
      };
    },

    async createSeries(user, input) {
      await requireRights(user);
      const catalogIds = await services.stations.idsOfKinds(["catalog"]);
      const stationId = input.stationId ?? catalogIds[0];
      if (!stationId) throw refused("no_catalog_station", "There's no catalog station yet. Set one up on a market's board first.");
      if (!catalogIds.includes(stationId)) throw badRequest("Series are made on a catalog station.", { stationId: "Not a catalog station" });
      const program = await services.library.createProgram(stationId, { title: input.title.trim(), description: input.description?.trim() || undefined, advisory: "none", live: false });
      const [row] = await db
        .insert(S)
        .values({
          title: input.title.trim(),
          description: input.description?.trim() || null,
          stationId,
          programId: program.id,
          mediaKind: input.mediaKind,
          rightsBasis: input.rightsBasis,
          basisNote: input.basisNote?.trim() || null,
          notes: input.notes?.trim() || null,
          episodeLengthMs: input.episodeLengthMs ?? null,
          colour: input.colour ?? null,
          state: input.coming ? "coming" : "building",
          createdBy: user.id,
          createdAt: deps.clock.now()
        })
        .returning();
      return service.series(user, row.id);
    },

    async series(user, seriesId) {
      const row = await seriesRow(seriesId);
      const carriers = await carriersOf([row]);
      const [[base], episodes, items, rebuilds, offerId, mayEdit] = await Promise.all([
        seriesRows([row], carriers),
        episodeViews(seriesId),
        db.select().from(I).where(eq(I.seriesId, seriesId)).orderBy(asc(I.createdAt)),
        rebuildViews(seriesId),
        services.catalog.openOfferFor(row.programId),
        services.settings.mayDesk(user, "rights")
      ]);
      if (!base) throw notFound("That series");
      const now = deps.clock.now();
      const ruleSet = await rules(now);
      const who = await people(items.flatMap((i) => [i.firstCheckedBy, i.secondCheckedBy, i.failedBy]));
      const found = carriers.get(row.id) ?? new Map();
      const idents = await services.stations.idents([...found.keys()]);
      const markets = await services.network.allMarkets();
      const carrierList = [...found].flatMap(([stationId, via]) => {
        const station = idents.get(stationId);
        return station ? [{ station, market: markets.find((m) => m.slug === station.marketSlug) ?? null, via }] : [];
      });
      return {
        ...base,
        notes: row.notes,
        episodes,
        items: items.map((i) => itemRowView(i, readPublicDomain(factsOf(i), ruleSet, now), who)),
        offer: { offered: !!offerId, carriers: carrierList, carrierMarkets: new Set(carrierList.map((c) => c.market?.id).filter(Boolean)).size },
        rebuilds,
        canEdit: mayEdit
      };
    },

    async libraryChoices(seriesId) {
      const series = await seriesRow(seriesId);
      const view = await services.library.library(series.stationId, {});
      const refs = await services.library.itemsByIds(view.items.map((i) => i.id));
      const taken = new Set((await db.select({ id: I.libraryItemId }).from(I).where(eq(I.seriesId, seriesId))).map((r) => r.id));
      const episodeItems = new Set((await db.select({ id: E.libraryItemId }).from(E)).map((r) => r.id));
      return [...refs.values()]
        .filter((r) => r.status === "ready" && !r.archived && r.contentId && !taken.has(r.id) && !episodeItems.has(r.id) && r.mediaKind === series.mediaKind && r.code === "PGM")
        .map((r) => ({ libraryItemId: r.id, title: r.title, contentId: r.contentId!, lengthMs: r.durationMs, mediaKind: r.mediaKind }))
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async addItem(user, seriesId, input) {
      await requireRights(user);
      const series = await seriesRow(seriesId);
      const ref = (await services.library.itemsByIds([input.libraryItemId])).get(input.libraryItemId);
      if (!ref || ref.archived || ref.stationId !== series.stationId) throw notFound("That library item");
      if (ref.status !== "ready" || !ref.contentId) throw conflict("not_ready", "That file is still being stored. Try again in a minute.");
      if (ref.mediaKind !== series.mediaKind) throw refused("wrong_kind", series.mediaKind === "video" ? "This series is video: choose a film." : "This series is sound only: choose a recording.");
      const [dupe] = await db
        .select({ id: I.id })
        .from(I)
        .where(and(eq(I.seriesId, seriesId), eq(I.contentId, ref.contentId)));
      if (dupe) throw conflict("already_on_shelf", "That file is already an item in this series.");
      const now = deps.clock.now();
      const facts: ItemFacts = { workKind: input.workKind, publishedYear: input.publishedYear ?? null, country: input.country.toUpperCase(), usGovernment: !!input.usGovernment };
      const reading = readPublicDomain(facts, await rules(now), now);
      const templates = checklistFor(facts, reading);
      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(I)
          .values({
            seriesId,
            title: input.title?.trim() || ref.title,
            source: input.source.trim(),
            workKind: input.workKind,
            publishedYear: input.publishedYear ?? null,
            country: facts.country,
            basis: input.usGovernment ? "us_government" : null,
            libraryItemId: ref.id,
            contentId: ref.contentId!,
            durationMs: ref.durationMs,
            addedBy: user.id,
            createdAt: now
          })
          .returning({ id: I.id });
        // The checklist, with what the rules answer already filled in (by nobody: the rules).
        await tx.insert(CK).values(templates.map((t) => ({ itemId: row.id, line: t.line, state: t.prefill?.state ?? "todo", detail: t.prefill?.detail ?? null, setAt: t.prefill ? now : null })));
        await services.library.content.addRef(tx, ref.contentId!, "catalog_item", row.id);
        return row.id;
      });
      return itemView(user, id);
    },

    item: (user, itemId) => itemView(user, itemId),

    async setCheck(user, itemId, line, input) {
      await requireRights(user);
      const item = await itemRow(itemId);
      if (item.state !== "checking") throw conflict("sent", item.state === "second_check" ? "It's been sent for the second check. The second checker can send it back." : "Its check is finished.");
      await db
        .insert(CK)
        .values({ itemId, line, state: input.state, detail: input.detail ?? null, record: input.record ?? null, setBy: user.id, setAt: deps.clock.now() })
        .onConflictDoUpdate({
          target: [CK.itemId, CK.line],
          set: {
            state: input.state,
            ...(input.detail !== undefined ? { detail: input.detail } : {}),
            ...(input.record !== undefined ? { record: input.record } : {}),
            setBy: user.id,
            setAt: deps.clock.now()
          }
        });
      return itemView(user, itemId);
    },

    async addEvidence(user, itemId, line, file) {
      await requireRights(user);
      if (!file) throw badRequest("Choose a file to attach.", { file: "Required" });
      const item = await itemRow(itemId);
      if (item.state !== "checking") throw conflict("sent", "It's been sent: evidence is added before the first check.");
      if (!EVIDENCE_TYPES.test(file.mimeType) && !EVIDENCE_EXTENSIONS.test(file.originalName)) throw refused("wrong_file_type", "Attach a PDF, a picture or a text file.");
      if (file.size > EVIDENCE_MAX_BYTES) throw refused("too_big", EVIDENCE_TOO_BIG);
      const content = services.library.content;
      // Kept for as long as the item is in the catalog, read now and then: Infrequent Access.
      const stored = await content.store(file.path, { storageClass: "infrequent", contentType: file.mimeType || undefined });
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(EV)
          .values({ itemId, line, contentId: stored.cid, fileName: file.originalName, contentType: file.mimeType || "application/octet-stream", bytes: stored.bytes, uploadedBy: user.id, createdAt: deps.clock.now() })
          .returning({ id: EV.id });
        await content.addRef(tx, stored.cid, "catalog_evidence", row.id);
      });
      return itemView(user, itemId);
    },

    async send(user, itemId) {
      await requireRights(user);
      const view = await itemView(user, itemId);
      if (view.state !== "checking") throw conflict("sent", "It's already been sent.");
      if (view.cantSendBecause) throw refused("evidence_missing", view.cantSendBecause);
      const renewal = view.checklist.find((l) => l.line === "renewal")?.state ?? "todo";
      const basis = view.basis === "us_government" ? "us_government" : basisOf(view.publicDomain, renewal);
      await db
        .update(I)
        .set({ state: "second_check", basis, firstCheckedBy: user.id, firstCheckedAt: deps.clock.now() })
        .where(and(eq(I.id, itemId), eq(I.state, "checking")));
      return itemView(user, itemId);
    },

    async secondCheck(user, itemId, input) {
      await requireRights(user);
      const item = await itemRow(itemId);
      if (item.state !== "second_check") throw conflict("not_sent", "It isn't waiting for a second check.");
      if (item.firstCheckedBy === user.id) throw new HttpError(403, "same_person", "You did the first check. Someone else does the second.");
      const now = deps.clock.now();
      if (input.decision === "confirm") {
        await db.update(I).set({ state: "passed", secondCheckedBy: user.id, secondCheckedAt: now }).where(eq(I.id, itemId));
      } else if (input.decision === "return") {
        await db.update(I).set({ state: "checking", firstCheckedBy: null, firstCheckedAt: null, basis: item.basis === "us_government" ? "us_government" : null }).where(eq(I.id, itemId));
      } else {
        await db
          .update(I)
          .set({ state: "failed", failedBy: user.id, failedAt: now, failedReason: input.note?.trim() || "Failed its second check" })
          .where(eq(I.id, itemId));
      }
      return itemView(user, itemId);
    },

    async fail(user, itemId, reason) {
      await requireRights(user);
      const item = await itemRow(itemId);
      if (item.state === "failed") throw conflict("already_failed", "It's already out of the catalog.");
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        await tx.update(I).set({ state: "failed", failedBy: user.id, failedAt: now, failedReason: reason.trim() }).where(eq(I.id, itemId));
        // Out of every episode it's in; the rest of each episode closes up.
        const pulled = await tx
          .update(EI)
          .set({ removedAt: now, removedReason: reason.trim(), position: null })
          .where(and(eq(EI.itemId, itemId), isNull(EI.removedAt)))
          .returning({ episodeId: EI.episodeId });
        for (const { episodeId } of pulled) {
          const rest = await tx
            .select({ itemId: EI.itemId })
            .from(EI)
            .where(and(eq(EI.episodeId, episodeId), isNull(EI.removedAt)))
            .orderBy(asc(EI.position));
          for (const [i, r] of rest.entries()) await tx.update(EI).set({ position: i + 1 }).where(and(eq(EI.episodeId, episodeId), eq(EI.itemId, r.itemId)));
        }
      });
      const rebuild = await service.rebuild(user, item.seriesId, reason.trim(), itemId);
      return { item: await itemView(user, itemId), rebuild };
    },

    async setEpisode(user, seriesId, number, input) {
      await requireRights(user);
      await seriesRow(seriesId);
      const ids = [...new Set(input.itemIds)];
      if (ids.length !== input.itemIds.length) throw badRequest("An item goes into an episode once.", { itemIds: "Repeated" });
      const items = await db.select().from(I).where(inArray(I.id, ids));
      if (items.length !== ids.length || items.some((i) => i.seriesId !== seriesId)) throw badRequest("Those items aren't all in this series.", { itemIds: "Not in the series" });
      const notPassed = items.filter((i) => i.state !== "passed");
      if (notPassed.length) throw refused("not_passed", `Only items checked by two people go into episodes: ${notPassed.map((i) => `"${i.title}"`).join(", ")} ${notPassed.length === 1 ? "isn't" : "aren't"} yet.`);
      const id = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(E)
          .where(and(eq(E.seriesId, seriesId), eq(E.number, number)));
        const episodeId =
          existing?.id ??
          (
            await tx
              .insert(E)
              .values({ seriesId, number, title: input.title ?? null, createdAt: deps.clock.now() })
              .returning({ id: E.id })
          )[0]!.id;
        if (existing && input.title !== undefined) await tx.update(E).set({ title: input.title }).where(eq(E.id, episodeId));
        // Chosen again from scratch; items taken out after failing stay in its history.
        await tx.delete(EI).where(and(eq(EI.episodeId, episodeId), isNull(EI.removedAt)));
        const kept = new Set((await tx.select({ itemId: EI.itemId }).from(EI).where(eq(EI.episodeId, episodeId))).map((r) => r.itemId));
        const fresh = ids.filter((i) => !kept.has(i));
        if (fresh.length !== ids.length) throw refused("not_passed", "An item taken out of this episode after failing can't go back in.");
        await tx.insert(EI).values(ids.map((itemId, i) => ({ episodeId, itemId, position: i + 1, addedAt: deps.clock.now() })));
        return episodeId;
      });
      return (await episodeViews(seriesId)).find((e) => e.id === id)!;
    },

    async rebuild(user, seriesId, reason = "Rebuilt from the series page", itemId = null) {
      if (user) await requireRights(user);
      await seriesRow(seriesId);
      const eps = await db.select().from(E).where(eq(E.seriesId, seriesId)).orderBy(asc(E.number));
      const changed: Array<{ episodeId: string; number: number; fromVersion: number; toVersion: number; status: string }> = [];
      let unchanged = 0;
      const toCompose: Array<{ id: string; key: string }> = [];
      for (const e of eps) {
        const links = await db
          .select({ contentId: I.contentId })
          .from(EI)
          .innerJoin(I, eq(I.id, EI.itemId))
          .where(and(eq(EI.episodeId, e.id), isNull(EI.removedAt)))
          .orderBy(asc(EI.position));
        if (!links.length) {
          if (e.status !== "failed" || e.error !== "Every item in it came out. Choose items to build it again.") {
            await db.update(E).set({ status: "failed", error: "Every item in it came out. Choose items to build it again." }).where(eq(E.id, e.id));
            changed.push({ episodeId: e.id, number: e.number, fromVersion: e.version, toVersion: e.version, status: "failed" });
          } else unchanged++;
          continue;
        }
        const key = compositionKey(links.map((l) => l.contentId));
        // Nothing in it changed: left exactly as it is, and nothing is prepared again.
        if (key === e.composition && (e.status === "ready" || e.status === "composing")) {
          unchanged++;
          continue;
        }
        await db.update(E).set({ status: "composing", error: null }).where(eq(E.id, e.id));
        changed.push({ episodeId: e.id, number: e.number, fromVersion: e.version, toVersion: e.version + 1, status: "composing" });
        toCompose.push({ id: e.id, key });
      }
      // A rebuild that changed nothing isn't recorded: there's nothing to show.
      if (!changed.length) {
        const who = user ? await people([user.id]) : new Map<string, DeskPerson>();
        const item = itemId ? await itemRow(itemId) : null;
        return { id: randomUUID(), at: deps.clock.now().toISOString(), by: user ? (who.get(user.id) ?? null) : null, reason, item: item ? { id: item.id, title: item.title } : null, episodes: [], unchanged };
      }
      const [row] = await db
        .insert(RB)
        .values({ seriesId, itemId, reason, by: user?.id ?? null, at: deps.clock.now(), episodes: changed, unchanged })
        .returning();
      // One at a time: FFmpeg is heavy, and each episode is independent.
      background(
        (async () => {
          for (const c of toCompose) await compose(c.id, c.key, user).catch((error) => console.error(`[shelf] episode ${c.id}`, error));
        })()
      );
      const [view] = await rebuildViews(seriesId, 20).then((all) => all.filter((r) => r.id === row.id));
      return view!;
    },

    async settle() {
      while (jobs.size) await Promise.allSettled([...jobs]);
    }
  };
  return service;
}
