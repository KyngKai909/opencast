// The rules behind the tuned-in page, kept out of the components so they can be tested: which
// station a URL means, keeping the URL in step with the channel on air, the dial's neighbours and
// tonight's rows. (The phone and tablet's swipe has its own: components/swipe.)

import { neighbour, type Command } from "@opencast/player";
import type { AiringX, DialRowX, StationPageX } from "../../api/ext";

type Ident = { id: string; callSign: string | null; handle: string | null; name?: string; channel: string | null; slug?: string; sharesCallSign?: boolean };

/**
 * The URL part for a station: the API's `slug` (A229: "rivc-15-2" for a station sharing X.1's
 * call sign), else its call sign in lower case ("beat"), or its handle.
 */
export function stationSlug(s: Pick<Ident, "id" | "callSign" | "handle"> & { slug?: string }): string {
  return (s.slug ?? s.callSign ?? s.handle ?? s.id).toLowerCase();
}

/** What a station is called on a button: its call sign, or its handle. (A URL param takes `stationSlug`.) */
export function callSignOf(s: Pick<Ident, "id" | "callSign" | "handle">): string {
  return s.callSign ?? s.handle ?? s.id;
}

/** Its call sign where only a call sign fits, with the channel when the call sign is shared ("RIVC 15.2"). */
export function callSignLabelOf(s: Pick<Ident, "id" | "callSign" | "handle" | "channel"> & { sharesCallSign?: boolean }): string {
  const cs = callSignOf(s);
  return s.sharesCallSign && s.callSign && s.channel ? `${cs} ${s.channel}` : cs;
}

export function identText(s: Pick<Ident, "callSign" | "channel">): string {
  return [s.callSign, s.channel].filter(Boolean).join(" ");
}

/**
 * The dial row a `/watch/:stationRef` means: by id, by its address ("rivc-15-2"), then by call sign
 * (a shared one means X.1, whose address it is) or handle, so every older link still finds it.
 */
export function resolveStation(channels: DialRowX[], ref: string | undefined): DialRowX | null {
  if (!ref) return null;
  const r = ref.toLowerCase();
  return (
    channels.find((c) => c.station.id === ref) ??
    channels.find((c) => stationSlug(c.station) === r) ??
    channels.find((c) => c.station.callSign?.toLowerCase() === r || c.station.handle?.toLowerCase() === r) ??
    null
  );
}

/**
 * A station from outside the market's dial (a nearby market's, linked from a thin dial), as a dial
 * row the player can tune: what's on, what's next and where its picture comes from.
 */
export function rowFromPage(p: Pick<StationPageX, "station" | "onAir" | "now" | "upNext" | "playback" | "external">): DialRowX {
  // An external station keeps what it is (follow-up Phase 6); while it's down, the player stands by.
  const external = p.external ? { source: p.external.source, plays: p.external.plays, schedule: p.external.schedule } : undefined;
  return { station: p.station, onAir: p.onAir, now: p.now, next: p.upNext[0] ?? null, playback: p.playback, ...(external ? { external } : {}) };
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

/**
 * The dial's neighbour, the way the player moves: in channel order, within the band, wrapping.
 * `skipDash`: this device can't play DASH, so the player skips DASH stream links (A226).
 */
export function neighbourOf(channels: DialRowX[], currentId: string | null, dir: "up" | "down", skipDash = false): DialRowX | null {
  return neighbour(channels, currentId, dir, { sameBand: true, skipDash }) as DialRowX | null;
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

/**
 * The tuned-in page's keys: ▲ ▼ change channel, the space bar (or k) pauses and resumes, l (or
 * End) goes back to live. Never with a modifier, in a text field, or inside a dialog, radio group,
 * menu, list box or tab list; the space bar leaves a focused button, link or slider alone, and End
 * a slider.
 */
export function watchKey(e: Pick<KeyboardEvent, "key" | "defaultPrevented" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">): Command | null {
  const toggle = e.key === " " || e.key === "k";
  const live = e.key === "l" || e.key === "End";
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && !toggle && !live) return null;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const t = e.target as HTMLElement | null;
  if (t && t.tagName && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest('[role="dialog"], [role="radiogroup"], [role="menu"], [role="listbox"], [role="tablist"]'))) return null;
  // Space on a focused button or link presses it; leave that alone.
  if (toggle && t?.closest?.("button, a, [role='button'], [role='slider']")) return null;
  // End on a slider moves it to its end.
  if (e.key === "End" && t?.closest?.("[role='slider']")) return null;
  if (toggle) return { type: "togglePlay" };
  if (live) return { type: "backToLive" };
  return { type: "channel", dir: e.key === "ArrowUp" ? "up" : "down" };
}
