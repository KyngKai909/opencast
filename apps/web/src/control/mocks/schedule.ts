// The log's standing schedule, on the shared db: off air hours (G9) and day templates (G8), as the
// API runs them (apps/api log/offair.ts, log/templates.ts). The log handlers read off air from
// here (so gaps leave it out and nothing warns about it) and call `generate` for the dates a log
// window covers; the template handlers (handlers/templates.ts) write through it.

import { templateBlocksOf } from "./blocks";
import type { DayTemplate, LogDay, OffAirHours, OffAirSpan, RepeatPattern, TemplateGeneration } from "@opencast/contracts";
import { now, STATION_TZ } from "../../lib/clock";
import { addDays, broadcastDay, isoDate, localTime, weekdayOf } from "../components/onair/time";
import { getDb, stationLog } from "./db";
import type { DbLogEntry } from "./fixtures/evening";
import { offAirSpans, ruleLabel } from "./fixtures/offair";
import { onAirState } from "./fixtures/onair";
import { entryOn, HORIZON_DAYS, MAX_AHEAD_DAYS, templateLabel, toTemplateEntry, winner, ymd, type DbTemplate, type DbTemplateDate } from "./fixtures/templates";

const DAY = 86_400_000;
const uuid = () => crypto.randomUUID();
const iso = (t: number) => new Date(t).toISOString();

// ---- off air hours ----

export function offAirRulesOf(stationId: string) {
  return getDb().offAirRules.filter((r) => r.stationId === stationId);
}

/** Planned off air overlapping `[from, to)`: the hours less what's on the log, and sign-offs. */
export function offAirFor(stationId: string, from: string, to: string): OffAirSpan[] {
  const rules = offAirRulesOf(stationId);
  const entries = stationLog(stationId, iso(Date.parse(from) - 2 * DAY), iso(Date.parse(to) + 3 * DAY));
  if (!rules.length && !entries.some((e) => e.kind === "off_air")) return [];
  return offAirSpans(entries, rules, from, to);
}

/** The off air on now, or the next, within `withinMs`. */
export function offAirNext(stationId: string, withinMs: number): OffAirSpan | null {
  const t = now().getTime();
  return offAirFor(stationId, iso(t), iso(t + withinMs)).find((s) => Date.parse(s.endsAt) > t) ?? null;
}

export function offAirHoursOf(stationId: string): OffAirHours {
  return {
    timezone: STATION_TZ,
    rules: offAirRulesOf(stationId).map((r) => ({ id: r.id, days: [...r.days].sort(), signOffAt: r.signOffAt, backAt: r.backAt, label: ruleLabel(r) })),
    next: offAirNext(stationId, 8 * DAY)
  };
}

// ---- the log ----

/** Takes an entry off the log, with any break the log placed after it. */
export function removeWithBreaks(entryId: string) {
  const db = getDb();
  const s = onAirState();
  const breakIds = new Set(s.placedBreaks.filter((p) => p.entryId === entryId).map((p) => p.breakId));
  db.log = db.log.filter((e) => e.id !== entryId);
  db.breaks = db.breaks.filter((b) => !breakIds.has(b.id));
  s.placedBreaks = s.placedBreaks.filter((p) => p.entryId !== entryId);
}

// ---- day templates ----

const today = () => broadcastDay(now());
const dayOf = (t: string) => isoDate(broadcastDay(t));

/** The templates still repeating. */
export function templatesOf(stationId: string): DbTemplate[] {
  return getDb().templates.filter((t) => t.stationId === stationId && !t.stoppedAt);
}

/** With the stopped ones, which keep their edited and past dates. */
function allTemplatesOf(stationId: string): DbTemplate[] {
  return getDb().templates.filter((t) => t.stationId === stationId);
}

export function templateById(stationId: string, id: string): DbTemplate | undefined {
  return templatesOf(stationId).find((t) => t.id === id);
}

