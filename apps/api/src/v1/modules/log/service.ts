import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Airing, BreakContent, BreakRow, Listing, LogEntry } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { badRequest, HttpError, notFound, refused } from "../../errors.js";
import { addDays, localDate, localDay, localWeekday, roundUpToMinute } from "../../lib/time.js";
import { CREDIT_MS, STATION_ID_MS } from "../playout/engine/fill.js";

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

/** G7: a "Repeat this day" still on the log. */
export interface RepeatView {
  id: string;
  day: string;
  pattern: "once" | "daily" | "weekly";
  until: string | null;
  entries: number;
}

type ListingPatch = { episodeTitle?: string | null; episodeDescription?: string | null; localNote?: string | null };

export interface LogService {
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
  fillDeadAir(stationId: string, gap: Gap): Promise<number>;
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

  log(stationId: string, from: Date, to: Date): Promise<{ from: string; to: string; entries: LogEntry[]; breaks: BreakSlotView[]; gaps: Gap[] }>;
  add(stationId: string, userId: string, input: EntryInput): Promise<LogEntry>;
  update(stationId: string, entryId: string, input: Partial<EntryInput>): Promise<LogEntry>;
  remove(stationId: string, entryId: string): Promise<void>;
  repeatDay(stationId: string, input: { day: string; pattern: "once" | "daily" | "weekly"; until: string; onto?: string }): Promise<{ created: number; skippedForConflicts: number }>;
  fill(stationId: string, userId: string, input: { with: "repeat"; startsAt: string; endsAt: string; itemIds: string[] } | { with: "sign_off"; startsAt: string; endsAt: string }): Promise<LogEntry[]>;
  deadAir(stationId: string): Promise<{ gaps: Gap[]; nextGapAt: string | null; logRunsUntil: string | null; warnings: Array<{ gapStartsAt: string; warnedAt: string; minutesBefore: 30 | 12 }> }>;
  /** The rolling dead-air check: warnings at 30 and 12 minutes before a gap. Run every minute by the scheduler. */
  checkDeadAir(stationIds: string[]): Promise<void>;
}

const E = schema.logEntries;
const B = schema.breaks;
const MIN = 60_000;
const HOUR = 60 * MIN;

