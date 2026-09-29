// Day templates (added 2026-09-29): a station builds a day once and repeats it (every day,
// weekdays, a given weekday, or once). The template keeps the day as local wall-clock times; each
// future date it covers gets its log generated from it, three weeks ahead (the minute job keeps
// the horizon rolling). Each generated date is recorded, so generation is idempotent. Editing one
// date's log by hand makes it an exception, never generated again; editing the template makes
// every future date that isn't an exception again. Dates already started are never touched.
//
// G7's "Repeat this day" (`repeatDay`) makes a template too. G7 copies made before templates
// (`repeat_groups.template` false) stay as they were: `removeRepeat` still takes them off.

import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { DayTemplate, DayTemplateEntry, TemplateGeneration } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { addDays, localDate, localDay, roundUpToMinute, tzOffsetMinutes, zonedTime } from "../../lib/time.js";
import { snapToSegment } from "../../lib/segments.js";

const G = schema.repeatGroups;
const TE = schema.dayTemplateEntries;
const TD = schema.dayTemplateDates;
const E = schema.logEntries;
const B = schema.breaks;

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
}

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
    input: { name?: string | null; pattern?: Pattern; weekday?: number; onto?: string; until?: string | null; fromDay?: string; entries?: TemplateEntryInput[] }
  ): Promise<{ template: DayTemplate; generated: TemplateGeneration }>;
  /** Takes a repeat (template or G7 copy) off the log from now on. */
  remove(stationId: string, groupId: string): Promise<number>;
  /** Generates the dates a station's templates cover, through the horizon (or `through`). Idempotent. */
  generate(stationId: string, options?: { through?: string; force?: string }): Promise<TemplateGeneration>;
  /** Every station with templates, for the job. */
  generateAll(): Promise<{ stations: number; dates: number }>;
  /** Hand edits: these local dates become exceptions (if a template made them). */
  markEdited(stationId: string, dates: string[]): Promise<void>;
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