/** A template as the contract has it: the dates from tomorrow on. */
export function templateView(t: DbTemplate): DayTemplate {
  const tomorrow = isoDate(addDays(today(), 1));
  return {
    id: t.id,
    name: t.name,
    pattern: t.pattern,
    weekday: t.pattern === "weekly" ? t.weekday : null,
    label: templateLabel(t),
    fromDay: t.fromDay,
    onDate: t.pattern === "once" ? t.onDate : null,
    until: t.until,
    timezone: STATION_TZ,
    entries: t.entries.map(({ carriedFrom: _c, ...e }) => e),
    dates: t.dates
      .filter((d) => d.date >= tomorrow)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ date, edited, entries, skipped }) => ({ date, edited, entries, skipped })),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    // A244: its programming blocks.
    ...(() => {
      const blocks = templateBlocksOf(t.id);
      return blocks.length ? { blocks } : {};
    })()
  };
}

/** A broadcast day's log as template entries. */
function snapshot(stationId: string, day: string) {
  const d = ymd(day);
  const from = localTime(d, 6);
  const to = localTime(d, 30);
  return stationLog(stationId, from, to)
    .filter((e) => e.startsAt >= from && e.startsAt < to)
    .map((e) => toTemplateEntry(e, uuid()));
}

function entriesOn(templateId: string, date: string): DbLogEntry[] {
  return getDb().log.filter((e) => e.repeatGroupId === templateId && dayOf(e.startsAt) === date);
}

const keyOf = (e: Pick<DbLogEntry, "startsAt" | "endsAt" | "kind" | "itemId" | "liveSourceId" | "carriageAgreementId">) =>
  [e.startsAt, e.endsAt, e.kind, e.itemId ?? "", e.liveSourceId ?? "", e.carriageAgreementId ?? ""].join("|");

/** What a template puts on a date: its entries still ahead. */
function desiredFor(t: DbTemplate, date: string): DbLogEntry[] {
  const t0 = now().toISOString();
  return t.entries.map((te) => entryOn(te, date, t.stationId, t.id, uuid())).filter((e) => e.startsAt > t0);
}

function overlapsLog(stationId: string, startsAt: string, endsAt: string) {
  return stationLog(stationId).some((e) => e.startsAt < endsAt && startsAt < e.endsAt);
}

/** Puts entries on the log where nothing else is; the rest are skipped. */
function place(stationId: string, rows: DbLogEntry[]): { placed: number; skipped: number } {
  let placed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (overlapsLog(stationId, row.startsAt, row.endsAt)) skipped++;
    else {
      getDb().log.push(row);
      placed++;
    }
  }
  return { placed, skipped };
}

/** The seed's dates are made when first needed (see fixtures/templates.ts), without counting. */
function makeSeeded(stationId: string, dates?: Set<string>) {
  for (const t of templatesOf(stationId)) {
    for (const rec of t.dates) {
      if (rec.made || (dates && !dates.has(rec.date))) continue;
      const r = place(stationId, desiredFor(t, rec.date));
      Object.assign(rec, { entries: r.placed, skipped: r.skipped, made: true });
    }
  }
}

function recordOf(stationId: string, date: string): { t: DbTemplate; rec: DbTemplateDate } | null {
  for (const t of allTemplatesOf(stationId)) {
    const rec = t.dates.find((d) => d.date === date);
    if (rec) return { t, rec };
  }
  return null;
}

/**
 * Makes the dates a station's templates cover, from tomorrow through the horizon (or `through`,
 * or just `dates`): each date from its winning template, keeping entries that are the same.
 * Edited dates are left as they are. `force` makes a template's own dates again.
 */
