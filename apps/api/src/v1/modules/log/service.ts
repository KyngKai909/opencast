import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Airing, BreakContent, BreakRow, Listing, LogDay, LogEntry } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, HttpError, notFound, refused } from "../../errors.js";
import { localDate, localDay, localWeekday, roundUpToMinute } from "../../lib/time.js";
import { endEarlyAt, nextSegment, SEGMENT_MS, snapDate, snapToSegment } from "../../lib/segments.js";
import { CREDIT_MS, STATION_ID_MS } from "../playout/engine/fill.js";
import { hhmm, offAirSpans, offAirStretches, ruleLabel, type OffAirSpanView } from "./offair.js";
import { createTemplateOps, templateLabel, type TemplateOps } from "./templates.js";

export type { OffAirSpanView } from "./offair.js";

/** Log entries made by the dead-air fill carry this note (playout records them as dead-air fills). */
export const DEAD_AIR_NOTE = "Filled automatically: dead air";
import type { ItemRef } from "../library/service.js";

type Row = typeof schema.logEntries.$inferSelect;

export interface AiringRef {
  id: string;
  stationId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface BreakSlotView {
  id: string | null;
  filledAt: string | null;
  startsAt: string;
  lengthMs: number;
  context: string;
  origin: "rule" | "cued_live" | "carried_barter";
  producerShareMs: number;
  filledMs: number;
  openMs: number;
  logEntryId: string | null;
}

export interface Gap {
  startsAt: string;
  endsAt: string;
}

export interface EntryInput {
  kind: "program" | "live" | "off_air";
  startsAt: string;
  endsAt?: string;
  itemId?: string;
  programId?: string;
  liveSourceId?: string;
  carriageAgreementId?: string;
  episodeTitle?: string;
  episodeDescription?: string;
  localNote?: string;
}

/** G7: a "Repeat this day" still on the log (a day template, or a G7 copy made before them). */
export interface RepeatView {
  id: string;
  day: string;
  pattern: "once" | "daily" | "weekly";
  until: string | null;
  entries: number;
  template?: boolean;
  weekday?: number | null;
  label?: string;
}

/** Off air hours as the settings page reads them. */
export interface OffAirHoursView {
  timezone: string;
  rules: Array<{ id: string; days: number[]; signOffAt: string; backAt: string; label: string }>;
  next: OffAirSpanView | null;
}

type ListingPatch = { episodeTitle?: string | null; episodeDescription?: string | null; localNote?: string | null };

export interface LogService {
  /** Day templates (added 2026-09-29). */
  templates: TemplateOps;
  /** Planned off air time (off air hours and sign-off entries) overlapping a window. */
  offAirSpans(stationId: string, from: Date, to: Date): Promise<OffAirSpanView[]>;
  /** The planned off air time on at a moment, if any. */
  offAirAt(stationId: string, at: Date): Promise<OffAirSpanView | null>;
  offAirHours(stationId: string): Promise<OffAirHoursView>;
  setOffAirHours(stationId: string, rules: Array<{ days: number[]; signOffAt: string; backAt: string }>): Promise<OffAirHoursView>;
  /** G1: what's in each break, in the order it airs (keyed by the break's start). */
  breakContents(stationId: string, slots: BreakSlotView[]): Promise<Map<string, BreakContent[]>>;
  /** G7: repeats with entries from `from` on. */
  repeats(stationId: string, from: Date): Promise<RepeatView[]>;
  /** G7: takes a repeat's entries off the log from now on. */
  removeRepeat(stationId: string, repeatId: string): Promise<number>;
  /** A live block on a station, or 404 / 409 `not_live`. */
  liveEntry(stationId: string, entryId: string): Promise<Row>;
  /** G3: ends a live block now and moves the log after it up. */
  endEarly(stationId: string, entryId: string): Promise<{ entryId: string; endedAt: string; movedUp: number }>;
  /** G5: listings per airing in a window. */
  listings(stationId: string, from: Date, to: Date): Promise<{ listings: Listing[]; needDescription: number }>;
  updateListing(stationId: string, entryId: string, patch: ListingPatch): Promise<Listing>;
  /** G2: the next entry after a moment. */
  nextEntry(stationId: string, at: Date): Promise<{ entry: LogEntry; description: string | null; producer: string | null; colour: string | null } | null>;
  /** L5: an item's log entries on now or still to come, on every station, soonest first. */
  itemSchedule(itemId: string, limit: number): Promise<{ total: number; shortestSlotMs: number | null; entries: Array<{ entryId: string; stationId: string; startsAt: string; endsAt: string; localNote: string | null; repeatGroupId: string | null }> }>;
  /** L1: how often a program airs on its maker's log over the next four weeks. */
  cadence(stationId: string, programId: string): Promise<"weekly" | "nightly" | "weeknights" | null>;
  airingsByIds(ids: string[]): Promise<Map<string, AiringRef>>;
  /** What's on now and next per station, for the dial. */
  nowNext(stationIds: string[], at: Date): Promise<Map<string, { now: Airing | null; next: Airing | null }>>;
  /** Every airing in a window per station, for the guide and station pages. */
  window(stationIds: string[], from: Date, to: Date): Promise<Map<string, Airing[]>>;
  upcomingForProgram(programId: string, limit: number): Promise<AiringRef[]>;
  itemUsage(itemId: string): Promise<{ upcoming: number }>;
  gaps(stationId: string, from: Date, to: Date): Promise<Gap[]>;
  /** Break slots in a window, generated from the break rule. Stored ones carry their id. */
  breaks(stationId: string, from: Date, to: Date): Promise<BreakSlotView[]>;
  /** Stores the generated breaks for a window (spots are placed into stored breaks). */
  ensureBreaks(stationId: string, from: Date, to: Date): Promise<BreakSlotView[]>;
  /** Entries within a window, for sign-on checks and playout. */
  entries(stationId: string, from: Date, to: Date): Promise<Row[]>;
  /** One entry's slot. */
  entrySpan(entryId: string): Promise<{ startsAt: Date; endsAt: Date } | null>;
  /** Every station's items on the log in a window, earliest first (the worker cache reads ahead). */
  upcomingItems(from: Date, to: Date): Promise<Array<{ stationId: string; entryId: string; itemId: string; startsAt: Date }>>;
  /** Takes an item off every log from now on (a rights claim). Returns what was pulled per station. */
  pullItem(itemId: string): Promise<Array<{ stationId: string; entries: number }>>;
  markBreakFilled(breakId: string): Promise<void>;
  /**
   * Nobody filled the gap: repeat from the library, in order, and record that it happened.
   * Whatever doesn't fit airs station ID and bumpers.
   */
  /** `usable` (playout's): only items it can air now (prepared for air). */
  fillDeadAir(stationId: string, gap: Gap, options?: { usable?(item: ItemRef): boolean }): Promise<number>;
  /** Adds a break now, cued from a live block. */
  cueBreak(stationId: string, at: Date, lengthMs: number, logEntryId: string | null): Promise<BreakSlotView>;
  /** "During Saturday Reel" / "After Late Crate, ep. 14" for stored breaks. */
  breakContexts(breakIds: string[]): Promise<Map<string, string>>;
  countCarried(input: { carrierStationId: string; agreementId: string; itemId: string; excludeEntryId?: string }): Promise<number>;
  /** When an item first aired (or airs) on a station's log. */
  firstAiring(stationId: string, itemId: string): Promise<Date | null>;
  /** Whether a station's log has the item on at a moment (live-only carriage). */
  airsAt(stationId: string, itemId: string, at: Date): Promise<boolean>;
  /** Puts carried slots on the carrier's log. */
  placeCarried(input: { agreementId: string; carrierStationId: string; programId: string; starts: Date[]; replaceExisting: boolean }): Promise<{ placed: number; replaced: number; blockedByLimit: number }>;