export function createTemplateOps({ deps, services }: ModuleContext): TemplateOps {
  const { db } = deps;

  async function group(stationId: string, id: string): Promise<Group> {
    const [row] = await db.select().from(G).where(and(eq(G.id, id), eq(G.stationId, stationId)));
    if (!row) throw notFound("That repeat");
    return row;
  }

  /** A day's log as template entries. */
  async function snapshot(stationId: string, day: string, tz: string) {
    const { from, to } = localDay(day, tz);
    const rows = await db
      .select()
      .from(E)
      .where(and(eq(E.stationId, stationId), gte(E.startsAt, from), lt(E.startsAt, to)))
      .orderBy(asc(E.startsAt));
    return rows.map((r) => ({
      startMinute: localMinute(r.startsAt, tz),
      lengthMs: r.endsAt.getTime() - r.startsAt.getTime(),
      kind: r.kind,
      code: r.code,
      assetId: r.assetId,
      programId: r.programId,
      carriageAgreementId: r.carriageAgreementId,
      liveSourceId: r.liveSourceId,
      localNote: r.localNote,
      episodeTitle: r.episodeTitle,
      episodeDescription: r.episodeDescription
    }));
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
        episodeDescription: x.episodeDescription ?? null
      });
    }
    out.sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < out.length; i++) {
      if (out[i - 1].startMinute * MIN + out[i - 1].lengthMs > out[i].startMinute * MIN) throw badRequest("Two entries overlap.", { entries: "Overlap" });
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
    const tomorrow = addDays(localDate(deps.clock.now(), tz), 1);
    const ids = groups.map((g) => g.id);
    const [entries, dates] = await Promise.all([
      db.select().from(TE).where(inArray(TE.templateId, ids)).orderBy(asc(TE.startMinute)),
      db.select().from(TD).where(and(inArray(TD.templateId, ids), gte(TD.date, tomorrow))).orderBy(asc(TD.date))
    ]);
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
        .map(
          (e): DayTemplateEntry => ({
            id: e.id,
            startTime: minuteText(e.startMinute),
            lengthMs: e.lengthMs,
            kind: e.kind,
            code: e.code,
            title: title(e),
            itemId: e.assetId,
            programId: e.programId ?? (e.assetId ? (items.get(e.assetId)?.programId ?? null) : null),
            liveSourceId: e.liveSourceId,
            carriageAgreementId: e.carriageAgreementId,
            episodeTitle: e.episodeTitle,
            episodeDescription: e.episodeDescription,
            localNote: e.localNote
          })
        ),
      dates: dates.filter((d) => d.templateId === g.id).map((d) => ({ date: d.date, edited: Boolean(d.editedAt), entries: d.entries, skipped: d.skipped })),
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt?.toISOString() ?? null
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
      const today = localDate(now, tz);
      checkPattern({ ...input, fromDay: input.fromDay }, today);
      const entries = await snapshot(stationId, input.fromDay, tz);
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
      const today = localDate(now, tz);
      const pattern = input.pattern ?? current.pattern;
      const onto = pattern === "once" ? (input.onto ?? (current.pattern === "once" ? current.endsOn : null)) : null;
      const until = pattern === "once" ? onto : input.until !== undefined ? input.until : current.pattern === "once" ? null : current.endsOn;
      if (input.pattern || input.onto || input.until !== undefined) checkPattern({ pattern, onto, until, fromDay: current.startsOn }, today);
      const entries = input.entries ? await fromInput(stationId, input.entries) : input.fromDay ? await snapshot(stationId, input.fromDay, tz) : null;
      const [row] = await db.transaction(async (tx) => {
        if (entries) {
          await tx.delete(TE).where(eq(TE.templateId, templateId));
          if (entries.length) await tx.insert(TE).values(entries.map((e) => ({ ...e, templateId })));
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
      const upcoming = await db
        .select()
        .from(E)
        .where(and(eq(E.repeatGroupId, groupId), gt(E.startsAt, now)));
      const removed = await removeRows(db, upcoming);
      if (row.template) {
        const tz = await services.stations.timezoneOf(stationId);
        await db.delete(TD).where(and(eq(TD.templateId, groupId), gt(TD.date, localDate(now, tz))));
        // Another template may cover those dates now ("Every day" on the Saturdays "Every Saturday" had).
        await ops.generate(stationId);
      }
      return removed;
    },

    async generate(stationId, options = {}) {
      const totals: TemplateGeneration = { dates: 0, created: 0, removed: 0, skippedForConflicts: 0, exceptions: 0 };
      const tz = await services.stations.timezoneOf(stationId);
      const now = deps.clock.now();
      const today = localDate(now, tz);
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
      const [items, pulled] = await Promise.all([services.library.itemsByIds(itemIds), services.trust.offAirItems(itemIds)]);

      /** A date's entries from its template: what can air (rights, claims, carriage limits). */
      async function desiredFor(t: Group, date: string) {
        const rows: Array<typeof E.$inferInsert & { startsAt: Date; endsAt: Date }> = [];
        let skipped = 0;
        for (const e of templateEntries.filter((x) => x.templateId === t.id)) {
          const startsAt = zonedTime(date, minuteText(e.startMinute), tz);
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
            code: e.code,
            assetId: e.assetId,
            programId: e.programId,
            liveSourceId: e.liveSourceId,
            carriageAgreementId: e.carriageAgreementId,
            localNote: e.localNote,
            episodeTitle: e.episodeTitle,
            episodeDescription: e.episodeDescription,
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
              if (row.repeatGroupId !== want.repeatGroupId || row.localNote !== want.localNote || row.episodeTitle !== want.episodeTitle || row.episodeDescription !== want.episodeDescription || row.programId !== want.programId) {
                await tx
                  .update(E)
                  .set({ repeatGroupId: want.repeatGroupId, localNote: want.localNote, episodeTitle: want.episodeTitle, episodeDescription: want.episodeDescription, programId: want.programId })
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
      const unique = [...new Set(dates)];
      if (!unique.length) return;
      await db
        .update(TD)
        .set({ editedAt: deps.clock.now() })
        .where(and(eq(TD.stationId, stationId), inArray(TD.date, unique), isNull(TD.editedAt)));
    }
  };
  return ops;
}
