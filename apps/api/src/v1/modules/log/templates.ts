// Day templates (added 2026-09-29): a station builds a day once and repeats it (every day,
// weekdays, a given weekday, or once). The template keeps the day as local wall-clock times; each
// future date it covers gets its log generated from it, three weeks ahead (the minute job keeps
// the horizon rolling). Each generated date is recorded, so generation is idempotent. Editing one
// date's log by hand makes it an exception, never generated again; editing the template makes
// every future date that isn't an exception again. Dates already started are never touched.
//
// A template's day is a broadcast day (G10), as the log, the guide and master control draw it: from
// 6:00 am local to 6:00 am the next day (25 hours the night clocks fall back, 23 the night they
// spring forward). "Repeat this day" on Saturday takes Saturday 6:00 am to Sunday 6:00 am, the
// programs after midnight included and Friday night's last hours left out. Every date here
// (`fromDay`, `onto`, `until`, `day_template_dates.date`, `log_entries.template_date`, today and
// tomorrow) is a broadcast date, and weekdays are the broadcast day's: "Every Saturday" is the
// Saturday broadcast day, Weekdays are the Monday to Friday broadcast days.
//
// `day_template_entries.start_minute` stays the local wall-clock minute (0 to 1439, as the
// contract's `startTime`), and a minute before 6:00 am falls on the calendar day after the date:
// 8:00 pm stays 8:00 pm across daylight saving, and "00:30" on Saturday is Sunday 12:30 am. Rows
// written before the broadcast day (2026-09-29) keep their meaning: a wall-clock minute is still
// one, and dates already generated aren't generated again until their template changes.
//
// Stopping a template (`remove`) takes its entries off the dates still ahead that weren't edited,
// and those dates can be made by another template; an edited date keeps its entries as they are,
// and stays an exception (A132).
//
// G7's "Repeat this day" (`repeatDay`) makes a template too. G7 copies made before templates
// (`repeat_groups.template` false) stay as they were: `removeRepeat` still takes them off.
//
// Programming Phase 3: a program slot says what airs from it. This episode (the item, every date,
// as before), Next episode (one step of its programs' walk each date it airs, in its order: the
// walker in `@opencast/domain`), Fill the slot (as many next episodes as fit, never past its end)
// or Same as earlier slot (what an earlier slot aired that date). A slot keeps its id across saves
// (`slot_id`, sent back by the editor) and every entry it makes names it (`template_slot_id`), so
// where its walk is comes from the log and is never stored: the slot's entries before the date,
// aired (in the as-run log) or still to come. A date where it didn't air (an exception without it,
// a live block in its place, off air) used no episode, and the next date gets it. Dates are made in
// order, each counting the ones before, and a date records what its walk was made from (`walk`):
// when that changes, the date is made again. An episode longer than its slot pushes what follows
// down (the ripple), stopping at an entry kept at its time; at the end of its programs a slot starts
// over (with a warning a week ahead) or stops.

import { randomUUID, createHash } from "node:crypto";
import { asLogCode, isIdentCode, slotPreviewLine, type TemplateSlotPreview, type TemplateWarning } from "@opencast/contracts";
import { walkEpisodes, type Airing as WalkAiring } from "@opencast/domain";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { DayTemplate, DayTemplateEntry, LogDay, TemplateGeneration } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, HttpError, notFound, refused } from "../../errors.js";
import { addDays, clockTime, localDate, roundUpToMinute, tzOffsetMinutes, zonedTime } from "../../lib/time.js";
import { snapToSegment } from "../../lib/segments.js";
import type { ItemRef, ProgramRef } from "../library/service.js";

const G = schema.repeatGroups;
const TE = schema.dayTemplateEntries;
const TD = schema.dayTemplateDates;
const E = schema.logEntries;
const B = schema.breaks;
const TB = schema.dayTemplateBlocks;
const SP = schema.programBlockSpans;

/** How far ahead dates are generated. */
export const TEMPLATE_HORIZON_DAYS = 21;
/** How far ahead a write may ask for ("once" on a date, a log window). */
const MAX_AHEAD_DAYS = 120;
const MIN = 60_000;

type Group = typeof G.$inferSelect;
type TemplateRow = typeof TE.$inferSelect;
type EntryRow = typeof E.$inferSelect;
type Pattern = Group["pattern"];
type WhatAirs = TemplateRow["whatAirs"];
type Order = NonNullable<TemplateRow["playbackOrder"]>;
type TemplateNoteRow = schema.TemplateNoteRow;

export interface TemplateEntryInput {
  startTime: string;
  lengthMs?: number;
  kind: "program" | "live" | "off_air";
  itemId?: string;
  programId?: string;
  liveSourceId?: string;
  carriageAgreementId?: string;
  episodeTitle?: string;
  episodeDescription?: string;
  localNote?: string;
  /** G18: "Keep at this time" (left out: false). */
  keepTime?: boolean;
  /** Programming Phase 3: the slot's id as read (kept when it's one of the template's), and what airs from it. */
  slotId?: string;
  whatAirs?: WhatAirs;
  programIds?: string[];
  order?: Order;
  atEnd?: "start_over" | "stop";
  sameAsSlotId?: string;
}

/** Programming Phase 3: the slots that walk their programs' episodes. */
const walks = (e: Pick<TemplateRow, "kind" | "whatAirs">) => e.kind === "program" && (e.whatAirs === "next_episode" || e.whatAirs === "fill");

/** Programming Phase 3: the words for Marathon on a slot with one program (the user's decision on Phase 2). */
export const MARATHON_NEEDS_A_MIX = "Marathon is for a slot that draws on several programs. For one program, In order already airs a season at a time.";

/** "Sat Oct 24". */
const dayWords = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(",", "");

/** "Late Crate, ep. 14", or the item's title. */
function episodeLabel(item: Pick<ItemRef, "title" | "programId" | "episodeNumber">, programs: Map<string, Pick<ProgramRef, "title">>): string {
  const program = item.programId ? programs.get(item.programId)?.title : undefined;
  return program && item.episodeNumber != null ? `${program}, ep. ${item.episodeNumber}` : item.title;
}

const noteView = (n: TemplateNoteRow, templateId: string, date: string): TemplateWarning => ({ code: n.code, templateId, slotId: n.slotId, date, startsAt: n.startsAt, message: n.message });

/** Each part's length on the log: whole minutes, as fill places them. */
const partLength = (i: Pick<ItemRef, "durationMs">) => roundUpToMinute(i.durationMs ?? 0);
const airingLength = (parts: Array<Pick<ItemRef, "durationMs">>) => parts.reduce((t, p) => t + partLength(p), 0);

/** One row a date would put on the log, before the ripple. */
type Desired = typeof E.$inferInsert & { startsAt: Date; endsAt: Date };

/**
 * Programming Phase 3: a date's rows in the broadcast day's order, with the ripple: a row that
 * would start before the one ahead of it ends (an episode longer than its slot) moves down just
 * enough, and so on down the day, until a gap takes the rest. An entry kept at its time doesn't
 * move: what wouldn't end before it isn't placed, and that's a warning (`pushesKept` words it).
 */
export function ripple(rows: Desired[], pushesKept: (kept: Desired, overBy: number, dropped: Desired[]) => void): { rows: Desired[]; dropped: number } {
  const out: Desired[] = [];
  let cursor = -Infinity;
  let dropped = 0;
  for (const r of rows) {
    const start = r.startsAt.getTime();
    if (start < cursor) {
      // A carried program's times are its agreement's: it stays put too.
      if (r.keepTime || r.carriageAgreementId) {
        const going = out.filter((x) => x.endsAt.getTime() > start);
        pushesKept(r, cursor - start, going);
        for (const g of going) out.splice(out.indexOf(g), 1);
        dropped += going.length;
        cursor = Math.max(-Infinity, ...out.map((x) => x.endsAt.getTime()));
      } else {
        const shift = cursor - start;
        r.startsAt = new Date(start + shift);
        r.endsAt = new Date(r.endsAt.getTime() + shift);
      }
    }
    out.push(r);
    cursor = Math.max(cursor, r.endsAt.getTime());
  }
  return { rows: out, dropped };
}

/** A244: a programming block in a day template, as sent. */
export interface TemplateBlockInput {
  blockId: string;
  startTime: string;
  lengthMs: number;
}