export function generate(stationId: string, opts: { dates?: string[]; through?: string; force?: string } = {}): TemplateGeneration {
  makeSeeded(stationId, opts.dates ? new Set(opts.dates) : undefined);
  const totals: TemplateGeneration = { dates: 0, created: 0, removed: 0, skippedForConflicts: 0, exceptions: 0 };
  const first = isoDate(addDays(today(), 1));
  const cap = isoDate(addDays(today(), MAX_AHEAD_DAYS));
  let dates: string[];
  if (opts.dates) dates = opts.dates.filter((d) => d >= first && d <= cap);
  else {
    let last = isoDate(addDays(today(), HORIZON_DAYS));
    if (opts.through && opts.through > last) last = opts.through < cap ? opts.through : cap;
    dates = [];
    for (let d = addDays(today(), 1); isoDate(d) <= last; d = addDays(d, 1)) dates.push(isoDate(d));
  }
  const templates = templatesOf(stationId);
  const t0 = now().toISOString();
  for (const date of dates) {
    const had = recordOf(stationId, date);
    const win = winner(templates, date);
    if (had?.rec.edited) {
      if (win) totals.exceptions++;
      continue;
    }
    if (!had && !win) continue;
    if (had && win && had.t === win && opts.force !== win.id) continue;
    const existing = had ? entriesOn(had.t.id, date) : [];
    const desired = win ? desiredFor(win, date) : [];
    const wanted = new Map(desired.map((r) => [keyOf(r), r]));
    const kept = new Set<string>();
    for (const row of existing) {
      const key = keyOf(row);
      const want = wanted.get(key);
      if (want && !kept.has(key)) {
        kept.add(key);
        Object.assign(row, { repeatGroupId: want.repeatGroupId, localNote: want.localNote, episodeTitle: want.episodeTitle, episodeDescription: want.episodeDescription, programId: want.programId });
      } else if (row.startsAt > t0) {
        removeWithBreaks(row.id);
        totals.removed++;
      }
    }
    const r = place(stationId, desired.filter((row) => !kept.has(keyOf(row))));
    totals.created += r.placed;
    totals.skippedForConflicts += r.skipped;
    if (had) had.t.dates = had.t.dates.filter((d) => d !== had.rec);
    if (win) win.dates.push({ date, edited: false, entries: kept.size + r.placed, skipped: r.skipped, made: true });
    totals.dates++;
  }
  return totals;
}

/** The broadcast days a window covers, from tomorrow on: the log makes them before it's read. */
export function generateWindow(stationId: string, from: string, to: string) {
  if (!templatesOf(stationId).length) return;
  const dates: string[] = [];
  for (let d = broadcastDay(from); isoDate(d) <= dayOf(iso(Date.parse(to) - 1)); d = addDays(d, 1)) dates.push(isoDate(d));
  generate(stationId, { dates });
}

/**
 * G11: each broadcast day `[from, to)` touches and the template that made it, today and past days
 * too. The seed's past weekdays have no record: their entries say which template made them.
 */
export function logDays(stationId: string, from: string, to: string): LogDay[] {
  const out: LogDay[] = [];
  const last = dayOf(iso(Math.max(Date.parse(from), Date.parse(to) - 1)));
  for (let d = broadcastDay(from); isoDate(d) <= last; d = addDays(d, 1)) {
    const date = isoDate(d);
    const had = recordOf(stationId, date);
    const t = had?.t ?? allTemplatesOf(stationId).find((x) => getDb().log.some((e) => e.stationId === stationId && e.repeatGroupId === x.id && dayOf(e.startsAt) === date));
    out.push(t ? { date, templateId: t.id, templateName: t.name, label: templateLabel(t), edited: had?.rec.edited ?? false } : { date, templateId: null, templateName: null, label: null, edited: false });
  }
  return out;
}

/** A date changed by hand is an exception: a template never makes it again. */
export function markEdited(stationId: string, times: string[]) {
  const tomorrow = isoDate(addDays(today(), 1));
  for (const date of new Set(times.map(dayOf))) {
    if (date < tomorrow) continue;
    const had = recordOf(stationId, date);
    if (!had) continue;
    if (!had.rec.made) makeSeeded(stationId, new Set([date]));
    had.rec.edited = true;
  }
}

export class TemplateInputError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string>
  ) {
    super(message);
  }
}

