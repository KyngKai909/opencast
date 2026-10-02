// A241 (2026-10-01, the user's decision): an external station's "what's on" entered by hand, as a
// weekly list of slots in the market's time zone, checked against the source's published schedule
// (where, and on what day). The API turns it into the same upcoming airings a feed produces; the
// desk edits it. The rules here are shared, so the desk says what the API would refuse before it's
// sent: days, 5-minute times, a title, and no two slots on air at once.

import { z } from "zod";
import { DateOnly } from "./common.js";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

/** "Mon", "Tue": the desk's day chips and the compact schedule. */
export const WEEKDAY_SHORT: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const WEEKDAY_PLURAL: Record<Weekday, string> = { mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays" };

/**
 * Times sit on a 5-minute grid. The guide has no coarser grid of its own (its cells are drawn to
 * the minute; full stations' logs snap to 4-second segments), and schedules are published to the
 * 5 minutes at most.
 */
export const MANUAL_GRID_MINUTES = 5;
export const MANUAL_TITLE_MAX = 120;
export const MANUAL_DESCRIPTION_MAX = 300;
export const MANUAL_SLOTS_MAX = 60;
export const MANUAL_SKIP_DATES_MAX = 366;
/** How far ahead airings are made from it: the same two weeks the hourly pass keeps filled. */
export const MANUAL_HORIZON_DAYS = 14;

/** A 24-hour wall-clock time, "18:00". */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time like 18:00");

/**
 * One weekly slot: the days it airs, its start and end in the market's time zone (an end before the
 * start runs past midnight into the next day), the source's own title, and optionally a description
 * and a season (`from` and `until`, both inclusive, by the day it starts).
 */
export const ManualSlot = z.object({
  days: z.array(Weekday).min(1, "Pick at least one day").max(7),
  start: ClockTime,
  end: ClockTime,
  title: z.string().trim().min(1, "Give it the title they publish").max(MANUAL_TITLE_MAX),
  description: z.string().trim().max(MANUAL_DESCRIPTION_MAX).nullable().optional(),
  from: DateOnly.nullable().optional(),
  until: DateOnly.nullable().optional()
});
export type ManualSlot = z.infer<typeof ManualSlot>;

/**
 * What's on, entered by hand (`addListedSource.schedule`, `updateListedSource.schedule`): the weekly
 * slots, where it was checked (the published schedule's address) and on what day (both required, as
 * Phase 6's rule for guide data needs), and the dates it doesn't air.
 */
export const ManualScheduleInput = z.object({
  source: z.literal("manual"),
  slots: z.array(ManualSlot).min(1, "Add at least one slot").max(MANUAL_SLOTS_MAX),
  checkedAgainst: z.url(),
  checkedOn: DateOnly,
  skipDates: z.array(DateOnly).max(MANUAL_SKIP_DATES_MAX).optional()
});
export type ManualScheduleInput = z.infer<typeof ManualScheduleInput>;

/** One thing wrong with a slot (or the list): which slot (0-based), which field, and the words. */
export interface ManualProblem {
  slot: number | null;
  field: "days" | "start" | "end" | "title" | "description" | "from" | "until" | "slots";
  message: string;
}

const WEEK = 7 * 1440;

/** Minutes after midnight for "18:05"; null when it isn't a time. */
export function clockMinutes(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** How long a slot runs, in minutes: past midnight when it ends before it starts. */
export function slotMinutes(slot: Pick<ManualSlot, "start" | "end">): number | null {
  const s = clockMinutes(slot.start);
  const e = clockMinutes(slot.end);
  if (s === null || e === null || s === e) return null;
  return e > s ? e - s : e + 1440 - s;
}

const order = (days: readonly string[]) => WEEKDAYS.filter((d) => days.includes(d));

/** "6:00 pm", "12:00 pm" (noon), "12:00 am" (midnight). */
function twelve(minutes: number): { time: string; half: "am" | "pm" } {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return { time: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`, half: h < 12 ? "am" : "pm" };
}

/** "6:00–9:00 pm", "11:00 am–1:00 pm", "11:00 pm–1:00 am". */
export function clockRangeText(start: string, end: string): string {
  const s = clockMinutes(start);
  const e = clockMinutes(end);
  if (s === null || e === null) return `${start}–${end}`;
  const a = twelve(s);
  const b = twelve(e);
  return a.half === b.half && e > s ? `${a.time}–${b.time} ${b.half}` : `${a.time} ${a.half}–${b.time} ${b.half}`;
}

/** "Mon–Fri", "Sat, Sun", "Mon, Wed, Fri", "Every day". */
export function daysText(days: readonly string[]): string {
  const list = order(days);
  if (list.length === 7) return "Every day";
  const runs: Weekday[][] = [];
  for (const d of list) {
    const last = runs[runs.length - 1];
    if (last && WEEKDAYS.indexOf(d) === WEEKDAYS.indexOf(last[last.length - 1]!) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${WEEKDAY_SHORT[r[0]!]}–${WEEKDAY_SHORT[r[r.length - 1]!]}` : r.map((d) => WEEKDAY_SHORT[d]).join(", "))).join(", ");
}

/** "Mon–Fri 6:00–9:00 pm: City Council" (and the season, when it has one). */
export function slotText(slot: Pick<ManualSlot, "days" | "start" | "end" | "title" | "from" | "until">): string {
  const season = slot.from && slot.until ? ` (${slot.from} to ${slot.until})` : slot.from ? ` (from ${slot.from})` : slot.until ? ` (until ${slot.until})` : "";
  return `${daysText(slot.days)} ${clockRangeText(slot.start, slot.end)}: ${slot.title}${season}`;
}

/** The slots in week order (by their first day, then the time), for showing them. */
export function sortedSlots<T extends Pick<ManualSlot, "days" | "start">>(slots: readonly T[]): T[] {
  const first = (s: T) => Math.min(...s.days.map((d) => WEEKDAYS.indexOf(d as Weekday)).filter((i) => i >= 0), 7);
  return [...slots].sort((a, b) => first(a) - first(b) || (clockMinutes(a.start) ?? 0) - (clockMinutes(b.start) ?? 0));
}

/** The whole week in one line, for the change history: "Mon–Fri 6:00–9:00 pm: City Council; Sat 10:00–11:00 am: Story time". */
export function weeklyText(slots: ReadonlyArray<Pick<ManualSlot, "days" | "start" | "end" | "title" | "from" | "until">>): string {
  return sortedSlots(slots).map(slotText).join("; ");
}

const seasonsMeet = (a: Pick<ManualSlot, "from" | "until">, b: Pick<ManualSlot, "from" | "until">) => (a.from ?? "0000-01-01") <= (b.until ?? "9999-12-31") && (b.from ?? "0000-01-01") <= (a.until ?? "9999-12-31");

/** Where two slots are on at once in the week, as minutes after Monday midnight; null when they never are. */
function overlapAt(a: Pick<ManualSlot, "days" | "start" | "end">, b: Pick<ManualSlot, "days" | "start" | "end">): number | null {
  const sa = clockMinutes(a.start);
  const sb = clockMinutes(b.start);
  const la = slotMinutes(a);
  const lb = slotMinutes(b);
  if (sa === null || sb === null || la === null || lb === null) return null;
  for (const da of order(a.days)) {
    const a0 = WEEKDAYS.indexOf(da) * 1440 + sa;
    for (const db of order(b.days)) {
      const b0 = WEEKDAYS.indexOf(db) * 1440 + sb;
      // The week wraps: Sunday night's slot runs into Monday morning.
      for (const k of [-WEEK, 0, WEEK]) {
        const start = Math.max(a0, b0 + k);
        if (start < Math.min(a0 + la, b0 + k + lb)) return ((start % WEEK) + WEEK) % WEEK;
      }
    }
  }
  return null;
}

/**
 * Everything wrong with a weekly schedule, in the desk's words: no days, times off the 5-minute
 * grid or the same at both ends, no title (or too long), a season that ends before it starts, and
 * two slots on at once (in the same season). Empty when it's fine.
 */
export function manualScheduleProblems(slots: ReadonlyArray<Partial<ManualSlot> & Pick<ManualSlot, "days" | "start" | "end" | "title">>): ManualProblem[] {
  const problems: ManualProblem[] = [];
  if (!slots.length) problems.push({ slot: null, field: "slots", message: "Add at least one slot." });
  if (slots.length > MANUAL_SLOTS_MAX) problems.push({ slot: null, field: "slots", message: `Up to ${MANUAL_SLOTS_MAX} slots.` });
  slots.forEach((s, i) => {
    if (!s.days.length) problems.push({ slot: i, field: "days", message: "Pick at least one day." });
    for (const field of ["start", "end"] as const) {
      const m = clockMinutes(s[field]);
      if (m === null) problems.push({ slot: i, field, message: "A time like 6:00 pm." });
      else if (m % MANUAL_GRID_MINUTES) problems.push({ slot: i, field, message: `Use 5-minute steps (${field === "start" ? "6:00, 6:05, 6:10" : "9:00, 9:05, 9:10"}).` });
    }
    if (clockMinutes(s.start) !== null && s.start === s.end) problems.push({ slot: i, field: "end", message: "It ends when it starts. An end before the start runs past midnight." });
    const title = s.title.trim();
    if (!title) problems.push({ slot: i, field: "title", message: "Give it the title they publish." });
    else if (title.length > MANUAL_TITLE_MAX) problems.push({ slot: i, field: "title", message: `Keep it to ${MANUAL_TITLE_MAX} characters.` });
    if ((s.description ?? "").trim().length > MANUAL_DESCRIPTION_MAX) problems.push({ slot: i, field: "description", message: `Keep it to ${MANUAL_DESCRIPTION_MAX} characters.` });
    if (s.from && s.until && s.until < s.from) problems.push({ slot: i, field: "until", message: "The season ends before it starts." });
  });
  if (problems.length) return problems;
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (!seasonsMeet(a, b)) continue;
      const at = overlapAt(a, b);
      if (at === null) continue;
      const day = WEEKDAYS[Math.floor(at / 1440)]!;
      const t = twelve(at % 1440);
      problems.push({ slot: j, field: "start", message: `“${b.title.trim()}” overlaps “${a.title.trim()}” on ${WEEKDAY_PLURAL[day]} at ${t.time} ${t.half}. Two slots can't be on at once.` });
    }
  }
  return problems;
}
