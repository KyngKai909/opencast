// A248 (2026-10-06): a spreadsheet's schedule, read from its rows (lib/sheetFiles.ts reads the rows).
// No template: the layout is worked out from the sheet.
//
// - A week grid with times in the cells: a header row of days, optionally dated ("Monday 10/05",
//   "Mon 10/5", "10/05 Monday", "Mon Oct 5"), each cell a title and its time ("Trigun 6:00 AM",
//   "6:00 AM Trigun", "Trigun (6am)"), 12- or 24-hour, "noon", "midnight", or a range ("6–7 pm").
//   A show ends where the next one in its column starts; a blank cell (or one that can't be read)
//   means nothing is listed until the next start, so the show before it has no end. Times run on
//   past midnight in a column (11:50 pm, then 12:15 am is the next morning, still the column's
//   date). The last show of a day ends at the next day's first start when that's within 6 hours;
//   otherwise it has no end. A time that would put a show more than a day after its column's first
//   (a typo: "2:55 PM" between 2:25 am and 3:20 am) is out of order, and skipped.
// - A week grid with a column of times down the side: each title runs from its row's time to the
//   next row's. A blank cell is nothing listed. Merged cells (in an .xlsx or .ods) are the one
//   unambiguous run-on: a title merged down three rows runs to the fourth's time. A CSV can't say
//   a cell was merged (it comes through blank), so there it's nothing listed.
// - A list: a header row naming its columns (Date, Day, Start or Time, End, Duration or Length,
//   Title, Show, Program or Name, Episode or Description; case and common synonyms don't matter),
//   one airing a row. Without an end or a length, the next row's start, as in a grid.
// - Note rows above the header, blank rows and blank columns are skipped. Dates without a year take
//   the year nearest now (and the next column's, the year nearest the column before: a sheet from
//   December 28 to January 3 is read as such). Days without dates repeat every week.
// - Nothing is made up: a cell without a time it can read is skipped (and counted), titles are the
//   sheet's own words, trimmed ("It's Always Sunny at 9:25 PM" is "It's Always Sunny"). In a sheet
//   that writes am and pm, "6:30" alone can't be told apart, and is skipped too.
// - Time zone: the sheet's own words ("eastern standard time", "EST", "times in Pacific",
//   "America/Chicago", "UTC"). One zone named is the sheet's; several, none. "Eastern standard
//   time" written in October still means New York's clock.

import { isTimeZone, WEEKDAYS, type SheetLayout, type Weekday } from "@opencast/contracts";
import type { CalendarEvent } from "./ics.js";
import { wallClock } from "./manualSchedule.js";
import { addDays, localDate } from "./time.js";

export interface SheetEntry {
  /** The day it's listed under ("2026-10-05"), or null for a weekly sheet. */
  date: string | null;
  day: Weekday;
  /** Minutes after that day's midnight (1455 is 12:15 am the next morning). */
  start: number;
  end: number | null;
  title: string;
}

export type SkipWhy = "no_time" | "no_title" | "out_of_order" | "no_am_pm" | "no_day";

export interface SheetSchedule {
  layout: SheetLayout | null;
  entries: SheetEntry[];
  weekly: boolean;
  firstDay: string | null;
  lastDay: string | null;
  firstDate: string | null;
  lastDate: string | null;
  /** The zone the sheet names, when it names exactly one. */
  zone: string | null;
  zonesNamed: string[];
  /** The first 20 cells skipped, with where and why; `skippedCount` all of them. */
  skipped: Array<{ text: string; where: string; why: SkipWhy }>;
  skippedCount: number;
}

const DAY = 1440;
/** The last show of a day runs to the next day's first start when that's this close. */
export const RUN_ON_MINUTES = 6 * 60;
const SKIPPED_KEPT = 20;

/** A cell this long isn't a show: only its first characters are read (and no pattern runs long on it). */
const CELL_CHARS = 500;

/** A cell's text on one line, its spaces collapsed. */
const norm = (s: string | undefined) => (s ?? "").slice(0, CELL_CHARS * 4).replace(/\s+/g, " ").trim().slice(0, CELL_CHARS);

// ---- Days and dates ----

const WEEKDAY_WORDS: Record<string, Weekday> = {
  monday: "mon", mon: "mon", tuesday: "tue", tues: "tue", tue: "tue", wednesday: "wed", weds: "wed", wed: "wed",
  thursday: "thu", thurs: "thu", thur: "thu", thu: "thu", friday: "fri", fri: "fri", saturday: "sat", sat: "sat", sunday: "sun", sun: "sun"
};
const MONTH_WORDS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

/** A date as a sheet writes it: `numeric` (10/05: month and day, or day and month) or not (Oct 5, 2026-10-05). */
interface DateWords {
  a: number;
  b: number;
  year: number | null;
  numeric: boolean;
}

