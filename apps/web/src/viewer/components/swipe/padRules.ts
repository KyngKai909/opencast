// The Tune pad's rules (swipe home 04 and 08, "Tune button"): type a channel (18, or 18.2 for a
// subchannel) or a frequency (90.7), and the number says the band: 2 to 69 is TV, a whole number
// meaning .1; 88.1 to 107.9 is radio. As you type it names the station and what's on; a number with
// no station says so and names the nearest, instead of tuning into nothing. It tunes 2 seconds
// after the last key, or at once on Tune, always with the full channel change (static, the corner
// number, the banner), like a number typed on the TV remote. Radio digits typed without the point
// work too, as on the remote's keypad: 8, 8, 4 is 88.4.

import { typeKey } from "@opencast/player";
import type { DialRowX } from "../../api/ext";

/** It tunes this long after the last key. */
export const PAD_WAIT_MS = 2000;
export const TV_MIN = 2;
export const TV_MAX = 69;
export const RADIO_MIN = 88.1;
export const RADIO_MAX = 107.9;

export type PadKey = number | "." | "del";

export type PadRead =
  /** Nothing typed yet. */
  | { kind: "empty" }
  /** Not a channel yet, but more digits could make it one ("1" on the way to "12"). */
  | { kind: "partial"; typed: string }
  /** Outside both bands. */
  | { kind: "out_of_range"; typed: string }
  | { kind: "match"; band: "tv" | "radio"; channel: string; row: DialRowX }
  | { kind: "none"; band: "tv" | "radio"; channel: string; nearest: DialRowX | null };

/** The digits after a key: digits and one point, five characters at most; delete takes the last. */
export function padKey(typed: string, key: PadKey): string {
  if (key === "del") return typed.slice(0, -1);
  return typeKey(typed, key) ?? typed;
}

/** The channel a typed number means, and its band, or null when it's on neither band. */
export function padChannel(typed: string): { band: "tv" | "radio"; channel: string } | null {
  if (!typed || !/^\d+(\.\d*)?$/.test(typed)) return null;
  const [major, minor = ""] = typed.split(".");
  const m = Number(major);
  if (typed.includes(".")) {
    if (m >= TV_MIN && m <= TV_MAX) return { band: "tv", channel: `${m}.${minor || "1"}` };
    const f = Number(`${m}.${minor || "0"}`);
    if (minor.length <= 1 && f >= RADIO_MIN && f <= RADIO_MAX) return { band: "radio", channel: f.toFixed(1) };
    return null;
  }
  // A whole number: TV's .1, a whole frequency, or a frequency's digits (884 is 88.4).
  if (m >= TV_MIN && m <= TV_MAX) return { band: "tv", channel: `${m}.1` };
  if (m >= Math.ceil(RADIO_MIN) && m <= Math.floor(RADIO_MAX)) return { band: "radio", channel: m.toFixed(1) };
  const f = m / 10;
  if (major.length >= 3 && f >= RADIO_MIN && f <= RADIO_MAX) return { band: "radio", channel: f.toFixed(1) };
  return null;
}

function sameChannel(a: string | null, b: string, band: "tv" | "radio"): boolean {
  if (!a) return false;
  return band === "radio" ? Math.abs(Number(a) - Number(b)) < 1e-6 : a === b;
}

function bandOf(r: DialRowX): "tv" | "radio" {
  return r.station.band === "radio" ? "radio" : "tv";
}

/** The station nearest a number on its band, by channel number (ties go to the lower). */
export function nearestOnBand(channel: string, band: "tv" | "radio", channels: readonly DialRowX[]): DialRowX | null {
  const n = Number(channel);
  let best: DialRowX | null = null;
  let d = Infinity;
  for (const r of channels) {
    if (bandOf(r) !== band || !r.station.channel) continue;
    const dd = Math.abs(Number(r.station.channel) - n);
    if (dd < d || (dd === d && best && Number(r.station.channel) < Number(best.station.channel))) {
      d = dd;
      best = r;
    }
  }
  return best;
}

/** What the typed number means: a station, no station (with the nearest), or not a channel. */
export function readPad(typed: string, channels: readonly DialRowX[]): PadRead {
  if (!typed) return { kind: "empty" };
  const c = padChannel(typed);
  if (!c) {
    const grows = typed.length < 5 && !typed.includes(".") && [..."0123456789"].some((k) => padChannel(typed + k));
    return grows ? { kind: "partial", typed } : { kind: "out_of_range", typed };
  }
  const row = channels.find((r) => bandOf(r) === c.band && sameChannel(r.station.channel, c.channel, c.band)) ?? null;
  if (row) return { kind: "match", band: c.band, channel: row.station.channel ?? c.channel, row };
  return { kind: "none", band: c.band, channel: c.channel, nearest: nearestOnBand(c.channel, c.band, channels) };
}

/** The station's line: "SAZN 18.1". */
export function identOf(r: DialRowX): string {
  return [r.station.callSign ?? r.station.name, r.station.channel].filter(Boolean).join(" ");
}

/**
 * The pad's two lines under the number, in the reference's words: "SAZN 18.1" over "Now: Tamales
 * for forty, 18 min left"; "No station on 45" over "Nearest is LUPE 33.1."
 */
export function padLines(read: PadRead, now: Date): { lead: string | null; rest: string; none: boolean } {
  switch (read.kind) {
    case "empty":
    case "partial":
      return { lead: null, rest: "Type a channel or frequency. It tunes 2 seconds after you stop, or press Tune.", none: false };
    case "out_of_range":
      return { lead: `No channel ${read.typed}`, rest: `TV runs ${TV_MIN} to ${TV_MAX}, radio ${RADIO_MIN} to ${RADIO_MAX}.`, none: true };
    case "none":
      return { lead: `No station on ${read.channel}`, rest: read.nearest ? `Nearest is ${identOf(read.nearest)}.` : "Nothing on that band here yet.", none: true };
    case "match": {
      const r = read.row;
      const on = r.onAir && r.now && r.now.kind !== "off_air" ? r.now : null;
      const what = on ? `Now: ${on.title}${leftText(on.endsAt, now)}` : "Off air now.";
      return { lead: identOf(r), rest: read.band === "radio" ? `Radio band. ${what}` : what, none: false };
    }
  }
}

/** ", 18 min left", ", 1 hr 18 min left". */
export function leftText(endsAt: string, now: Date): string {
  const min = Math.max(0, Math.round((Date.parse(endsAt) - now.getTime()) / 60_000));
  if (!Number.isFinite(min)) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `, ${h ? `${h} hr ` : ""}${h && !m ? "" : `${m} min `}left`;
}
