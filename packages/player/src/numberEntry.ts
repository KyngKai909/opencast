// Tune by number. Typing 1 then 2 shows "12" with the ".1" filled in and the station it will tune
// to; it tunes after a short wait, or at once on OK. A number with no station says so, names the
// nearest two, and stays on the current channel. Radio frequencies type as digits: 8, 8, 3 is 88.3.

import type { Channel } from "./types";
import { inChannelOrder } from "./dial";

export interface NumberEntry {
  /** What was typed: "12", "12.2", "883". */
  typed: string;
  /** How it reads on screen: the typed part and the filled-in part ("12" + ".1"). */
  shown: { typed: string; filled: string };
  /** The station it will tune to, if any. */
  match: Channel | null;
  /** When nothing matches: the two nearest stations, by channel number. */
  nearest: Channel[];
}

const MAX = 5;

function asChannel(typed: string, channels: Channel[]): { channel: string; filled: string } | null {
  if (!typed) return null;
  if (typed.includes(".")) return typed.endsWith(".") ? { channel: `${typed}1`, filled: "1" } : { channel: typed, filled: "" };
  const tv = `${typed}.1`;
  if (channels.some((c) => c.station.channel === tv)) return { channel: tv, filled: ".1" };
  // Radio: the last digit is the tenth (883 → 88.3, 1019 → 101.9).
  if (typed.length >= 3) {
    const radio = `${typed.slice(0, -1)}.${typed.slice(-1)}`;
    if (channels.some((c) => c.station.channel === radio)) return { channel: radio, filled: "" };
  }
  return { channel: tv, filled: ".1" };
}

function numeric(channel: string): number {
  return Number(channel);
}

export function readEntry(typed: string, channels: Channel[]): NumberEntry {
  const target = asChannel(typed, channels);
  const match = target ? channels.find((c) => c.station.channel === target.channel) ?? null : null;
  const shown = { typed: target?.filled === "1" ? typed : typed, filled: target?.filled ?? "" };
  let nearest: Channel[] = [];
  if (!match && target) {
    const n = numeric(target.channel);
    nearest = inChannelOrder(channels)
      .filter((c) => c.station.channel)
      .sort((a, b) => Math.abs(numeric(a.station.channel!) - n) - Math.abs(numeric(b.station.channel!) - n))
      .slice(0, 2);
    nearest = inChannelOrder(nearest);
  }
  return { typed, shown, match, nearest };
}

/** Adds a digit or the dot. Returns null when the key can't be added (too long, a second dot). */
export function typeKey(typed: string, key: number | "."): string | null {
  if (key === ".") return typed.includes(".") || !typed ? null : `${typed}.`;
  if (typed.length >= MAX) return null;
  return `${typed}${key}`;
}

/** "No station on 13": the words the reference uses when a number has no station. */
export function noStationText(entry: NumberEntry): string {
  const n = entry.typed.includes(".") ? entry.typed : entry.typed;
  return `No station on ${n}`;
}