/** "10/05", "10/5/26", "2026-10-05", "Oct 5", "October 5th, 2026", "5 Oct". */
export function dateWords(text: string): DateWords | null {
  const s = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?: 00:00)?$/.exec(s);
  if (m) return { a: +m[2]!, b: +m[3]!, year: +m[1]!, numeric: false };
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/.exec(s);
  if (m) return { a: +m[1]!, b: +m[2]!, year: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, numeric: true };
  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
  if (m && MONTH_WORDS[m[1]!]) return { a: MONTH_WORDS[m[1]!]!, b: +m[2]!, year: m[3] ? +m[3] : null, numeric: false };
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/.exec(s);
  if (m && MONTH_WORDS[m[2]!]) return { a: MONTH_WORDS[m[2]!]!, b: +m[1]!, year: m[3] ? +m[3] : null, numeric: false };
  return null;
}

export interface DayLabel {
  /** As the sheet writes it. */
  text: string;
  day: Weekday | null;
  date: DateWords | null;
}

/** A day as a header (or a list's Day or Date cell) writes it: a weekday, a date, or both, and nothing else. */
export function dayLabel(cell: string | undefined): DayLabel | null {
  const text = norm(cell);
  if (!text || text.length > 40) return null;
  const words = text.toLowerCase().replace(/,/g, " ").split(" ").filter(Boolean);
  let day: Weekday | null = null;
  const rest: string[] = [];
  for (const w of words) {
    const wd = WEEKDAY_WORDS[w.replace(/\.$/, "")];
    if (wd && day === null) day = wd;
    else rest.push(w);
  }
  if (!rest.length) return day ? { text, day, date: null } : null;
  const date = dateWords(rest.join(" "));
  return date ? { text, day, date } : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
export const weekdayOf = (date: string): Weekday => WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * The dates of a run of day labels (a header's columns, a list's rows), in order. Numeric dates are
 * month/day unless a number over 12 (or the weekdays given) say day/month. A missing year is the one
 * nearest `today` for the first, then the one nearest the date before (December into January).
 */
export function resolveDates(labels: Array<{ day: Weekday | null; date: DateWords | null }>, today: string): Array<string | null> {
  const numeric = labels.filter((l) => l.date?.numeric).map((l) => l.date!);
  let dayFirst = numeric.some((d) => d.a > 12) && !numeric.some((d) => d.b > 12);
  if (!dayFirst && numeric.length && !numeric.some((d) => d.a > 12 || d.b > 12)) {
    // Both ways possible: the weekdays decide, when they say day/month more often.
    const fits = (first: boolean) => labels.filter((l) => l.date?.numeric && l.day && pick(l, first, today, false) && weekdayOf(pick(l, first, today, false)!) === l.day).length;
    dayFirst = fits(true) > fits(false);
  }
  const out: Array<string | null> = [];
  let prev: string | null = null;
  for (const l of labels) {
    const date: string | null = l.date ? pick(l, l.date.numeric && dayFirst, prev ?? today, !prev) : null;
    out.push(date);
    if (date) prev = date;
  }
  return out;
}

/** One label's date: its year if it has one, else the year that puts it nearest `near` (and on its weekday, for the first). */
function pick(l: { day: Weekday | null; date: DateWords | null }, dayFirst: boolean, near: string, first = true): string | null {
  const d = l.date!;
  const [month, day] = dayFirst ? [d.b, d.a] : [d.a, d.b];
  const nearYear = Number(near.slice(0, 4));
  const years = d.year ? [d.year] : [nearYear - 1, nearYear, nearYear + 1];
  const candidates = years.filter((y) => validDate(y, month, day)).map((y) => iso(y, month, day));
  const onDay = first && l.day ? candidates.filter((c) => weekdayOf(c) === l.day) : [];
  return (onDay.length ? onDay : candidates).sort((x, y) => daysApart(x, near) - daysApart(y, near))[0] ?? null;
}

// ---- Times ----

const ZONE_ABBR = "ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|AKST|AKDT|HST|UTC|GMT";
const TIME = String.raw`(?:(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\b\.?|(\d{1,2}):(\d{2})(?!\d)|\b(noon|midnight)\b)`;
const TIME_RE = new RegExp(String.raw`(?<![\d:.])${TIME}`, "gi");
const RANGE_JOIN = /^\s*(?:-|–|—|to|until|till)\s*$/i;
/** The start of a range written "6–8 pm": a bare hour (or hour and minutes) and the dash, just before the end's time. */
const RANGE_BARE = /(?<![\d:.])(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|to|until|till)\s*$/i;

interface Clock {
  minutes: number;
  /** Written with am or pm (or as noon or midnight), or in 24-hour form past 12: never ambiguous. */
  sure: boolean;
  /** Written with am or pm, or noon or midnight. */
  meridiem: "a" | "p" | null;
  hour: number;
  /** "noon" or "midnight": a time at a cell's end only ("Midnight Run" is a title). */
  word: boolean;
}

function clockOf(m: RegExpExecArray): Clock | null {
  if (m[6]) return { minutes: m[6].toLowerCase() === "noon" ? 720 : 0, sure: true, meridiem: m[6].toLowerCase() === "noon" ? "p" : "a", hour: 12, word: true };
  if (m[3]) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = m[3].toLowerCase() === "p";
    return { minutes: (h % 12) * 60 + min + (pm ? 720 : 0), sure: true, meridiem: pm ? "p" : "a", hour: h, word: false };
  }
  const h = Number(m[4]);
  const min = Number(m[5]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return { minutes: (h % 24) * 60 + min, sure: h === 0 || h > 12, meridiem: null, hour: h, word: false };
}

/** With am or pm: the same clock in the other half of the day. */
const withMeridiem = (c: Clock, meridiem: "a" | "p"): Clock => ({ ...c, minutes: (c.hour % 12) * 60 + (c.minutes % 60) + (meridiem === "p" ? 720 : 0), meridiem, sure: true });

interface TimeToken {
  index: number;
  end: number;
  start: Clock;
  /** A range's end ("6–7 pm"). */
  until: Clock | null;
}

/** The times in a text, a range ("6:00–7:00 PM", "11 to 1 pm") as one. */
function timeTokens(text: string): TimeToken[] {
  const singles: Array<{ index: number; end: number; clock: Clock }> = [];
  for (const m of text.matchAll(TIME_RE)) {
    const clock = clockOf(m);
    if (clock) singles.push({ index: m.index!, end: m.index! + m[0].length, clock });
  }
  const out: TimeToken[] = [];
  for (let i = 0; i < singles.length; i++) {
    const a = singles[i]!;
    const b = singles[i + 1];
    // "6–8 pm": a bare hour, a dash, then a time with am or pm.
    const after = out.at(-1)?.end ?? 0;
    const bare = a.clock.meridiem && !a.clock.word && !(b && RANGE_JOIN.test(text.slice(a.end, b.index))) ? RANGE_BARE.exec(text.slice(after, a.index)) : null;
    if (bare && Number(bare[1]) >= 1 && Number(bare[1]) <= 12 && Number(bare[2] ?? 0) < 60) {
      const plain: Clock = { minutes: (Number(bare[1]) % 12) * 60 + Number(bare[2] ?? 0), sure: false, meridiem: null, hour: Number(bare[1]), word: false };
      let start = withMeridiem(plain, a.clock.meridiem!);
      if (start.minutes > a.clock.minutes) start = withMeridiem(plain, a.clock.meridiem === "p" ? "a" : "p");
      out.push({ index: after + bare.index, end: a.end, start, until: a.clock });
      continue;
    }
    if (b && RANGE_JOIN.test(text.slice(a.end, b.index))) {
      let start = a.clock;
      let until = b.clock;
      // "6–7 pm", "11–1 pm": the start takes the end's half of the day, or the other when that runs backwards.
      if (!start.meridiem && until.meridiem && start.hour >= 1 && start.hour <= 12) {
        start = withMeridiem(start, until.meridiem);
        if (start.minutes > until.minutes) start = withMeridiem(start, until.meridiem === "p" ? "a" : "p");
      } else if (start.meridiem && !until.meridiem && until.hour >= 1 && until.hour <= 12) until = withMeridiem(until, start.meridiem);
      out.push({ index: a.index, end: b.end, start, until });
      i++;
    } else out.push({ index: a.index, end: a.end, start: a.clock, until: null });
  }
  return out;
}

export interface CellTime {
  start: number;
  /** A range's end, in minutes after midnight. */
  end: number | null;
  title: string;
  /** Written with am or pm, or 24-hour past 12 (never ambiguous). */
  sure: boolean;
  meridiem: boolean;
  /** A zone written right after the time ("6:00 PM ET"). */
  zone: string | null;
}

const LEAD = /^[\s(\-–—:|,;~•*]+/;
const TRAIL = /[\s(\-–—:|,;~•*@]+$/;
const ZONE_AFTER = new RegExp(String.raw`^\s*\(?\s*(${ZONE_ABBR})\b\.?\s*\)?`);

/**
 * A grid cell's title and time: the time at its end ("Trigun 6:00 AM", "News (6pm)", "It's Always
 * Sunny at 9:25 PM"), else at its start ("6:00 AM Trigun", "18:30 - News"). Null without a time in
 * either place. The title is the rest, its separators trimmed; empty when there's none.
 */
export function cellTime(cell: string | undefined): CellTime | null {
  const text = norm(cell);
  if (!text) return null;
  const tokens = timeTokens(text);
  if (!tokens.length) return null;
  const last = tokens[tokens.length - 1]!;
  const after = text.slice(last.end);
  const zoneAfterLast = ZONE_AFTER.exec(after);
  const tail = zoneAfterLast ? after.slice(zoneAfterLast[0].length) : after;
  let token: TimeToken | null = null;
  let title = "";
  let zone: string | null = null;
  if (/^[\s).,;:!\-–—]*$/.test(tail)) {
    token = last;
    zone = zoneAfterLast?.[1] ?? null;
    // "Title at 9:25 PM": a lowercase "at" or "@" joining them isn't the title's ("Where It's At" keeps its own).
    title = text.slice(0, last.index).replace(TRAIL, "").replace(/\s+(at|@)$/, "").replace(TRAIL, "");
  } else {
    const first = tokens[0]!;
    if (!/^[\s(]*$/.test(text.slice(0, first.index)) || first.start.word) return null;
    token = first;
    const rest = text.slice(first.end);
    const z = ZONE_AFTER.exec(rest);
    zone = z?.[1] ?? null;
    title = (z ? rest.slice(z[0].length) : rest).replace(LEAD, "").replace(/\s*\(\s*\)\s*$/, "");
  }
  // A title of only punctuation is no title.
  if (!/[\p{L}\p{N}]/u.test(title)) title = "";
  const len = token.until ? (token.until.minutes - token.start.minutes + DAY) % DAY : 0;
  return {
    start: token.start.minutes,
    end: token.until && len > 0 ? (token.start.minutes + len) % DAY : null,
    title: title.trim(),
    sure: token.start.sure,
    meridiem: !!token.start.meridiem,
    zone: zone ? (ABBR_ZONES[zone] ?? null) : null
  };
}

/** A cell that is a time (or a range) and nothing else, but for a zone: a time column's. */
export function bareTime(cell: string | undefined): CellTime | null {
  const t = cellTime(cell);
  return t && !t.title ? t : null;
}

/** "30", "30 min", "1h30", "1 hr 30 min", "0:30", "01:30:00": minutes, or null. Up to a day. */
export function durationMinutes(cell: string | undefined): number | null {
  const s = norm(cell).toLowerCase();
  if (!s) return null;
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  let minutes: number | null = null;
  if (m) minutes = +m[1]! * 60 + +m[2]!;
  else if ((m = /^(\d{1,4})(?:\.(\d+))?\s*(?:m|min|mins|minutes?)?$/.exec(s))) minutes = Math.round(Number(`${m[1]}.${m[2] ?? 0}`));
  else if ((m = /^(?:(\d{1,2})(?:\.(\d+))?\s*(?:h|hr|hrs|hours?))?\s*(?:(\d{1,3})\s*(?:m|min|mins|minutes?)?)?$/.exec(s)) && (m[1] || m[3])) {
    minutes = Math.round(Number(`${m[1] ?? 0}.${m[2] ?? 0}`) * 60) + Number(m[3] ?? 0);
  }
  return minutes !== null && minutes > 0 && minutes <= DAY ? minutes : null;
}

// ---- Time zones ----

const NY = "America/New_York";
const CHI = "America/Chicago";
const DEN = "America/Denver";
const LA = "America/Los_Angeles";
const ABBR_ZONES: Record<string, string> = {
  ET: NY, EST: NY, EDT: NY, CT: CHI, CST: CHI, CDT: CHI, MT: DEN, MST: DEN, MDT: DEN, PT: LA, PST: LA, PDT: LA,
  AKST: "America/Anchorage", AKDT: "America/Anchorage", HST: "Pacific/Honolulu", UTC: "UTC", GMT: "UTC"
};
const WORD_ZONES: Record<string, string> = { eastern: NY, central: CHI, mountain: DEN, pacific: LA, alaska: "America/Anchorage", hawaii: "Pacific/Honolulu", hawaiian: "Pacific/Honolulu", atlantic: "America/Halifax" };

/**
 * The zones a text names: "eastern standard time", "Pacific Time", "times in Central", "EST",
 * "America/Chicago", "UTC", "GMT-5". `strict` (a note or a header, not a show's title): "ET", "PT"
 * and the like count too.
 */
export function zonesIn(text: string, strict: boolean): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(eastern|central|mountain|pacific|alaska|hawaii(?:an)?|atlantic)\s+(?:standard\s+|daylight\s+|prevailing\s+)?time\b/gi)) found.add(WORD_ZONES[m[1]!.toLowerCase()]!);
  for (const m of text.matchAll(/\btimes?\s+(?:are\s+|shown\s+|listed\s+)?(?:in\s+)?(eastern|central|mountain|pacific)\b/gi)) found.add(WORD_ZONES[m[1]!.toLowerCase()]!);
  for (const m of text.matchAll(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST)\b/g)) found.add(ABBR_ZONES[m[1]!]!);
  if (strict) for (const m of text.matchAll(/(?<![\w.])(ET|CT|MT|PT)(?![\w.])/g)) found.add(ABBR_ZONES[m[1]!]!);
  for (const m of text.matchAll(/\b(UTC|GMT)(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?(?![\w])/g)) {
    if (!m[2]) found.add("UTC");
    // Whole hours only: "GMT-5" is Etc/GMT+5 (the sign is POSIX's, the other way round).
    else if (!m[4] || m[4] === "00") {
      const zone = Number(m[3]) === 0 ? "UTC" : `Etc/GMT${m[2] === "+" ? "-" : "+"}${Number(m[3])}`;
      if (isTimeZone(zone)) found.add(zone);
    }
  }
  for (const m of text.matchAll(/\b((?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Indian|Antarctica)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/g)) if (isTimeZone(m[1]!)) found.add(m[1]!);
  return [...found];
}

// ---- Layouts ----

type ListColumn = "date" | "day" | "start" | "end" | "duration" | "title" | "episode";
const LIST_HEADERS: Record<ListColumn, string[]> = {
  date: ["date", "air date", "airdate", "airing date", "broadcast date", "day/date", "date/day"],
  day: ["day", "weekday", "day of week", "days"],
  start: ["start", "start time", "starts", "starts at", "time", "times", "begins", "begin", "begin time", "airs", "air time", "airtime", "from", "time slot", "timeslot", "slot"],
  end: ["end", "end time", "ends", "ends at", "until", "to", "finish", "finishes", "stop", "stop time"],
  duration: ["duration", "length", "runtime", "run time", "running time", "mins", "minutes", "min", "len"],
  title: ["title", "show", "program", "programme", "name", "series", "show name", "show title", "program name", "programme name", "program title", "programme title", "series title"],
  episode: ["episode", "episode title", "episode name", "description", "subtitle", "sub-title", "sub title", "synopsis", "notes", "details"]
};

/** A list's header row: which column is which; null unless it has a title (or episode) and a start. */
function listColumns(cells: string[]): Partial<Record<ListColumn, number>> | null {
  const cols: Partial<Record<ListColumn, number>> = {};
  cells.forEach((cell, i) => {
    const h = norm(cell).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z/ -]/g, "").replace(/\s+/g, " ").trim();
    for (const [col, names] of Object.entries(LIST_HEADERS) as Array<[ListColumn, string[]]>) if (cols[col] === undefined && names.includes(h)) cols[col] = i;
  });
  return (cols.title !== undefined || cols.episode !== undefined) && cols.start !== undefined ? cols : null;
}

