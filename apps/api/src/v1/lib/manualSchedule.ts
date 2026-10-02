// A241 (2026-10-01): a weekly schedule entered by hand, made into the same airings a feed produces.
// Times are wall-clock times in the market's time zone, so 6:00 pm stays 6:00 pm across daylight
// saving; an end before the start runs past midnight into the next day. A time that doesn't exist
// on the night the clocks go forward is moved on by the gap, as iCalendar does (2:30 am is 3:30
// am), and a slot left with no length that night is skipped; a time that happens twice when they
// go back is the first.

import { MANUAL_HORIZON_DAYS, WEEKDAYS, clockMinutes, type ManualSlot } from "@opencast/contracts";
import type { CalendarEvent } from "./ics.js";
import { addDays, localDate, localWeekday, tzOffsetMinutes, zonedTime } from "./time.js";

export { MANUAL_HORIZON_DAYS };

export interface ManualScheduleData {
  slots: Array<Pick<ManualSlot, "days" | "start" | "end" | "title"> & { from?: string | null; until?: string | null }>;
  skipDates: string[];
}

/** The instant of a wall-clock time in `tz`; in the spring gap, the moment after it. */
export function wallClock(date: string, time: string, tz: string): Date {
  const at = zonedTime(date, time, tz);
  const want = clockMinutes(time) ?? 0;
  const local = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60_000);
  const got = local.getUTCHours() * 60 + local.getUTCMinutes();
  const sameDay = local.toISOString().slice(0, 10) === date;
  // zonedTime lands an hour early for a time the clocks skip: move it past the gap.
  if (!sameDay || got === want) return at;
  return new Date(at.getTime() + (want - got) * 60_000);
}

/**
 * Its airings that are on in [from, to): each slot on each of its days (in season, and not on a
 * skipped date, by the day it starts), with the slot's title. One that started before `from` and is
 * still on is included. `uid` is `manual:<date>@<start>`, the same each time it's made.
 */
export function manualAirings(schedule: ManualScheduleData, tz: string, from: Date, to: Date): CalendarEvent[] {
  const skip = new Set(schedule.skipDates);
  const out: CalendarEvent[] = [];
  // From the day before (a slot past midnight from yesterday may still be on) to the last day.
  const last = localDate(to, tz);
  for (let day = addDays(localDate(from, tz), -1); day <= last; day = addDays(day, 1)) {
    if (skip.has(day)) continue;
    // Noon that day, safely inside it whatever the clocks do.
    const weekday = WEEKDAYS[(localWeekday(zonedTime(day, "12:00", tz), tz) + 6) % 7]!;
    for (const slot of schedule.slots) {
      if (!slot.days.includes(weekday)) continue;
      if ((slot.from && day < slot.from) || (slot.until && day > slot.until)) continue;
      const s = clockMinutes(slot.start);
      const e = clockMinutes(slot.end);
      if (s === null || e === null || s === e) continue;
      const start = wallClock(day, slot.start, tz);
      const end = wallClock(e > s ? day : addDays(day, 1), slot.end, tz);
      if (end <= from || start >= to || end <= start) continue;
      out.push({ uid: `manual:${day}@${slot.start}`, summary: slot.title.trim(), start, end });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The window the hourly pass keeps filled: now to the end of the horizon. */
export function manualWindow(now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + MANUAL_HORIZON_DAYS * 86_400_000) };
}
