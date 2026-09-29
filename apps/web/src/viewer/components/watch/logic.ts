// The rules behind the tuned-in page, kept out of the components so they can be tested: which
// station a URL means, keeping the URL in step with the channel on air, the swipe on the phone,
// tonight's rows, and the radio band's wrap hint.

import { neighbour } from "@opencast/player";
import type { AiringX, DialRowX, StationPageX } from "../../api/ext";

type Ident = { id: string; callSign: string | null; handle: string | null; name?: string; channel: string | null };

/** The URL part for a station: its call sign in lower case ("beat"), or its handle. */
export function stationSlug(s: Pick<Ident, "id" | "callSign" | "handle">): string {
  return (s.callSign ?? s.handle ?? s.id).toLowerCase();
}

/** What a station is called in a URL param and on a button: its call sign, or its handle. */
export function callSignOf(s: Pick<Ident, "id" | "callSign" | "handle">): string {
  return s.callSign ?? s.handle ?? s.id;
}

export function identText(s: Pick<Ident, "callSign" | "channel">): string {
  return [s.callSign, s.channel].filter(Boolean).join(" ");
}

/** The dial row a `/watch/:stationRef` means: by id, call sign or handle. */
export function resolveStation(channels: DialRowX[], ref: string | undefined): DialRowX | null {
  if (!ref) return null;
  const r = ref.toLowerCase();
  return channels.find((c) => c.station.id === ref || c.station.callSign?.toLowerCase() === r || c.station.handle?.toLowerCase() === r) ?? null;
}

/**
 * A station from outside the market's dial (a nearby market's, linked from a thin dial), as a dial
 * row the player can tune: what's on, what's next and where its picture comes from.
 */
export function rowFromPage(p: Pick<StationPageX, "station" | "onAir" | "now" | "upNext" | "playback">): DialRowX {
  return { station: p.station, onAir: p.onAir, now: p.now, next: p.upNext[0] ?? null, playback: p.playback };
}

/** The player's dial with an outside station added (once), or null when it's already there. */
export function withOutsideStation(channels: DialRowX[], row: DialRowX): DialRowX[] | null {
  return channels.some((c) => c.station.id === row.station.id) ? null : [...channels, row];
}

/**
 * The URL changed: tune to the station it names, unless that's already on (or on its way).
 * Returns the station to tune, or null.
 */
export function tuneForUrl(refId: string | null, playingId: string | null): string | null {
  return refId && refId !== playingId ? refId : null;
}

/**
 * The channel changed (arrow keys, the buttons, a swipe, a preset key): the URL follows it.
 * `lastSynced` is the station the URL last named; null until the page has resolved its own URL,
 * so a station left over from the previous page never rewrites it. Returns the station the URL
 * should now name, or null to leave it.
 */
export function urlForChannel(playingId: string | null, lastSynced: string | null): string | null {
  return lastSynced !== null && playingId !== null && playingId !== lastSynced ? playingId : null;
}

/** How far a finger must travel on the picture before a swipe changes channel. */
export const SWIPE_MIN_PX = 56;
/** …or this share of the picture's height, whichever is more. */
export const SWIPE_SHARE = 0.22;
/** The next station shows over the picture once the finger has moved this far. */
export const SWIPE_PREVIEW_PX = 12;

/**
 * A vertical swipe on the picture: up (the finger moves up) goes up the dial, down goes down.
 * Short or sideways movements don't count.
 */
export function swipeChannel(dy: number, height: number, dx = 0): "up" | "down" | null {
  const need = Math.max(SWIPE_MIN_PX, height * SWIPE_SHARE);
  if (Math.abs(dy) < need || Math.abs(dx) > Math.abs(dy)) return null;
  return dy < 0 ? "up" : "down";
}

/** Which way the swipe is heading, for the channel shown over the picture while it moves. */
export function swipePreview(dy: number, dx = 0): "up" | "down" | null {
  if (Math.abs(dy) < SWIPE_PREVIEW_PX || Math.abs(dx) > Math.abs(dy)) return null;
  return dy < 0 ? "up" : "down";
}

/** The dial's neighbour, the way the player moves: in channel order, within the band, wrapping. */
export function neighbourOf(channels: DialRowX[], currentId: string | null, dir: "up" | "down"): DialRowX | null {
  return neighbour(channels, currentId, dir, { sameBand: true }) as DialRowX | null;
}

function channelKey(ch: string | null): number {
  const [a, b] = (ch ?? "9999.9").split(".").map(Number);
  return (a ?? 0) * 100 + (b ?? 0);
}

