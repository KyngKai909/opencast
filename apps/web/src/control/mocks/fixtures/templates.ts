// Day templates (G8): "Repeat this day" as a template, as the API keeps them (apps/api
// log/templates.ts). A template is a day's log as wall-clock times; each date it covers from
// tomorrow on is made from it, until someone edits that date by hand (an exception). Where two
// templates cover a date the more specific wins: once, a weekday, weekdays, every day.
//
// BEAT's (illustrations, for the frames' "Every Saturday"): tonight's Saturday repeats every
// Saturday, and "After work", two programs from Monday's late evening, repeats on weekdays.
// Next Saturday skips Saturday Reel and Beat Tape Live, which the week's log (fixtures/live.ts)
// already has at 8:30 and 9:00 pm; next Wednesday was edited by hand (Crate Talk went on at
// 7:00 pm), so it's an exception. The mock's days are broadcast days (6:00 am to 6:00 am), as
// the log draws them.
//
// Dates the seed says were made are made on the log when a log window first covers them (the
// API's `getLog` does the same for dates in its window), so the evening the other areas read
// stays as the frames draw it until someone looks ahead.

import type { DayTemplateEntry, LibraryItem, RepeatPattern, StationIdent } from "@opencast/contracts";
import { addDays, broadcastDay, isoDate, localParts, localTime, weekdayOf, type Ymd } from "../../components/onair/time";
import type { DbLogEntry } from "./evening";
import { BEAT, uid } from "./stations";
import { at } from "./time";

/** A template's entry, with what the mock needs to make it again (a carried program's maker). */
export type DbTemplateEntry = DayTemplateEntry & { carriedFrom?: StationIdent | null };

export interface DbTemplateDate {
  date: string;
  edited: boolean;
  entries: number;
  skipped: number;
  /** On the log yet: seeded dates are made when a log window first covers them. */
  made: boolean;
}

export interface DbTemplate {
  id: string;
  stationId: string;
  name: string | null;
  pattern: RepeatPattern;
  weekday: number | null;
  fromDay: string;
  onDate: string | null;
  until: string | null;
  entries: DbTemplateEntry[];
  dates: DbTemplateDate[];
  createdAt: string;
  updatedAt: string | null;
}

/** How far ahead dates are made, and the furthest "Once" can go. */
export const HORIZON_DAYS = 21;
export const MAX_AHEAD_DAYS = 120;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const RANK: Record<RepeatPattern, number> = { once: 3, weekly: 2, weekdays: 1, daily: 0 };