function checkPattern(input: { pattern: RepeatPattern; onto?: string | null; until?: string | null; fromDay: string }) {
  const t = isoDate(today());
  if (input.pattern === "once") {
    if (!input.onto) throw new TemplateInputError("Choose the day to copy to.", { onto: "Required" });
    if (input.onto <= t) throw new TemplateInputError("Choose a day from tomorrow on.", { onto: "Tomorrow or later" });
    if (input.onto > isoDate(addDays(today(), MAX_AHEAD_DAYS))) throw new TemplateInputError(`Choose a day within ${MAX_AHEAD_DAYS} days.`, { onto: "Too far ahead" });
  } else if (input.until && input.until <= input.fromDay) {
    throw new TemplateInputError("It has to repeat after the day it's built from.", { until: "Before the day" });
  }
}

export interface TemplateInput {
  fromDay: string;
  pattern: RepeatPattern;
  weekday?: number;
  onto?: string;
  until?: string | null;
  name?: string;
}

export function createTemplate(stationId: string, input: TemplateInput): { template: DbTemplate; generated: TemplateGeneration } {
  checkPattern(input);
  const t: DbTemplate = {
    id: uuid(),
    stationId,
    name: input.name ?? null,
    pattern: input.pattern,
    weekday: input.pattern === "weekly" ? (input.weekday ?? weekdayOf(ymd(input.fromDay))) : null,
    fromDay: input.fromDay,
    onDate: input.pattern === "once" ? input.onto! : null,
    until: input.pattern === "once" ? input.onto! : (input.until ?? null),
    entries: snapshot(stationId, input.fromDay),
    dates: [],
    createdAt: now().toISOString(),
    updatedAt: now().toISOString()
  };
  getDb().templates.push(t);
  const generated = generate(stationId, { through: input.pattern === "once" ? input.onto : undefined });
  return { template: t, generated };
}

export interface TemplatePatch {
  name?: string | null;
  pattern?: RepeatPattern;
  weekday?: number;
  onto?: string;
  until?: string | null;
  fromDay?: string;
}

export function updateTemplate(t: DbTemplate, input: TemplatePatch): TemplateGeneration {
  const pattern = input.pattern ?? t.pattern;
  const onto = pattern === "once" ? (input.onto ?? (t.pattern === "once" ? t.onDate : null)) : null;
  const until = pattern === "once" ? onto : input.until !== undefined ? input.until : t.pattern === "once" ? null : t.until;
  if (input.pattern || input.onto || input.until !== undefined) checkPattern({ pattern, onto, until, fromDay: t.fromDay });
  if (input.fromDay) t.entries = snapshot(t.stationId, input.fromDay);
  Object.assign(t, {
    pattern,
    weekday: pattern === "weekly" ? (input.weekday ?? t.weekday ?? weekdayOf(ymd(t.fromDay))) : null,
    onDate: onto,
    until,
    updatedAt: now().toISOString(),
    ...(input.name !== undefined ? { name: input.name } : {})
  });
  return generate(t.stationId, { force: t.id, through: pattern === "once" ? (onto ?? undefined) : undefined });
}

/**
 * Stops a template: its entries come off the dates ahead that weren't edited, and another may take
 * those dates. An edited date keeps its entries as they are and stays an exception (A132: "Future
 * dates that weren't edited will be cleared").
 */
export function removeTemplate(t: DbTemplate): number {
  const t0 = now().toISOString();
  const tomorrow = isoDate(addDays(today(), 1));
  const edited = new Set(t.dates.filter((d) => d.edited).map((d) => d.date));
  // A seeded edited date not on the log yet is made first, so it stays as it was.
  makeSeeded(t.stationId, edited);
  const gone = getDb().log.filter((e) => e.repeatGroupId === t.id && e.startsAt > t0 && !edited.has(dayOf(e.startsAt)));
  for (const e of gone) removeWithBreaks(e.id);
  t.stoppedAt = t0;
  t.dates = t.dates.filter((d) => d.date < tomorrow || d.edited);
  generate(t.stationId);
  return gone.length;
}
