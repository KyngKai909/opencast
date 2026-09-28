// Time helpers. Stations keep their market's local time; the log stores UTC.

const MINUTE = 60_000;

/** Offset of `tz` from UTC at `at`, in minutes (Los Angeles in summer is -420). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / MINUTE);
}

/** The UTC instant of a local wall-clock time in `tz`. */
export function zonedTime(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - offset * MINUTE);
  // Correct across a DST change between the guess and the answer.
  const second = tzOffsetMinutes(first, tz);
  return second === offset ? first : new Date(guess.getTime() - second * MINUTE);
}

/** Start and end (exclusive) of a local day. */
export function localDay(date: string, tz: string): { from: Date; to: Date } {
  const from = zonedTime(date, "00:00", tz);
  const next = new Date(Date.UTC(...(date.split("-").map(Number) as [number, number, number])) + 86_400_000);
  const to = zonedTime(next.toISOString().slice(0, 10), "00:00", tz);
  return { from, to };
}

/** `YYYY-MM-DD` of `at` in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Date(at.getTime() + tzOffsetMinutes(at, tz) * MINUTE).toISOString().slice(0, 10);
}

/** Weekday of `at` in `tz`, 0 = Sunday. */
export function localWeekday(at: Date, tz: string): number {
  return new Date(at.getTime() + tzOffsetMinutes(at, tz) * MINUTE).getUTCDay();
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const roundUpToMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE;