/** "Down wraps to 104.3, up is 90.7": where the buttons go, and whether they wrap at the band's ends. */
export function bandHint(channels: DialRowX[], currentId: string | null): string | null {
  const cur = channels.find((c) => c.station.id === currentId);
  if (!cur) return null;
  const down = neighbourOf(channels, currentId, "down");
  const up = neighbourOf(channels, currentId, "up");
  if (!down || !up) return null;
  const here = channelKey(cur.station.channel);
  const d = down.station.channel ?? "";
  const u = up.station.channel ?? "";
  const dWraps = channelKey(down.station.channel) > here;
  const uWraps = channelKey(up.station.channel) < here;
  return `Down ${dWraps ? "wraps to" : "is"} ${d}, up ${uWraps ? "wraps to" : "is"} ${u}`;
}

/** The instant of the next midnight in a time zone. */
export function nextMidnight(t: Date, timeZone: string): Date {
  const p = zoned(t, timeZone);
  const guess = Date.UTC(p.y, p.m - 1, p.d + 1);
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

interface Zoned {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

export function zoned(t: Date, timeZone: string): Zoned {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(t);
  const get = (k: Intl.DateTimeFormatPartTypes) => Number(parts.find((x) => x.type === k)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") };
}

/** The zone's offset from UTC at `t`, in ms (Pacific daylight time is −7 h). */
export function offsetMs(t: Date, timeZone: string): number {
  const p = zoned(t, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(t.getTime() / 60_000) * 60_000;
}

/**
 * "On BEAT tonight": the program on now (or next, when it's off air), what follows it until
 * midnight (at least three more, within the next 12 hours), and on the web the one before it, faded.
 */
export function tonightRows(schedule: AiringX[], now: Date, opts: { before: number; timeZone: string; after?: number }): AiringX[] {
  const list = [...schedule].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const t = now.getTime();
  let i = list.findIndex((a) => Date.parse(a.endsAt) > t);
  if (i < 0) return [];
  const midnight = nextMidnight(now, opts.timeZone).getTime();
  const out: AiringX[] = list.slice(Math.max(0, i - opts.before), i + 1);
  const min = opts.after ?? 3;
  let after = 0;
  for (let j = i + 1; j < list.length; j++) {
    const a = list[j]!;
    const start = Date.parse(a.startsAt);
    // Past midnight only to make up three rows, and never into tomorrow evening.
    if (start >= midnight && (after >= min || start > t + 12 * 3600e3)) break;
    out.push(a);
    after++;
  }
  return out;
}

/** Splits a leading "Live" off an airing's note, so it can be set in red: "Live from the studio" → "from the studio". */
export function liveRest(note: string | null | undefined): { live: boolean; rest: string } {
  if (!note) return { live: false, rest: "" };
  const m = /^Live\b[,.]?\s*/.exec(note);
  return m ? { live: true, rest: note.slice(m[0].length) } : { live: false, rest: note };
}

/**
 * The listing's words: the airing's note, then the program's description without the sentences
 * that repeat the note. "Live from the Redlands studio. Producers play unreleased tapes…".
 */
export function listingText(note: string | null | undefined, description: string | null | undefined): string {
  const n = (note ?? "").trim().replace(/\.$/, "");
  const sentences = (description ?? "").match(/[^.]+\.?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const rest = sentences.filter((s) => s.replace(/\.$/, "").toLowerCase() !== n.toLowerCase());
  return [n ? `${n}.` : "", ...rest].filter(Boolean).join(" ");
}

/**
 * Planned off air (G9): an `off_air` airing ("Off air", code OPEN), from sign-off to `backAt`.
 * It's not a program: nothing to tune to, remind or describe.
 */
export function isOffAir(a: Pick<AiringX, "kind"> | null | undefined): boolean {
  return a?.kind === "off_air";
}

/**
 * When an off air station is back: the player's own word (the stream's sign-off tag), then the
 * dial's `backAt`, then the off air airing's, then its next airing; null when nothing says.
 */
export function backAtOf(row: Pick<DialRowX, "now" | "next"> & { backAt?: string } | null | undefined, player?: { stationId: string; backAt: string | null } | null, stationId?: string): string | null {
  const fromPlayer = player && stationId && player.stationId === stationId ? player.backAt : null;
  const now = row?.now;
  return fromPlayer ?? row?.backAt ?? (isOffAir(now) ? (now!.backAt ?? now!.endsAt) : null) ?? row?.next?.startsAt ?? null;
}