  log(stationId: string, from: Date, to: Date): Promise<{ from: string; to: string; entries: LogEntry[]; breaks: BreakSlotView[]; gaps: Gap[]; offAir: OffAirSpanView[]; days: LogDay[] }>;
  add(stationId: string, userId: string, input: EntryInput): Promise<LogEntry>;
  update(stationId: string, entryId: string, input: Partial<EntryInput>): Promise<LogEntry>;
  remove(stationId: string, entryId: string): Promise<void>;
  repeatDay(stationId: string, input: { day: string; pattern: "once" | "daily" | "weekly"; until: string; onto?: string }): Promise<{ created: number; skippedForConflicts: number; templateId: string }>;
  fill(stationId: string, userId: string, input: { with: "repeat"; startsAt: string; endsAt: string; itemIds: string[] } | { with: "sign_off"; startsAt: string; endsAt: string }): Promise<LogEntry[]>;
  deadAir(stationId: string): Promise<{ gaps: Gap[]; nextGapAt: string | null; logRunsUntil: string | null; warnings: Array<{ gapStartsAt: string; warnedAt: string; minutesBefore: 30 | 12 }>; offAir: OffAirSpanView[] }>;
  /** The rolling dead-air check: warnings at 30 and 12 minutes before a gap. Run every minute by the scheduler. */
  checkDeadAir(stationIds: string[]): Promise<void>;
}

const E = schema.logEntries;
const B = schema.breaks;
const OH = schema.offAirHours;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function createLogService(ctx: ModuleContext): LogService {
  const { deps, services } = ctx;
  const { db } = deps;
  const templates = createTemplateOps(ctx);

  /**
   * Before entries come off the log (removed, an item pulled, a carried slot replacing them): the
   * breaks stored for them go too, except breaks with spots held in them, which stay without the
   * entry, as a stale break with airings does (those airings are paid for; any that don't air are
   * released). Before 2026-09-29 the break's reference made removing the entry fail.
   */
  async function releaseBreaks(ex: Executor, entryIds: string[]) {
    if (!entryIds.length) return;
    const stored = await ex.select({ id: B.id }).from(B).where(inArray(B.logEntryId, entryIds));
    if (!stored.length) return;
    const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
    const empty = stored.filter((b) => !filled.get(b.id)).map((b) => b.id);
    const held = stored.filter((b) => filled.get(b.id)).map((b) => b.id);
    if (empty.length) await ex.delete(B).where(inArray(B.id, empty));
    if (held.length) await ex.update(B).set({ logEntryId: null }).where(inArray(B.id, held));
  }

  /**
   * The log changed where playout has already read it (it plans a quarter of an hour ahead): a
   * station on air reads it again now, or the edit airs only once that plan runs out. Before
   * 2026-09-29 only the off air hours told it.
   */
  async function changedNear(stationId: string, times: Date[]) {
    const now = deps.clock.now().getTime();
    if (times.some((t) => t.getTime() < now + 30 * 60_000)) await services.playout.replan(stationId);
  }

  async function load(stationIds: string[], from: Date, to: Date) {
    if (!stationIds.length) return [] as Row[];
    return db
      .select()
      .from(E)
      .where(and(inArray(E.stationId, stationIds), lt(E.startsAt, to), gt(E.endsAt, from)))
      .orderBy(asc(E.startsAt));
  }

  async function context(rows: Row[]) {
    const [items, programs, agreements] = await Promise.all([
      services.library.itemsByIds(rows.map((r) => r.assetId).filter((v): v is string => Boolean(v))),
      services.library.programsByIds(rows.map((r) => r.programId).filter((v): v is string => Boolean(v))),
      services.catalog.agreementsByIds(rows.map((r) => r.carriageAgreementId).filter((v): v is string => Boolean(v)))
    ]);
    // A carried item's program is the maker's; look it up too.
    const extraPrograms = await services.library.programsByIds(
      [...items.values()].map((i) => i.programId).filter((v): v is string => Boolean(v) && !programs.has(v as string)) as string[]
    );
    for (const [id, p] of extraPrograms) programs.set(id, p);
    const makers = await services.stations.idents([...agreements.values()].map((a) => a.makerStationId));
    return { items, programs, agreements, makers };
  }

  function titleOf(row: Row, ctx: Awaited<ReturnType<typeof context>>): string {
    const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
    const programId = row.programId ?? item?.programId ?? null;
    if (programId && ctx.programs.has(programId)) return ctx.programs.get(programId)!.title;
    if (item) return item.title;
    return row.kind === "off_air" ? "Off air" : row.kind === "live" ? "Live" : "Untitled";
  }

  function toAiring(row: Row, ctx: Awaited<ReturnType<typeof context>>): Airing {
    const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
    const agreement = row.carriageAgreementId ? ctx.agreements.get(row.carriageAgreementId) : undefined;
    const programId = row.programId ?? item?.programId ?? null;
    const program = programId ? ctx.programs.get(programId) : undefined;
    return {
      logEntryId: row.id,
      title: titleOf(row, ctx),
      episodeTitle: row.episodeTitle ?? (program && item ? item.title : null),
      code: row.code,
      kind: row.kind,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      live: row.kind === "live",
      carriedFrom: agreement ? (ctx.makers.get(agreement.makerStationId) ?? null) : null,
      programId,
      episodeDescription: descriptionOf(row, ctx)
    };
  }

  /** G5: the airing's own description, else its item's (a carried item's is the maker's). */
  function descriptionOf(row: Row, ctx: Awaited<ReturnType<typeof context>>): string | null {
    const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
    return row.episodeDescription ?? item?.episodeDescription ?? null;
  }

  function toEntry(row: Row, ctx: Awaited<ReturnType<typeof context>>): LogEntry {
    const airing = toAiring(row, ctx);
    return {
      id: row.id,
      kind: row.kind,
      code: row.code,
      startsAt: airing.startsAt,
      endsAt: airing.endsAt,
      title: airing.title,
      episodeTitle: airing.episodeTitle,
      itemId: row.assetId,
      programId: airing.programId,
      liveSourceId: row.liveSourceId,
      carriedFrom: airing.carriedFrom,
      carriageAgreementId: row.carriageAgreementId,
      repeatGroupId: row.repeatGroupId,
      localNote: row.localNote,
      episodeDescription: airing.episodeDescription ?? null,
      endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null
    };
  }

  async function listingViews(rows: Row[]): Promise<Listing[]> {
    const ctx = await context(rows);
    const programIds = [...new Set(rows.map((r) => r.programId ?? (r.assetId ? ctx.items.get(r.assetId)?.programId : null)).filter((v): v is string => Boolean(v)))];
    const programs = new Map(
      (await Promise.all(programIds.map((id) => services.library.program(id).catch(() => null)))).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => [p.id, p])
    );
    return rows.map((row) => {
      const entry = toEntry(row, ctx);
      const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
      const program = entry.programId ? programs.get(entry.programId) : undefined;
      const own = descriptionOf(row, ctx);
      const carried = Boolean(entry.carriedFrom);
      const imported = item?.source === "link";
      const episode = row.kind !== "live" && (item?.episodeNumber != null || Boolean(row.episodeTitle));
      const status: Listing["status"] = carried
        ? "from_the_maker"
        : own
          ? "complete"
          : imported || episode
            ? "needs_description"
            : program?.description
              ? "complete"
              : "needs_description";
      return {
        entryId: row.id,
        kind: row.kind,
        code: row.code,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        title: entry.title,
        episodeTitle: entry.episodeTitle,
        episodeDescription: own,
        localNote: row.localNote,
        carriedFrom: entry.carriedFrom,
        itemId: row.assetId,
        imported,
        status,
        program: program ? { ...program, captions: program.captions } : null
      };
    });
  }

