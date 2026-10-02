// The rules behind the live, listings and library screens, kept apart from the screens so they can
// be tested: a live block's phase, the countdown, the signal column, day labels, which block a
// person lands on, and the description counter.

import { clock, duration, minutesText } from "@opencast/ui";

export type Phase = "standby" | "on_air" | "ended";

export interface Block {
  id: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  programId: string | null;
  liveSourceId: string | null;
  repeatGroupId?: string | null;
}

const t = (x: string | number | Date) => (x instanceof Date ? x.getTime() : typeof x === "number" ? x : Date.parse(x));

/**
 * A live block goes out when its block starts, not when someone presses a button (live-listings 02):
 * stand by until then, on air until it ends (or ends early), then ended.
 */
export function blockPhase(b: Pick<Block, "startsAt" | "endsAt">, now: Date | number, endedEarlyAt?: string | null): Phase {
  const n = t(now);
  if (endedEarlyAt && t(endedEarlyAt) <= n) return "ended";
  if (n < t(b.startsAt)) return "standby";
  if (n < t(b.endsAt)) return "on_air";
  return "ended";
}

/** "2:14" to go: whole seconds, rounded up, so it reads 0:00 only as the block starts. */
export function countdown(startsAt: string, now: Date | number): string {
  const left = Math.max(0, t(startsAt) - t(now));
  const s = Math.ceil(left / 1000);
  return s >= 60 ? duration(s * 1000) : `0:${String(s).padStart(2, "0")}`;
}

/** "24:10 in": how long it's been on air (phone 05.2). */
export function elapsed(startsAt: string, now: Date | number): string {
  return `${duration(Math.max(0, t(now) - t(startsAt)))} in`;
}

/** The parts of a time in the station's zone. */
function parts(x: string | number | Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "long" }).formatToParts(new Date(t(x)));
  const g = (k: Intl.DateTimeFormatPartTypes) => f.find((p) => p.type === k)?.value ?? "";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24, weekday: g("weekday") };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
}

/**
 * The day column (live-listings 01.1, 03.1): "Tonight" (today, from 5 pm), "Today", a weekday
 * within the week, and the weekday with its date a week or more away ("Saturday Oct 3").
 */
export function dayLabel(x: string | number | Date, now: Date | number, timeZone: string): string {
  const a = parts(now, timeZone);
  const b = parts(x, timeZone);
  if (a.day === b.day) return b.hour >= 17 ? "Tonight" : "Today";
  if (t(x) - t(now) >= 7 * 86400e3) {
    const md = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(t(x)));
    return `${b.weekday} ${md}`;
  }
  return b.weekday;
}

/** "Tonight, 10:00 pm" / "Sunday, 12:00 am" (the item page's In the log). */
export function whenLabel(x: string, now: Date | number, timeZone: string): string {
  return `${dayLabel(x, now, timeZone)}, ${clock(x, { timeZone })}`;
}

/** "Saturday, September 26, 3:00 am" (the item page's Aired). */
export function airedLabel(x: string, timeZone: string): string {
  const d = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(new Date(t(x)));
  return `${d}, ${clock(x, { timeZone })}`;
}

/** The item page's right column: "In 1 hr 18 min" later today, "Tomorrow", then the weekday. */
export function relativeLabel(x: string, now: Date | number, timeZone: string): string {
  const diff = dayDiff(parts(now, timeZone).day, parts(x, timeZone).day);
  if (diff <= 0) return `In ${minutesText(t(x) - t(now))}`;
  if (diff === 1) return "Tomorrow";
  return parts(x, timeZone).weekday;
}

/** The line under a live block's title (01.1): "Starts in 18 min" within the hour, else "Weekly". */
export function blockDetail(b: Pick<Block, "startsAt" | "endsAt" | "repeatGroupId">, now: Date | number): string | null {
  const phase = blockPhase(b, now);
  const until = t(b.startsAt) - t(now);
  if (phase === "standby" && until <= 60 * 60_000) return `Starts in ${minutesText(until)}`;
  if (phase === "on_air") return "On air";
  return b.repeatGroupId ? "Weekly" : null;
}

export type SignalTone = "ok" | "no" | "quiet";

/** The Signal column (01.1): a block a week or more away says "Next week"; otherwise the source's signal. */
export function signalWords(source: { signal: "not_connected" | "receiving"; quality?: string | null } | null, b: Pick<Block, "startsAt">, now: Date | number): { text: string; tone: SignalTone } {
  if (t(b.startsAt) - t(now) >= 7 * 86400e3) return { text: "Next week", tone: "quiet" };
  if (!source) return { text: "No source", tone: "no" };
  if (source.signal === "receiving") return { text: source.quality ? `Receiving, ${source.quality}` : "Receiving", tone: "ok" };
  return { text: "Not connected yet", tone: "no" };
}

/**
 * Which block `/live` opens (A27): a host's next own block; anyone else's next live block on the
 * log. One that's on air now counts as next.
 */
export function nextBlock<B extends Block>(entries: B[], now: Date | number, host: { programIds: string[] } | null): B | null {
  const n = t(now);
  return (
    entries
      .filter((e) => e.kind === "live" && t(e.endsAt) > n)
      .filter((e) => !host || (e.programId !== null && host.programIds.includes(e.programId)))
      .sort((a, b) => t(a.startsAt) - t(b.startsAt))[0] ?? null
  );
}

export const DESCRIPTION_LIMIT = 160;

/** "131 of 160", and whether it can be saved. */
export function descriptionCount(text: string): { label: string; over: boolean } {
  const n = [...text].length;
  return { label: `${n} of ${DESCRIPTION_LIMIT}`, over: n > DESCRIPTION_LIMIT };
}

/** "1 hr 58 min" of programs, "1:15" of spots (A.2's summary). */
export function librarySummary(items: { code: string; durationMs: number | null; rights: unknown }[]) {
  const programs = items.filter((i) => i.code === "PGM").reduce((a, i) => a + (i.durationMs ?? 0), 0);
  const shorts = items.filter((i) => i.code !== "PGM").reduce((a, i) => a + (i.durationMs ?? 0), 0);
  return {
    count: items.length,
    programs: minutesText(programs),
    shorts: duration(shorts),
    needRights: items.filter((i) => !i.rights).length
  };
}

/** A library row's status line: "720p, stereo" (the picture's height and the sound). */
export function readyLine(i: { picture: { height: number } | null; mediaKind: string; audioLayout?: string | null }): string {
  const sound = i.audioLayout ?? null;
  const pic = i.picture ? `${i.picture.height}p` : i.mediaKind === "audio" ? "Audio" : null;
  return [pic, sound].filter(Boolean).join(", ");
}
