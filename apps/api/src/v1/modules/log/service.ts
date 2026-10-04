import { asLogCode, isIdentCode } from "@opencast/contracts";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Airing, AiringBlock, BlockBand, BlockSpan, BreakContent, BreakRow, Listing, LogDay, LogEntry } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, HttpError, notFound, refused } from "../../errors.js";
import { clockTime, localDate, localDay, localWeekday, roundUpToMinute } from "../../lib/time.js";
import { endEarlyAt, nextSegment, SEGMENT_MS, snapDate, snapToSegment } from "../../lib/segments.js";
import { CREDIT_MS, STATION_ID_MS } from "../playout/engine/fill.js";
import { bumpersIn, cadenceContext, EVERY_PART, hourStartIn, isEveryBreak, needMs, partsOf, type BreakParts } from "../playout/engine/cadence.js";
import { BoundaryDecider, blockPositionAirs, bumperHistory, defaultElements, eligible, elementsMs, fitElements, pickElements, rolesFor, SequenceDecider, UpNextDecider, upNextAired, upNextHome, withoutUpNext, withUpNext, type Announce, type Boundary, type BumperRole, type BumperSequences, type Element } from "../playout/engine/sequence.js";
import { GENERATED_BLOCK_CARD_MS } from "../playout/engine/stationId.js";
import { blockAt, loadSpans, memberOf, memberships, type Membership, type SpanRow } from "./blocks.js";
import type { BlockRef } from "../library/blocks.js";
import { catalogCreditBreaks, catalogEntries } from "../playout/engine/catalogCredit.js";
import { hhmm, offAirSpans, offAirStretches, ruleLabel, type OffAirSpanView } from "./offair.js";
import { broadcastDate, createTemplateOps, templateLabel, type TemplateOps } from "./templates.js";
import { createChangeOps, logVersion, PARK, type ChangeOps } from "./changes.js";

export type { OffAirSpanView } from "./offair.js";
export type { Boundary, Element } from "../playout/engine/sequence.js";

/** Log entries made by the dead-air fill carry this note (playout records them as dead-air fills). */
export const DEAD_AIR_NOTE = "Filled automatically: dead air";
import type { ItemRef } from "../library/service.js";
import type { BreakRuleView } from "../stations/service.js";

type Row = typeof schema.logEntries.$inferSelect;

/**
 * A viewer's reminder, settled when its airing came off the log (added 2026-09-29): moved to the
 * program's next airing (`startsAt` is that one's), or cancelled (`startsAt` is the one that went).
 */
export interface ReminderNews {
  event: "reminder.moved" | "reminder.cancelled";
  userId: string;
  reminderId: string;
  stationId: string;
  title: string;
  startsAt: string;
}

/** Reminders on an airing that comes off move to the same program's next airing on the station, this far after it at most. */
export const REMINDER_MOVE_MS = 7 * 24 * 60 * 60_000;

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
  /**
   * What airs in it: the station ID, bumpers, the credit and spots, each as often as the break
   * rule's cadence says (added 2026-09-29). Left out: everything (every break).
   */
  parts?: BreakParts;
  /** A243: its bumpers, picked from their roles' pools: the sequence opening it and the one closing it. */
  elements?: { open: Element[]; close: Element[] };
  /** A243: the between sequence after it, when it closes a program's slot just as the next starts (carved from its end). */
  boundary?: Boundary | null;
  /** A244: the programming block it's in (its entry is a member), or null. */
  blockId?: string | null;
}

/** A244: where programming blocks air on a station, for playout: each piece (members and the open time between them) and the blocks. */
export interface BlockPlan {
  pieces: Array<{ blockId: string; spanId: string; s: number; e: number }>;
  /** Members' entry ids → their block. */
  byEntry: Map<string, string>;
  refs: Map<string, BlockRef>;
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
  /** G18: "Keep at this time" (left out: false; on `update`, as it is). */
  keepTime?: boolean;
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
  /** Edit mode (added 2026-09-29): batches of changes, checked together and published at once, and their history. */
  changes: ChangeOps;
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
  /**
   * Break slots in a window, generated from the break rule. Stored ones carry their id. With
   * `everyPart`, as the rule lays them out with every part in every break (its cadence left aside).
   */
  breaks(stationId: string, from: Date, to: Date, options?: { everyPart?: boolean }): Promise<BreakSlotView[]>;
  /**
   * A246: a window's entries and breaks (with their rows) rebuilt with a break rule that isn't
   * saved, as `log` would answer after saving it (`previewBreakRule`). Reads only: nothing is
   * stored, placed or sent, and template dates aren't made. `keeps`: the break keeps what it has
   * (spots placed in it, or it has started).
   */
  previewBreaks(stationId: string, from: Date, to: Date, rule: BreakRuleView): Promise<{ entries: LogEntry[]; breaks: Array<BreakSlotView & { rows: BreakRow[]; keeps: boolean }>; blocks?: BlockSpan[] }>;
  /**
   * A243: the breaks in a window (as `breaks`) and every program boundary's between sequence in it
   * (including those carried by a closing break as its `boundary`), for playout.
   */
  breakPlan(stationId: string, from: Date, to: Date): Promise<{ breaks: BreakSlotView[]; boundaries: Boundary[]; blocks: BlockPlan }>;
  /** A243: what up next names after a moment: the guide's next airing, or null when off air (or nothing) comes first. */
  upNextAfter(stationId: string, at: Date): Promise<Airing | null>;
  /** A244: programming blocks for playout (as `breakPlan` decides with them). */
  blockPlan(stationId: string, from: Date, to: Date): Promise<BlockPlan>;
  /** A244: each station's programming blocks in a window, from first member to last (the guide's bands). */
  blockBands(stationIds: string[], from: Date, to: Date): Promise<Map<string, BlockBand[]>>;
  /** A244: the block on air at a moment, and the block the next entry after it enters (the Monitor). */
  blockStatus(stationId: string, at: Date, nextEntryId: string | null): Promise<{ now: BlockBand | null; next: BlockBand | null }>;
  /** A244: blocks' schedules ("Every Saturday, 9:00 pm to 1:00 am"), next airing and (`withPlacements`) where they're on the log. */
  blockSchedules(stationId: string, blockIds: string[], withPlacements: boolean): Promise<Map<string, BlockSchedule>>;
  /** A244: the station page's Blocks: blocks with a span in the next 14 days. */
  stationPageBlocks(stationId: string): Promise<StationPageBlock[]>;
  /** A244: a block's spans starting from now on. */
  blockSpansAhead(stationId: string, blockId: string): Promise<number>;
  /** A244: takes a block off the log from now on (dates edited by hand keep theirs) and out of its day templates. */
  takeBlockOffLog(stationId: string, blockId: string): Promise<{ removed: number; kept: number }>;
  /** Stores the generated breaks for a window (spots are placed into stored breaks). */
  ensureBreaks(stationId: string, from: Date, to: Date): Promise<BreakSlotView[]>;
  /** Entries within a window, for sign-on checks and playout. */
  entries(stationId: string, from: Date, to: Date): Promise<Row[]>;
  /** One entry's slot. */
  entrySpan(entryId: string): Promise<{ startsAt: Date; endsAt: Date } | null>;
  /** Every station's items on the log in a window, earliest first (the readiness check reads ahead). */
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

  log(stationId: string, from: Date, to: Date): Promise<{ from: string; to: string; entries: LogEntry[]; breaks: BreakSlotView[]; gaps: Gap[]; offAir: OffAirSpanView[]; days: LogDay[]; version: string }>;
  add(stationId: string, userId: string, input: EntryInput): Promise<LogEntry>;
  update(stationId: string, entryId: string, input: Partial<EntryInput>): Promise<LogEntry>;
  remove(stationId: string, entryId: string): Promise<void>;
  repeatDay(stationId: string, input: { day: string; pattern: "once" | "daily" | "weekly"; until: string; onto?: string }): Promise<{ created: number; skippedForConflicts: number; templateId: string }>;
  fill(stationId: string, userId: string, input: { with: "repeat"; startsAt: string; endsAt: string; itemIds: string[] } | { with: "sign_off"; startsAt: string; endsAt: string }): Promise<LogEntry[]>;
  deadAir(stationId: string): Promise<{ gaps: Gap[]; nextGapAt: string | null; logRunsUntil: string | null; warnings: Array<{ gapStartsAt: string; warnedAt: string; minutesBefore: 30 | 12 }>; offAir: OffAirSpanView[] }>;
  /** The rolling dead-air check: warnings at 30 and 12 minutes before a gap. Run every minute by the scheduler. */
  checkDeadAir(stationIds: string[]): Promise<void>;
}

export interface BlockSchedule {
  label: string | null;
  /** For viewers: "Saturdays, 9:00 pm to 1:00 am". */
  viewerLabel: string | null;
  next: string | null;
  onLog?: {
    templates: Array<{ templateId: string; name: string | null; label: string; startTime: string; lengthMs: number }>;
    dates: Array<{ spanId: string; startsAt: string; endsAt: string; templateId: string | null }>;
    ahead: number;
  };
}