/** A244: the words for a block that would run past 6:00 am in a template. */
export const BLOCK_CROSSES_DAY = "A block in a day template ends by 6:00 am, when the next broadcast day starts. Make it two blocks, or place it on the date.";

export interface TemplateOps {
  list(stationId: string): Promise<DayTemplate[]>;
  get(stationId: string, templateId: string): Promise<DayTemplate>;
  create(
    stationId: string,
    input: { fromDay: string; pattern: Pattern; weekday?: number; onto?: string; until?: string | null; name?: string }
  ): Promise<{ template: DayTemplate; generated: TemplateGeneration }>;
  update(
    stationId: string,
    templateId: string,
    input: { name?: string | null; pattern?: Pattern; weekday?: number; onto?: string; until?: string | null; fromDay?: string; entries?: TemplateEntryInput[]; blocks?: TemplateBlockInput[] }
  ): Promise<{ template: DayTemplate; generated: TemplateGeneration }>;
  /** Takes a repeat (template or G7 copy) off the log from now on. */
  remove(stationId: string, groupId: string): Promise<number>;
  /**
   * A246: "Reset to template": an edited date made again from its template (what the template
   * didn't make comes off it from now on), no longer an exception. Dates from tomorrow on.
   */
  resetDate(stationId: string, templateId: string, date: string): Promise<{ template: DayTemplate; generated: TemplateGeneration }>;
  /** Generates the dates a station's templates cover, through the horizon (or `through`). Idempotent. */
  generate(stationId: string, options?: { through?: string; force?: string }): Promise<TemplateGeneration>;
  /** Every station with templates, for the job. */
  generateAll(): Promise<{ stations: number; dates: number }>;
  /**
   * Hand edits: these broadcast dates become exceptions (if a template made them). An instant
   * stands for the broadcast day it falls in.
   */
  markEdited(stationId: string, dates: Array<string | Date>): Promise<void>;
  /** G11: every broadcast day `[from, to)` touches, with the template that made it. */
  days(stationId: string, from: Date, to: Date): Promise<LogDay[]>;
  /**
   * Programming Phase 3: the template warnings for the broadcast days `[from, to)` touches, and a
   * program's last new episode from a week before its date.
   */
  warnings(stationId: string, from: Date, to: Date): Promise<TemplateWarning[]>;
  /** Programming Phase 3: what a slot (saved or not) would air on the template's next dates, from where its walk is. Reads only. */
  preview(stationId: string, templateId: string, entry: TemplateEntryInput, count?: number): Promise<TemplateSlotPreview>;
  /** Programming Phase 3: the slots that made log entries (for a log entry's details), by slot id. */
  slotsOf(slotIds: string[]): Promise<Map<string, { slotId: string; templateId: string; templateName: string | null; label: string; startTime: string; whatAirs: WhatAirs }>>;
}