export function ymd(date: string): Ymd {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/** "Every Saturday", "Weekdays", "Every day", "Once, Sat Oct 10". */
export function templateLabel(t: Pick<DbTemplate, "pattern" | "weekday" | "onDate">): string {
  if (t.pattern === "once") {
    const day = t.onDate ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${t.onDate}T12:00:00Z`)).replace(",", "") : "";
    return `Once${day ? `, ${day}` : ""}`;
  }
  if (t.pattern === "weekly") return `Every ${WEEKDAYS[t.weekday ?? 0]}`;
  if (t.pattern === "weekdays") return "Weekdays";
  return "Every day";
}

/** Whether a template covers a date (the day it's built from is the station's own). */
export function covers(t: Pick<DbTemplate, "pattern" | "fromDay" | "onDate" | "until" | "weekday">, date: string): boolean {
  if (t.pattern === "once") return date === t.onDate;
  if (date <= t.fromDay) return false;
  if (t.until && date > t.until) return false;
  const wd = weekdayOf(ymd(date));
  if (t.pattern === "weekdays") return wd >= 1 && wd <= 5;
  if (t.pattern === "weekly") return wd === t.weekday;
  return true;
}

/** The template that makes a date: the most specific that covers it, the newest among equals. */
export function winner<T extends Pick<DbTemplate, "pattern" | "fromDay" | "onDate" | "until" | "weekday" | "createdAt">>(templates: T[], date: string): T | null {
  return [...templates].filter((t) => covers(t, date)).sort((a, b) => RANK[b.pattern] - RANK[a.pattern] || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A log entry as a template entry, at its wall-clock time. */
export function toTemplateEntry(e: DbLogEntry, id: string): DbTemplateEntry {
  const p = localParts(e.startsAt);
  return {
    id,
    startTime: `${pad(p.hour)}:${pad(p.minute)}`,
    lengthMs: Date.parse(e.endsAt) - Date.parse(e.startsAt),
    kind: e.kind,
    code: e.code,
    title: e.kind === "off_air" ? "Off air" : e.title,
    itemId: e.itemId,
    programId: e.programId,
    liveSourceId: e.liveSourceId,
    carriageAgreementId: e.carriageAgreementId,
    episodeTitle: e.episodeTitle,
    episodeDescription: e.episodeDescription ?? null,
    localNote: e.localNote,
    carriedFrom: e.carriedFrom
  };
}

/** Where a template entry falls on a broadcast day: before 6:00 am is after midnight. */
export function placeOn(te: Pick<DayTemplateEntry, "startTime" | "lengthMs">, date: string): { startsAt: string; endsAt: string } {
  const [h, m] = te.startTime.split(":").map(Number);
  const startsAt = localTime(ymd(date), h < 6 ? h + 24 : h, m);
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + te.lengthMs).toISOString() };
}

/** A template entry as a log entry on a date. */
export function entryOn(te: DbTemplateEntry, date: string, stationId: string, templateId: string, id: string): DbLogEntry {
  return {
    id,
    stationId,
    kind: te.kind,
    code: te.code,
    title: te.title,
    episodeTitle: te.episodeTitle,
    episodeDescription: te.episodeDescription,
    itemId: te.itemId,
    programId: te.programId,
    liveSourceId: te.liveSourceId,
    carriedFrom: te.carriedFrom ?? null,
    carriageAgreementId: te.carriageAgreementId,
    repeatGroupId: templateId,
    localNote: te.localNote,
    ...placeOn(te, date)
  };
}

export const TEMPLATE_IDS = { saturdays: uid(447001), weekdays: uid(447002) };

/**
 * BEAT's templates, from the seeded log: every Saturday (from tonight) and weekdays ("After
 * work", from Monday). Returns the templates, and Monday's log with the weekdays already made
 * this week (the past, which the log keeps).
 */
export function seedTemplates(log: DbLogEntry[], items: LibraryItem[]): { templates: DbTemplate[]; log: DbLogEntry[] } {
  const today = broadcastDay(at("12:00"));
  const todayIso = isoDate(today);
  let n = 0;
  const entryId = () => uid(448000 + ++n);
  let e = 0;
  const logId = () => uid(449000 + ++e);

  // Every Saturday: tonight's log, as it is.
  const tonight = log.filter((x) => x.stationId === BEAT.id && isoDate(broadcastDay(x.startsAt)) === todayIso);
  const saturdayEntries = tonight.map((x) => toTemplateEntry(x, entryId()));
  const saturdays: DbTemplate = {
    id: TEMPLATE_IDS.saturdays,
    stationId: BEAT.id,
    name: null,
    pattern: "weekly",
    weekday: weekdayOf(today),
    fromDay: todayIso,
    onDate: null,
    until: null,
    entries: saturdayEntries,
    // Next Saturday: Saturday Reel and Beat Tape Live overlap the week's own (fixtures/live.ts).
    dates: [7, 14, 21].map((d) => ({ date: isoDate(addDays(today, d)), edited: false, entries: saturdayEntries.length - (d === 7 ? 2 : 0), skipped: d === 7 ? 2 : 0, made: false })),
    createdAt: at("12:00"),
    updatedAt: null
  };

  // Weekdays: built from the last Monday before today.
  const back = (weekdayOf(today) + 6) % 7 || 7;
  const monday = addDays(today, -back);
  const byTitle = (t: string) => items.find((i) => i.title === t)!;
  const mondayLog: DbLogEntry[] = [
    ["Late Crate, ep. 13", 21, 30, 30],
    ["Crate Session 01", 22, 0, 120]
  ].map(([title, h, m, mins]) => {
    const it = byTitle(title as string);
    const startsAt = localTime(monday, h as number, m as number);
    return {
      id: logId(),
      stationId: BEAT.id,
      kind: "program",
      code: "PGM",
      title: it.title,
      episodeTitle: it.episodeNumber ? `ep. ${it.episodeNumber}` : null,
      itemId: it.id,
      programId: it.programId,
      liveSourceId: null,
      carriedFrom: null,
      carriageAgreementId: null,
      repeatGroupId: null,
      localNote: null,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + (mins as number) * 60_000).toISOString()
    };
  });
  const weekdayEntries = mondayLog.map((x) => toTemplateEntry(x, entryId()));
  const weekdays: DbTemplate = {
    id: TEMPLATE_IDS.weekdays,
    stationId: BEAT.id,
    name: "After work",
    pattern: "weekdays",
    weekday: null,
    fromDay: isoDate(monday),
    onDate: null,
    until: null,
    entries: weekdayEntries,
    dates: [],
    createdAt: localTime(monday, 22, 0),
    updatedAt: null
  };
  // This week's weekdays before today, already made.
  const made: DbLogEntry[] = [];
  for (let d = addDays(monday, 1); isoDate(d) < todayIso; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd < 1 || wd > 5) continue;
    for (const te of weekdayEntries) made.push(entryOn(te, isoDate(d), BEAT.id, weekdays.id, logId()));
  }
  // The next three weeks' weekdays; the first Wednesday was edited by hand.
  let editedOne = false;
  for (let i = 1; i <= HORIZON_DAYS; i++) {
    const d = addDays(today, i);
    const wd = weekdayOf(d);
    if (wd < 1 || wd > 5) continue;
    const edited = !editedOne && wd === 3;
    if (edited) editedOne = true;
    weekdays.dates.push({ date: isoDate(d), edited, entries: weekdayEntries.length, skipped: 0, made: false });
  }
  return { templates: [saturdays, weekdays], log: [...mondayLog, ...made] };
}
