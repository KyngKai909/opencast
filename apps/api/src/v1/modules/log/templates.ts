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

import { asLogCode, isIdentCode } from "@opencast/contracts";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { DayTemplate, DayTemplateEntry, LogDay, TemplateGeneration } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, HttpError, notFound, refused } from "../../errors.js";
import { addDays, localDate, roundUpToMinute, tzOffsetMinutes, zonedTime } from "../../lib/time.js";
import { snapToSegment } from "../../lib/segments.js";

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

  /** A broadcast day's log as template entries (at their wall-clock minutes). */
  async function snapshot(stationId: string, day: string, tz: string) {
    const { from, to } = broadcastDay(day, tz);
    const rows = await db
      .select()
      .from(E)
      .where(and(eq(E.stationId, stationId), gte(E.startsAt, from), lt(E.startsAt, to)))
      .orderBy(asc(E.startsAt));
    return rows.map((r) => ({
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
      keepTime: r.keepTime
    }));
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

  /** Entries sent for a template, checked as the log checks them (times are checked per date). */
  async function fromInput(stationId: string, list: TemplateEntryInput[]) {
    const items = await services.library.itemsByIds(list.map((x) => x.itemId).filter((v): v is string => Boolean(v)));
    const out = [];
    for (const [i, x] of list.entries()) {
      const [hh, mm] = x.startTime.split(":").map(Number);
      const startMinute = hh * 60 + mm;
      let lengthMs = x.lengthMs ?? null;
      let code: EntryRow["code"] = "PGM";
      let programId = x.programId ?? null;
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
        keepTime: x.keepTime ?? false
      });
    }
    // In the broadcast day's order: "23:00" comes before "01:00".
    out.sort(byDayOrder);
    for (let i = 1; i < out.length; i++) {
      if (dayOrder(out[i - 1].startMinute) * MIN + out[i - 1].lengthMs > dayOrder(out[i].startMinute) * MIN) throw badRequest("Two entries overlap.", { entries: "Overlap" });
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
    const programIds = entries.map((e) => e.programId ?? (e.assetId ? items.get(e.assetId)?.programId : null)).filter((v): v is string => Boolean(v));
    const programs = await services.library.programsByIds([...new Set(programIds)]);
    const title = (e: TemplateRow) => {
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
            keepTime: e.keepTime
          })
        ),
      dates: dates.filter((d) => d.templateId === g.id).map((d) => ({ date: d.date, edited: Boolean(d.editedAt), entries: d.entries, skipped: d.skipped })),
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
      const [entries, blocks] = await Promise.all([snapshot(stationId, input.fromDay, tz), snapshotBlocks(stationId, input.fromDay, tz)]);
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
        if (entries.length) await tx.insert(TE).values(entries.map((e) => ({ ...e, templateId: inserted[0].id })));
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
      const entries = input.entries ? await fromInput(stationId, input.entries) : input.fromDay ? await snapshot(stationId, input.fromDay, tz) : null;
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
      const readRecords = async (ex: Executor) =>
        new Map((await ex.select().from(TD).where(and(eq(TD.stationId, stationId), gte(TD.date, first), lte(TD.date, last)))).map((r) => [r.date, r]));
      const due = (records: Map<string, typeof TD.$inferSelect>) => {
        const dates: string[] = [];
        let exceptions = 0;
        for (let d = first; d <= last; d = addDays(d, 1)) {
          const rec = records.get(d);
          const win = winner(templates, d);
          if (rec?.editedAt) {
            if (win) exceptions++;
            continue;
          }
          if (!rec && !win) continue;
          if (rec && win && rec.templateId === win.id && options.force !== win.id && rec.generatedAt >= (win.updatedAt ?? win.createdAt)) continue;
          dates.push(d);
        }
        return { dates, exceptions };
      };
      // Most runs have nothing to do: look before taking the lock.
      const before = due(await readRecords(db));
      totals.exceptions = before.exceptions;
      if (!before.dates.length) return totals;

      const templateEntries = templates.length
        ? await db
            .select()
            .from(TE)
            .where(inArray(TE.templateId, templates.map((t) => t.id)))
            .orderBy(asc(TE.startMinute))
        : [];
      const itemIds = [...new Set(templateEntries.map((e) => e.assetId).filter((v): v is string => Boolean(v)))];
      // A244: the templates' programming blocks (an archived block is made no more).
      const templateBlocks = templates.length ? await db.select().from(TB).where(inArray(TB.templateId, templates.map((t) => t.id))) : [];
      const [items, pulled, blockRefs] = await Promise.all([services.library.itemsByIds(itemIds), services.trust.offAirItems(itemIds), services.library.blocks.refs(templateBlocks.map((b) => b.blockId))]);

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

      /** A date's entries from its template: what can air (rights, claims, carriage limits). */
      async function desiredFor(t: Group, date: string) {
        const rows: Array<typeof E.$inferInsert & { startsAt: Date; endsAt: Date }> = [];
        let skipped = 0;
        for (const e of templateEntries.filter((x) => x.templateId === t.id)) {
          const startsAt = templateInstant(date, e.startMinute, tz);
          // On a segment boundary (the template keeps the day's lengths as they were made).
          const endsAt = new Date(startsAt.getTime() + snapToSegment(e.lengthMs));
          if (startsAt <= now) continue;
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
          rows.push({
            stationId,
            startsAt,
            endsAt,
            kind: e.kind,
            code: asLogCode(e.code),
            assetId: e.assetId,
            programId: e.programId,
            liveSourceId: e.liveSourceId,
            carriageAgreementId: e.carriageAgreementId,
            localNote: e.localNote,
            episodeTitle: e.episodeTitle,
            episodeDescription: e.episodeDescription,
            keepTime: e.keepTime,
            repeatGroupId: t.id,
            templateDate: date
          });
        }
        return { rows, skipped };
      }

      const keyOf = (x: { startsAt: Date; endsAt: Date; kind: string; assetId?: string | null; liveSourceId?: string | null; carriageAgreementId?: string | null }) =>
        [x.startsAt.getTime(), x.endsAt.getTime(), x.kind, x.assetId ?? "", x.liveSourceId ?? "", x.carriageAgreementId ?? ""].join("|");

      await db.transaction(async (tx) => {
        // One generation per station at a time (the job and a write can meet).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`day-templates:${stationId}`}))`);
        const records = await readRecords(tx);
        for (const date of due(records).dates) {
          const rec = records.get(date);
          const win = winner(templates, date);
          const existing = rec
            ? await tx
                .select()
                .from(E)
                .where(and(eq(E.stationId, stationId), eq(E.repeatGroupId, rec.templateId), eq(E.templateDate, date)))
            : [];
          const desired = win ? await desiredFor(win, date) : { rows: [], skipped: 0 };
          const wanted = new Map(desired.rows.map((r) => [keyOf(r), r]));
          const kept = new Set<string>();
          const stale: EntryRow[] = [];
          for (const row of existing) {
            const key = keyOf(row);
            const want = wanted.get(key);
            if (want && !kept.has(key)) {
              kept.add(key);
              if (row.repeatGroupId !== want.repeatGroupId || row.localNote !== want.localNote || row.episodeTitle !== want.episodeTitle || row.episodeDescription !== want.episodeDescription || row.programId !== want.programId || row.keepTime !== want.keepTime) {
                await tx
                  .update(E)
                  .set({ repeatGroupId: want.repeatGroupId, localNote: want.localNote, episodeTitle: want.episodeTitle, episodeDescription: want.episodeDescription, programId: want.programId, keepTime: want.keepTime })
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
            await tx
              .insert(TD)
              .values({ stationId, date, templateId: win.id, generatedAt: now, entries: placed, skipped })
              .onConflictDoUpdate({ target: [TD.stationId, TD.date], set: { templateId: win.id, generatedAt: now, entries: placed, skipped, editedAt: null } });
          } else {
            await tx.delete(TD).where(and(eq(TD.stationId, stationId), eq(TD.date, date)));
          }
          totals.dates++;
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
    }
  };
  return ops;
}