  /** Dead air: time with nothing on the log, outside planned off air time. */
  function gapsIn(rows: Row[], from: Date, to: Date, offAir: OffAirSpanView[] = []): Gap[] {
    const gaps: Gap[] = [];
    let cursor = from.getTime();
    const blocks = [
      ...rows.map((r) => ({ s: r.startsAt.getTime(), e: r.endsAt.getTime() })),
      ...offAir.map((o) => ({ s: Date.parse(o.startsAt), e: Date.parse(o.endsAt) }))
    ].sort((a, b) => a.s - b.s);
    for (const block of blocks) {
      if (block.s > cursor) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(Math.min(block.s, to.getTime())).toISOString() });
      cursor = Math.max(cursor, block.e);
    }
    if (cursor < to.getTime()) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: to.toISOString() });
    return gaps.filter((g) => Date.parse(g.endsAt) > Date.parse(g.startsAt) && Date.parse(g.startsAt) < to.getTime());
  }

  /**
   * Planned off air time per station overlapping `[from, to)`. Reads a wider range (a day before,
   * two after) so a stretch running past the window still knows when the station is back.
   * `wholeStretches` keeps every span of a stretch that touches the window (viewers see a
   * stretch from its sign-off, even when that was before the window).
   */
  async function offAirMap(stationIds: string[], from: Date, to: Date, wholeStretches = false): Promise<Map<string, OffAirSpanView[]>> {
    const result = new Map<string, OffAirSpanView[]>(stationIds.map((id) => [id, []]));
    if (!stationIds.length) return result;
    const lo = new Date(from.getTime() - DAY);
    const hi = new Date(to.getTime() + 2 * DAY);
    const [rules, rows] = await Promise.all([db.select().from(OH).where(inArray(OH.stationId, stationIds)), load(stationIds, lo, hi)]);
    for (const id of stationIds) {
      const mine = rows.filter((r) => r.stationId === id);
      const myRules = rules.filter((r) => r.stationId === id);
      if (!myRules.length && !mine.some((r) => r.kind === "off_air")) continue;
      const tz = myRules.length ? await stationTz(id) : "UTC";
      const spans = offAirSpans(mine, myRules, tz, lo, hi);
      const touches = (s: OffAirSpanView) => Date.parse(s.endsAt) > from.getTime() && Date.parse(s.startsAt) < to.getTime();
      const stretches = new Set(spans.filter(touches).map((s) => s.backAt));
      result.set(id, spans.filter((s) => (wholeStretches ? stretches.has(s.backAt) : touches(s))));
    }
    return result;
  }

  /**
   * What viewers see (dial, guide, station page): the log's programs and live blocks, and each
   * unbroken stretch of planned off air time as one `off_air` airing with the time it's back.
   */
  function viewerAirings(rows: Row[], spans: OffAirSpanView[], ctx: Awaited<ReturnType<typeof context>>): Airing[] {
    const airings = rows.filter((r) => r.kind !== "off_air").map((r) => toAiring(r, ctx));
    for (const stretch of offAirStretches(spans)) {
      airings.push({
        logEntryId: stretch.logEntryId,
        title: "Off air",
        episodeTitle: null,
        code: "OPEN",
        kind: "off_air",
        startsAt: stretch.startsAt,
        endsAt: stretch.backAt,
        live: false,
        carriedFrom: null,
        programId: null,
        episodeDescription: null,
        backAt: stretch.backAt
      });
    }
    return airings.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async function offAirView(stationId: string): Promise<OffAirHoursView> {
    const now = deps.clock.now();
    const [rules, tz, upcoming] = await Promise.all([
      db.select().from(OH).where(eq(OH.stationId, stationId)).orderBy(asc(OH.createdAt)),
      stationTz(stationId),
      offAirMap([stationId], now, new Date(now.getTime() + 8 * DAY))
    ]);
    return {
      timezone: tz,
      rules: rules.map((r) => ({ id: r.id, days: [...r.days].sort(), signOffAt: hhmm(r.signOffAt), backAt: hhmm(r.backAt), label: ruleLabel(r) })),
      next: upcoming.get(stationId)?.[0] ?? null
    };
  }

  async function generateBreaks(stationId: string, from: Date, to: Date): Promise<Array<Omit<BreakSlotView, "id" | "filledAt" | "filledMs" | "openMs">>> {
    const rule = await services.stations.breakRule(stationId);
    const rows = await load([stationId], new Date(from.getTime() - 6 * HOUR), to);
    const ctx = await context(rows);
    const slots: Array<Omit<BreakSlotView, "id" | "filledAt" | "filledMs" | "openMs">> = [];
    for (const row of rows) {
      if (row.kind !== "program") continue; // Live programs cue their own; off-air has none.
      const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
      const agreement = row.carriageAgreementId ? ctx.agreements.get(row.carriageAgreementId) : undefined;
      const title = titleOf(row, ctx);
      const episode = item?.episodeNumber ? `, ep. ${item.episodeNumber}` : "";
      const slotMs = row.endsAt.getTime() - row.startsAt.getTime();
      const itemMs = Math.min(item?.durationMs ?? slotMs, slotMs);
      const barterPerHour = agreement && (agreement.term === "barter" || agreement.term === "cash_plus_barter") ? (agreement.barterMakerMsPerHour ?? 0) : 0;

      // Inside the program, every N minutes (or at the maker's break points).
      if (rule.mode === "every_n_minutes" && rule.everyMinutes) {
        const points = item?.breakPointsMs?.length
          ? item.breakPointsMs
          : Array.from({ length: Math.floor(itemMs / (rule.everyMinutes * MIN)) }, (_, i) => (i + 1) * rule.everyMinutes! * MIN).filter((p) => p < itemMs);
        let shift = 0;
        for (const point of points) {
          // At the segment boundary nearest the maker's break point.
          const startsAt = new Date(row.startsAt.getTime() + snapToSegment(point) + shift);
          const perBreakShare = barterPerHour ? Math.min(rule.lengthMs, Math.round(barterPerHour / (60 / rule.everyMinutes))) : 0;
          slots.push({
            startsAt: startsAt.toISOString(),
            lengthMs: rule.lengthMs,
            context: `During ${title}${episode}`,
            origin: barterPerHour ? "carried_barter" : "rule",
            producerShareMs: perBreakShare,
            logEntryId: row.id
          });
          shift += rule.lengthMs;
        }
        const used = itemMs + shift;
        if (slotMs - used > 0) {
          slots.push({
            startsAt: new Date(row.startsAt.getTime() + used).toISOString(),
            lengthMs: slotMs - used,
            context: `After ${title}${episode}`,
            origin: "rule",
            producerShareMs: 0,
            logEntryId: row.id
          });
        }
        continue;
      }
      // After every program (and with no rule): the time between the item's end and the slot's end.
      const slack = slotMs - itemMs;
      if (slack > 0) {
        slots.push({
          startsAt: new Date(row.startsAt.getTime() + itemMs).toISOString(),
          lengthMs: slack,
          context: `After ${title}${episode}`,
          origin: barterPerHour ? "carried_barter" : "rule",
          producerShareMs: barterPerHour ? Math.min(slack, Math.round((barterPerHour * slotMs) / HOUR)) : 0,
          logEntryId: row.id
        });
      }
    }
    return slots.filter((s) => Date.parse(s.startsAt) >= from.getTime() && Date.parse(s.startsAt) < to.getTime());
  }

  async function withStored(stationId: string, generatedIn: Awaited<ReturnType<typeof generateBreaks>>, from: Date, to: Date): Promise<BreakSlotView[]> {
    let generated = generatedIn;
    const stored = await db
      .select()
      .from(B)
      .where(and(eq(B.stationId, stationId), gte(B.startsAt, from), lt(B.startsAt, to)));
    const byTime = new Map(stored.map((b) => [b.startsAt.toISOString(), b]));
    const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
    // Breaks cued from a live block aren't generated from the rule; they're stored as they happen.
    const cued = stored
      .filter((b) => b.origin === "cued_live")
      .map((b) => ({ startsAt: b.startsAt.toISOString(), lengthMs: b.lengthMs, context: "Cued live", origin: "cued_live" as const, producerShareMs: 0, logEntryId: b.logEntryId }));
    generated = [...generated, ...cued].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return generated.map((slot) => {
      const row = byTime.get(slot.startsAt);
      const filledMs = row ? (filled.get(row.id) ?? 0) : 0;
      return { ...slot, id: row?.id ?? null, filledAt: row?.filledAt?.toISOString() ?? null, filledMs, openMs: Math.max(0, slot.lengthMs - slot.producerShareMs - filledMs) };
    });
  }

  async function stationTz(stationId: string) {
    return services.stations.timezoneOf(stationId);
  }

  async function validate(stationId: string, input: EntryInput, excludeId?: string) {
    // On segment boundaries (the stream changes item there): rounded to the nearest, never refused.
    const startsAt = snapDate(new Date(input.startsAt));
    let endsAt = input.endsAt ? snapDate(new Date(input.endsAt)) : null;
    let code: Row["code"] = "PGM";
    let programId = input.programId ?? null;

    if (input.kind === "program") {
      if (!input.itemId) throw badRequest("Choose what airs.", { itemId: "Required" });
      const item = (await services.library.itemsByIds([input.itemId])).get(input.itemId);
      if (!item || item.archived) throw notFound("That item");
      if (!item.rightsConfirmed) throw refused("rights_unconfirmed", "Confirm the rights to air it first.");
      if (item.stationId !== stationId) {
        if (!input.carriageAgreementId) throw refused("needs_agreement", "Another station's program needs a carriage agreement.");
        await services.catalog.checkAiring({ agreementId: input.carriageAgreementId, carrierStationId: stationId, itemId: item.id, startsAt, excludeEntryId: excludeId });
      }
      code = item.code;
      programId = programId ?? item.programId;
      endsAt = endsAt ?? new Date(startsAt.getTime() + roundUpToMinute(item.durationMs ?? 30 * MIN));
      // A second's grace, plus up to a segment's rounding.
      if (item.durationMs && endsAt.getTime() - startsAt.getTime() < item.durationMs - 1000 - SEGMENT_MS / 2) {
        throw badRequest("The slot is shorter than the item.", { endsAt: "Too short" });
      }
    } else if (input.kind === "live") {
      if (!input.liveSourceId) throw badRequest("Choose a live source.", { liveSourceId: "Required" });
      if (!(await services.stations.liveSourceBelongs(stationId, input.liveSourceId))) throw notFound("That live source");
      if (!endsAt) throw badRequest("Say when the live block ends.", { endsAt: "Required" });
    } else {
      code = "OPEN";
      if (!endsAt) throw badRequest("Say when you're back on air.", { endsAt: "Required" });
    }
    if (endsAt <= startsAt) throw badRequest("It has to end after it starts.", { endsAt: "Before the start" });
    return { startsAt, endsAt, code, programId };
  }

  const service: LogService = {
    templates,

    async offAirSpans(stationId, from, to) {
      return (await offAirMap([stationId], from, to)).get(stationId) ?? [];
    },

    async offAirAt(stationId, at) {
      const spans = await service.offAirSpans(stationId, at, new Date(at.getTime() + 1000));
      return spans.find((s) => Date.parse(s.startsAt) <= at.getTime() && Date.parse(s.endsAt) > at.getTime()) ?? null;
    },

    async offAirHours(stationId) {
      return offAirView(stationId);
    },

    async setOffAirHours(stationId, rules) {
      for (const [i, rule] of rules.entries()) {
        if (rule.signOffAt === rule.backAt) throw badRequest("Sign off and back on can't be the same time.", { [`rules.${i}.backAt`]: "Same as sign off" });
      }
      await db.transaction(async (tx) => {
        await tx.delete(OH).where(eq(OH.stationId, stationId));
        if (rules.length) {
          await tx.insert(OH).values(rules.map((r) => ({ stationId, days: [...new Set(r.days)].sort(), signOffAt: r.signOffAt, backAt: r.backAt })));
        }
      });
      return offAirView(stationId);
    },

    async breakContents(stationId, slots) {
      const result = new Map<string, BreakContent[]>();
      if (!slots.length) return result;
      const stored = slots.map((s) => s.id).filter((v): v is string => Boolean(v));
      const entryIds = [...new Set(slots.map((s) => s.logEntryId).filter((v): v is string => Boolean(v)))];
      const [placed, rotations, credits, entries] = await Promise.all([
        services.spots.breakAirings(stored),
        services.spots.rotations(stationId),
        services.spots.creditsFor(stationId),
        entryIds.length ? db.select().from(E).where(inArray(E.id, entryIds)) : Promise.resolve([] as Row[])
      ]);
      const ctx = await context(entries);
      const main = new Set(rotations.main.spots.map((s) => s.spotId));
      const backup = new Set(rotations.backup.spots.map((s) => s.spotId));
      for (const slot of slots) {
        const rows: BreakContent[] = [];
        const airings = slot.id ? (placed.get(slot.id) ?? []) : [];
        const entry = slot.logEntryId ? entries.find((e) => e.id === slot.logEntryId) : undefined;
        const agreement = entry?.carriageAgreementId ? ctx.agreements.get(entry.carriageAgreementId) : undefined;
        const maker = agreement ? ctx.makers.get(agreement.makerStationId) : undefined;
        const makerName = maker?.callSign ?? maker?.name ?? "The maker";
        let producerPlaced = 0;
        for (const a of airings.filter((x) => x.carriageAgreementId)) {
          producerPlaced += a.lengthSec * 1000;
          rows.push({ id: a.airingId, kind: "producer", title: a.title, lengthMs: a.lengthSec * 1000, spotId: a.spotId, business: a.business, shortName: a.shortName, rotation: null, note: `${makerName}'s break time, barter` });
        }
        if (slot.producerShareMs > producerPlaced) {
          rows.push({ id: `${slot.startsAt}:producer`, kind: "producer", title: `${makerName}'s break time`, lengthMs: slot.producerShareMs - producerPlaced, spotId: null, business: null, shortName: null, rotation: null, note: `${makerName}'s break time, barter` });
        }
        for (const a of airings.filter((x) => !x.carriageAgreementId)) {
          const rotation = main.has(a.spotId) ? "main" : backup.has(a.spotId) ? "backup" : "main";
          rows.push({ id: a.airingId, kind: "spot", title: a.title, lengthMs: a.lengthSec * 1000, spotId: a.spotId, business: a.business, shortName: a.shortName, rotation, note: rotation === "backup" ? "Backup rotation" : null });
        }
        // What playout adds when it airs the break: the credit, bumpers or the slate, the station ID last.
        let left = Math.max(0, slot.lengthMs - rows.reduce((sum, r) => sum + r.lengthMs, 0));
        const sidMs = Math.min(left, STATION_ID_MS);
        left -= sidMs;
        if (credits.length && left >= CREDIT_MS) {
          rows.push({ id: `${slot.startsAt}:credit`, kind: "underwriting", title: credits.map((c) => c.business).join(", "), lengthMs: CREDIT_MS, spotId: null, business: null, shortName: null, rotation: null, note: "Made possible by" });
          left -= CREDIT_MS;
        }
        if (left > 0) {
          rows.push({ id: `${slot.startsAt}:open`, kind: slot.id ? "bumper" : "open", title: slot.id ? "Bumpers and station ID slate" : "Open", lengthMs: left, spotId: null, business: null, shortName: null, rotation: null, note: slot.id ? null : "Filled from the rotation about 20 minutes before" });
        }
        if (sidMs > 0) rows.push({ id: `${slot.startsAt}:sid`, kind: "station_id", title: "Station ID", lengthMs: sidMs, spotId: null, business: null, shortName: null, rotation: null, note: null });
        result.set(slot.startsAt, rows);
      }
      return result;
    },

    async repeats(stationId, from) {
      const G = schema.repeatGroups;
      const rows = await db
        .select({ group: G, n: sql<number>`count(${E.id})::int` })
        .from(G)
        .leftJoin(E, and(eq(E.repeatGroupId, G.id), gte(E.startsAt, from)))
        .where(and(eq(G.stationId, stationId), sql`${G.removedAt} is null`))
        .groupBy(G.id)
        .orderBy(asc(G.startsOn), asc(G.createdAt));
      const tz = rows.some((r) => r.group.template) ? await stationTz(stationId) : "UTC";
      const fromDay = localDate(from, tz);
      return rows
        // G7 copies while they have entries to come; templates while they still repeat. G7's list
        // has three patterns: weekday templates are in `listTemplates` only.
        .filter((r) => (r.group.template ? !r.group.endsOn || r.group.endsOn >= fromDay : r.n > 0))
        .flatMap((r) => (r.group.pattern === "weekdays" ? [] : [{ ...r, pattern: r.group.pattern }]))
        .map((r) => ({
          id: r.group.id,
          day: r.group.startsOn,
          pattern: r.pattern,
          until: r.group.endsOn,
          entries: r.n,
          template: r.group.template,
          weekday: r.group.pattern === "weekly" ? r.group.weekday : null,
          label: templateLabel(r.group)
        }));
    },

    async removeRepeat(stationId, repeatId) {
      return templates.remove(stationId, repeatId);
    },

    async liveEntry(stationId, entryId) {
      const [row] = await db.select().from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
      if (!row) throw notFound("That block");
      if (row.kind !== "live") throw new HttpError(409, "not_live", "That isn't a live block.");
      return row;
    },

    async endEarly(stationId, entryId) {
      const row = await service.liveEntry(stationId, entryId);
      // At the nearest segment boundary after its start, where the stream can change item (the shared rule, G12).
      const at = new Date(endEarlyAt(deps.clock.now().getTime(), row.startsAt));
      if (row.endedEarlyAt) throw new HttpError(409, "ended", "It has already ended.");
      if (!(row.startsAt <= at && at < row.endsAt)) throw new HttpError(409, "not_on_air", "It can end early only while it's on air.");
      const shift = row.endsAt.getTime() - at.getTime();
      // The programs right after it move up, in order, until a gap, a live block, a carried
      // program (its times are the carriage agreement's) or a break with spots already held.
      const after = await db
        .select()
        .from(E)
        .where(and(eq(E.stationId, stationId), gte(E.startsAt, row.endsAt), lt(E.startsAt, new Date(row.endsAt.getTime() + 24 * HOUR))))
        .orderBy(asc(E.startsAt));
      const heldBreaks = after.length
        ? await db
            .select({ id: B.id, logEntryId: B.logEntryId })
            .from(B)
            .where(inArray(B.logEntryId, after.map((e) => e.id)))
        : [];
      const filled = await services.spots.filledMsByBreak(heldBreaks.map((b) => b.id));
      const held = new Set(heldBreaks.filter((b) => (filled.get(b.id) ?? 0) > 0 || false).map((b) => b.logEntryId));
      const moving: Row[] = [];
      let cursor = row.endsAt.getTime();
      for (const e of after) {
        if (e.startsAt.getTime() !== cursor) break;
        if (e.kind !== "program" || e.carriageAgreementId || held.has(e.id)) break;
        moving.push(e);
        cursor = e.endsAt.getTime();
      }
      await db.transaction(async (tx) => {
        await tx.update(E).set({ endsAt: at, endedEarlyAt: at }).where(eq(E.id, row.id));
        for (const e of moving) {
          await tx
            .update(E)
            .set({ startsAt: new Date(e.startsAt.getTime() - shift), endsAt: new Date(e.endsAt.getTime() - shift) })
            .where(eq(E.id, e.id));
        }
        // Breaks stored for the moved programs with nothing placed go; they're made again at the new times.
        const stale = heldBreaks.filter((b) => moving.some((m) => m.id === b.logEntryId)).map((b) => b.id);
        if (stale.length) await tx.delete(B).where(inArray(B.id, stale));
      });
      return { entryId, endedAt: at.toISOString(), movedUp: moving.length };
    },

    async listings(stationId, from, to) {
      if (to.getTime() - from.getTime() > 8 * 24 * HOUR) throw badRequest("Ask for 8 days at most.");
      const rows = (await load([stationId], from, to)).filter((r) => r.kind !== "off_air" && r.code === "PGM" && r.startsAt >= from);
      const listings = await listingViews(rows);
      return { listings, needDescription: listings.filter((l) => l.status === "needs_description").length };
    },

    async updateListing(stationId, entryId, patch) {
      const [row] = await db.select().from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
      if (!row) throw notFound("That airing");
      if (row.carriageAgreementId && (patch.episodeTitle !== undefined || patch.episodeDescription !== undefined)) {
        const [view] = await listingViews([row]);
        const from = view.carriedFrom?.callSign ?? view.carriedFrom?.name ?? "its maker";
        throw new HttpError(409, "from_the_maker", `Listings for ${view.title} come from ${from}. Add a local note instead.`);
      }
      const set: Partial<typeof E.$inferInsert> = {};
      if (patch.episodeTitle !== undefined) set.episodeTitle = patch.episodeTitle || null;
      if (patch.episodeDescription !== undefined) set.episodeDescription = patch.episodeDescription || null;
      if (patch.localNote !== undefined) set.localNote = patch.localNote || null;
      const [updated] = Object.keys(set).length ? await db.update(E).set(set).where(eq(E.id, entryId)).returning() : [row];
      // A day template's date edited by hand is an exception from now on.
      if (Object.keys(set).length && row.templateDate) await templates.markEdited(stationId, [row.templateDate]);
      return (await listingViews([updated]))[0];
    },

    async nextEntry(stationId, at) {
      const [row] = await db
        .select()
        .from(E)
        .where(and(eq(E.stationId, stationId), gt(E.startsAt, at)))
        .orderBy(asc(E.startsAt))
        .limit(1);
      if (!row) return null;
      const ctx = await context([row]);
      const entry = toEntry(row, ctx);
      const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
      const program = entry.programId ? ctx.programs.get(entry.programId) : undefined;
      const agreement = row.carriageAgreementId ? ctx.agreements.get(row.carriageAgreementId) : undefined;
      const maker = agreement ? ctx.makers.get(agreement.makerStationId) : undefined;
      const station = (await services.stations.idents([stationId])).get(stationId);
      return {
        entry,
        description: entry.episodeTitle ?? program?.description ?? item?.episodeDescription ?? null,
        producer: maker ? (maker.callSign ?? maker.name) : null,
        colour: maker?.colour ?? station?.colour ?? null
      };
    },

    async itemSchedule(itemId, limit) {
      const now = deps.clock.now();
      // On now, or still to come.
      const where = and(eq(E.assetId, itemId), gt(E.endsAt, now));
      const [[count], rows] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int`, shortest: sql<number | null>`min(extract(epoch from ${E.endsAt} - ${E.startsAt}) * 1000)::bigint` }).from(E).where(where),
        db.select().from(E).where(where).orderBy(asc(E.startsAt)).limit(limit)
      ]);
      return {
        total: count.n,
        shortestSlotMs: count.shortest === null ? null : Number(count.shortest),
        entries: rows.map((r) => ({ entryId: r.id, stationId: r.stationId, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), localNote: r.localNote, repeatGroupId: r.repeatGroupId }))
      };
    },

    async cadence(stationId, programId) {
      const now = deps.clock.now();
      const tz = await stationTz(stationId);
      const episodes = await services.library.episodes(programId);
      const itemIds = episodes.map((e) => e.id);
      const rows = await db
        .select({ startsAt: E.startsAt })
        .from(E)
        .where(
          and(
            eq(E.stationId, stationId),
            gte(E.startsAt, now),
            lt(E.startsAt, new Date(now.getTime() + 28 * 24 * HOUR)),
            or(eq(E.programId, programId), itemIds.length ? inArray(E.assetId, itemIds) : sql`false`)
          )
        );
      const days = [...new Set(rows.map((r) => localDate(r.startsAt, tz)))];
      if (days.length < 2) return null;
      const weekdays = new Set(days.map((d) => localWeekday(localDay(d, tz).from, tz)));
      if (weekdays.size === 1) return "weekly";
      if (days.length >= 20 && weekdays.size === 7) return "nightly";
      if (days.length >= 12 && weekdays.size === 5 && !weekdays.has(0) && !weekdays.has(6)) return "weeknights";
      return null;
    },

    async airingsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(E).where(inArray(E.id, ids));
      const ctx = await context(rows);
      return new Map(
        rows.map((r) => [r.id, { id: r.id, stationId: r.stationId, title: titleOf(r, ctx), startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }])
      );
    },

    async nowNext(stationIds, at) {
      const until = new Date(at.getTime() + 24 * HOUR);
      const [rows, offAir] = await Promise.all([load(stationIds, at, until), offAirMap(stationIds, at, until, true)]);
      const ctx = await context(rows);
      const result = new Map<string, { now: Airing | null; next: Airing | null }>();
      for (const id of stationIds) {
        const airings = viewerAirings(
          rows.filter((r) => r.stationId === id),
          offAir.get(id) ?? [],
          ctx
        );
        const now = airings.find((a) => Date.parse(a.startsAt) <= at.getTime() && Date.parse(a.endsAt) > at.getTime()) ?? null;
        const next = airings.find((a) => Date.parse(a.startsAt) > at.getTime()) ?? null;
        result.set(id, { now, next });
      }
      return result;
    },

    async window(stationIds, from, to) {
      const [rows, offAir] = await Promise.all([load(stationIds, from, to), offAirMap(stationIds, from, to, true)]);
      const ctx = await context(rows);
      const result = new Map<string, Airing[]>();
      for (const id of stationIds) {
        result.set(
          id,
          viewerAirings(
            rows.filter((r) => r.stationId === id),
            offAir.get(id) ?? [],
            ctx
          ).filter((a) => Date.parse(a.endsAt) > from.getTime() && Date.parse(a.startsAt) < to.getTime())
        );
      }
      return result;
    },

    async upcomingForProgram(programId, limit) {
      const episodes = await services.library.episodes(programId);
      const itemIds = episodes.map((e) => e.id);
      const now = deps.clock.now();
      const rows = await db
        .select()
        .from(E)
        .where(and(gte(E.startsAt, now), or(eq(E.programId, programId), itemIds.length ? inArray(E.assetId, itemIds) : sql`false`)))
        .orderBy(asc(E.startsAt))
        .limit(limit);
      const ctx = await context(rows);
      return rows.map((r) => ({ id: r.id, stationId: r.stationId, title: titleOf(r, ctx), startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
    },

    async itemUsage(itemId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(E)
        .where(and(eq(E.assetId, itemId), gt(E.endsAt, deps.clock.now())));
      return { upcoming: row.n };
    },

    async gaps(stationId, from, to) {
      const [rows, offAir] = await Promise.all([load([stationId], from, to), service.offAirSpans(stationId, from, to)]);
      return gapsIn(rows, from, to, offAir);
    },

    async breaks(stationId, from, to) {
      return withStored(stationId, await generateBreaks(stationId, from, to), from, to);
    },

    async ensureBreaks(stationId, from, to) {
      const generated = await generateBreaks(stationId, from, to);
      const stored = await db
        .select()
        .from(B)
        .where(and(eq(B.stationId, stationId), gte(B.startsAt, from), lt(B.startsAt, to)));
      const wanted = new Set(generated.map((g) => g.startsAt));
      const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
      // Stale breaks with nothing placed in them go; ones with airings stay (those airings are paid for).
      const stale = stored.filter((b) => b.origin !== "cued_live" && !wanted.has(b.startsAt.toISOString()) && !filled.get(b.id));
      if (stale.length) await db.delete(B).where(inArray(B.id, stale.map((b) => b.id)));
      const have = new Set(stored.map((b) => b.startsAt.toISOString()));
      const missing = generated.filter((g) => !have.has(g.startsAt));
      if (missing.length) {
        await db.insert(B).values(
          missing.map((g) => ({
            stationId,
            startsAt: new Date(g.startsAt),
            lengthMs: g.lengthMs,
            logEntryId: g.logEntryId,
            origin: g.origin,
            producerShareMs: g.producerShareMs
          }))
        );
      }
      return withStored(stationId, generated, from, to);
    },

    async entries(stationId, from, to) {
      return load([stationId], from, to);
    },

    async entrySpan(entryId) {
      const [row] = await db.select({ startsAt: E.startsAt, endsAt: E.endsAt }).from(E).where(eq(E.id, entryId));
      return row ?? null;
    },

    async upcomingItems(from, to) {
      const rows = await db
        .select({ stationId: E.stationId, entryId: E.id, itemId: E.assetId, startsAt: E.startsAt })
        .from(E)
        .where(and(sql`${E.assetId} is not null`, gt(E.endsAt, from), lt(E.startsAt, to)))
        .orderBy(asc(E.startsAt));
      return rows.map((r) => ({ ...r, itemId: r.itemId! }));
    },

    async pullItem(itemId) {
      const now = deps.clock.now();
      const pulled = await db.transaction(async (tx) => {
        const rows = await tx.select({ id: E.id }).from(E).where(and(eq(E.assetId, itemId), gt(E.startsAt, now)));
        await releaseBreaks(tx, rows.map((r) => r.id));
        return rows.length ? tx.delete(E).where(inArray(E.id, rows.map((r) => r.id))).returning({ stationId: E.stationId }) : [];
      });
      const counts = new Map<string, number>();
      for (const p of pulled) counts.set(p.stationId, (counts.get(p.stationId) ?? 0) + 1);
      return [...counts].map(([stationId, entries]) => ({ stationId, entries }));
    },

    async fillDeadAir(stationId, gap, options = {}) {
      const startsAt = new Date(gap.startsAt);
      const endsAt = new Date(gap.endsAt);
      const items = (await services.library.repeatable(stationId, 20)).filter((i) => options.usable?.(i) ?? true);
      // From a segment boundary (the stream changes item there).
      let cursor = nextSegment(startsAt.getTime());
      let placed = 0;
      for (let i = 0; items.length && i < 200; i++) {
        const item = items[i % items.length];
        const length = roundUpToMinute(item.durationMs!);
        if (cursor + length > endsAt.getTime()) break;
        await db.insert(E).values({
          stationId,
          startsAt: new Date(cursor),
          endsAt: new Date(cursor + length),
          kind: "program",
          code: item.code,
          assetId: item.id,
          programId: item.programId,
          localNote: DEAD_AIR_NOTE
        });
        cursor += length;
        placed++;
      }
      const now = deps.clock.now();
      const [event] = await db
        .select()
        .from(schema.deadAirEvents)
        .where(and(eq(schema.deadAirEvents.stationId, stationId), eq(schema.deadAirEvents.gapStartsAt, startsAt)));
      if (event) await db.update(schema.deadAirEvents).set({ autoFilledAt: now }).where(eq(schema.deadAirEvents.id, event.id));
      else await db.insert(schema.deadAirEvents).values({ stationId, gapStartsAt: startsAt, gapEndsAt: endsAt, autoFilledAt: now });
      deps.bus.emit("station.dead_air_filled", { stationId, gapStartsAt: gap.startsAt, gapEndsAt: gap.endsAt });
      return placed;
    },

    async markBreakFilled(breakId) {
      await db.update(B).set({ filledAt: deps.clock.now() }).where(eq(B.id, breakId));
    },

    async cueBreak(stationId, atTime, lengthMs, logEntryId) {
      // From the next segment boundary.
      const at = new Date(nextSegment(atTime.getTime()));
      const [row] = await db.insert(B).values({ stationId, startsAt: at, lengthMs, logEntryId, origin: "cued_live" }).returning();
      return {
        id: row.id,
        filledAt: null,
        startsAt: row.startsAt.toISOString(),
        lengthMs,
        context: "Cued live",
        origin: "cued_live",
        producerShareMs: 0,
        filledMs: 0,
        openMs: lengthMs,
        logEntryId
      };
    },

    async breakContexts(breakIds) {
      if (!breakIds.length) return new Map();
      const rows = await db.select().from(B).where(inArray(B.id, [...new Set(breakIds)]));
      const entries = await db.select().from(E).where(inArray(E.id, rows.map((r) => r.logEntryId).filter((v): v is string => Boolean(v))));
      const ctx = await context(entries);
      return new Map(
        rows.map((b) => {
          const entry = entries.find((e) => e.id === b.logEntryId);
          if (!entry) return [b.id, "Between programs"];
          const item = entry.assetId ? ctx.items.get(entry.assetId) : undefined;
          const during = b.startsAt.getTime() < entry.startsAt.getTime() + (item?.durationMs ?? 0) - 1000;
          const episode = item?.episodeNumber ? `, ep. ${item.episodeNumber}` : "";
          return [b.id, `${during ? "During" : "After"} ${titleOf(entry, ctx)}${episode}`];
        })
      );
    },

    async countCarried({ carrierStationId, agreementId, itemId, excludeEntryId }) {
      const rows = await db
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.stationId, carrierStationId), eq(E.carriageAgreementId, agreementId), eq(E.assetId, itemId)));
      return rows.filter((r) => r.id !== excludeEntryId).length;
    },

    async firstAiring(stationId, itemId) {
      const [row] = await db
        .select({ startsAt: E.startsAt })
        .from(E)
        .where(and(eq(E.stationId, stationId), eq(E.assetId, itemId)))
        .orderBy(asc(E.startsAt))
        .limit(1);
      return row?.startsAt ?? null;
    },

    async airsAt(stationId, itemId, at) {
      const [row] = await db
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.stationId, stationId), eq(E.assetId, itemId), sql`${E.startsAt} <= ${at}`, gt(E.endsAt, at)))
        .limit(1);
      return Boolean(row);
    },

    async placeCarried({ agreementId, carrierStationId, programId, starts, replaceExisting }) {
      const episodes = (await services.library.episodes(programId)).filter((e) => e.rightsConfirmed && !e.archived);
      if (!episodes.length) throw refused("no_episodes", "The program has no episodes ready to carry yet.");
      // Next unaired, in order.
      const aired = await db
        .select({ assetId: E.assetId })
        .from(E)
        .where(and(eq(E.stationId, carrierStationId), eq(E.carriageAgreementId, agreementId)));
      const airedSet = new Set(aired.map((a) => a.assetId));
      let index = Math.max(0, episodes.findIndex((e) => !airedSet.has(e.id)));
      let placed = 0;
      let replaced = 0;
      let blockedByLimit = 0;
      for (const start of starts) {
        const episode = episodes[index % episodes.length];
        // Carried slots run to the next half hour, which leaves the break time barter splits.
        const endsAt = new Date(start.getTime() + Math.ceil((episode.durationMs ?? 30 * MIN) / (30 * MIN)) * 30 * MIN);
        try {
          await services.catalog.checkAiring({ agreementId, carrierStationId, itemId: episode.id, startsAt: start });
        } catch {
          blockedByLimit++;
          continue;
        }
        await db.transaction(async (tx) => {
          if (replaceExisting) {
            const replacing = await tx.select({ id: E.id }).from(E).where(and(eq(E.stationId, carrierStationId), lt(E.startsAt, endsAt), gt(E.endsAt, start)));
            await releaseBreaks(tx, replacing.map((r) => r.id));
            const removed = await tx
              .delete(E)
              .where(and(eq(E.stationId, carrierStationId), lt(E.startsAt, endsAt), gt(E.endsAt, start)))
              .returning({ id: E.id });
            replaced += removed.length;
          }
          await tx.insert(E).values({
            stationId: carrierStationId,
            startsAt: start,
            endsAt,
            kind: "program",
            code: "PGM",
            assetId: episode.id,
            programId,
            carriageAgreementId: agreementId
          });
        }).then(
          () => {
            placed++;
            index++;
          },
          () => {
            blockedByLimit++;
          }
        );
      }
      return { placed, replaced, blockedByLimit };
    },

    async log(stationId, from, to) {
      if (to.getTime() - from.getTime() > 8 * 24 * HOUR) throw badRequest("Ask for a week at most.");
      // Day templates: the dates in the window are generated (usually already, by the job).
      await templates.generate(stationId, { through: localDate(to, await stationTz(stationId)) });
      const [rows, offAir] = await Promise.all([load([stationId], from, to), service.offAirSpans(stationId, from, to)]);
      const ctx = await context(rows);
      const breaks = await service.breaks(stationId, from, to);
      const [contents, repeats, days] = await Promise.all([service.breakContents(stationId, breaks), service.repeats(stationId, from), templates.days(stationId, from, to)]);
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        entries: rows.map((r) => toEntry(r, ctx)),
        // G1: each break's rows, in the order they air.
        breaks: breaks.map((b) => ({ ...b, rows: (contents.get(b.startsAt) ?? []).map(breakRow) })),
        gaps: gapsIn(rows, from, to, offAir),
        repeats,
        offAir,
        // G11: each broadcast day in the window and the day template that made it.
        days
      };
    },

    async add(stationId, userId, input) {
      const checked = await validate(stationId, input);
      const [row] = await db
        .insert(E)
        .values({
          stationId,
          startsAt: checked.startsAt,
          endsAt: checked.endsAt,
          kind: input.kind,
          code: checked.code,
          assetId: input.itemId ?? null,
          programId: checked.programId,
          liveSourceId: input.liveSourceId ?? null,
          carriageAgreementId: input.carriageAgreementId ?? null,
          episodeTitle: input.episodeTitle ?? null,
          episodeDescription: input.episodeDescription ?? null,
          localNote: input.localNote ?? null,
          createdBy: userId
        })
        .returning();
      // Adding to a date a day template made makes that date an exception.
      await templates.markEdited(stationId, [row.startsAt]);
      await changedNear(stationId, [row.startsAt]);
      return toEntry(row, await context([row]));
    },

    async update(stationId, entryId, input) {
      const [current] = await db.select().from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
      if (!current) throw notFound("That log entry");
      const merged: EntryInput = {
        kind: input.kind ?? current.kind,
        startsAt: input.startsAt ?? current.startsAt.toISOString(),
        endsAt: input.endsAt ?? (input.startsAt || input.itemId ? undefined : current.endsAt.toISOString()),
        itemId: input.itemId ?? current.assetId ?? undefined,
        programId: input.programId ?? current.programId ?? undefined,
        liveSourceId: input.liveSourceId ?? current.liveSourceId ?? undefined,
        carriageAgreementId: input.carriageAgreementId ?? current.carriageAgreementId ?? undefined
      };
      if (input.startsAt && !input.endsAt) {
        merged.endsAt = new Date(Date.parse(input.startsAt) + (current.endsAt.getTime() - current.startsAt.getTime())).toISOString();
      }
      const checked = await validate(stationId, merged, entryId);
      const [row] = await db
        .update(E)
        .set({
          startsAt: checked.startsAt,
          endsAt: checked.endsAt,
          kind: merged.kind,
          code: checked.code,
          assetId: merged.itemId ?? null,
          programId: checked.programId,
          liveSourceId: merged.liveSourceId ?? null,
          carriageAgreementId: merged.carriageAgreementId ?? null,
          ...(input.episodeTitle !== undefined ? { episodeTitle: input.episodeTitle } : {}),
          ...(input.episodeDescription !== undefined ? { episodeDescription: input.episodeDescription } : {}),
          ...(input.localNote !== undefined ? { localNote: input.localNote } : {})
        })
        .where(eq(E.id, entryId))
        .returning();
      await templates.markEdited(stationId, [current.templateDate ?? current.startsAt, row.startsAt]);
      await changedNear(stationId, [current.startsAt, row.startsAt]);
      return toEntry(row, await context([row]));
    },

    async remove(stationId, entryId) {
      const removed = await db.transaction(async (tx) => {
        const [mine] = await tx.select({ id: E.id }).from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
        if (mine) await releaseBreaks(tx, [mine.id]);
        return tx
          .delete(E)
          .where(and(eq(E.id, entryId), eq(E.stationId, stationId)))
          .returning({ startsAt: E.startsAt, templateDate: E.templateDate });
      });
      if (!removed.length) throw notFound("That log entry");
      await templates.markEdited(stationId, [removed[0].templateDate ?? removed[0].startsAt]);
      await changedNear(stationId, [removed[0].startsAt]);
    },

    async repeatDay(stationId, input) {
      // Since 2026-09-29 "Repeat this day" makes a day template, running until `until`.
      const { template, generated } = await templates.create(stationId, { fromDay: input.day, pattern: input.pattern, onto: input.onto, until: input.pattern === "once" ? undefined : input.until });
      return { created: generated.created, skippedForConflicts: generated.skippedForConflicts, templateId: template.id };
    },

    async fill(stationId, userId, input) {
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (endsAt <= startsAt) throw badRequest("It has to end after it starts.");
      if (input.with === "sign_off") {
        return [await service.add(stationId, userId, { kind: "off_air", startsAt: input.startsAt, endsAt: input.endsAt })];
      }
      const items = await services.library.itemsByIds(input.itemIds);
      const ordered = input.itemIds.map((id) => items.get(id)).filter((i): i is ItemRef => Boolean(i?.durationMs && i.rightsConfirmed));
      if (!ordered.length) throw refused("nothing_to_repeat", "Choose items with confirmed rights to repeat.");
      const added: LogEntry[] = [];
      let cursor = startsAt.getTime();
      for (let i = 0; ; i++) {
        const item = ordered[i % ordered.length];
        const length = roundUpToMinute(item.durationMs!);
        if (cursor + length > endsAt.getTime()) break;
        added.push(
          await service.add(stationId, userId, {
            kind: "program",
            startsAt: new Date(cursor).toISOString(),
            endsAt: new Date(cursor + length).toISOString(),
            itemId: item.id
          })
        );
        cursor += length;
        if (i > 500) break;
      }
      return added;
    },

    async deadAir(stationId) {
      const now = deps.clock.now();
      const until = new Date(now.getTime() + 24 * HOUR);
      const [rows, offAir] = await Promise.all([load([stationId], now, until), service.offAirSpans(stationId, now, until)]);
      const gaps = gapsIn(rows, now, until, offAir);
      const [last] = await db.select({ endsAt: E.endsAt }).from(E).where(eq(E.stationId, stationId)).orderBy(desc(E.endsAt)).limit(1);
      const events = await db
        .select()
        .from(schema.deadAirEvents)
        .where(and(eq(schema.deadAirEvents.stationId, stationId), gte(schema.deadAirEvents.gapStartsAt, new Date(now.getTime() - HOUR))));
      const warnings = events.flatMap((e) => [
        ...(e.warned30At ? [{ gapStartsAt: e.gapStartsAt.toISOString(), warnedAt: e.warned30At.toISOString(), minutesBefore: 30 as const }] : []),
        ...(e.warned12At ? [{ gapStartsAt: e.gapStartsAt.toISOString(), warnedAt: e.warned12At.toISOString(), minutesBefore: 12 as const }] : [])
      ]);
      return {
        gaps,
        nextGapAt: gaps[0]?.startsAt ?? null,
        logRunsUntil: last && last.endsAt > now ? last.endsAt.toISOString() : null,
        warnings,
        offAir
      };
    },

    async checkDeadAir(stationIds) {
      const now = deps.clock.now();
      for (const stationId of stationIds) {
        const soon = new Date(now.getTime() + 31 * MIN);
        // Planned off air time isn't dead air: never warned about.
        const [rows, offAir] = await Promise.all([load([stationId], now, soon), service.offAirSpans(stationId, now, soon)]);
        const gaps = gapsIn(rows, now, soon, offAir);
        for (const gap of gaps) {
          const gapStart = new Date(gap.startsAt);
          const minutesAway = (gapStart.getTime() - now.getTime()) / MIN;
          if (minutesAway <= 0) continue;
          let [event] = await db
            .select()
            .from(schema.deadAirEvents)
            .where(and(eq(schema.deadAirEvents.stationId, stationId), eq(schema.deadAirEvents.gapStartsAt, gapStart)));
          if (!event) {
            [event] = await db
              .insert(schema.deadAirEvents)
              .values({ stationId, gapStartsAt: gapStart, gapEndsAt: new Date(gap.endsAt) })
              .returning();
          }
          if (minutesAway <= 30 && !event.warned30At) {
            await db.update(schema.deadAirEvents).set({ warned30At: now }).where(eq(schema.deadAirEvents.id, event.id));
            deps.bus.emit("station.dead_air_warning", { stationId, gapStartsAt: gap.startsAt, minutesBefore: 30 });
          }
          if (minutesAway <= 12 && !event.warned12At) {
            await db.update(schema.deadAirEvents).set({ warned12At: now }).where(eq(schema.deadAirEvents.id, event.id));
            deps.bus.emit("station.dead_air_warning", { stationId, gapStartsAt: gap.startsAt, minutesBefore: 12 });
          }
        }
      }
    }
  };
  return service;
}


/** G1: a break's content as a row on the log. */
function breakRow(c: BreakContent): BreakRow {
  const code: BreakRow["code"] =
    c.kind === "station_id" ? "SID" : c.kind === "bumper" ? "BMP" : c.kind === "underwriting" || c.kind === "sponsor" ? "UND" : c.kind === "open" ? "OPEN" : "SPT";
  const whose: BreakRow["whose"] = c.kind === "producer" ? "producer" : c.rotation === "backup" ? "backup" : "station";
  return { code, title: c.business && c.kind === "spot" ? `${c.shortName ?? c.business}: ${c.title}` : c.title, lengthMs: c.lengthMs, whose, note: c.note };
}