export function createLogService({ deps, services }: ModuleContext): LogService {
  const { db } = deps;

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

  function gapsIn(rows: Row[], from: Date, to: Date): Gap[] {
    const gaps: Gap[] = [];
    let cursor = from.getTime();
    for (const row of [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
      if (row.startsAt.getTime() > cursor) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: row.startsAt.toISOString() });
      cursor = Math.max(cursor, row.endsAt.getTime());
    }
    if (cursor < to.getTime()) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: to.toISOString() });
    return gaps.filter((g) => Date.parse(g.endsAt) > Date.parse(g.startsAt));
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
          const startsAt = new Date(row.startsAt.getTime() + point + shift);
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
    const startsAt = new Date(input.startsAt);
    let endsAt = input.endsAt ? new Date(input.endsAt) : null;
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
      if (item.durationMs && endsAt.getTime() - startsAt.getTime() < item.durationMs - 1000) {
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
      const rows = await db
        .select({ group: schema.repeatGroups, n: sql<number>`count(${E.id})::int` })
        .from(schema.repeatGroups)
        .innerJoin(E, and(eq(E.repeatGroupId, schema.repeatGroups.id), gte(E.startsAt, from)))
        .where(eq(schema.repeatGroups.stationId, stationId))
        .groupBy(schema.repeatGroups.id)
        .orderBy(asc(schema.repeatGroups.startsOn));
      return rows.map((r) => ({ id: r.group.id, day: r.group.startsOn, pattern: r.group.pattern, until: r.group.endsOn, entries: r.n }));
    },

    async removeRepeat(stationId, repeatId) {
      const [group] = await db.select().from(schema.repeatGroups).where(and(eq(schema.repeatGroups.id, repeatId), eq(schema.repeatGroups.stationId, stationId)));
      if (!group) throw notFound("That repeat");
      const removed = await db
        .delete(E)
        .where(and(eq(E.repeatGroupId, repeatId), gt(E.startsAt, deps.clock.now())))
        .returning({ id: E.id });
      return removed.length;
    },

    async liveEntry(stationId, entryId) {
      const [row] = await db.select().from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
      if (!row) throw notFound("That block");
      if (row.kind !== "live") throw new HttpError(409, "not_live", "That isn't a live block.");
      return row;
    },

    async endEarly(stationId, entryId) {
      const row = await service.liveEntry(stationId, entryId);
      // To the second: the as-run log's live airing ends here too.
      const at = new Date(Math.floor(deps.clock.now().getTime() / 1000) * 1000);
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
      const rows = await load(stationIds, at, new Date(at.getTime() + 24 * HOUR));
      const ctx = await context(rows);
      const result = new Map<string, { now: Airing | null; next: Airing | null }>();
      for (const id of stationIds) {
        const mine = rows.filter((r) => r.stationId === id);
        const now = mine.find((r) => r.startsAt <= at && r.endsAt > at) ?? null;
        const next = mine.find((r) => r.startsAt > at) ?? null;
        result.set(id, { now: now ? toAiring(now, ctx) : null, next: next ? toAiring(next, ctx) : null });
      }
      return result;
    },

    async window(stationIds, from, to) {
      const rows = await load(stationIds, from, to);
      const ctx = await context(rows);
      const result = new Map<string, Airing[]>(stationIds.map((id) => [id, []]));
      for (const row of rows) result.get(row.stationId)!.push(toAiring(row, ctx));
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
      return gapsIn(await load([stationId], from, to), from, to);
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
      const pulled = await db
        .delete(E)
        .where(and(eq(E.assetId, itemId), gt(E.startsAt, now)))
        .returning({ stationId: E.stationId });
      const counts = new Map<string, number>();
      for (const p of pulled) counts.set(p.stationId, (counts.get(p.stationId) ?? 0) + 1);
      return [...counts].map(([stationId, entries]) => ({ stationId, entries }));
    },

    async fillDeadAir(stationId, gap) {
      const startsAt = new Date(gap.startsAt);
      const endsAt = new Date(gap.endsAt);
      const items = await services.library.repeatable(stationId, 20);
      let cursor = startsAt.getTime();
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

    async cueBreak(stationId, at, lengthMs, logEntryId) {
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
      const rows = await load([stationId], from, to);
      const ctx = await context(rows);
      const breaks = await service.breaks(stationId, from, to);
      const [contents, repeats] = await Promise.all([service.breakContents(stationId, breaks), service.repeats(stationId, from)]);
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        entries: rows.map((r) => toEntry(r, ctx)),
        // G1: each break's rows, in the order they air.
        breaks: breaks.map((b) => ({ ...b, rows: (contents.get(b.startsAt) ?? []).map(breakRow) })),
        gaps: gapsIn(rows, from, to),
        repeats
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
      return toEntry(row, await context([row]));
    },

    async remove(stationId, entryId) {
      const removed = await db.delete(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId))).returning({ id: E.id });
      if (!removed.length) throw notFound("That log entry");
    },

    async repeatDay(stationId, input) {
      const tz = await stationTz(stationId);
      const { from, to } = localDay(input.day, tz);
      const source = await load([stationId], from, to);
      const days: string[] = [];
      if (input.pattern === "once") {
        if (!input.onto) throw badRequest("Choose the day to copy to.", { onto: "Required" });
        days.push(input.onto);
      } else {
        const weekday = localWeekday(from, tz);
        for (let d = addDays(input.day, 1); d <= input.until; d = addDays(d, 1)) {
          if (input.pattern === "daily" || localWeekday(localDay(d, tz).from, tz) === weekday) days.push(d);
        }
      }
      if (days.length > 120) throw badRequest("Repeat for at most 120 days at a time.");
      const [group] = await db
        .insert(schema.repeatGroups)
        .values({
          stationId,
          pattern: input.pattern,
          weekday: input.pattern === "weekly" ? localWeekday(from, tz) : null,
          startTime: "00:00",
          startsOn: input.day,
          endsOn: input.pattern === "once" ? input.onto! : input.until
        })
        .returning();
      let created = 0;
      let skippedForConflicts = 0;
      for (const day of days) {
        const target = localDay(day, tz).from;
        for (const row of source) {
          const offset = row.startsAt.getTime() - from.getTime();
          const startsAt = new Date(target.getTime() + offset);
          const endsAt = new Date(startsAt.getTime() + (row.endsAt.getTime() - row.startsAt.getTime()));
          try {
            await db.insert(E).values({
              stationId,
              startsAt,
              endsAt,
              kind: row.kind,
              code: row.code,
              assetId: row.assetId,
              programId: row.programId,
              liveSourceId: row.liveSourceId,
              carriageAgreementId: row.carriageAgreementId,
              repeatGroupId: group.id,
              localNote: row.localNote
            });
            created++;
          } catch {
            // Overlaps something already there, or breaks a carriage limit: leave the existing log alone.
            skippedForConflicts++;
          }
        }
      }
      return { created, skippedForConflicts };
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
      const rows = await load([stationId], now, until);
      const gaps = gapsIn(rows, now, until);
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
        warnings
      };
    },

    async checkDeadAir(stationIds) {
      const now = deps.clock.now();
      for (const stationId of stationIds) {
        const gaps = gapsIn(await load([stationId], now, new Date(now.getTime() + 31 * MIN)), now, new Date(now.getTime() + 31 * MIN));
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
