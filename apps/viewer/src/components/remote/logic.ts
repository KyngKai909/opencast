// The phone remote's rules: the rocker's neighbours, the keypad's entry and countdown, the presets
// strip against what the TV shows. Pure, so they're tested on their own.

import { neighbour, readEntry, typeKey, type NumberEntry } from "@opencast/player";
import type { DialRowX } from "../../api/ext";
import type { PresetView } from "../../data/viewer";

/** Up and down the dial from what the TV shows, in the TV's band ("Up: 9.1 RDLS", "Down: 31.1 PREP"). */
export function rockerNeighbours(channels: DialRowX[], stationId: string | null): { up: DialRowX | null; down: DialRowX | null } {
  if (!stationId) return { up: null, down: null };
  return { up: neighbour(channels, stationId, "up", { sameBand: true }) as DialRowX | null, down: neighbour(channels, stationId, "down", { sameBand: true }) as DialRowX | null };
}

export function identText(row: DialRowX | null): string {
  return row ? [row.station.channel, row.station.callSign].filter(Boolean).join(" ") : "";
}

// ---------- The keypad (06.4) ----------

/** The phone's wait before tuning: the TV's default number wait (2 seconds), counted down on screen. */
export const KEYPAD_WAIT_S = 2;

export type KeypadKey = number | "." | "back";

/** The typed digits after a key: digits and one dot, five at most; back removes the last. */
export function pressKey(typed: string, key: KeypadKey): string {
  if (key === "back") return typed.slice(0, -1);
  return typeKey(typed, key) ?? typed;
}

export function keypadEntry(typed: string, channels: DialRowX[]): NumberEntry | null {
  return typed ? readEntry(typed, channels) : null;
}

/** "Tuning in 1 second", "Tuning in 2 seconds". */
export function tuningIn(seconds: number): string {
  return `Tuning in ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** The line under the readout: call sign and station name, as the TV's number entry says it ("REEL, Saturday Reel. Tuning in 1 second"); a number with no station names the nearest two. */
export function keypadLine(entry: NumberEntry | null, secondsLeft: number | null): { lead: string; rest: string } | null {
  if (!entry) return null;
  if (entry.match) {
    const m = entry.match as DialRowX;
    const what = m.station.name;
    const count = secondsLeft !== null && secondsLeft > 0 ? `. ${tuningIn(secondsLeft)}` : "";
    return { lead: m.station.callSign ?? m.station.channel ?? "", rest: `, ${what}${count}` };
  }
  if (entry.typed.length < 2 && !entry.typed.includes(".")) return null;
  const near = entry.nearest.map((c) => [c.station.channel, c.station.callSign].filter(Boolean).join(" ")).join(", ");
  return { lead: `No station on ${entry.typed}`, rest: near ? `. Nearest: ${near}` : "" };
}

/** The channel a keypad entry tunes, or null. */
export function keypadChannel(entry: NumberEntry | null): string | null {
  return entry?.match?.station.channel ?? null;
}

// ---------- Presets (06.3) ----------

export interface RemotePreset {
  key: number;
  preset: PresetView | null;
}

/** The six keys, filled or empty, from the account's (or this device's) presets. */
export function presetStrip(presets: PresetView[]): RemotePreset[] {
  return Array.from({ length: 6 }, (_, i) => ({ key: i + 1, preset: presets.find((p) => p.key === i + 1) ?? null }));
}
