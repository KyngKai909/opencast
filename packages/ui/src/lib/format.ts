// How Opencast writes times, lengths, amounts and channel numbers (style guide, Voice).
// A 12-hour clock with lowercase am/pm; lengths as :30, 28:30, 1:02:15; amounts in dollars with
// a true minus sign. Amounts arrive from the API as micros (1 dollar = 1,000,000).

export type TimeInput = Date | string | number;

export interface ClockOptions {
  /** The market's time zone ("America/Los_Angeles"). Defaults to the device's. */
  timeZone?: string;
  /** "8:42:12 pm" instead of "8:42 pm". */
  seconds?: boolean;
  /** Leave off am/pm, as in a column where the first row already says it. */
  suffix?: boolean;
}

interface ClockParts {
  hour: number;
  minute: string;
  second: string;
  period: "am" | "pm";
}

function toDate(value: TimeInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function clockParts(value: TimeInput, timeZone?: string): ClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h12",
    timeZone
  }).formatToParts(toDate(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")),
    minute: get("minute"),
    second: get("second"),
    period: get("dayPeriod").toLowerCase().startsWith("p") ? "pm" : "am"
  };
}

/** "8:42 pm", "8:42:12 pm", or "8:42" with `suffix: false`. */
export function clock(value: TimeInput, options: ClockOptions = {}): string {
  const p = clockParts(value, options.timeZone);
  const time = `${p.hour}:${p.minute}${options.seconds ? `:${p.second}` : ""}`;
  return options.suffix === false ? time : `${time} ${p.period}`;
}

/**
 * A span of time. am/pm is said once when both ends share it ("8:00 to 9:00 pm") and at both
 * ends when they don't ("11:40 pm to 2:00 am"). `separator: "–"` gives the grid form "8:30 – 9:00 pm".
 */
export function clockRange(
  start: TimeInput,
  end: TimeInput,
  options: Omit<ClockOptions, "suffix"> & { separator?: "to" | "–" } = {}
): string {
  const a = clockParts(start, options.timeZone);
  const b = clockParts(end, options.timeZone);
  const sep = options.separator === "–" ? " – " : " to ";
  // Across midnight ("6:00 am to 1:00 am"), both ends need their am/pm even when they match.
  const minutes = (p: ClockParts) => ((p.hour % 12) + (p.period === "pm" ? 12 : 0)) * 60 + Number(p.minute);
  const crossesMidnight = minutes(b) < minutes(a) || toDate(end).getTime() - toDate(start).getTime() >= 12 * 3600e3;
  const first = clock(start, { ...options, suffix: a.period !== b.period || crossesMidnight });
  return `${first}${sep}${clock(end, { ...options, suffix: true })}`;
}

/** A length, as broadcast writes it: ":30", "2:00", "28:30", "1:02:15". Rounds down to the second. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  if (m > 0) return `${m}:${s}`;
  return `:${s}`;
}

export interface MoneyOptions {
  /** Prefix a plus for money coming in ("+$250.00"). Negative amounts always get "−". */
  sign?: boolean;
  /** Whole dollars when there are no cents ("$100" instead of "$100.00"). Off by default. */
  trimCents?: boolean;
}

const MICROS = 1_000_000;

/** "$1,234.56"; "−$2.50" (a true minus sign); "+$250.00" with `sign`. */
export function money(micros: number, options: MoneyOptions = {}): string {
  const negative = micros < 0;
  const cents = Math.round(Math.abs(micros) / (MICROS / 100));
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = dollars.toLocaleString("en-US");
  const body = options.trimCents && rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
  if (negative && cents > 0) return `−${body}`;
  if (options.sign && cents > 0) return `+${body}`;
  return body;
}

/** A channel as it's written on the dial: "12.1" for TV, "88.3" for radio. */
export function channel(major: number, minor: number): string {
  return `${major}.${minor}`;
}

/** "Channel 12.1, BEAT": the words a screen reader hears for an ident. */
export function identLabel(channelText: string, callSign: string): string {
  return `Channel ${channelText}, ${callSign}`;
}