const RANK: Record<Pattern, number> = { once: 3, weekly: 2, weekdays: 1, daily: 0 };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");
const minuteText = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const weekdayOfDate = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Whether a template covers a date (the day it was built from is the station's own). */
export function covers(t: Pick<Group, "pattern" | "startsOn" | "endsOn" | "weekday">, date: string): boolean {
  if (t.pattern === "once") return date === t.endsOn;
  if (date <= t.startsOn) return false;
  if (t.endsOn && date > t.endsOn) return false;
  const weekday = weekdayOfDate(date);
  if (t.pattern === "weekdays") return weekday >= 1 && weekday <= 5;
  if (t.pattern === "weekly") return weekday === t.weekday;
  return true;
}

/** The template that makes a date: the most specific that covers it, the newest among equals. */
export function winner<T extends Pick<Group, "pattern" | "startsOn" | "endsOn" | "weekday" | "createdAt">>(templates: T[], date: string): T | null {
  const matching = templates.filter((t) => covers(t, date));
  matching.sort((a, b) => RANK[b.pattern] - RANK[a.pattern] || b.createdAt.getTime() - a.createdAt.getTime());
  return matching[0] ?? null;
}

export function templateLabel(t: Pick<Group, "pattern" | "weekday" | "endsOn">): string {
  if (t.pattern === "once") {
    const day = t.endsOn ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${t.endsOn}T12:00:00Z`)).replace(",", "") : "";
    return `Once${day ? `, ${day}` : ""}`;
  }
  if (t.pattern === "weekly") return `Every ${WEEKDAYS[t.weekday ?? 0]}`;
  if (t.pattern === "weekdays") return "Weekdays";
  return "Every day";
}

/** Minutes after local midnight of an instant. */
function localMinute(at: Date, tz: string): number {
  const minutes = Math.floor(at.getTime() / MIN) + tzOffsetMinutes(at, tz);
  return ((minutes % 1440) + 1440) % 1440;
}

/** The broadcast day starts at 6:00 am local (G10), as the log and the guide draw it. */
export const DAY_STARTS_MINUTE = 6 * 60;

/** The broadcast day an instant falls in, by the wall clock: 2:00 am Sunday is still Saturday. */
export function broadcastDate(at: Date, tz: string): string {
  const date = localDate(at, tz);
  return localMinute(at, tz) < DAY_STARTS_MINUTE ? addDays(date, -1) : date;
}

/** Start and end (exclusive) of a broadcast day: 6:00 am to 6:00 am the next calendar day. */
export function broadcastDay(date: string, tz: string): { from: Date; to: Date } {
  return { from: zonedTime(date, minuteText(DAY_STARTS_MINUTE), tz), to: zonedTime(addDays(date, 1), minuteText(DAY_STARTS_MINUTE), tz) };
}

/** A template's wall-clock minute on a broadcast date: before 6:00 am is the calendar day after. */
export function templateInstant(date: string, startMinute: number, tz: string): Date {
  return zonedTime(startMinute < DAY_STARTS_MINUTE ? addDays(date, 1) : date, minuteText(startMinute), tz);
}

/** A wall-clock minute's place in the broadcast day (6:00 am is 0 ... 5:59 am is 1439). */
const dayOrder = (startMinute: number) => (startMinute - DAY_STARTS_MINUTE + 1440) % 1440;
const byDayOrder = <T extends { startMinute: number }>(a: T, b: T) => dayOrder(a.startMinute) - dayOrder(b.startMinute);

export function createTemplateOps({ deps, services }: ModuleContext): TemplateOps {
  const { db } = deps;

  async function group(stationId: string, id: string): Promise<Group> {
    const [row] = await db.select().from(G).where(and(eq(G.id, id), eq(G.stationId, stationId)));
    if (!row) throw notFound("That repeat");
    return row;
  }

  /**
   * Programming Phase 3: what walking slots walk: their programs' episodes, which of them can air
   * (rights confirmed, a length, the file available, not failed or taken off air; one still being
   * prepared can, as This episode's can), and the programs, for words.
   */
  async function walkState(stationId: string, slots: Array<Pick<TemplateRow, "programIds">>) {
    const episodes = await services.library.programEpisodes(stationId, slots.flatMap((s) => s.programIds ?? []));
    const [pulled, programs] = await Promise.all([
      services.trust.offAirItems(episodes.map((e) => e.id)),
      services.library.programsByIds([...new Set(episodes.map((e) => e.programId).filter((v): v is string => Boolean(v)))])
    ]);
    const canAir = (i: ItemRef) => !i.archived && i.rightsConfirmed && !i.contentUnavailable && !!i.durationMs && i.status !== "failed" && !pulled.has(i.id);
    const episodesOf = (slot: Pick<TemplateRow, "programIds">) => episodes.filter((e) => e.programId && slot.programIds?.includes(e.programId));
    return { episodes, canAir, episodesOf, programs };
  }
  type WalkState = Awaited<ReturnType<typeof walkState>>;

  /**
   * Programming Phase 3: the walking slots' entries that count, oldest first: aired (in the as-run
   * log, as more than a slate) or still to come. One that didn't air used no episode.
   */
  async function slotHistory(ex: Executor, stationId: string, slotIds: string[], tz: string): Promise<Array<{ slotId: string | null; date: string; assetId: string | null }>> {
    if (!slotIds.length) return [];
    const now = deps.clock.now();
    const rows = await ex
      .select({ id: E.id, slotId: E.templateSlotId, date: E.templateDate, startsAt: E.startsAt, assetId: E.assetId })
      .from(E)
      .where(and(eq(E.stationId, stationId), inArray(E.templateSlotId, slotIds), isNotNull(E.assetId)))
      .orderBy(asc(E.startsAt), asc(E.id));
    // Playout's as-run log says which of those that have started aired (its program rows: no slates).
    const started = rows.filter((r) => r.startsAt <= now).map((r) => r.id);
    const aired = new Set(started.length ? (await services.playout.programRows({ logEntryIds: started })).map((r) => r.logEntryId) : []);
    // The day a template was built from has no template date: its broadcast day.
    return rows.filter((r) => r.startsAt > now || aired.has(r.id)).map((r) => ({ slotId: r.slotId, date: r.date ?? broadcastDate(r.startsAt, tz), assetId: r.assetId }));
  }
  type History = Awaited<ReturnType<typeof slotHistory>>;
  /** Where a slot's walk is on a date: its airings on the dates before it, as item ids. */
  const before = (history: History, slotId: string, date: string) => history.filter((h) => h.slotId === slotId && h.date < date).map((h) => h.assetId!);

  /**
   * Programming Phase 3: a walking slot's airings on a date, from its position: Next episode one,
   * Fill the slot as many as fit its length (never past its end). A slot that stops at its
   * programs' end airs nothing once the walk starts over (`stopped`).
   */
  function airingsFor(slot: Pick<TemplateRow, "slotId" | "programIds" | "playbackOrder" | "atEnd" | "whatAirs" | "lengthMs">, position: string[], state: WalkState) {
    const episodes = state.episodesOf(slot).map((i) => ({ ...i, ready: state.canAir(i) }));
    const walk = walkEpisodes({ episodes, order: slot.playbackOrder ?? "in_order", seed: slot.slotId, position, programs: slot.programIds ?? undefined });
    const airings: Array<WalkAiring<(typeof episodes)[number]>> = [];
    let stopped = false;
    let room = snapToSegment(slot.lengthMs);
    for (const a of walk) {
      if (slot.atEnd === "stop" && a.cycle > 0) {
        stopped = true;
        break;
      }
      if (slot.whatAirs !== "fill") {
        airings.push(a);
        break;
      }
      const length = airingLength(a.episodes);
      if (length > room || airings.length >= 200) break;
      airings.push(a);
      room -= length;
    }
    return { airings, stopped };
  }

  /** "Late Crate airs its last new episode Sat Oct 24, then starts over." */
  function lastEpisodeNote(slot: Pick<TemplateRow, "slotId" | "atEnd">, episode: ItemRef, date: string, startsAt: Date, programs: Map<string, ProgramRef>): TemplateNoteRow {
    const name = (episode.programId ? programs.get(episode.programId)?.title : undefined) ?? episode.title;
    return {
      code: "last_episode",
      slotId: slot.slotId,
      startsAt: startsAt.toISOString(),
      message: slot.atEnd === "stop" ? `${name} airs its last new episode ${dayWords(date)}, then stops. Its slot is dead air after that.` : `${name} airs its last new episode ${dayWords(date)}, then starts over.`
    };
  }

  /**
   * A broadcast day's log as template entries (at their wall-clock minutes). Programming Phase 3:
   * taken again for the template that made the day (`current`, its entries), an entry one of its
   * slots made keeps that slot (its id, what airs, its length); the rest of a Fill the slot's run,
   * and what a slot's ripple moved, is the slot's and doesn't become an entry of its own.
   */
  async function snapshot(stationId: string, day: string, tz: string, current: TemplateRow[] = []) {
    const { from, to } = broadcastDay(day, tz);
    const rows = await db
      .select()
      .from(E)
      .where(and(eq(E.stationId, stationId), gte(E.startsAt, from), lt(E.startsAt, to)))
      .orderBy(asc(E.startsAt));
    const slots = new Map(current.map((e) => [e.slotId, e]));
    const seen = new Set<string>();
    return rows.flatMap((r) => {
      const slot = r.templateSlotId ? slots.get(r.templateSlotId) : undefined;
      const entry = {
        startMinute: localMinute(r.startsAt, tz),
        lengthMs: r.endsAt.getTime() - r.startsAt.getTime(),
        kind: r.kind,
        code: asLogCode(r.code),
        assetId: r.assetId,
        programId: r.programId,
        carriageAgreementId: r.carriageAgreementId,
        liveSourceId: r.liveSourceId,
        localNote: r.localNote,
        episodeTitle: r.episodeTitle,
        episodeDescription: r.episodeDescription,
        // G18: the day's fixed points stay fixed on each date the template makes.
        keepTime: r.keepTime,
        // Phase 3: the log entry it was taken from, and the slot that made that.
        sourceId: r.id,
        sourceSlotId: r.templateSlotId
      };
      if (!slot) return [entry];
      if (slot.whatAirs === "this_episode") {
        if (seen.has(slot.slotId)) return [entry];
        seen.add(slot.slotId);
        return [{ ...entry, slotId: slot.slotId }];
      }
      if (seen.has(slot.slotId)) return [];
      seen.add(slot.slotId);
      return [{ ...entry, lengthMs: slot.lengthMs, slotId: slot.slotId, whatAirs: slot.whatAirs, programIds: slot.programIds, playbackOrder: slot.playbackOrder, atEnd: slot.atEnd, sameAsSlotId: slot.sameAsSlotId, episodeTitle: null, episodeDescription: null }];
    });
  }

  /**
   * A244: a broadcast day's programming blocks as template blocks (spans starting in it). One that
   * runs past the day's end (6:00 am) is refused: a template's blocks end by then.
   */
  async function snapshotBlocks(stationId: string, day: string, tz: string) {
    const { from, to } = broadcastDay(day, tz);
    const spans = await db
      .select()
      .from(SP)
      .where(and(eq(SP.stationId, stationId), gte(SP.startsAt, from), lt(SP.startsAt, to)))
      .orderBy(asc(SP.startsAt));
    if (spans.some((sp) => sp.endsAt > to)) throw refused("block_crosses_day", BLOCK_CROSSES_DAY);
    return spans.map((sp) => ({ blockId: sp.blockId, startMinute: localMinute(sp.startsAt, tz), lengthMs: sp.endsAt.getTime() - sp.startsAt.getTime() }));
  }

  /** A244: template blocks as sent: the station's blocks (not archived), ending by 6:00 am, not overlapping. */
  async function blocksFromInput(stationId: string, list: TemplateBlockInput[]) {
    const refs = await services.library.blocks.refs(list.map((b) => b.blockId));
    const out = list.map((b, i) => {
      const ref = refs.get(b.blockId);
      if (!ref || ref.stationId !== stationId || ref.archived) throw notFound("That block");
      const [hh, mm] = b.startTime.split(":").map(Number);
      const startMinute = hh * 60 + mm;
      if (!b.lengthMs || b.lengthMs <= 0) throw badRequest("Say how long it runs.", { [`blocks.${i}.lengthMs`]: "Required" });
      if (dayOrder(startMinute) * MIN + b.lengthMs > 1440 * MIN) throw new HttpError(400, "block_crosses_day", BLOCK_CROSSES_DAY, { [`blocks.${i}.lengthMs`]: "Past 6:00 am" });
      return { blockId: b.blockId, startMinute, lengthMs: b.lengthMs };
    });
    out.sort(byDayOrder);
    for (let i = 1; i < out.length; i++) {
      if (dayOrder(out[i - 1].startMinute) * MIN + out[i - 1].lengthMs > dayOrder(out[i].startMinute) * MIN) throw new HttpError(400, "block_overlap", "Blocks can't overlap.", { blocks: "Overlap" });
    }
    return out;
  }

  /**
   * Entries sent for a template, checked as the log checks them (times are checked per date).
   * Programming Phase 3: each keeps the slot id it was sent with when that's one of the template's
   * (`slots`), else gets a new one; a walking slot names the station's own programs; Same as earlier
   * slot points at an earlier slot that airs episodes.
   */
  async function fromInput(stationId: string, list: TemplateEntryInput[], slots: Set<string> = new Set()) {
    const items = await services.library.itemsByIds(list.map((x) => x.itemId).filter((v): v is string => Boolean(v)));
    const walkPrograms = await services.library.programsByIds([...new Set(list.flatMap((x) => x.programIds ?? (x.programId ? [x.programId] : [])))]);
    const out = [];
    const used = new Set<string>();
    for (const [i, x] of list.entries()) {
      const [hh, mm] = x.startTime.split(":").map(Number);
      const startMinute = hh * 60 + mm;
      let lengthMs = x.lengthMs ?? null;
      let code: EntryRow["code"] = "PGM";
      let programId = x.programId ?? null;
      const whatAirs: WhatAirs = x.kind === "program" ? (x.whatAirs ?? "this_episode") : "this_episode";
      const slotId = x.slotId && slots.has(x.slotId) && !used.has(x.slotId) ? x.slotId : randomUUID();
      used.add(slotId);
      const slot = { slotId, whatAirs, programIds: null as string[] | null, playbackOrder: null as Order | null, atEnd: null as "start_over" | "stop" | null, sameAsSlotId: null as string | null };
      if (x.kind === "program" && whatAirs !== "this_episode") {
        const item = x.itemId ? items.get(x.itemId) : undefined;
        if (x.itemId && (!item || item.archived || item.stationId !== stationId)) throw notFound("That item");
        if (whatAirs === "same_as") {
          if (!x.sameAsSlotId) throw badRequest("Choose the earlier slot it repeats.", { [`entries.${i}.sameAsSlotId`]: "Required" });
          slot.sameAsSlotId = x.sameAsSlotId;
        } else {
          const ids = [...new Set(x.programIds?.length ? x.programIds : programId ? [programId] : item?.programId ? [item.programId] : [])];
          if (!ids.length) throw badRequest("Choose the program it airs the next episode of.", { [`entries.${i}.programIds`]: "Required" });
          for (const id of ids) {
            const p = walkPrograms.get(id);
            if (!p || p.stationId !== stationId) throw notFound("That program");
          }
          const order = x.order ?? "in_order";
          if (order === "marathon" && ids.length < 2) throw badRequest(MARATHON_NEEDS_A_MIX, { [`entries.${i}.order`]: "Several programs" });
          Object.assign(slot, { programIds: ids, playbackOrder: order, atEnd: x.atEnd ?? "start_over" });
          programId = ids.length === 1 ? ids[0] : null;
        }
        lengthMs = lengthMs ?? (item?.durationMs ? roundUpToMinute(item.durationMs) : null);
        if (!lengthMs || lengthMs <= 0) throw badRequest("Say how long the slot runs.", { [`entries.${i}.lengthMs`]: "Required" });
        out.push({ startMinute, lengthMs, kind: x.kind, code, assetId: item?.id ?? null, programId, carriageAgreementId: null, liveSourceId: null, localNote: x.localNote ?? null, episodeTitle: null, episodeDescription: null, keepTime: x.keepTime ?? false, ...slot });
        continue;
      }
      if (x.kind === "program") {
        if (!x.itemId) throw badRequest("Choose what airs.", { [`entries.${i}.itemId`]: "Required" });
        const item = items.get(x.itemId);
        if (!item || item.archived) throw notFound("That item");
        if (isIdentCode(item.code)) throw refused("not_for_the_log", "Openers, closers and off-air cards air at sign-off and sign-on, not from the log.");
        if (!item.rightsConfirmed) throw refused("rights_unconfirmed", "Confirm the rights to air it first.");
        if (item.stationId !== stationId && !x.carriageAgreementId) throw refused("needs_agreement", "Another station's program needs a carriage agreement.");
        lengthMs = lengthMs ?? roundUpToMinute(item.durationMs ?? 30 * MIN);
        if (item.durationMs && lengthMs < item.durationMs - 1000) throw badRequest("The slot is shorter than the item.", { [`entries.${i}.lengthMs`]: "Too short" });
        code = item.code;
        programId = programId ?? item.programId;
      } else if (x.kind === "live") {
        if (!x.liveSourceId) throw badRequest("Choose a live source.", { [`entries.${i}.liveSourceId`]: "Required" });
        if (!(await services.stations.liveSourceBelongs(stationId, x.liveSourceId))) throw notFound("That live source");
      } else {
        code = "OPEN";
      }
      if (!lengthMs || lengthMs <= 0) throw badRequest("Say how long it runs.", { [`entries.${i}.lengthMs`]: "Required" });
      out.push({
        startMinute,
        lengthMs,
        kind: x.kind,
        code,
        assetId: x.itemId ?? null,
        programId,
        carriageAgreementId: x.carriageAgreementId ?? null,
        liveSourceId: x.liveSourceId ?? null,
        localNote: x.localNote ?? null,
        episodeTitle: x.episodeTitle ?? null,
        episodeDescription: x.episodeDescription ?? null,
        keepTime: x.keepTime ?? false,
        ...slot
      });
    }
    // In the broadcast day's order: "23:00" comes before "01:00".
    out.sort(byDayOrder);
    for (let i = 1; i < out.length; i++) {
      if (dayOrder(out[i - 1].startMinute) * MIN + out[i - 1].lengthMs > dayOrder(out[i].startMinute) * MIN) throw badRequest("Two entries overlap.", { entries: "Overlap" });
    }
    // Same as earlier slot: an earlier slot on the template that airs episodes.
    for (const [i, e] of out.entries()) {
      if (e.whatAirs !== "same_as") continue;
      const source = out.findIndex((s) => s.slotId === e.sameAsSlotId);
      if (source < 0 || source >= i || out[source].kind !== "program" || out[source].whatAirs === "same_as") throw badRequest("Choose an earlier program slot on this template.", { entries: "Same as earlier slot" });
    }
    return out;
  }

  /** Takes entries off the log, with their stored breaks; one with spots held in a break (or anything else pointing at it) stays. */
  async function removeRows(ex: Executor, rows: EntryRow[]): Promise<number> {
    if (!rows.length) return 0;
    const stored = await ex
      .select({ id: B.id, logEntryId: B.logEntryId })
      .from(B)
      .where(inArray(B.logEntryId, rows.map((r) => r.id)));
    const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
    let removed = 0;
    for (const row of rows) {
      const mine = stored.filter((b) => b.logEntryId === row.id);
      if (mine.some((b) => filled.get(b.id))) continue;
      try {
        await ex.transaction(async (sp) => {
          if (mine.length) await sp.delete(B).where(inArray(B.id, mine.map((b) => b.id)));
          await sp.delete(E).where(eq(E.id, row.id));
        });
        removed++;
      } catch {
        // A reminder or an as-run row points at it: it stays.
      }
    }
    return removed;
  }

  async function views(stationId: string, groups: Group[]): Promise<DayTemplate[]> {
    if (!groups.length) return [];
    const tz = await services.stations.timezoneOf(stationId);
    const tomorrow = addDays(broadcastDate(deps.clock.now(), tz), 1);
    const ids = groups.map((g) => g.id);
    const [entries, dates, blocks] = await Promise.all([
      db.select().from(TE).where(inArray(TE.templateId, ids)).orderBy(asc(TE.startMinute)),
      db.select().from(TD).where(and(inArray(TD.templateId, ids), gte(TD.date, tomorrow))).orderBy(asc(TD.date)),
      db.select().from(TB).where(inArray(TB.templateId, ids))
    ]);
    const blockRefs = await services.library.blocks.refs(blocks.map((b) => b.blockId));
    const items = await services.library.itemsByIds(entries.map((e) => e.assetId).filter((v): v is string => Boolean(v)));
    const programIds = entries.flatMap((e) => [e.programId ?? (e.assetId ? items.get(e.assetId)?.programId : null), ...(e.programIds ?? [])]).filter((v): v is string => Boolean(v));
    const programs = await services.library.programsByIds([...new Set(programIds)]);
    const title = (e: TemplateRow): string => {
      // Programming Phase 3: a mix is its programs ("Late Crate and Slow Hours"); a rerun, its slot's.
      if (e.whatAirs === "same_as") {
        const source = entries.find((s) => s.templateId === e.templateId && s.slotId === e.sameAsSlotId);
        if (source) return title(source);
      }
      if (walks(e) && (e.programIds?.length ?? 0) > 1) {
        const names = e.programIds!.map((id) => programs.get(id)?.title).filter((v): v is string => Boolean(v));
        if (names.length) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
      }
      const item = e.assetId ? items.get(e.assetId) : undefined;
      const programId = e.programId ?? item?.programId ?? null;
      if (programId && programs.has(programId)) return programs.get(programId)!.title;
      if (item) return item.title;
      return e.kind === "off_air" ? "Off air" : e.kind === "live" ? "Live" : "Untitled";
    };
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      pattern: g.pattern,
      weekday: g.pattern === "weekly" ? g.weekday : null,
      label: templateLabel(g),
      fromDay: g.startsOn,
      onDate: g.pattern === "once" ? g.endsOn : null,
      until: g.endsOn,
      timezone: tz,
      entries: entries
        .filter((e) => e.templateId === g.id)
        .sort(byDayOrder)
        .map(
          (e): DayTemplateEntry => ({
            id: e.id,
            startTime: minuteText(e.startMinute),
            lengthMs: e.lengthMs,
            kind: e.kind,
            code: asLogCode(e.code),
            title: title(e),
            itemId: e.assetId,
            programId: e.programId ?? (e.assetId ? (items.get(e.assetId)?.programId ?? null) : null),
            liveSourceId: e.liveSourceId,
            carriageAgreementId: e.carriageAgreementId,
            episodeTitle: e.episodeTitle,
            episodeDescription: e.episodeDescription,
            localNote: e.localNote,
            keepTime: e.keepTime,
            // Programming Phase 3: the slot, and what airs from it.
            slotId: e.slotId,
            whatAirs: e.whatAirs,
            ...(walks(e) ? { programIds: e.programIds ?? [], order: e.playbackOrder ?? "in_order", atEnd: e.atEnd ?? "start_over" } : {}),
            ...(e.whatAirs === "same_as" ? { sameAsSlotId: e.sameAsSlotId } : {})
          })
        ),
      dates: dates
        .filter((d) => d.templateId === g.id)
        .map((d) => ({ date: d.date, edited: Boolean(d.editedAt), entries: d.entries, skipped: d.skipped, ...(d.notes?.length ? { warnings: d.notes.map((n) => noteView(n, g.id, d.date)) } : {}) })),
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt?.toISOString() ?? null,
      // A244: its programming blocks, in the broadcast day's order.
      ...(blocks.some((b) => b.templateId === g.id)
        ? {
            blocks: blocks
              .filter((b) => b.templateId === g.id)
              .sort(byDayOrder)
              .map((b) => ({ id: b.id, blockId: b.blockId, name: blockRefs.get(b.blockId)?.name ?? "Block", colour: blockRefs.get(b.blockId)?.colour ?? null, startTime: minuteText(b.startMinute), lengthMs: b.lengthMs }))
          }
        : {})
    }));
  }

  function checkPattern(input: { pattern: Pattern; onto?: string | null; until?: string | null; fromDay: string }, today: string) {
    if (input.pattern === "once") {
      if (!input.onto) throw badRequest("Choose the day to copy to.", { onto: "Required" });
      if (input.onto <= today) throw badRequest("Choose a day from tomorrow on.", { onto: "Tomorrow or later" });
      if (input.onto > addDays(today, MAX_AHEAD_DAYS)) throw badRequest(`Choose a day within ${MAX_AHEAD_DAYS} days.`, { onto: "Too far ahead" });
    } else if (input.until && input.until <= input.fromDay) {
      throw badRequest("It has to repeat after the day it's built from.", { until: "Before the day" });
    }
  }

  const ops: TemplateOps = {
    async list(stationId) {
      const rows = await db
        .select()
        .from(G)
        .where(and(eq(G.stationId, stationId), eq(G.template, true), isNull(G.removedAt)))
        .orderBy(asc(G.createdAt));
      return views(stationId, rows);
    },

    async get(stationId, templateId) {
      const row = await group(stationId, templateId);
      if (!row.template || row.removedAt) throw notFound("That template");
      return (await views(stationId, [row]))[0];
    },

    async create(stationId, input) {
      const tz = await services.stations.timezoneOf(stationId);
      const now = deps.clock.now();
      const today = broadcastDate(now, tz);
      checkPattern({ ...input, fromDay: input.fromDay }, today);
      const [snapped, blocks] = await Promise.all([snapshot(stationId, input.fromDay, tz), snapshotBlocks(stationId, input.fromDay, tz)]);
      // Programming Phase 3: each entry is a slot from the start, and the day it was built from is
      // its first airing (a slot made Next episode later goes on from there). An entry another
      // template's slot made stays that slot's.
      const entries = snapped.map(({ sourceId, sourceSlotId, ...e }) => ({ ...e, slotId: randomUUID(), sourceId, sourceSlotId }));
      const [row] = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(G)
          .values({
            stationId,
            pattern: input.pattern,
            weekday: input.pattern === "weekly" ? (input.weekday ?? weekdayOfDate(input.fromDay)) : null,
            startTime: "00:00",
            startsOn: input.fromDay,
            endsOn: input.pattern === "once" ? input.onto! : (input.until ?? null),
            template: true,
            name: input.name ?? null,
            updatedAt: now
          })
          .returning();
        if (entries.length) await tx.insert(TE).values(entries.map(({ sourceId: _row, sourceSlotId: _slot, ...e }) => ({ ...e, templateId: inserted[0].id })));
        for (const e of entries) if (!e.sourceSlotId) await tx.update(E).set({ templateSlotId: e.slotId }).where(eq(E.id, e.sourceId));
        if (blocks.length) await tx.insert(TB).values(blocks.map((b) => ({ ...b, templateId: inserted[0].id })));
        return inserted;
      });
      const generated = await ops.generate(stationId, { through: input.pattern === "once" ? input.onto : undefined });
      return { template: (await views(stationId, [row]))[0], generated };
    },

    async update(stationId, templateId, input) {
      const current = await group(stationId, templateId);
      if (!current.template || current.removedAt) throw notFound("That template");
      const tz = await services.stations.timezoneOf(stationId);
      const now = deps.clock.now();
      const today = broadcastDate(now, tz);
      const pattern = input.pattern ?? current.pattern;
      const onto = pattern === "once" ? (input.onto ?? (current.pattern === "once" ? current.endsOn : null)) : null;
      const until = pattern === "once" ? onto : input.until !== undefined ? input.until : current.pattern === "once" ? null : current.endsOn;
      if (input.pattern || input.onto || input.until !== undefined) checkPattern({ pattern, onto, until, fromDay: current.startsOn }, today);
      // Programming Phase 3: its slots keep their ids (and so their walks) through the save.
      const currentEntries = input.entries || input.fromDay ? await db.select().from(TE).where(eq(TE.templateId, templateId)) : [];
      const entries = input.entries
        ? await fromInput(stationId, input.entries, new Set(currentEntries.map((e) => e.slotId)))
        : input.fromDay
          ? (await snapshot(stationId, input.fromDay, tz, currentEntries)).map(({ sourceId: _row, sourceSlotId: _slot, ...e }) => e)
          : null;
      // A244: its blocks, as sent (`blocks` replaces them), or from the day again.
      const blocks = input.blocks ? await blocksFromInput(stationId, input.blocks) : input.fromDay ? await snapshotBlocks(stationId, input.fromDay, tz) : null;
      const [row] = await db.transaction(async (tx) => {
        if (entries) {
          await tx.delete(TE).where(eq(TE.templateId, templateId));
          if (entries.length) await tx.insert(TE).values(entries.map((e) => ({ ...e, templateId })));
        }
        if (blocks) {
          await tx.delete(TB).where(eq(TB.templateId, templateId));
          if (blocks.length) await tx.insert(TB).values(blocks.map((b) => ({ ...b, templateId })));
        }
        return tx
          .update(G)
          .set({
            pattern,
            weekday: pattern === "weekly" ? (input.weekday ?? current.weekday ?? weekdayOfDate(current.startsOn)) : null,
            endsOn: until,
            ...(input.name !== undefined ? { name: input.name } : {}),
            updatedAt: now
          })
          .where(eq(G.id, templateId))
          .returning();
      });
      const generated = await ops.generate(stationId, { force: templateId, through: pattern === "once" ? (onto ?? undefined) : undefined });
      return { template: (await views(stationId, [row]))[0], generated };
    },

    async remove(stationId, groupId) {
      const row = await group(stationId, groupId);
      const now = deps.clock.now();
      if (row.template) await db.update(G).set({ removedAt: now }).where(eq(G.id, groupId));
      // A132: a date edited by hand keeps its entries as they are ("Future dates that weren't
      // edited will be cleared"), and stays an exception, so no other template makes it again.
      const edited = row.template
        ? (await db.select({ date: TD.date }).from(TD).where(and(eq(TD.stationId, stationId), eq(TD.templateId, groupId), isNotNull(TD.editedAt)))).map((d) => d.date)
        : [];
      const upcoming = await db
        .select()
        .from(E)
        .where(and(eq(E.repeatGroupId, groupId), gt(E.startsAt, now)));
      const removed = await removeRows(
        db,
        upcoming.filter((e) => !(e.templateDate && edited.includes(e.templateDate)))
      );
      // A244: its programming blocks come off the same dates.
      const spans = await db.select({ id: SP.id, templateDate: SP.templateDate }).from(SP).where(and(eq(SP.repeatGroupId, groupId), gt(SP.startsAt, now)));
      const goingSpans = spans.filter((sp) => !(sp.templateDate && edited.includes(sp.templateDate)));
      if (goingSpans.length) await db.delete(SP).where(inArray(SP.id, goingSpans.map((sp) => sp.id)));
      if (row.template) {
        const tz = await services.stations.timezoneOf(stationId);
        await db.delete(TD).where(and(eq(TD.templateId, groupId), gt(TD.date, broadcastDate(now, tz)), isNull(TD.editedAt)));
        // Another template may cover the dates it cleared now ("Every day" on the Saturdays "Every Saturday" had).
        await ops.generate(stationId);
      }
      return removed;
    },

    async resetDate(stationId, templateId, date) {
      const row = await group(stationId, templateId);
      if (!row.template || row.removedAt) throw notFound("That template");
      const tz = await services.stations.timezoneOf(stationId);
      const now = deps.clock.now();
      if (date <= broadcastDate(now, tz)) {
        const words = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
        throw new HttpError(409, "date_started", `${words} has started. Only dates from tomorrow on can be reset to their template.`);
      }
      const [rec] = await db.select().from(TD).where(and(eq(TD.stationId, stationId), eq(TD.date, date)));
      if (!rec || rec.templateId !== templateId) throw notFound("That date of the template");
      let removed = 0;
      if (rec.editedAt) {
        const { from, to } = broadcastDay(date, tz);
        // The template's own rows stay for `generate` to match (kept, moved back or remade); what
        // it didn't make comes off: entries put on by hand, and blocks placed on the date.
        const ours = (x: { repeatGroupId: string | null; templateDate: string | null }) => x.repeatGroupId === templateId && x.templateDate === date;
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`day-templates:${stationId}`}))`);
          const rows = await tx
            .select()
            .from(E)
            .where(and(eq(E.stationId, stationId), gte(E.startsAt, from), lt(E.startsAt, to), gt(E.startsAt, now)));
          removed = await removeRows(tx, rows.filter((r) => !ours(r)));
          const spans = await tx
            .select({ id: SP.id, repeatGroupId: SP.repeatGroupId, templateDate: SP.templateDate })
            .from(SP)
            .where(and(eq(SP.stationId, stationId), gte(SP.startsAt, from), lt(SP.startsAt, to), gt(SP.startsAt, now)));
          const going = spans.filter((sp) => !ours(sp));
          if (going.length) await tx.delete(SP).where(inArray(SP.id, going.map((sp) => sp.id)));
          // No longer an exception, and older than the template: `generate` makes it again.
          await tx.update(TD).set({ editedAt: null, generatedAt: new Date(0) }).where(and(eq(TD.stationId, stationId), eq(TD.date, date)));
        });
      }
      const generated = rec.editedAt ? await ops.generate(stationId, { through: date }) : { dates: 0, created: 0, removed: 0, skippedForConflicts: 0, exceptions: 0 };
      return { template: (await views(stationId, [row]))[0], generated: { ...generated, removed: generated.removed + removed } };
    },

    async generate(stationId, options = {}) {
      const totals: TemplateGeneration = { dates: 0, created: 0, removed: 0, skippedForConflicts: 0, exceptions: 0 };
      const tz = await services.stations.timezoneOf(stationId);
      const now = deps.clock.now();
      // Today's broadcast day has started: generation starts tomorrow's.
      const today = broadcastDate(now, tz);
      const first = addDays(today, 1);
      const cap = addDays(today, MAX_AHEAD_DAYS);
      let last = addDays(today, TEMPLATE_HORIZON_DAYS);
      if (options.through && options.through > last) last = options.through < cap ? options.through : cap;

      const templates = await db.select().from(G).where(and(eq(G.stationId, stationId), eq(G.template, true), isNull(G.removedAt)));
      const templateEntries = templates.length
        ? await db
            .select()
            .from(TE)
            .where(inArray(TE.templateId, templates.map((t) => t.id)))
            .orderBy(asc(TE.startMinute))
        : [];
      // Programming Phase 3: the slots that walk, what they walk, and where each walk is.
      const walking = templateEntries.filter(walks);
      const state = walking.length ? await walkState(stationId, walking) : null;
      const readHistory = (ex: Executor) => slotHistory(ex, stationId, walking.map((e) => e.slotId), tz);
      /** What a date's walking slots are made from: each one's airings before it, and its programs' episodes. */
      const walkOf = (t: Group, date: string, history: History): string | null => {
        const mine = walking.filter((e) => e.templateId === t.id);
        if (!mine.length || !state) return null;
        const made = mine.map((e) => [
          [e.slotId, e.startMinute, e.lengthMs, e.whatAirs, e.programIds, e.playbackOrder, e.atEnd],
          before(history, e.slotId, date),
          state.episodesOf(e).map((i) => (state.canAir(i) ? i.id : `${i.id}!`))
        ]);
        return createHash("sha1").update(JSON.stringify(made)).digest("base64url");
      };

      const readRecords = async (ex: Executor) =>
        new Map((await ex.select().from(TD).where(and(eq(TD.stationId, stationId), gte(TD.date, first), lte(TD.date, last)))).map((r) => [r.date, r]));
      /** Whether a date is made (again): its template changed, another took it, or (Phase 3) its walk did. */
      const isDue = (rec: typeof TD.$inferSelect | undefined, d: string, history: History) => {
        const win = winner(templates, d);
        if (rec?.editedAt) return false;
        if (!rec && !win) return false;
        if (rec && win && rec.templateId === win.id && options.force !== win.id && rec.generatedAt >= (win.updatedAt ?? win.createdAt) && (rec.walk ?? null) === walkOf(win, d, history)) return false;
        return true;
      };
      const exceptionsIn = (records: Map<string, typeof TD.$inferSelect>) => {
        let exceptions = 0;
        for (let d = first; d <= last; d = addDays(d, 1)) if (records.get(d)?.editedAt && winner(templates, d)) exceptions++;
        return exceptions;
      };
      // Most runs have nothing to do: look before taking the lock.
      {
        const records = await readRecords(db);
        totals.exceptions = exceptionsIn(records);
        const history = walking.length ? await readHistory(db) : [];
        let any = false;
        for (let d = first; d <= last && !any; d = addDays(d, 1)) any = isDue(records.get(d), d, history);
        if (!any) return totals;
      }

      const itemIds = [...new Set(templateEntries.map((e) => e.assetId).filter((v): v is string => Boolean(v)))];
      // A244: the templates' programming blocks (an archived block is made no more).
      const templateBlocks = templates.length ? await db.select().from(TB).where(inArray(TB.templateId, templates.map((t) => t.id))) : [];
      const [items, pulled, blockRefs] = await Promise.all([services.library.itemsByIds(itemIds), services.trust.offAirItems(itemIds), services.library.blocks.refs(templateBlocks.map((b) => b.blockId))]);
      // Phase 3: titles for the warnings.
      const programs = new Map([...(state?.programs ?? new Map<string, ProgramRef>())]);
      for (const [id, p] of await services.library.programsByIds([...new Set([...items.values()].map((i) => i.programId).filter((v): v is string => Boolean(v) && !programs.has(v!)))])) programs.set(id, p);
      const titleOf = (row: Desired) => {
        const item = row.assetId ? (items.get(row.assetId) ?? state?.episodes.find((e) => e.id === row.assetId)) : undefined;
        const programId = row.programId ?? item?.programId ?? null;
        return (programId ? programs.get(programId)?.title : undefined) ?? item?.title ?? (row.kind === "live" ? "Live" : row.kind === "off_air" ? "Off air" : "Untitled");
      };

      /** A244: a date's spans from its template. */
      function spansFor(t: Group, date: string) {
        return templateBlocks
          .filter((b) => b.templateId === t.id && blockRefs.get(b.blockId) && !blockRefs.get(b.blockId)!.archived)
          .map((b) => {
            const startsAt = templateInstant(date, b.startMinute, tz);
            return { stationId, blockId: b.blockId, startsAt, endsAt: new Date(startsAt.getTime() + snapToSegment(b.lengthMs)), repeatGroupId: t.id, templateDate: date };
          })
          .filter((sp) => sp.startsAt > now);
      }
      const spanKey = (x: { startsAt: Date; endsAt: Date; blockId: string }) => [x.startsAt.getTime(), x.endsAt.getTime(), x.blockId].join("|");

      /**
       * A date's entries from its template: what can air (rights, claims, carriage limits).
       * Programming Phase 3: a walking slot's episodes from where its walk is (`history`), a rerun
       * of an earlier slot's, then the ripple; and the date's warnings.
       */
      async function desiredFor(t: Group, date: string, history: History) {
        const planned: Desired[] = [];
        const notes: TemplateNoteRow[] = [];
        let skipped = 0;
        // What each slot aired this date, for Same as earlier slot; the rows that run past their slot.
        const aired = new Map<string, { airings: ItemRef[][]; fill: boolean }>();
        const longer = new Map<Desired, string>();
        for (const e of templateEntries.filter((x) => x.templateId === t.id).sort(byDayOrder)) {
          const startsAt = templateInstant(date, e.startMinute, tz);
          // On a segment boundary (the template keeps the day's lengths as they were made).
          const endsAt = new Date(startsAt.getTime() + snapToSegment(e.lengthMs));
          if (startsAt <= now) continue;
          const base = {
            stationId,
            kind: e.kind,
            code: asLogCode(e.code),
            liveSourceId: e.liveSourceId,
            carriageAgreementId: e.carriageAgreementId,
            localNote: e.localNote,
            keepTime: e.keepTime,
            repeatGroupId: t.id,
            templateDate: date,
            templateSlotId: e.slotId
          };
          if (e.kind === "program" && e.whatAirs !== "this_episode") {
            let airings: ItemRef[][] = [];
            let fill = e.whatAirs === "fill";
            let stopped = false;
            if (e.whatAirs === "same_as") {
              const source = aired.get(e.sameAsSlotId ?? "");
              airings = source?.airings ?? [];
              fill = source?.fill ?? false;
            } else if (state) {
              const walked = airingsFor(e, before(history, e.slotId, date), state);
              airings = walked.airings.map((a) => a.episodes);
              stopped = walked.stopped;
              aired.set(e.slotId, { airings, fill });
              const ending = walked.airings.find((a) => a.cycle === 0 && a.endsCycle);
              if (ending) notes.push(lastEpisodeNote(e, ending.episodes[0], date, startsAt, programs));
            }
            if (!airings.length) {
              // A slot stopped at its program's end is dead air, as the station chose; otherwise nothing could air.
              if (!stopped) skipped++;
              continue;
            }
            let cursor = startsAt.getTime();
            const rows: Desired[] = [];
            for (const parts of airings) {
              // Fill the slot never runs past its end (a rerun of one fits this slot's length too).
              if (fill && cursor + airingLength(parts) > endsAt.getTime()) break;
              for (const p of parts) {
                rows.push({ ...base, code: asLogCode(p.code), assetId: p.id, programId: p.programId, episodeTitle: null, episodeDescription: null, startsAt: new Date(cursor), endsAt: new Date(cursor + partLength(p)) });
                cursor += partLength(p);
              }
            }
            const lastRow = rows[rows.length - 1];
            if (!fill && lastRow) {
              // Shorter than the slot: the slot's length, with time for breaks and fill, as before.
              // Longer: the ripple pushes what follows.
              if (lastRow.endsAt < endsAt) lastRow.endsAt = endsAt;
              else if (lastRow.endsAt > endsAt) longer.set(lastRow, episodeLabel(airings[0][0], programs));
            }
            if (!rows.length) skipped++;
            planned.push(...rows);
            continue;
          }
          if (e.kind === "program") {
            const item = e.assetId ? items.get(e.assetId) : undefined;
            if (!item || item.archived || !item.rightsConfirmed || item.contentUnavailable || pulled.has(item.id)) {
              skipped++;
              continue;
            }
            if (e.carriageAgreementId) {
              try {
                await services.catalog.checkAiring({ agreementId: e.carriageAgreementId, carrierStationId: stationId, itemId: item.id, startsAt });
              } catch {
                skipped++;
                continue;
              }
            }
          }
          planned.push({ ...base, assetId: e.assetId, programId: e.programId, episodeTitle: e.episodeTitle, episodeDescription: e.episodeDescription, startsAt, endsAt });
        }
        const laid = ripple(planned, (kept, overBy, going) => {
          const pusher = [...longer.keys()].filter((r) => r.startsAt < kept.startsAt).pop();
          const at = clockTime(kept.startsAt, tz);
          notes.push({
            code: "pushes_kept",
            slotId: kept.templateSlotId!,
            startsAt: kept.startsAt.toISOString(),
            message: `${pusher ? longer.get(pusher) : going.length ? titleOf(going[0]) : "An episode"} would push ${titleOf(kept)} ${Math.ceil(overBy / MIN)} min past ${at} on ${dayWords(date)}, where it's kept. What doesn't fit before ${at} isn't placed that day.`
          });
        });
        return { rows: laid.rows, skipped: skipped + laid.dropped, notes };
      }

      const keyOf = (x: { startsAt: Date; endsAt: Date; kind: string; assetId?: string | null; liveSourceId?: string | null; carriageAgreementId?: string | null }) =>
        [x.startsAt.getTime(), x.endsAt.getTime(), x.kind, x.assetId ?? "", x.liveSourceId ?? "", x.carriageAgreementId ?? ""].join("|");

      await db.transaction(async (tx) => {
        // One generation per station at a time (the job and a write can meet).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`day-templates:${stationId}`}))`);
        const records = await readRecords(tx);
        let history = walking.length ? await readHistory(tx) : [];
        // In date order: a walking slot's date counts what the dates before it now have.
        for (let date = first; date <= last; date = addDays(date, 1)) {
          const rec = records.get(date);
          if (!isDue(rec, date, history)) continue;
          const win = winner(templates, date);
          const existing = rec
            ? await tx
                .select()
                .from(E)
                .where(and(eq(E.stationId, stationId), eq(E.repeatGroupId, rec.templateId), eq(E.templateDate, date)))
            : [];
          const walk = win ? walkOf(win, date, history) : null;
          const desired = win ? await desiredFor(win, date, history) : { rows: [], skipped: 0, notes: [] };
          const wanted = new Map(desired.rows.map((r) => [keyOf(r), r]));
          const kept = new Set<string>();
          const stale: EntryRow[] = [];
          for (const row of existing) {
            const key = keyOf(row);
            const want = wanted.get(key);
            if (want && !kept.has(key)) {
              kept.add(key);
              const slotId = want.templateSlotId ?? null;
              if (row.repeatGroupId !== want.repeatGroupId || row.localNote !== want.localNote || row.episodeTitle !== want.episodeTitle || row.episodeDescription !== want.episodeDescription || row.programId !== want.programId || row.keepTime !== want.keepTime || row.templateSlotId !== slotId) {
                await tx
                  .update(E)
                  .set({ repeatGroupId: want.repeatGroupId, localNote: want.localNote, episodeTitle: want.episodeTitle, episodeDescription: want.episodeDescription, programId: want.programId, keepTime: want.keepTime, templateSlotId: slotId })
                  .where(eq(E.id, row.id));
              }
            } else if (row.startsAt > now) {
              stale.push(row);
            }
          }
          totals.removed += await removeRows(tx, stale);
          let placed = kept.size;
          let skipped = desired.skipped;
          for (const [key, row] of wanted) {
            if (kept.has(key)) continue;
            try {
              await tx.transaction(async (sp) => {
                await sp.insert(E).values(row);
              });
              placed++;
              totals.created++;
            } catch {
              // Overlaps something already on the log, or breaks a carriage limit: the log stays.
              skipped++;
            }
          }
          // A244: its programming blocks, the same way: kept, made, or taken off (a span that would
          // overlap one already on the date is skipped there, and counted).
          const existingSpans = rec
            ? await tx
                .select()
                .from(SP)
                .where(and(eq(SP.stationId, stationId), eq(SP.repeatGroupId, rec.templateId), eq(SP.templateDate, date)))
            : [];
          const wantedSpans = new Map((win ? spansFor(win, date) : []).map((sp) => [spanKey(sp), sp]));
          const keptSpans = new Set<string>();
          for (const sp of existingSpans) {
            const key = spanKey(sp);
            const want = wantedSpans.get(key);
            if (want && !keptSpans.has(key)) {
              keptSpans.add(key);
              if (sp.repeatGroupId !== want.repeatGroupId) await tx.update(SP).set({ repeatGroupId: want.repeatGroupId }).where(eq(SP.id, sp.id));
            } else if (sp.startsAt > now) {
              await tx.delete(SP).where(eq(SP.id, sp.id));
            }
          }
          for (const [key, sp] of wantedSpans) {
            if (keptSpans.has(key)) continue;
            try {
              await tx.transaction(async (savepoint) => {
                await savepoint.insert(SP).values(sp);
              });
            } catch {
              skipped++;
            }
          }
          totals.skippedForConflicts += skipped;
          if (win) {
            const notes = desired.notes.length ? desired.notes : null;
            await tx
              .insert(TD)
              .values({ stationId, date, templateId: win.id, generatedAt: now, entries: placed, skipped, walk, notes })
              .onConflictDoUpdate({ target: [TD.stationId, TD.date], set: { templateId: win.id, generatedAt: now, entries: placed, skipped, editedAt: null, walk, notes } });
          } else {
            await tx.delete(TD).where(and(eq(TD.stationId, stationId), eq(TD.date, date)));
          }
          totals.dates++;
          // The dates after it count what this one has now.
          if (walking.length && (rec?.walk || walk)) history = await readHistory(tx);
        }
      });
      return totals;
    },

    async generateAll() {
      const stations = await db
        .selectDistinct({ stationId: G.stationId })
        .from(G)
        .where(and(eq(G.template, true), isNull(G.removedAt)));
      let dates = 0;
      for (const { stationId } of stations) {
        try {
          dates += (await ops.generate(stationId)).dates;
        } catch (error) {
          console.error(`[log] generating ${stationId}'s day templates failed`, error);
        }
      }
      return { stations: stations.length, dates };
    },

    async markEdited(stationId, dates) {
      if (!dates.length) return;
      const tz = dates.some((d) => d instanceof Date) ? await services.stations.timezoneOf(stationId) : "UTC";
      const unique = [...new Set(dates.map((d) => (d instanceof Date ? broadcastDate(d, tz) : d)))];
      await db
        .update(TD)
        .set({ editedAt: deps.clock.now() })
        .where(and(eq(TD.stationId, stationId), inArray(TD.date, unique), isNull(TD.editedAt)));
    },

    async days(stationId, from, to) {
      const tz = await services.stations.timezoneOf(stationId);
      const first = broadcastDate(from, tz);
      const last = broadcastDate(new Date(Math.max(from.getTime(), to.getTime() - 1)), tz);
      const records = await db
        .select({ date: TD.date, editedAt: TD.editedAt, group: G })
        .from(TD)
        .innerJoin(G, eq(G.id, TD.templateId))
        .where(and(eq(TD.stationId, stationId), gte(TD.date, first), lte(TD.date, last)));
      const byDate = new Map(records.map((r) => [r.date, r]));
      const out: LogDay[] = [];
      for (let d = first; d <= last; d = addDays(d, 1)) {
        const r = byDate.get(d);
        out.push(
          r
            ? { date: d, templateId: r.group.id, templateName: r.group.name, label: templateLabel(r.group), edited: Boolean(r.editedAt) }
            : { date: d, templateId: null, templateName: null, label: null, edited: false }
        );
      }
      return out;
    },

    async warnings(stationId, from, to) {
      const tz = await services.stations.timezoneOf(stationId);
      const firstDay = broadcastDate(from, tz);
      const lastDay = broadcastDate(new Date(Math.max(from.getTime(), to.getTime() - 1)), tz);
      // A program's last new episode shows from a week before its date.
      const rows = await db
        .select({ date: TD.date, templateId: TD.templateId, notes: TD.notes })
        .from(TD)
        .where(and(eq(TD.stationId, stationId), gte(TD.date, firstDay), lte(TD.date, addDays(lastDay, 7)), isNotNull(TD.notes)))
        .orderBy(asc(TD.date));
      return rows.flatMap((r) => (r.notes ?? []).filter((n) => n.code === "last_episode" || r.date <= lastDay).map((n) => noteView(n, r.templateId, r.date)));
    },

    async preview(stationId, templateId, entry, count = 4) {
      const t = await group(stationId, templateId);
      if (!t.template || t.removedAt) throw notFound("That template");
      const tz = await services.stations.timezoneOf(stationId);
      const today = broadcastDate(deps.clock.now(), tz);
      const current = await db.select().from(TE).where(eq(TE.templateId, templateId));
      // A rerun previews the slot it repeats.
      const source = entry.whatAirs === "same_as" ? current.find((e) => e.slotId === entry.sameAsSlotId) : undefined;
      if (entry.whatAirs === "same_as" && !source) throw badRequest("Choose an earlier program slot on this template.", { sameAsSlotId: "Not on the template" });
      const [slot] = source ? [source] : await fromInput(stationId, [entry], new Set(current.map((e) => e.slotId)));
      // The template's next dates: those it makes, not edited by hand.
      const others = await db.select().from(G).where(and(eq(G.stationId, stationId), eq(G.template, true), isNull(G.removedAt)));
      const edited = new Set((await db.select({ date: TD.date }).from(TD).where(and(eq(TD.stationId, stationId), gt(TD.date, today), isNotNull(TD.editedAt)))).map((d) => d.date));
      const dates: string[] = [];
      for (let d = addDays(today, 1); d <= addDays(today, MAX_AHEAD_DAYS) && dates.length < count; d = addDays(d, 1)) {
        if (winner(others, d)?.id === templateId && !edited.has(d)) dates.push(d);
      }
      const out: TemplateSlotPreview["dates"] = [];
      if (walks(slot)) {
        const state = await walkState(stationId, [slot]);
        // From where the slot's walk is before the first of them; each date after takes one step more.
        const known = current.some((e) => e.slotId === slot.slotId);
        const position = known && dates.length ? before(await slotHistory(db, stationId, [slot.slotId], tz), slot.slotId, dates[0]) : [];
        for (const date of dates) {
          const { airings } = airingsFor(slot, position, state);
          const episodes = airings.flatMap((a) => a.episodes);
          position.push(...episodes.map((e) => e.id));
          out.push({ date, episodes: episodes.map((e) => ({ itemId: e.id, title: e.title, programId: e.programId, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber })) });
        }
        const days = t.pattern === "weekly" ? { one: WEEKDAYS[t.weekday ?? 0], many: `${WEEKDAYS[t.weekday ?? 0]}s` } : t.pattern === "weekdays" ? { one: "weekday", many: "weekdays" } : t.pattern === "once" ? (t.endsOn ? dayWords(t.endsOn) : "Once") : { one: "day", many: "days" };
        return { dates: out, line: slotPreviewLine(out, days, (id) => (id ? (state.programs.get(id)?.title ?? "") : "")) };
      }
      // This episode: the same item every date.
      const item = slot.assetId ? (await services.library.itemsByIds([slot.assetId])).get(slot.assetId) : undefined;
      for (const date of dates) out.push({ date, episodes: item ? [{ itemId: item.id, title: item.title, programId: item.programId, seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber }] : [] });
      return { dates: out, line: item ? `The same every date: ${item.title}` : "No dates ahead" };
    },

    async slotsOf(slotIds) {
      const ids = [...new Set(slotIds)];
      if (!ids.length) return new Map();
      const rows = await db
        .select({ slotId: TE.slotId, startMinute: TE.startMinute, whatAirs: TE.whatAirs, group: G })
        .from(TE)
        .innerJoin(G, eq(G.id, TE.templateId))
        .where(inArray(TE.slotId, ids));
      return new Map(rows.map((r) => [r.slotId, { slotId: r.slotId, templateId: r.group.id, templateName: r.group.name, label: templateLabel(r.group), startTime: minuteText(r.startMinute), whatAirs: r.whatAirs }]));
    }
  };
  return ops;
}