export interface StationPageBlock {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  colour: string | null;
  schedule: string | null;
  next: string | null;
  programs: string[];
}

/** A243: a bumper role in the station's words. */
const roleWords = (role: string) => ({ into_break: "Into the break", out_of_break: "Out of the break", up_next: "Up next", any: "Any" })[role] ?? "Bumper";
/** ":08", "1:30". */
const shortLength = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${total >= 60 ? Math.floor(total / 60) : ""}:${String(total % 60).padStart(2, "0")}`;
};

const E = schema.logEntries;
const B = schema.breaks;
const OH = schema.offAirHours;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A break over this long ago is history (cadence.ts has the same). */
const SETTLED_MS = 60_000;

export function createLogService(ctx: ModuleContext): LogService {
  const { deps, services } = ctx;
  const { db } = deps;
  const moduleCtx = ctx;
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

  /**
   * Entries coming off the log (inside the transaction, before they go, once anything replacing
   * them is on): viewers' reminders on them move to the same program's (or item's) next airing on
   * the station, starting no sooner than the one that went and within a week of it; with none,
   * they're cancelled. Reminders for an airing that already started just go. Answers who to tell
   * (`tellReminders`, after the transaction). Before 2026-09-29 a reminder made removing its entry fail.
   */
  async function settleReminders(ex: Executor, leaving: Row[]): Promise<ReminderNews[]> {
    if (!leaving.length) return [];
    const on = await services.accounts.remindersOnEntries(leaving.map((r) => r.id), ex);
    const reminded = leaving.filter((r) => on.has(r.id));
    if (!reminded.length) return [];
    const now = deps.clock.now();
    const gone = leaving.map((r) => r.id);
    const ctx = await context(reminded);
    const news: ReminderNews[] = [];
    const cancel: Row[] = [];
    const stale: string[] = [];
    for (const row of reminded) {
      if (row.startsAt <= now) {
        stale.push(row.id);
        continue;
      }
      const programId = row.programId ?? (row.assetId ? ctx.items.get(row.assetId)?.programId : null) ?? null;
      const same = [...(programId ? [eq(E.programId, programId)] : []), ...(row.assetId ? [eq(E.assetId, row.assetId)] : [])];
      const [next] = same.length
        ? await ex
            .select({ id: E.id, startsAt: E.startsAt })
            .from(E)
            .where(
              and(
                eq(E.stationId, row.stationId),
                gte(E.startsAt, row.startsAt),
                lte(E.startsAt, new Date(row.startsAt.getTime() + REMINDER_MOVE_MS)),
                notInArray(E.id, gone),
                or(...same)
              )
            )
            .orderBy(asc(E.startsAt))
            .limit(1)
        : [];
      if (!next) {
        cancel.push(row);
        continue;
      }
      const title = titleOf(row, ctx);
      for (const r of await services.accounts.moveReminders(ex, row.id, next.id)) {
        news.push({ event: "reminder.moved", userId: r.userId, reminderId: r.id, stationId: row.stationId, title, startsAt: next.startsAt.toISOString() });
      }
    }
    const byId = new Map(cancel.map((r) => [r.id, r]));
    for (const r of await services.accounts.cancelReminders(ex, cancel.map((c) => c.id))) {
      const row = byId.get(r.logEntryId)!;
      news.push({ event: "reminder.cancelled", userId: r.userId, reminderId: r.id, stationId: row.stationId, title: titleOf(row, ctx), startsAt: row.startsAt.toISOString() });
    }
    await services.accounts.cancelReminders(ex, stale);
    return news;
  }

  /** After the transaction: each viewer hears what happened to their reminder. */
  function tellReminders(news: ReminderNews[]) {
    for (const { event, ...payload } of news) deps.bus.emit(event, payload);
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
      code: asLogCode(row.code),
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
      code: asLogCode(row.code),
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
      endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null,
      keepTime: row.keepTime
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
        code: asLogCode(row.code),
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
  function viewerAirings(rows: Row[], spans: OffAirSpanView[], ctx: Awaited<ReturnType<typeof context>>, blocks?: Map<string, AiringBlock>): Airing[] {
    // A244: a member of a programming block says which.
    const airings = rows
      .filter((r) => r.kind !== "off_air")
      .map((r) => {
        const airing = toAiring(r, ctx);
        const block = blocks?.get(r.id);
        return block ? { ...airing, block } : airing;
      });
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

  // ---- A244: programming blocks ---------------------------------------------------------------

  /**
   * Each station's spans reaching into `[from, to)` with their members (programs and live blocks
   * starting inside them), where each airs (`pieces`), and the blocks themselves.
   */
  async function blockState(stationIds: string[], from: Date, to: Date) {
    const spans = await loadSpans(db, stationIds, from, to);
    const list = new Map<string, Array<Membership<Row>>>();
    if (!spans.length) return { spans, list, refs: new Map<string, BlockRef>(), rows: [] as Row[] };
    const lo = new Date(Math.min(...spans.map((x) => x.startsAt.getTime())));
    const hi = new Date(Math.max(to.getTime(), ...spans.map((x) => x.endsAt.getTime())));
    const ids = [...new Set(spans.map((x) => x.stationId))];
    const [rows, offAir, refs] = await Promise.all([load(ids, lo, hi), offAirMap(ids, lo, hi), services.library.blocks.refs(spans.map((x) => x.blockId))]);
    for (const id of ids) {
      const offs = (offAir.get(id) ?? []).map((o) => ({ s: Date.parse(o.startsAt), e: Date.parse(o.endsAt) }));
      list.set(
        id,
        memberships(
          spans.filter((x) => x.stationId === id),
          rows.filter((r) => r.stationId === id),
          offs
        )
      );
    }
    return { spans, list, refs, rows };
  }
  type BlockState = Awaited<ReturnType<typeof blockState>>;

  /** Members' blocks, by entry id (what the dial, guide and banner name). */
  function airingBlocks(state: BlockState): Map<string, AiringBlock> {
    const out = new Map<string, AiringBlock>();
    for (const list of state.list.values()) {
      for (const m of list) {
        const ref = state.refs.get(m.span.blockId);
        if (ref) for (const e of m.members) out.set(e.id, { id: ref.id, name: ref.name, colour: ref.colour });
      }
    }
    return out;
  }

  /** A station's blocks as viewers see them: each piece, first member to last. */
  function bandsOf(state: BlockState, stationId: string): BlockBand[] {
    return (state.list.get(stationId) ?? []).flatMap((m) => {
      const ref = state.refs.get(m.span.blockId);
      if (!ref) return [];
      return m.pieces.map((p) => ({ id: ref.id, name: ref.name, colour: ref.colour, logoUrl: ref.logoUrl, startsAt: new Date(p.s).toISOString(), endsAt: new Date(p.e).toISOString() }));
    });
  }

  /** "9:00 pm" for a wall-clock minute. */
  const minuteClock = (minute: number) => {
    const h = Math.floor(minute / 60) % 24;
    return `${((h + 11) % 12) + 1}:${String(minute % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  };

  /** The spans in a window as master control draws them, with what to look at. */
  async function spanViews(stationId: string, from: Date, to: Date): Promise<BlockSpan[]> {
    const state = await blockState([stationId], from, to);
    const list = (state.list.get(stationId) ?? []).filter((m) => m.span.startsAt < to && Math.max(m.span.endsAt.getTime(), m.airsUntil ?? 0) > from.getTime());
    if (!list.length) return [];
    const tz = await stationTz(stationId);
    // What's just before each block too (whether there's room for its intro).
    const rows = await load([stationId], new Date(Math.min(...list.map((m) => m.span.startsAt.getTime())) - 6 * HOUR), new Date(Math.max(...list.map((m) => m.airsUntil ?? m.span.endsAt.getTime()))));
    const ctx = await context(rows);
    const fillers = list.some((m) => state.refs.get(m.span.blockId)?.intro) ? await services.library.fillers(stationId) : null;
    const offAir = (await offAirMap([stationId], new Date(Math.min(...list.map((m) => m.span.startsAt.getTime())) - DAY), to)).get(stationId) ?? [];
    const clock = (t: number | Date) => clockTime(new Date(t), tz);
    return list.map((m) => {
      const ref = state.refs.get(m.span.blockId);
      const name = ref?.name ?? "Block";
      const problems: BlockSpan["problems"] = [];
      if (!m.members.length) {
        problems.push({ code: "empty", message: `Nothing in this block yet. Put programs between ${clock(m.span.startsAt)} and ${clock(m.span.endsAt)}.` });
      }
      for (const e of m.members) {
        const over = e.endsAt.getTime() - m.span.endsAt.getTime();
        if (over > 0) problems.push({ code: "overrun", message: `${titleOf(e, ctx)} runs ${Math.max(1, Math.round(over / MIN))} ${Math.round(over / MIN) === 1 ? "minute" : "minutes"} past the block's end, ${clock(m.span.endsAt)}. It stays in the block.` });
      }
      // The intro airs between programs, just before the first member: is there room?
      const first = m.members[0];
      if (ref?.intro && first) {
        const introMs = fillers?.blocks.get(ref.id)?.intros[0]?.durationMs ?? GENERATED_BLOCK_CARD_MS;
        const at = first.startsAt.getTime();
        const before = rows.filter((r) => r.kind !== "off_air" && r.endsAt.getTime() <= at && r.id !== first.id).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
        const signOn = offAir.some((o) => Date.parse(o.endsAt) >= (before?.endsAt.getTime() ?? -Infinity) && Date.parse(o.startsAt) < at);
        if (before && !signOn) {
          const gap = at - before.endsAt.getTime();
          const item = before.assetId ? ctx.items.get(before.assetId) : undefined;
          const slack = gap === 0 && before.kind === "program" ? Math.max(0, before.endsAt.getTime() - before.startsAt.getTime() - Math.min(item?.durationMs ?? 0, before.endsAt.getTime() - before.startsAt.getTime())) : 0;
          // A closing break keeps its station ID first: what's left of it is the room.
          const room = gap > 0 ? gap : slack > 0 ? slack - STATION_ID_MS : 0;
          if (room < introMs) problems.push({ code: "no_room_intro", message: `No room for the intro before ${clock(at)}. Leave ${shortLength(introMs)} at the end of ${titleOf(before, ctx)}'s slot.` });
        }
      }
      return {
        id: m.span.id,
        blockId: m.span.blockId,
        name,
        colour: ref?.colour ?? null,
        startsAt: m.span.startsAt.toISOString(),
        endsAt: m.span.endsAt.toISOString(),
        airsFrom: m.airsFrom === null ? null : new Date(m.airsFrom).toISOString(),
        airsUntil: m.airsUntil === null ? null : new Date(m.airsUntil).toISOString(),
        pieces: m.pieces.map((p) => ({ startsAt: new Date(p.s).toISOString(), endsAt: new Date(p.e).toISOString() })),
        templateId: m.span.repeatGroupId,
        entryIds: m.members.map((e) => e.id),
        problems
      };
    });
  }

  /** A244: a station's spans overlapping a window (what edit mode's version covers). */
  async function spansOverlapping(stationId: string, from: Date, to: Date): Promise<SpanRow[]> {
    const SP = schema.programBlockSpans;
    return db
      .select()
      .from(SP)
      .where(and(eq(SP.stationId, stationId), lt(SP.startsAt, to), gt(SP.endsAt, from)))
      .orderBy(asc(SP.startsAt));
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

  type GeneratedBreak = Omit<BreakSlotView, "id" | "filledAt" | "filledMs" | "openMs">;

  /**
   * A243: what up next names after `t`: the first airing viewers see (the guide's own) starting at
   * or after it, read once for a window (to a day past it). Null when off air comes first or
   * nothing's on the log.
   */
  async function nextAiringFinder(stationId: string, from: Date, to: Date): Promise<(t: number) => Airing | null> {
    const until = new Date(to.getTime() + DAY);
    const [rows, offAir, blocks] = await Promise.all([load([stationId], from, until), offAirMap([stationId], from, until, true), blockState([stationId], from, until)]);
    const ctx = await context(rows);
    const airings = viewerAirings(rows, offAir.get(stationId) ?? [], ctx, airingBlocks(blocks));
    return (t) => {
      const next = airings.find((a) => Date.parse(a.startsAt) >= t);
      return next && next.kind !== "off_air" ? next : null;
    };
  }

  const announceOf = (a: Airing): Announce => ({
    entryId: a.logEntryId,
    title: a.title,
    episodeTitle: a.episodeTitle,
    startsAt: a.startsAt,
    carriedFrom: a.carriedFrom ? (a.carriedFrom.callSign ?? a.carriedFrom.name) : null,
    // A244: "Up next · Late Crate Nights · Saturday Reel".
    ...(a.block ? { blockName: a.block.name } : {})
  });

  /**
   * The breaks in a window, from the break rule. With a cadence (added 2026-09-29), each break
   * carries what airs in it, decided in order from an hour before now (or `from`, if earlier) so
   * any window decides the same; a break without spots is only as long as what airs in it needs,
   * and the program goes on sooner (the break that closes a program's slot keeps the slot's time).
   * Breaks cued live are decided in their place too, and come back with the rest.
   *
   * A243 (2026-10-02): each break also carries its bumpers (`elements`: the opening and closing
   * sequences, each bumper picked from its role's pool), and each program boundary its between
   * sequence (`boundaries`; the closing break before it carries it too, as `boundary`). Picks are
   * decided in the same walk: a pool of three or more takes turns, least recently aired first,
   * from the as-run log, so the walk starts an hour back whenever one does. A break or boundary
   * that's over goes by what the as-run log says aired in it.
   *
   * A244 (2026-10-02): programming blocks. A member's breaks are decided in its block: the
   * block's own bumper order when it has one, its bumpers before the station's, and its ID before
   * the station's (playout's). Between programs, leaving a block airs its outro, entering one its
   * intro (`[outro] [the station's between] [intro]`); between two members of the same block, the
   * block's between sequence. After off-air time (sign-on) there's no intro: the opener is the
   * station's moment. Before off-air time, a block being left still airs its outro.
   *
   * S20 (2026-10-03, A246): Up next with its own cadence (`rule.cadence.upNext`, when set) airs
   * by it, in the first position with its role (else between programs), the position's own `every`
   * governing only its other roles (precedence: sequence.ts, "Up next with its own cadence").
   * Unset, nothing here changes: Up next is a role in its position, as before.
   *
   * A246 (2026-10-03): `override` is a break rule that isn't saved (`previewBreakRule`): the walk
   * uses it in place of the station's and reads nothing else differently. Nothing here writes.
   */
  async function generateAll(stationId: string, from: Date, to: Date, everyPart = false, override?: BreakRuleView): Promise<{ slots: GeneratedBreak[]; boundaries: Boundary[]; blocks: BlockPlan }> {
    const [rule, tz, fillers] = await Promise.all([override ?? services.stations.breakRule(stationId), stationTz(stationId), services.library.fillers(stationId)]);
    const ruleSeq = rule.bumperSequences;
    // S20: Up next's own cadence, if set. Its role then leaves the station's sequences (each
    // position airs its other roles as its own `every` says) and goes where `upNextHome` puts it.
    const upNextCadence = rule.cadence.upNext ?? null;
    const upNextAt = upNextCadence ? upNextHome(ruleSeq) : null;
    const seq: BumperSequences = upNextCadence ? { open: withoutUpNext(ruleSeq.open), close: withoutUpNext(ruleSeq.close), between: withoutUpNext(ruleSeq.between) } : ruleSeq;
    const upNextOn = !!upNextCadence && upNextCadence.every !== "never" && fillers.bumpers.length > 0;
    const sequenceCadences = { open: seq.open, close: seq.close };
    const every = everyPart || isEveryBreak(rule.cadence, sequenceCadences);
    const now = deps.clock.now().getTime();
    const settledBefore = now - SETTLED_MS;

    // A244: the programming blocks the walk can meet (from as far back as it can start).
    const bstate = await blockState([stationId], new Date(Math.min(from.getTime(), now - HOUR) - 6 * HOUR), new Date(to.getTime() + 1));
    const blockList = bstate.list.get(stationId) ?? [];
    const hasBlocks = blockList.length > 0;
    const entrySpan = memberOf(blockList);
    const spanOf = (entryId: string | null | undefined) => (entryId ? (entrySpan.get(entryId) ?? null) : null);
    const refOf = (span: SpanRow | null) => (span ? (bstate.refs.get(span.blockId) ?? null) : null);
    const blockBumpers = new Map([...(fillers.blocks ?? new Map())].map(([id, f]) => [id, f.bumpers]));
    /** A block's bumper order, else the station's (block, then station, then the defaults). */
    const seqOf = (ref: BlockRef | null): BumperSequences => ref?.sequences ?? seq;
    const blockRefs = [...bstate.refs.values()];

    const roles = new Set<BumperRole>([...seq.open.roles, ...seq.close.roles, ...seq.between.roles, ...(upNextOn ? (["up_next"] as const) : []), ...blockRefs.flatMap((r) => (r.sequences ? [...r.sequences.open.roles, ...r.sequences.close.roles, ...r.sequences.between.roles] : []))]);
    const decider = new SequenceDecider(fillers.bumpers, tz, {}, blockBumpers);
    const rotates = decider.rotates(roles);
    const between = seq.between.roles.length > 0 && seq.between.every !== "never" && fillers.bumpers.length > 0;
    const betweenStateful = between && (seq.between.every === "hour" || seq.between.every === "n_programs");
    const blocksStateful = blockRefs.some((r) => r.sequences && r.sequences.between.roles.length > 0 && (r.sequences.between.every === "hour" || r.sequences.between.every === "n_programs"));
    // S20: Up next by its own cadence, between programs (its home) or in breaks.
    const upNextBetween = upNextOn && upNextAt === "between";
    const upNextStateful = upNextOn && (upNextCadence!.every === "hour" || upNextCadence!.every === "n_programs");
    // Boundaries are walked for the between sequence, and (A244) for blocks' intros and outros.
    const walkBoundaries = between || hasBlocks || upNextBetween;
    const walk = !every || rotates || betweenStateful || blocksStateful || upNextStateful;
    const start = walk ? new Date(Math.min(from.getTime(), now - HOUR)) : from;
    const lookback = new Date(start.getTime() - 6 * HOUR);
    // A program starting just as the window ends has its boundary (the between sequence) in it.
    const rows = await load([stationId], lookback, new Date(to.getTime() + 1));
    const ctx = await context(rows);
    const first = rows[0]?.startsAt && rows[0].startsAt < lookback ? rows[0].startsAt : lookback;
    const [decided, filled] = every
      ? [null, new Set<number>()]
      : await Promise.all([
          cadenceContext(moduleCtx, stationId, { cadence: rule.cadence, sequences: sequenceCadences, from: first, to, rows, readEntries: (a, b) => load([stationId], a, b) }),
          // Breaks filled with spots (the filler marks only those): they keep them.
          db
            .select({ startsAt: B.startsAt })
            .from(B)
            .where(and(eq(B.stationId, stationId), isNotNull(B.filledAt), gte(B.startsAt, first), lt(B.startsAt, to)))
            .then((r) => new Set(r.map((b) => b.startsAt.getTime())))
        ]);
    const cadence = decided && { ...decided, filled };
    // A243: what bumpers aired in breaks and between programs (the as-run log): picks that are over,
    // and least recently aired first. A244: the blocks' bumpers too.
    const allBumpers = [...fillers.bumpers, ...[...blockBumpers.values()].flat()];
    const bumperIds = allBumpers.map((b) => b.id);
    const { seedRows, airedRows, lastBetween } = await bumperHistory(moduleCtx, stationId, {
      bumperIds,
      start,
      to,
      seed: rotates,
      inWindow: start.getTime() < settledBefore,
      between: betweenStateful || blocksStateful
    });
    const seeded = new SequenceDecider(
      fillers.bumpers,
      tz,
      {
        last: new Map(seedRows.filter((r) => r.id && r.at).map((r) => [r.id!, new Date(r.at).getTime()])),
        aired: airedRows.filter((r) => r.id).map((r) => ({ id: r.id!, at: r.at.getTime() }))
      },
      blockBumpers
    );
    const byId = new Map(allBumpers.map((b) => [b.id, b]));
    // Picks that are over go by the as-run log when they take turns (so any walk agrees); a pool
    // of one or two picks the same whatever aired.
    const fromAsRun = rotates && start.getTime() < settledBefore;
    /** What the as-run log says aired from `a` to `b` (a break or boundary that's over), by position. */
    const airedIn = (a: number, b: number, position: "open" | "close" | "between", blockId: string | null = null): Element[] => {
      const inside = airedRows.filter((r) => r.id && r.at.getTime() >= a && r.at.getTime() < b);
      // Rows from before A243 have no position: the first in a break opened it, the rest closed it.
      const pick = inside.filter((r, i) => (r.position ? r.position === position : position !== "between" && (position === "open") === (i === 0)));
      return pick.map((r) => {
        const item = byId.get(r.id!);
        return {
          position,
          role: item?.bumperRole ?? "any",
          itemId: r.id!,
          title: item?.title ?? "Bumper",
          lengthMs: r.endedAt.getTime() - r.at.getTime(),
          alternates: [],
          ...(blockId ? { blockId } : {}),
          ...(item?.programBlockId ? { ofBlock: true } : {})
        };
      });
    };
    // What up next names (only read when a sequence has it and there's an up-next bumper).
    const upNextAnywhere = seeded.has("up_next") || [...blockBumpers.keys()].some((id) => seeded.has("up_next", id));
    const nextAt = roles.has("up_next") && upNextAnywhere ? await nextAiringFinder(stationId, start, to) : () => null;
    const announce = (t: number) => () => {
      const next = nextAt(t);
      return next ? announceOf(next) : null;
    };
    // Program boundaries (between programs), with planned off air time in between ruling one out.
    const offAir = walkBoundaries ? ((await offAirMap([stationId], lookback, to)).get(stationId) ?? []) : [];
    const boundaryInput = {
      last: lastBetween,
      times: airedRows.filter((r) => r.position === "between").map((r) => r.at.getTime()),
      settledBefore,
      hourStart: hourStartIn(tz),
      starts: rows.filter((r) => r.kind !== "off_air").map((r) => r.startsAt.getTime())
    };
    const boundaryDecider = between ? new BoundaryDecider({ rule: seq.between, ...boundaryInput }) : null;
    // S20: Up next's own decider, from when an up-next bumper last aired (the as-run log) when its
    // cadence needs it (once an hour, every N programs).
    const upNextHistory = upNextStateful ? await upNextAired(moduleCtx, stationId, start, to) : { last: null, times: [] };
    const upNext = upNextOn ? new UpNextDecider({ cadence: upNextCadence!, ...upNextHistory, settledBefore, hourStart: hourStartIn(tz), starts: boundaryInput.starts }) : null;
    /** A244: between two members of a block with its own order, its own between sequence decides. */
    const blockDeciders = new Map<string, BoundaryDecider | null>();
    const deciderFor = (ref: BlockRef | null): BoundaryDecider | null => {
      if (!ref?.sequences) return boundaryDecider;
      if (!blockDeciders.has(ref.id)) {
        const b = ref.sequences.between;
        const any = fillers.bumpers.length > 0 || (blockBumpers.get(ref.id)?.length ?? 0) > 0;
        blockDeciders.set(ref.id, b.roles.length > 0 && b.every !== "never" && any ? new BoundaryDecider({ rule: b, ...boundaryInput }) : null);
      }
      return blockDeciders.get(ref.id)!;
    };
    // A244: a block's intro or outro: its own (one a broadcast day, in turn, in library order), else
    // a five-second card in its look (TV only; playout airs it once it's prepared).
    const band = hasBlocks ? ((await services.stations.look(stationId))?.band ?? "tv") : "tv";
    const turnOf = (t: number) => Math.floor(Date.parse(`${broadcastDate(new Date(t), tz)}T00:00:00Z`) / DAY);
    const blockElement = (ref: BlockRef, kind: "intro" | "outro", at: number): Element | null => {
      if (!(kind === "intro" ? ref.intro : ref.outro)) return null;
      const own = (kind === "intro" ? fillers.blocks?.get(ref.id)?.intros : fillers.blocks?.get(ref.id)?.outros) ?? [];
      const ready = own.filter((i) => eligible(i, at, tz));
      if (ready.length) {
        const k = turnOf(at) % ready.length;
        const ordered = [...ready.slice(k), ...ready.slice(0, k)];
        return { position: "boundary", role: kind, itemId: ordered[0].id, title: ordered[0].title, lengthMs: ordered[0].durationMs!, alternates: ordered.slice(1).map((i) => i.id), blockId: ref.id, ofBlock: true };
      }
      if (band === "radio") return null;
      return { position: "boundary", role: kind, itemId: "", title: `${ref.name} ${kind}`, lengthMs: GENERATED_BLOCK_CARD_MS, alternates: [], blockId: ref.id, ofBlock: true, generated: true };
    };

    // Breaks cued from a live block, decided where they fall.
    const cued = (await db.select().from(B).where(and(eq(B.stationId, stationId), eq(B.origin, "cued_live"), gte(B.startsAt, lookback), lt(B.startsAt, to))).orderBy(asc(B.startsAt))).map((b) => ({
      startsAt: b.startsAt.toISOString(),
      lengthMs: b.lengthMs,
      context: "Cued live",
      origin: "cued_live" as const,
      producerShareMs: 0,
      logEntryId: b.logEntryId
    }));
    const slots: GeneratedBreak[] = [];
    const boundaries: Boundary[] = [];
    const entryEnd = (id: string | null) => (id ? rows.find((r) => r.id === id)?.endsAt.getTime() : undefined);
    /** Boundaries whose closing break already has up next (between leaves it out). */
    const upNextBefore = new Set<number>();
    /** The bumpers in a break: as aired (over), or picked (A244: in its block, when its entry is a member). */
    const elementsFor = (b: { startsAt: number; lengthMs: number; logEntryId: string | null; afterProgram: boolean }, parts: BreakParts | undefined): { open: Element[]; close: Element[] } => {
      const end = b.startsAt + b.lengthMs;
      const ref = refOf(spanOf(b.logEntryId));
      if (end < settledBefore && fromAsRun) return { open: airedIn(b.startsAt, end, "open", ref?.id ?? null), close: airedIn(b.startsAt, end, "close", ref?.id ?? null) };
      const p = parts ?? EVERY_PART;
      const own = ref?.sequences ?? null;
      const airs = own
        ? { open: blockPositionAirs(own.open, b, bumpersIn(p, "open")), close: blockPositionAirs(own.close, b, bumpersIn(p, "close")), between: false }
        : { open: bumpersIn(p, "open"), close: bumpersIn(p, "close"), between: false };
      const r = rolesFor(seqOf(ref), airs);
      // S20: Up next by its own cadence, in its break position (the station's order only).
      if (upNext && upNextAt && upNextAt !== "between" && !ref?.sequences && upNext.next({ at: end, from: b.startsAt, afterProgram: b.afterProgram })) r[upNextAt] = withUpNext(ruleSeq, upNextAt, r[upNextAt]);
      const used = new Set<string>();
      const after = announce(entryEnd(b.logEntryId) ?? end);
      return { open: pickElements(seeded, "open", r.open, b.startsAt, used, after, ref?.id ?? null), close: pickElements(seeded, "close", r.close, b.startsAt, used, after, ref?.id ?? null) };
    };
    /** What airs in a break (every part without a cadence), its bumpers, and how long it runs. */
    const decide = (b: {
      startsAt: number;
      lengthMs: number;
      afterProgram: boolean;
      fixed: boolean;
      programId: string | null;
      producerShareMs: number;
      logEntryId: string | null;
    }): { parts: BreakParts | undefined; lengthMs: number; elements: { open: Element[]; close: Element[] } } => {
      const parts = cadence ? cadence.decider.next({ key: String(b.startsAt), startsAt: b.startsAt, endsAt: b.startsAt + b.lengthMs, afterProgram: b.afterProgram }, { spots: cadence.filled.has(b.startsAt) }) : undefined;
      const elements = elementsFor(b, parts);
      if (b.afterProgram && [...elements.open, ...elements.close].some((e) => e.role === "up_next")) upNextBefore.add(b.startsAt + b.lengthMs);
      // Without spots: only as long as what airs needs, where the program can move up.
      if (!cadence || !parts || parts.spots || b.fixed || !cadence.needs) return { parts, lengthMs: b.lengthMs, elements };
      return { parts, lengthMs: Math.min(b.lengthMs, needMs(cadence.needs, parts, { ...b, elementsMs: elementsMs({ elements }) })), elements };
    };
    let c = 0;
    const cuedBefore = (t: number) => {
      while (c < cued.length && Date.parse(cued[c].startsAt) < t) {
        const b = cued[c++];
        const { parts, elements } = decide({ startsAt: Date.parse(b.startsAt), lengthMs: b.lengthMs, afterProgram: false, fixed: true, programId: null, producerShareMs: 0, logEntryId: b.logEntryId });
        slots.push({ ...b, ...(parts ? { parts } : {}), elements });
      }
    };
    /** Puts a boundary on, carved from the end of the closing break before it when that ends just then. */
    const place = (boundary: Boundary, before: { closing: GeneratedBreak | null }) => {
      boundaries.push(boundary);
      const at = Date.parse(boundary.at);
      if (before.closing && Date.parse(before.closing.startsAt) + before.closing.lengthMs === at) before.closing.boundary = boundary;
    };
    const boundaryOf = (at: number, entryId: string, elements: Element[]): Boundary => ({ at: new Date(at).toISOString(), entryId, elements, ms: elements.reduce((sum, e) => sum + e.lengthMs, 0) });
    /** A244: leaving a block just before off-air time: its outro (the closer follows). */
    const outroBefore = (before: { row: Row; closing: GeneratedBreak | null }, ref: BlockRef, at: number) => {
      const outro = blockElement(ref, "outro", at);
      if (outro) place(boundaryOf(at, before.row.id, [outro]), before);
    };
    /**
     * The boundary into an entry: the between sequence, after the closing break of the one before
     * (or open time); A244: a block's outro before it when leaving one, its intro after it when
     * entering one.
     */
    let previous: { row: Row; closing: GeneratedBreak | null } | null = null;
    const boundaryInto = (row: Row) => {
      const before = previous;
      if (!walkBoundaries || !before) return;
      const at = row.startsAt.getTime();
      const left = spanOf(before.row.id);
      const entered = spanOf(row.id);
      const same = Boolean(left && entered && left.id === entered.id);
      const leftRef = refOf(left);
      const enteredRef = refOf(entered);
      // Planned off air time between them: sign-on, not a boundary (the opener airs there, A242; never a block's intro).
      const off = offAir.find((o) => Date.parse(o.startsAt) < at && Date.parse(o.endsAt) > before.row.endsAt.getTime() - 1);
      if (off) {
        if (leftRef) outroBefore(before, leftRef, Math.max(before.row.endsAt.getTime(), Date.parse(off.startsAt)));
        return;
      }
      const context = same ? leftRef : null;
      const d = deciderFor(context);
      let elements: Element[] = [];
      const sequenceAirs = d?.next(at) ?? false;
      // S20: Up next by its own cadence, between programs (the station's order only; not twice).
      const upNextHere = upNextBetween && !context?.sequences && !upNextBefore.has(at) && upNext!.next({ at, afterProgram: true });
      if (sequenceAirs || upNextHere) {
        if (at < settledBefore && fromAsRun) elements = airedIn(at - 5 * MIN, at, "between", context?.id ?? null);
        else {
          let r = sequenceAirs ? rolesFor(seqOf(context), { open: false, close: false, between: true }).between.filter((x) => x !== "up_next" || !upNextBefore.has(at)) : [];
          if (upNextHere) r = withUpNext(ruleSeq, "between", r);
          elements = pickElements(seeded, "between", r, at, new Set(), announce(at), context?.id ?? null);
        }
      }
      const outro = leftRef && !same ? blockElement(leftRef, "outro", at) : null;
      const intro = enteredRef && !same ? blockElement(enteredRef, "intro", at) : null;
      const all = [...(outro ? [outro] : []), ...elements, ...(intro ? [intro] : [])];
      if (!all.length) return;
      place(boundaryOf(at, row.id, all), before);
    };
    for (const row of rows) {
      cuedBefore(row.startsAt.getTime());
      if (row.kind === "off_air") {
        // A244: a block left for a sign-off says goodbye first.
        const leftRef = previous && walkBoundaries ? refOf(spanOf(previous.row.id)) : null;
        if (previous && leftRef) outroBefore(previous, leftRef, Math.max(previous.row.endsAt.getTime(), row.startsAt.getTime()));
        previous = null;
        continue;
      }
      boundaryInto(row);
      if (row.kind !== "program") {
        // Live programs cue their own.
        cuedBefore(row.endsAt.getTime());
        previous = { row, closing: null };
        continue;
      }
      const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
      const agreement = row.carriageAgreementId ? ctx.agreements.get(row.carriageAgreementId) : undefined;
      const title = titleOf(row, ctx);
      const episode = item?.episodeNumber ? `, ep. ${item.episodeNumber}` : "";
      const slotMs = row.endsAt.getTime() - row.startsAt.getTime();
      const itemMs = Math.min(item?.durationMs ?? slotMs, slotMs);
      const barterPerHour = agreement && (agreement.term === "barter" || agreement.term === "cash_plus_barter") ? (agreement.barterMakerMsPerHour ?? 0) : 0;
      const programId = row.programId ?? item?.programId ?? null;
      let closing: GeneratedBreak | null = null;

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
          const { parts, lengthMs, elements } = decide({ startsAt: startsAt.getTime(), lengthMs: rule.lengthMs, afterProgram: false, fixed: false, programId, producerShareMs: perBreakShare, logEntryId: row.id });
          // Nothing airs in it at all: no break.
          if (lengthMs > 0) {
            slots.push({
              startsAt: startsAt.toISOString(),
              lengthMs,
              context: `During ${title}${episode}`,
              origin: barterPerHour ? "carried_barter" : "rule",
              producerShareMs: perBreakShare,
              logEntryId: row.id,
              ...(parts ? { parts } : {}),
              elements
            });
          }
          shift += lengthMs;
        }
        const used = itemMs + shift;
        if (slotMs - used > 0) {
          const startsAt = row.startsAt.getTime() + used;
          const { parts, elements } = decide({ startsAt, lengthMs: slotMs - used, afterProgram: true, fixed: true, programId, producerShareMs: 0, logEntryId: row.id });
          closing = {
            startsAt: new Date(startsAt).toISOString(),
            lengthMs: slotMs - used,
            context: `After ${title}${episode}`,
            origin: "rule",
            producerShareMs: 0,
            logEntryId: row.id,
            ...(parts ? { parts } : {}),
            elements
          };
          slots.push(closing);
        }
        previous = { row, closing };
        continue;
      }
      // After every program (and with no rule): the time between the item's end and the slot's end.
      const slack = slotMs - itemMs;
      if (slack > 0) {
        const startsAt = row.startsAt.getTime() + itemMs;
        const producerShareMs = barterPerHour ? Math.min(slack, Math.round((barterPerHour * slotMs) / HOUR)) : 0;
        const { parts, elements } = decide({ startsAt, lengthMs: slack, afterProgram: true, fixed: true, programId, producerShareMs, logEntryId: row.id });
        closing = {
          startsAt: new Date(startsAt).toISOString(),
          lengthMs: slack,
          context: `After ${title}${episode}`,
          origin: barterPerHour ? "carried_barter" : "rule",
          producerShareMs,
          logEntryId: row.id,
          ...(parts ? { parts } : {}),
          elements
        };
        slots.push(closing);
      }
      previous = { row, closing };
    }
    cuedBefore(Infinity);
    // A244: each break says the block it's in (its entry is a member).
    if (hasBlocks) {
      for (const slot of slots) {
        const span = spanOf(slot.logEntryId);
        if (span) slot.blockId = span.blockId;
      }
    }
    return {
      slots: slots.filter((s) => Date.parse(s.startsAt) >= from.getTime() && Date.parse(s.startsAt) < to.getTime()),
      boundaries: boundaries.filter((b) => Date.parse(b.at) > from.getTime() && Date.parse(b.at) <= to.getTime()),
      blocks: {
        pieces: blockList.flatMap((m) => m.pieces.map((p) => ({ blockId: m.span.blockId, spanId: m.span.id, s: p.s, e: p.e }))),
        byEntry: new Map([...entrySpan].map(([id, span]) => [id, span.blockId])),
        refs: bstate.refs
      }
    };
  }

  async function generateBreaks(stationId: string, from: Date, to: Date, everyPart = false, override?: BreakRuleView): Promise<GeneratedBreak[]> {
    return (await generateAll(stationId, from, to, everyPart, override)).slots;
  }

  async function withStored(stationId: string, generatedIn: GeneratedBreak[], from: Date, to: Date): Promise<BreakSlotView[]> {
    let generated = generatedIn;
    const stored = await db
      .select()
      .from(B)
      .where(and(eq(B.stationId, stationId), gte(B.startsAt, from), lt(B.startsAt, to)));
    const byTime = new Map(stored.map((b) => [b.startsAt.toISOString(), b]));
    const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
    // Breaks cued from a live block aren't generated from the rule; they're stored as they happen
    // (with a cadence, they come generated, decided in their place).
    const have = new Set(generated.map((g) => g.startsAt));
    const cued = stored
      .filter((b) => b.origin === "cued_live" && !have.has(b.startsAt.toISOString()))
      .map((b) => ({ startsAt: b.startsAt.toISOString(), lengthMs: b.lengthMs, context: "Cued live", origin: "cued_live" as const, producerShareMs: 0, logEntryId: b.logEntryId }));
    generated = [...generated, ...cued].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return generated.map((slot) => {
      const row = byTime.get(slot.startsAt);
      const filledMs = row ? (filled.get(row.id) ?? 0) : 0;
      // Spot time: none in a break spots don't air in.
      const openMs = partsOf(slot).spots ? Math.max(0, slot.lengthMs - slot.producerShareMs - filledMs) : 0;
      return { ...slot, id: row?.id ?? null, filledAt: row?.filledAt?.toISOString() ?? null, filledMs, openMs };
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
      // A242: never on the log (so the log, guide and dial keep the codes every app knows).
      if (isIdentCode(item.code)) throw refused("not_for_the_log", "Openers, closers and off-air cards air at sign-off and sign-on, not from the log.");
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
    changes: undefined as unknown as ChangeOps,

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
      const [placed, rotations, credits, entries, stationIdMs, fillers] = await Promise.all([
        services.spots.breakAirings(stored),
        services.spots.rotations(stationId),
        services.spots.creditsFor(stationId),
        entryIds.length ? db.select().from(E).where(inArray(E.id, entryIds)) : Promise.resolve([] as Row[]),
        // Ten seconds for a station airing its generated station ID.
        services.playout.stationIdMs(stationId),
        services.library.fillers(stationId)
      ]);
      const ctx = await context(entries);
      // Catalog programs keep one credit an hour: their series' sponsor in this market, or Clear.
      const catalog = await catalogEntries(services, stationId, entries, deps.clock.now());
      const catalogBreaks = catalog.programOf.size ? catalogCreditBreaks(slots, (entryId) => catalog.programOf.has(entryId), hourStartIn(await stationTz(stationId))) : new Set<string>();
      // A243: each break's bumpers (its opening and closing sequences, and the between sequence after
      // a closing break) come picked with it; a slot from elsewhere gets the defaults (the library's
      // first two Any bumpers, or its one twice).
      const tz = await stationTz(stationId);
      const fallback = (slot: BreakSlotView) => {
        const parts = partsOf(slot);
        return defaultElements(fillers.bumpers, { open: bumpersIn(parts, "open"), close: bumpersIn(parts, "close") }, Date.parse(slot.startsAt), tz);
      };
      const main = new Set(rotations.main.spots.map((s) => s.spotId));
      const backup = new Set(rotations.backup.spots.map((s) => s.spotId));
      // A244: the programming blocks these breaks are in (their ID, bumpers, intro and outro).
      const blockIds = [...new Set(slots.flatMap((s) => [s.blockId, ...(s.boundary?.elements ?? []).map((e) => e.blockId)]).filter((v): v is string => Boolean(v)))];
      const blockRefs = await services.library.blocks.refs(blockIds);
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
        // What playout adds when it airs the break, each as often as the break rule's cadence says
        // (every part in every break by default): the opening bumpers, before the spots; the credit
        // after them; the closing bumpers; the station ID last; then (A243) the between sequence
        // when the break closes a program's slot. Time nothing takes holds on the station ID slate
        // before the station ID. A break spots don't air in has no spot time (it's only as long as
        // the rest needs, unless it closes its program's slot). Bumpers that don't fit are listed
        // with no length (A243: by priority, into the break first, then out of it, up next, Any).
        const parts = partsOf(slot);
        let left = Math.max(0, slot.lengthMs - rows.reduce((sum, r) => sum + r.lengthMs, 0));
        // A244: in a block with an ID of its own, that airs where the station ID would.
        const block = slot.blockId ? blockRefs.get(slot.blockId) : undefined;
        const blockId = block ? fillers.blocks?.get(block.id)?.stationIds[0] : undefined;
        const sidMs = parts.stationId ? Math.min(left, blockId?.durationMs ?? stationIdMs) : 0;
        left -= sidMs;
        const catalogCredit = slot.logEntryId && catalogBreaks.has(slot.startsAt) ? catalog.credits.get(catalog.programOf.get(slot.logEntryId)!) : undefined;
        const credit = parts.underwriting && (credits.length > 0 || !!catalogCredit) && left >= CREDIT_MS;
        if (credit) left -= CREDIT_MS;
        const chosen = slot.elements ?? fallback(slot);
        const boundary = slot.boundary ?? null;
        const fitted = fitElements([...chosen.open, ...chosen.close, ...(boundary?.elements ?? [])], left);
        for (const e of fitted) if (e.fits) left -= e.lengthMs;
        const bumper = (e: (typeof fitted)[number], i: number): BreakContent => {
          // A244: a block's intro or outro, between programs.
          if (e.role === "intro" || e.role === "outro") {
            const ref = e.blockId ? blockRefs.get(e.blockId) : undefined;
            const words = e.role === "intro" ? "Intro" : "Outro";
            return {
              id: `${slot.startsAt}:${e.role}`,
              kind: "station_id",
              title: e.title,
              lengthMs: e.fits ? e.lengthMs : 0,
              spotId: null,
              business: null,
              shortName: null,
              rotation: null,
              note: e.fits ? words : `Didn't fit: ${words} (${shortLength(e.lengthMs)})`,
              ...(ref ? { block: { id: ref.id, name: ref.name, part: e.role, fits: e.fits } } : {})
            };
          }
          const role = e.role;
          const announces = e.announces ? { title: e.announces.title, startsAt: e.announces.startsAt } : null;
          const where = e.position === "open" ? "Into the break" : e.position === "close" ? "Out of the break" : "Between programs";
          const note = !e.fits ? `Didn't fit: ${roleWords(role)} (${shortLength(e.lengthMs)})` : announces ? `Up next: ${announces.title}, ${clockTime(new Date(announces.startsAt), tz)}` : where;
          // The first two keep the ids they had before A243 (in and out).
          const id = e.position === "open" && i === 0 ? `${slot.startsAt}:bmp:in` : e.position === "close" && i === 0 ? `${slot.startsAt}:bmp:out` : `${slot.startsAt}:bmp:${e.position}:${i}`;
          const ref = e.ofBlock && e.blockId ? blockRefs.get(e.blockId) : undefined;
          return {
            id,
            kind: "bumper",
            title: e.title,
            lengthMs: e.fits ? e.lengthMs : 0,
            spotId: null,
            business: null,
            shortName: null,
            rotation: null,
            note,
            element: { position: e.position === "boundary" ? "between" : e.position, role, announces, fits: e.fits },
            ...(ref ? { block: { id: ref.id, name: ref.name, part: "bumper" as const, fits: e.fits } } : {})
          };
        };
        const at = (position: "open" | "close" | "between") => fitted.filter((e) => e.position === position || (position === "between" && e.position === "boundary")).map(bumper);
        rows.unshift(...at("open"));
        // Before spots are placed (up to 20 minutes ahead), the spot time is open.
        if (!slot.id && parts.spots && left > 0) {
          rows.push({ id: `${slot.startsAt}:open`, kind: "open", title: "Open", lengthMs: left, spotId: null, business: null, shortName: null, rotation: null, note: "Filled from the rotation about 20 minutes before" });
          left = 0;
        }
        if (credit)
          rows.push({
            id: `${slot.startsAt}:credit`,
            kind: "underwriting",
            title: catalogCredit ? catalogCredit.sponsor.business : credits.map((c) => c.business).join(", "),
            lengthMs: CREDIT_MS,
            spotId: null,
            business: null,
            shortName: null,
            rotation: null,
            note: catalogCredit ? `${catalogCredit.subject} is made possible by` : "Made possible by"
          });
        rows.push(...at("close"));
        if (left > 0) rows.push({ id: `${slot.startsAt}:slate`, kind: "open", title: "Station ID slate", lengthMs: left, spotId: null, business: null, shortName: null, rotation: null, note: null });
        if (sidMs > 0) {
          rows.push(
            block && blockId
              ? { id: `${slot.startsAt}:sid`, kind: "station_id", title: `${block.name} ID`, lengthMs: sidMs, spotId: null, business: null, shortName: null, rotation: null, note: "Block ID", block: { id: block.id, name: block.name, part: "id", fits: true } }
              : { id: `${slot.startsAt}:sid`, kind: "station_id", title: "Station ID", lengthMs: sidMs, spotId: null, business: null, shortName: null, rotation: null, note: null }
          );
        }
        rows.push(...at("between"));
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
      // program (its times are the carriage agreement's), a break with spots already held, or a
      // program kept at its time (G18: the station fixed it there; it stays, and so does what follows).
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
        if (e.kind !== "program" || e.carriageAgreementId || held.has(e.id) || e.keepTime) break;
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
      const [rows, offAir, blocks] = await Promise.all([load(stationIds, at, until), offAirMap(stationIds, at, until, true), blockState(stationIds, at, until)]);
      const ctx = await context(rows);
      const marks = airingBlocks(blocks);
      const result = new Map<string, { now: Airing | null; next: Airing | null }>();
      for (const id of stationIds) {
        const airings = viewerAirings(
          rows.filter((r) => r.stationId === id),
          offAir.get(id) ?? [],
          ctx,
          marks
        );
        const now = airings.find((a) => Date.parse(a.startsAt) <= at.getTime() && Date.parse(a.endsAt) > at.getTime()) ?? null;
        const next = airings.find((a) => Date.parse(a.startsAt) > at.getTime()) ?? null;
        result.set(id, { now, next });
      }
      return result;
    },

    async window(stationIds, from, to) {
      const [rows, offAir, blocks] = await Promise.all([load(stationIds, from, to), offAirMap(stationIds, from, to, true), blockState(stationIds, from, to)]);
      const ctx = await context(rows);
      const marks = airingBlocks(blocks);
      const result = new Map<string, Airing[]>();
      for (const id of stationIds) {
        result.set(
          id,
          viewerAirings(
            rows.filter((r) => r.stationId === id),
            offAir.get(id) ?? [],
            ctx,
            marks
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

    async breaks(stationId, from, to, options) {
      return withStored(stationId, await generateBreaks(stationId, from, to, options?.everyPart), from, to);
    },

    async previewBreaks(stationId, from, to, rule) {
      // The breaks part of `log()`, with the rule given: the same walk, stored breaks, contents and rows.
      const [rows, generated, blocks] = await Promise.all([load([stationId], from, to), generateBreaks(stationId, from, to, false, rule), spanViews(stationId, from, to)]);
      const ctx = await context(rows);
      const breaks = await withStored(stationId, generated, from, to);
      const contents = await service.breakContents(stationId, breaks);
      const now = deps.clock.now().getTime();
      return {
        entries: rows.map((r) => toEntry(r, ctx)),
        breaks: breaks.map((b) => ({ ...b, rows: (contents.get(b.startsAt) ?? []).map(breakRow), keeps: Boolean(b.filledAt) || b.filledMs > 0 || Date.parse(b.startsAt) <= now })),
        ...(blocks.length ? { blocks } : {})
      };
    },

    async breakPlan(stationId, from, to) {
      const { slots, boundaries, blocks } = await generateAll(stationId, from, to);
      return { breaks: await withStored(stationId, slots, from, to), boundaries, blocks };
    },

    async blockPlan(stationId, from, to) {
      const state = await blockState([stationId], from, to);
      const list = state.list.get(stationId) ?? [];
      return {
        pieces: list.flatMap((m) => m.pieces.map((p) => ({ blockId: m.span.blockId, spanId: m.span.id, s: p.s, e: p.e }))),
        byEntry: new Map([...memberOf(list)].map(([id, span]) => [id, span.blockId])),
        refs: state.refs
      };
    },

    async upNextAfter(stationId, at) {
      return (await nextAiringFinder(stationId, at, at))(at.getTime());
    },

    async blockBands(stationIds, from, to) {
      const state = await blockState(stationIds, from, to);
      return new Map(stationIds.map((id) => [id, bandsOf(state, id).filter((b) => Date.parse(b.endsAt) > from.getTime() && Date.parse(b.startsAt) < to.getTime())]));
    },

    async blockStatus(stationId, at, nextEntryId) {
      const state = await blockState([stationId], at, new Date(at.getTime() + DAY));
      const list = state.list.get(stationId) ?? [];
      const t = at.getTime();
      const band = (m: Membership<Row>, p: { s: number; e: number }): BlockBand | null => {
        const ref = state.refs.get(m.span.blockId);
        return ref ? { id: ref.id, name: ref.name, colour: ref.colour, logoUrl: ref.logoUrl, startsAt: new Date(p.s).toISOString(), endsAt: new Date(p.e).toISOString() } : null;
      };
      let now: BlockBand | null = null;
      let nowPiece: { s: number; e: number } | null = null;
      for (const m of list) {
        const p = m.pieces.find((x) => x.s <= t && t < x.e);
        if (p) {
          now = band(m, p);
          nowPiece = p;
        }
      }
      let next: BlockBand | null = null;
      const m = nextEntryId ? list.find((x) => x.members.some((e) => e.id === nextEntryId)) : undefined;
      if (m) {
        const entry = m.members.find((e) => e.id === nextEntryId)!;
        const p = m.pieces.find((x) => x.s <= entry.startsAt.getTime() && entry.startsAt.getTime() < x.e);
        // It enters a block (not the one already on).
        if (p && p !== nowPiece) next = band(m, p);
      }
      return { now, next };
    },

    async blockSchedules(stationId, blockIds, withPlacements) {
      const out = new Map<string, BlockSchedule>();
      if (!blockIds.length) return out;
      const TB = schema.dayTemplateBlocks;
      const G = schema.repeatGroups;
      const SP = schema.programBlockSpans;
      const now = deps.clock.now();
      const tz = await stationTz(stationId);
      const today = broadcastDate(now, tz);
      const [tbs, ahead] = await Promise.all([
        db
          .select({ tb: TB, g: G })
          .from(TB)
          .innerJoin(G, eq(G.id, TB.templateId))
          .where(and(inArray(TB.blockId, blockIds), eq(G.stationId, stationId), eq(G.template, true), isNull(G.removedAt))),
        db
          .select()
          .from(SP)
          .where(and(eq(SP.stationId, stationId), inArray(SP.blockId, blockIds), gt(SP.endsAt, now)))
          .orderBy(asc(SP.startsAt))
      ]);
      // The next airing: the first span ahead's first member (else the span's own start).
      const firsts = blockIds.map((id) => ahead.find((sp) => sp.blockId === id)).filter((v): v is SpanRow => Boolean(v));
      const rows = firsts.length ? await load([stationId], new Date(Math.min(...firsts.map((f) => f.startsAt.getTime()))), new Date(Math.max(...firsts.map((f) => f.endsAt.getTime())))) : [];
      const firstMembers = memberships(firsts, rows, []);
      const PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
      const day = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d).replace(",", "");
      for (const id of blockIds) {
        const mine = tbs.filter((t) => t.tb.blockId === id && (!t.g.endsOn || t.g.endsOn >= today));
        const range = (t: (typeof mine)[number]) => `${minuteClock(t.tb.startMinute)} to ${minuteClock((t.tb.startMinute + Math.round(t.tb.lengthMs / MIN)) % 1440)}`;
        const templateLabels = mine.map((t) => `${templateLabel(t.g)}, ${range(t)}`);
        const viewerLabels = mine.flatMap((t) => {
          const days = t.g.pattern === "weekly" ? PLURAL[t.g.weekday ?? 0] : t.g.pattern === "daily" ? "Every day" : t.g.pattern === "weekdays" ? "Weekdays" : null;
          return days ? [`${days}, ${range(t)}`] : [];
        });
        const span = firsts.find((f) => f.blockId === id);
        const m = span ? firstMembers.find((x) => x.span.id === span.id) : undefined;
        const next = m?.airsFrom ?? span?.startsAt.getTime() ?? null;
        const oneOff = span ? `${day(span.startsAt)}, ${clockTime(span.startsAt, tz)} to ${clockTime(span.endsAt, tz)}` : null;
        const mineAhead = ahead.filter((sp) => sp.blockId === id);
        out.set(id, {
          label: templateLabels.join("; ") || oneOff,
          viewerLabel: viewerLabels.join("; ") || null,
          next: next === null ? null : new Date(next).toISOString(),
          ...(withPlacements
            ? {
                onLog: {
                  templates: mine.map((t) => ({ templateId: t.g.id, name: t.g.name, label: templateLabel(t.g), startTime: `${String(Math.floor(t.tb.startMinute / 60)).padStart(2, "0")}:${String(t.tb.startMinute % 60).padStart(2, "0")}`, lengthMs: t.tb.lengthMs })),
                  dates: mineAhead.slice(0, 20).map((sp) => ({ spanId: sp.id, startsAt: sp.startsAt.toISOString(), endsAt: sp.endsAt.toISOString(), templateId: sp.repeatGroupId })),
                  ahead: mineAhead.filter((sp) => sp.startsAt > now).length
                }
              }
            : {})
        });
      }
      return out;
    },

    async stationPageBlocks(stationId) {
      const now = deps.clock.now();
      const state = await blockState([stationId], now, new Date(now.getTime() + 14 * DAY));
      const list = (state.list.get(stationId) ?? []).filter((m) => m.members.length && (m.airsUntil ?? 0) > now.getTime() && !state.refs.get(m.span.blockId)?.archived);
      if (!list.length) return [];
      const ctx = await context(state.rows);
      const ids = [...new Set(list.map((m) => m.span.blockId))];
      const schedules = await service.blockSchedules(stationId, ids, false);
      const tz = await stationTz(stationId);
      return ids.map((id) => {
        const ref = state.refs.get(id)!;
        const first = list.filter((m) => m.span.blockId === id).sort((a, b) => (a.airsFrom ?? 0) - (b.airsFrom ?? 0))[0];
        const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(first.airsFrom!)).replace(",", "");
        return {
          id,
          name: ref.name,
          description: ref.description,
          logoUrl: ref.logoUrl,
          colour: ref.colour,
          schedule: schedules.get(id)?.viewerLabel ?? `${day}, ${clockTime(new Date(first.airsFrom!), tz)} to ${clockTime(new Date(first.airsUntil!), tz)}`,
          next: new Date(first.airsFrom!).toISOString(),
          programs: [...new Set(first.members.map((e) => titleOf(e, ctx)))]
        };
      });
    },

    async blockSpansAhead(stationId, blockId) {
      const SP = schema.programBlockSpans;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(SP)
        .where(and(eq(SP.stationId, stationId), eq(SP.blockId, blockId), gt(SP.startsAt, deps.clock.now())));
      return row?.n ?? 0;
    },

    async takeBlockOffLog(stationId, blockId) {
      const SP = schema.programBlockSpans;
      const TD = schema.dayTemplateDates;
      const now = deps.clock.now();
      const tz = await stationTz(stationId);
      const [ahead, edited] = await Promise.all([
        db.select().from(SP).where(and(eq(SP.stationId, stationId), eq(SP.blockId, blockId), gt(SP.startsAt, now))),
        db.select({ date: TD.date }).from(TD).where(and(eq(TD.stationId, stationId), isNotNull(TD.editedAt)))
      ]);
      // A date edited by hand keeps its spans, as it keeps its entries.
      const editedDates = new Set(edited.map((d) => d.date));
      const kept = ahead.filter((sp) => editedDates.has(broadcastDate(sp.startsAt, tz)));
      const removing = ahead.filter((sp) => !kept.includes(sp));
      await db.transaction(async (tx) => {
        if (removing.length) await tx.delete(SP).where(inArray(SP.id, removing.map((sp) => sp.id)));
        // Out of its day templates, so they don't make it again.
        const TB = schema.dayTemplateBlocks;
        const G = schema.repeatGroups;
        const mine = await tx.select({ id: TB.id }).from(TB).innerJoin(G, eq(G.id, TB.templateId)).where(and(eq(TB.blockId, blockId), eq(G.stationId, stationId)));
        if (mine.length) await tx.delete(TB).where(inArray(TB.id, mine.map((r) => r.id)));
      });
      if (removing.length) await changedNear(stationId, removing.map((sp) => sp.startsAt));
      return { removed: removing.length, kept: kept.length };
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
      let news: ReminderNews[] = [];
      const pulled = await db.transaction(async (tx) => {
        const rows = await tx.select().from(E).where(and(eq(E.assetId, itemId), gt(E.startsAt, now)));
        await releaseBreaks(tx, rows.map((r) => r.id));
        news = await settleReminders(tx, rows);
        return rows.length ? tx.delete(E).where(inArray(E.id, rows.map((r) => r.id))).returning({ stationId: E.stationId }) : [];
      });
      tellReminders(news);
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
      // What airs in it, as the rest of the log decides (the break rule's cadence).
      const decided = (await service.breaks(stationId, at, new Date(at.getTime() + 1))).find((b) => b.id === row.id);
      if (decided) return decided;
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
        let news: ReminderNews[] = [];
        await db.transaction(async (tx) => {
          const replacing = replaceExisting ? await tx.select().from(E).where(and(eq(E.stationId, carrierStationId), lt(E.startsAt, endsAt), gt(E.endsAt, start))) : [];
          await releaseBreaks(tx, replacing.map((r) => r.id));
          // Out of the way while the carried slot goes on, so reminders on what it replaces can
          // move to it (the same program placed again) before they go.
          for (const [i, r] of replacing.entries()) {
            await tx.update(E).set({ startsAt: new Date(PARK + i * 2 * MIN), endsAt: new Date(PARK + i * 2 * MIN + MIN) }).where(eq(E.id, r.id));
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
          news = await settleReminders(tx, replacing);
          if (replacing.length) {
            const removed = await tx.delete(E).where(inArray(E.id, replacing.map((r) => r.id))).returning({ id: E.id });
            replaced += removed.length;
          }
        }).then(
          () => {
            tellReminders(news);
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
      const [contents, repeats, days, blocks, spans] = await Promise.all([
        service.breakContents(stationId, breaks),
        service.repeats(stationId, from),
        templates.days(stationId, from, to),
        spanViews(stationId, from, to),
        spansOverlapping(stationId, from, to)
      ]);
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
        days,
        // Edit mode: what a draft began from (a batch is refused if the window changed since; A244: its blocks too).
        version: logVersion(rows, spans),
        // A244: programming blocks in the window.
        ...(blocks.length ? { blocks } : {})
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
          keepTime: input.keepTime ?? false,
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
          ...(input.localNote !== undefined ? { localNote: input.localNote } : {}),
          ...(input.keepTime !== undefined ? { keepTime: input.keepTime } : {})
        })
        .where(eq(E.id, entryId))
        .returning();
      // Reminders follow the entry: at a new start, they come again then.
      if (row.startsAt.getTime() !== current.startsAt.getTime()) await services.accounts.rearmReminders(db, [row.id]);
      await templates.markEdited(stationId, [current.templateDate ?? current.startsAt, row.startsAt]);
      await changedNear(stationId, [current.startsAt, row.startsAt]);
      return toEntry(row, await context([row]));
    },

    async remove(stationId, entryId) {
      let news: ReminderNews[] = [];
      const removed = await db.transaction(async (tx) => {
        const [mine] = await tx.select().from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
        if (mine) {
          await releaseBreaks(tx, [mine.id]);
          // Viewers' reminders move to the program's next airing, or are cancelled; they're told.
          news = await settleReminders(tx, [mine]);
        }
        return tx
          .delete(E)
          .where(and(eq(E.id, entryId), eq(E.stationId, stationId)))
          .returning({ startsAt: E.startsAt, templateDate: E.templateDate });
      });
      if (!removed.length) throw notFound("That log entry");
      tellReminders(news);
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
  // Edit mode (added 2026-09-29): a batch checks with the single edits' own rules.
  service.changes = createChangeOps(ctx, {
    validate,
    releaseBreaks,
    load: (stationId, from, to) => load([stationId], from, to),
    async titles(rows) {
      const ctx = await context(rows);
      return new Map(rows.map((r) => [r.id, titleOf(r, ctx)]));
    },
    offAirSpans: (stationId, from, to) => service.offAirSpans(stationId, from, to),
    gapsIn,
    ensureBreaks: (stationId, from, to) => service.ensureBreaks(stationId, from, to),
    breakContexts: (ids) => service.breakContexts(ids),
    markEdited: (stationId, dates) => templates.markEdited(stationId, dates),
    remindersOn: (entryIds) => services.accounts.remindersOnEntries(entryIds),
    settleReminders,
    rearmReminders: (ex, entryIds) => services.accounts.rearmReminders(ex, entryIds),
    tellReminders,
    spans: (stationId, from, to) => spansOverlapping(stationId, from, to)
  });
  return service;
}


/** G1: a break's content as a row on the log. */
function breakRow(c: BreakContent): BreakRow {
  const code: BreakRow["code"] =
    c.kind === "station_id" ? "SID" : c.kind === "bumper" ? "BMP" : c.kind === "underwriting" || c.kind === "sponsor" ? "UND" : c.kind === "open" ? "OPEN" : "SPT";
  const whose: BreakRow["whose"] = c.kind === "producer" ? "producer" : c.rotation === "backup" ? "backup" : "station";
  return { code, title: c.business && c.kind === "spot" ? `${c.shortName ?? c.business}: ${c.title}` : c.title, lengthMs: c.lengthMs, whose, note: c.note, ...(c.element ? { element: c.element } : {}), ...(c.block ? { block: c.block } : {}) };
}