/** A header row of days: the columns with a day label, two at least. */
function dayHeader(cells: string[]): Map<number, DayLabel> | null {
  const labels = new Map<number, DayLabel>();
  cells.forEach((c, i) => {
    const l = dayLabel(c);
    if (l) labels.set(i, l);
  });
  return labels.size >= 2 ? labels : null;
}

interface Reader {
  entries: SheetEntry[];
  skip(text: string, where: string, why: SkipWhy): void;
  /** Text that isn't a show (notes, headers): read for a time zone. */
  notes: string[];
  /** Zones written after a show's time. */
  cellZones: string[];
  /** Day columns' labels, with their dates, for the first and last day. */
  days: Array<{ label: string; date: string | null; day: Weekday }>;
}

/**
 * The schedule in a spreadsheet's rows. `continues`: cells under the first of a merged block
 * (`row:col`). `now` decides the year of dates written without one.
 */
export function readSheetSchedule(rows: string[][], continues: ReadonlySet<string> = new Set(), now: Date = new Date()): SheetSchedule {
  const today = now.toISOString().slice(0, 10);
  const skipped: SheetSchedule["skipped"] = [];
  let skippedCount = 0;
  const r: Reader = {
    entries: [],
    skip(text, where, why) {
      skippedCount++;
      if (skipped.length < SKIPPED_KEPT) skipped.push({ text: text.slice(0, 120), where, why });
    },
    notes: [],
    cellZones: [],
    days: []
  };
  // A sheet that writes am and pm can't have a bare "6:30" read: which half of the day?
  const meridiems = rows.some((row) => row.some((c) => /\d\s*[ap]\.?\s*m\b/i.test(c)));
  let layout: SheetLayout | null = null;
  let at = 0;
  while (at < rows.length) {
    // The next header: a row of days (a grid), or of column names (a list).
    let header = -1;
    let days: Map<number, DayLabel> | null = null;
    let list: Partial<Record<ListColumn, number>> | null = null;
    for (let i = at; i < rows.length; i++) {
      days = dayHeader(rows[i]!);
      list = days ? null : listColumns(rows[i]!);
      if (days || list) {
        header = i;
        break;
      }
    }
    if (header < 0) {
      // Before the first header (or with none), notes; after the last section, nothing more.
      if (!layout) for (let i = at; i < rows.length; i++) r.notes.push(noteOf(rows[i]!));
      break;
    }
    if (!layout) for (let i = at; i < header; i++) r.notes.push(noteOf(rows[i]!));
    r.notes.push(noteOf(rows[header]!));
    // A section runs to the next header of days (another week below), or the end.
    let end = header + 1;
    while (end < rows.length && !(days ? dayHeader(rows[end]!) : listColumns(rows[end]!))) end++;
    if (days) layout = gridSection(r, rows, header, end, days, continues, today, meridiems) ?? layout;
    else {
      listSection(r, rows, header, end, list!, today, meridiems);
      layout ??= "list";
    }
    at = end;
  }

  // One entry per show: a sheet that lists one twice says it once.
  const seen = new Set<string>();
  const entries = r.entries.filter((e) => {
    const key = `${e.date ?? e.day}@${e.start}@${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const weekly = entries.length > 0 && entries.every((e) => e.date === null);
  const zonesNamed = [...new Set([...r.notes.flatMap((n) => zonesIn(n, true)), ...r.cellZones])];
  const used = r.days.filter((d) => entries.some((e) => (e.date ?? e.day) === (d.date ?? d.day)));
  const order = (d: { date: string | null; day: Weekday }) => d.date ?? String(WEEKDAYS.indexOf(d.day));
  const sorted = [...used].sort((a, b) => order(a).localeCompare(order(b)));
  return {
    layout: entries.length ? layout : null,
    entries,
    weekly,
    firstDay: sorted[0]?.label ?? null,
    lastDay: sorted.at(-1)?.label ?? null,
    firstDate: weekly ? null : (sorted.find((d) => d.date)?.date ?? null),
    lastDate: weekly ? null : (sorted.filter((d) => d.date).at(-1)?.date ?? null),
    zone: zonesNamed.length === 1 ? zonesNamed[0]! : null,
    zonesNamed,
    skipped,
    skippedCount
  };
}

/** A row read for a time zone: its cells' first characters. */
const noteOf = (row: string[]) => row.map((c) => c.slice(0, CELL_CHARS)).join(" ");

/** "Tuesday 10/06, row 61". */
const whereIn = (label: string, row: number) => `${label}, row ${row + 1}`;

/**
 * A grid's dates by column. Columns with a weekday and no date, beside dated ones, take the date of
 * that weekday next to the dated column before (or after) them.
 */
function columnDates(days: Map<number, DayLabel>, today: string): Map<number, { date: string | null; day: Weekday }> {
  const cols = [...days.keys()].sort((a, b) => a - b);
  const dates = resolveDates(cols.map((c) => days.get(c)!), today);
  const out = new Map<number, { date: string | null; day: Weekday }>();
  const anyDated = dates.some(Boolean);
  cols.forEach((c, i) => {
    const l = days.get(c)!;
    let date = dates[i] ?? null;
    if (!date && anyDated && l.day) {
      const before = dates.slice(0, i).map((d, j) => [d, j] as const).filter(([d]) => d).at(-1);
      const after = dates.slice(i + 1).map((d, j) => [d, i + 1 + j] as const).find(([d]) => d);
      const want = WEEKDAYS.indexOf(l.day);
      if (before) date = addDays(before[0]!, (want - WEEKDAYS.indexOf(weekdayOf(before[0]!)) + 7) % 7 || 7);
      else if (after) date = addDays(after[0]!, -((WEEKDAYS.indexOf(weekdayOf(after[0]!)) - want + 7) % 7 || 7));
    }
    const day = date ? weekdayOf(date) : l.day;
    if (day) out.set(c, { date, day });
  });
  return out;
}

/** A section under a header of days: times in the cells (a week grid), or a column of times (a time grid). */
function gridSection(r: Reader, rows: string[][], header: number, end: number, labels: Map<number, DayLabel>, continues: ReadonlySet<string>, today: string, meridiems: boolean): SheetLayout | null {
  const cols = columnDates(labels, today);
  const dayCols = [...cols.keys()];
  for (const c of dayCols) r.days.push({ label: labels.get(c)!.text, ...cols.get(c)! });
  // A time column: left of the last day, mostly bare times.
  let timeCol = -1;
  let best = 0;
  const width = Math.max(...rows.slice(header, end).map((row) => row.length));
  for (let c = 0; c < width; c++) {
    if (cols.has(c)) continue;
    let bare = 0;
    let filled = 0;
    for (let i = header + 1; i < end; i++) {
      if (!norm(rows[i]![c])) continue;
      filled++;
      if (bareTime(rows[i]![c])) bare++;
    }
    if (bare >= 2 && bare >= 0.6 * filled && bare > best) {
      best = bare;
      timeCol = c;
    }
  }
  // Times in the cells win when most of the day cells carry their own.
  let withTimes = 0;
  let filled = 0;
  for (let i = header + 1; i < end; i++) {
    for (const c of dayCols) {
      if (!norm(rows[i]![c])) continue;
      filled++;
      if (cellTime(rows[i]![c])?.title) withTimes++;
    }
  }
  if (timeCol >= 0 && withTimes < 0.5 * filled) {
    timeGrid(r, rows, header, end, timeCol, cols, labels, continues, meridiems);
    return "time_grid";
  }
  weekGrid(r, rows, header, end, cols, labels, meridiems);
  return "week_grid";
}

function weekGrid(r: Reader, rows: string[][], header: number, end: number, cols: Map<number, { date: string | null; day: Weekday }>, labels: Map<number, DayLabel>, meridiems: boolean) {
  const byColumn = new Map<number, SheetEntry[]>();
  for (const [c, { date, day }] of cols) {
    const label = labels.get(c)!.text;
    const list: SheetEntry[] = [];
    let prev: SheetEntry | null = null;
    let gap = false;
    let first: number | null = null;
    let last = -1;
    for (let i = header + 1; i < end; i++) {
      const raw = rows[i]![c];
      const text = norm(raw);
      if (!text) {
        gap = true;
        continue;
      }
      const t = cellTime(raw);
      const why: SkipWhy | null = !t ? "no_time" : !t.title ? "no_title" : !t.sure && meridiems ? "no_am_pm" : null;
      if (why || !t) {
        r.skip(text, whereIn(label, i), why ?? "no_time");
        gap = true;
        continue;
      }
      if (t.zone) r.cellZones.push(t.zone);
      // On past midnight: each start after the one before, within a day of the column's first.
      let start = t.start;
      while (last >= 0 && start <= last) start += DAY;
      if (first !== null && start - first >= DAY) {
        r.skip(text, whereIn(label, i), "out_of_order");
        gap = true;
        continue;
      }
      if (prev && !gap && prev.end === null) prev.end = start;
      const entry: SheetEntry = { date, day, start, end: t.end === null ? null : start + ((t.end - t.start + DAY) % DAY), title: t.title };
      list.push(entry);
      first ??= start;
      last = start;
      prev = entry;
      gap = false;
    }
    byColumn.set(c, list);
    r.entries.push(...list);
  }
  // The last show of each day runs to the next day's first start, when that's within 6 hours.
  for (const [c, list] of byColumn) {
    const lastShow = list.at(-1);
    if (!lastShow || lastShow.end !== null) continue;
    const { date, day } = cols.get(c)!;
    const nextDay = date ? addDays(date, 1) : WEEKDAYS[(WEEKDAYS.indexOf(day) + 1) % 7]!;
    const next = [...cols].find(([, d]) => (date ? d.date === nextDay : d.date === null && d.day === nextDay));
    const firstNext = next ? byColumn.get(next[0])?.[0] : undefined;
    if (!firstNext) continue;
    const at = DAY + firstNext.start;
    if (at > lastShow.start && at - lastShow.start <= RUN_ON_MINUTES) lastShow.end = at;
  }
}

function timeGrid(r: Reader, rows: string[][], header: number, end: number, timeCol: number, cols: Map<number, { date: string | null; day: Weekday }>, labels: Map<number, DayLabel>, continues: ReadonlySet<string>, meridiems: boolean) {
  const times: Array<{ row: number; start: number }> = [];
  let first: number | null = null;
  let last = -1;
  for (let i = header + 1; i < end; i++) {
    const t = bareTime(rows[i]![timeCol]);
    if (!t) continue;
    if (!t.sure && meridiems) {
      r.skip(norm(rows[i]![timeCol]), `row ${i + 1}`, "no_am_pm");
      continue;
    }
    if (t.zone) r.cellZones.push(t.zone);
    let start = t.start;
    while (last >= 0 && start <= last) start += DAY;
    if (first !== null && start - first >= DAY) {
      r.skip(norm(rows[i]![timeCol]), `row ${i + 1}`, "out_of_order");
      continue;
    }
    times.push({ row: i, start });
    first ??= start;
    last = start;
  }
  for (const [c, { date, day }] of cols) {
    for (let k = 0; k < times.length; k++) {
      const { row, start } = times[k]!;
      const title = norm(rows[row]![c]);
      if (!title || continues.has(`${row}:${c}`)) continue;
      // Merged down (an .xlsx or .ods): it runs on through the rows under it.
      let j = k + 1;
      while (j < times.length && continues.has(`${times[j]!.row}:${c}`)) j++;
      r.entries.push({ date, day, start, end: j < times.length ? times[j]!.start : null, title });
    }
    // Cells on rows without a time aren't shows; say so only when they look like one.
    for (let i = header + 1; i < end; i++) {
      const text = norm(rows[i]![c]);
      if (text && !times.some((t) => t.row === i) && !continues.has(`${i}:${c}`)) r.skip(text, whereIn(labels.get(c)!.text, i), "no_time");
    }
  }
}

/** A list's start cell: a time, or a date and a time ("2026-10-05 18:00", "10/5/2026 6:00 PM"). */
function startCell(cell: string | undefined): { date: DateWords | null; time: CellTime | null } {
  const text = norm(cell);
  const t = bareTime(text);
  if (t) return { date: null, time: t };
  const tokens = timeTokens(text);
  const tok = tokens.at(-1);
  if (!tok) return { date: null, time: null };
  const date = dayLabel(text.slice(0, tok.index).replace(/[T,\s]+$/, ""))?.date ?? null;
  return { date, time: date ? bareTime(text.slice(tok.index)) : null };
}

function listSection(r: Reader, rows: string[][], header: number, end: number, cols: Partial<Record<ListColumn, number>>, today: string, meridiems: boolean) {
  type Row = { i: number; text: string; date: DateWords | null; day: Weekday | null; label: string; start: CellTime; endAt: number | null; title: string };
  const read: Array<Row | null> = [];
  for (let i = header + 1; i < end; i++) {
    const cells = rows[i]!;
    const cell = (c: ListColumn) => (cols[c] === undefined ? "" : norm(cells[cols[c]!]));
    if (!cells.some((c) => norm(c))) {
      read.push(null);
      continue;
    }
    const s = startCell(cell("start"));
    const title = cell("title") || cell("episode");
    const text = [cell("date") || cell("day"), cell("start"), title].filter(Boolean).join(" ");
    if (!s.time) {
      // A row with a title and no time it can read; a row of only a note isn't a show.
      if (title && cell("start")) r.skip(text, `row ${i + 1}`, "no_time");
      read.push(null);
      continue;
    }
    if (!title) {
      r.skip(text, `row ${i + 1}`, "no_title");
      read.push(null);
      continue;
    }
    if (!s.time.sure && meridiems) {
      r.skip(text, `row ${i + 1}`, "no_am_pm");
      read.push(null);
      continue;
    }
    const dateCell = dayLabel(cell("date")) ?? (cell("date") ? { text: cell("date"), day: null, date: dateWords(cell("date")) } : null);
    const dayCell = dayLabel(cell("day"));
    const date = dateCell?.date ?? dayCell?.date ?? s.date;
    const day = dayCell?.day ?? dateCell?.day ?? null;
    if (!date && !day) {
      r.skip(text, `row ${i + 1}`, "no_day");
      read.push(null);
      continue;
    }
    if (s.time.zone) r.cellZones.push(s.time.zone);
    // Its end: an End time, else a length.
    let endAt: number | null = null;
    const e = startCell(cell("end")).time;
    if (e && (e.sure || !meridiems)) endAt = s.time.start + ((e.start - s.time.start + DAY) % DAY || DAY);
    else {
      const d = durationMinutes(cell("duration"));
      if (d) endAt = s.time.start + d;
    }
    read.push({ i, text, date, day, label: cell("date") || cell("day") || cell("start"), start: s.time, endAt, title });
  }
  // Dates: in order down the list, the year nearest the row before.
  const shows = read.filter((x): x is Row => !!x);
  const dates = resolveDates(shows.map((x) => ({ day: x.day, date: x.date })), today);
  const made = new Map<Row, SheetEntry>();
  shows.forEach((x, k) => {
    const date = dates[k] ?? null;
    const day = date ? weekdayOf(date) : x.day!;
    const entry: SheetEntry = { date, day, start: x.start.start, end: x.endAt, title: x.title };
    made.set(x, entry);
    r.entries.push(entry);
    r.days.push({ label: x.label, date, day });
  });
  // Without an end or a length, the next row's start (with no blank row between), within 6 hours.
  for (let k = 0; k + 1 < read.length; k++) {
    const a = read[k];
    const b = read[k + 1];
    if (!a || !b) continue;
    const ea = made.get(a)!;
    const eb = made.get(b)!;
    if (ea.end !== null) continue;
    const apart = ea.date && eb.date ? (Date.parse(eb.date) - Date.parse(ea.date)) / 86_400_000 : ea.day === eb.day ? 0 : (WEEKDAYS.indexOf(eb.day) - WEEKDAYS.indexOf(ea.day) + 7) % 7;
    const at = apart * DAY + eb.start;
    if (at > ea.start && at - ea.start <= RUN_ON_MINUTES) ea.end = at;
  }
}

// ---- Airings ----

const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** The instant `minutes` after `date`'s midnight by the clock in `tz` (1455: 12:15 am the next day). */
function clockAt(date: string, minutes: number, tz: string): Date {
  return wallClock(addDays(date, Math.floor(minutes / DAY)), hhmm(((minutes % DAY) + DAY) % DAY), tz);
}

/**
 * A spreadsheet's shows as airings in `tz`: on their dates, or (a weekly sheet) on every matching
 * day of [from, to). Those already over by `from` are left out (one still on stays). Times are wall
 * clock times, so 6:00 am stays 6:00 am across daylight saving.
 */
export function sheetAirings(entries: SheetEntry[], tz: string, from: Date, to: Date): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const add = (date: string, e: SheetEntry) => {
    const start = clockAt(date, e.start, tz);
    const end = e.end === null ? null : clockAt(date, e.end, tz);
    out.push({ uid: null, summary: e.title, start, end: end && end > start ? end : null });
  };
  for (const e of entries) if (e.date) add(e.date, e);
  const weekly = entries.filter((e) => !e.date);
  if (weekly.length) {
    const last = localDate(to, tz);
    // From the day before: a show past midnight from yesterday may still be on.
    for (let day = addDays(localDate(from, tz), -1); day <= last; day = addDays(day, 1)) {
      const wd = weekdayOf(day);
      for (const e of weekly) if (e.day === wd) add(day, e);
    }
  }
  const seen = new Set<string>();
  return out
    .filter((e) => (e.end ? e.end > from : e.start >= from) && (!weekly.length || e.start < to))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .filter((e) => {
      const key = `${e.start.getTime()}@${e.summary}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
