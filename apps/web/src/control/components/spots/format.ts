// How the Spots pages write things: rates, distances, runways, break summaries, sponsorship lines
// and dates. Pure, so the rules are tested (format.test.ts).

import { type BreakContent } from "@opencast/contracts";
import { duration, money } from "@opencast/ui";
import type { BreakPart } from "@opencast/ui";

// ---- Money and the market ----

export type Rate = { kind: "per_thousand" | "per_airing"; micros: number };

/** A spot's length as broadcast writes it: ":15", ":30", ":60". */
export function spotLength(sec: number): string {
  return `:${String(sec).padStart(2, "0")}`;
}

/** "$8.00" and "per 1,000 tuned in" / "an airing": as the business listed it, never an estimate. */
export function rateParts(r: Rate): { amount: string; unit: string } {
  return { amount: money(r.micros), unit: r.kind === "per_thousand" ? "per 1,000 tuned in" : "an airing" };
}

export function rateText(r: Rate): string {
  const p = rateParts(r);
  return `${p.amount} ${p.unit}`;
}

/** C.2 "1.2 miles"; biz-funding 05.1 "1.2 mi". */
export function milesText(miles: number | null, short = false): string | null {
  if (miles === null) return null;
  return `${miles.toFixed(1)} ${short ? "mi" : "miles"}`;
}

/** biz-funding 05.1: "About 44 days" over "at the current pace", or "Tops up automatically". Never the balance. */
export function runwayParts(r: { kind: "days"; days: number } | { kind: "tops_up" }): { main: string; sub: string | null } {
  if (r.kind === "tops_up") return { main: "Tops up automatically", sub: null };
  return { main: `About ${r.days} ${r.days === 1 ? "day" : "days"}`, sub: "at the current pace" };
}

/** C.2's pane: "6 airings a day on BEAT". */
export function upToText(n: number | null, callSign: string): string {
  if (n === null) return "No daily limit";
  return `${n} ${n === 1 ? "airing" : "airings"} a day on ${callSign}`;
}

/** ":30" or ":30, code on screen" (biz-funding 05.1). */
export function runsText(lengthSec: number, onScreen: string | null): string {
  return `${spotLength(lengthSec)}${onScreen ? ", code on screen" : ""}`;
}

/** Parses a typed amount ("140", "$140.00", "1,200.5") to micros, or null. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 10_000;
}

// ---- Dates ----

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 1" from "2026-10-01"; "Oct 1" with `short`. */
export function dateText(d: string, short = false): string {
  const [, m, day] = d.slice(0, 10).split("-").map(Number);
  const name = MONTHS[m - 1];
  return `${short ? name.slice(0, 3) : name} ${day}`;
}

/** "June" from "2026-06-01". */
export function monthText(d: string): string {
  return MONTHS[Number(d.slice(5, 7)) - 1];
}

/** The calendar date of a moment in the station's zone: "2026-09-24". */
export function localDate(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}

/**
 * Tonight in the station's zone: 5:00 pm to 6:00 am. Before 6:00 am it's still last night.
 * Returned as ISO instants for the log's window.
 */
export function tonightWindow(now: Date, timeZone: string): { from: string; to: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value])
  );
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day) - (Number(p.hour) < 6 ? 1 : 0);
  const at = (day: number, hour: number) => {
    // The zone's offset at that moment: guess in UTC, then correct by what the zone reads.
    const guess = Date.UTC(y, m - 1, day, hour);
    const read = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date(guess))
        .map((x) => [x.type, x.value])
    );
    const asRead = Date.UTC(Number(read.year), Number(read.month) - 1, Number(read.day), Number(read.hour), Number(read.minute));
    return new Date(guess - (asRead - guess)).toISOString();
  };
  return { from: at(d, 17), to: at(d + 1, 6) };
}

// ---- Breaks ----

export interface BreakView {
  aired: boolean;
  lengthMs: number;
  producerShareMs: number;
  openMs: number;
  /** Null when the break's contents aren't known (G1 absent). */
  contents: BreakContent[] | null;
}

/** The bar's parts: the producer's barter time, filled, just added, open (C.1, C.3). */
export function breakParts(b: BreakView, isNew: (c: BreakContent) => boolean = () => false): BreakPart[] {
  const parts: BreakPart[] = [];
  if (!b.contents) {
    const barter = b.producerShareMs;
    const filled = Math.max(0, b.lengthMs - b.openMs - barter);
    if (barter) parts.push({ kind: "barter", length: barter });
    if (filled) parts.push({ kind: "filled", length: filled });
    if (b.openMs) parts.push({ kind: "open", length: b.openMs });
    return parts;
  }
  const producer = b.contents.filter((c) => c.kind === "producer").reduce((a, c) => a + c.lengthMs, 0);
  const barter = Math.max(producer, b.producerShareMs);
  const station = b.contents.filter((c) => c.kind !== "producer" && c.kind !== "open");
  const added = station.filter(isNew).reduce((a, c) => a + c.lengthMs, 0);
  const filled = station.filter((c) => !isNew(c)).reduce((a, c) => a + c.lengthMs, 0);
  if (barter) parts.push({ kind: "barter", length: barter });
  if (filled) parts.push({ kind: "filled", length: filled });
  if (added) parts.push({ kind: "added", length: added });
  const open = Math.max(0, b.lengthMs - barter - filled - added);
  if (open) parts.push({ kind: "open", length: open });
  return parts;
}

/**
 * The line under a break's bar. Aired: "1:30 of 1:30 filled". Spots: their short names, or "All 3
 * spots" when every spot in the rotation is there, then the backups ("then Redlands Hardware", or
 * "Redlands Hardware (backup)"). No spots: "REEL fills 1:00", "ID and bumper only", "Underwriting only".
 */
export function breakSummary(b: BreakView, o: { rotationSize: number; barterOwner?: string | null }): string {
  if (b.aired) return `${duration(b.lengthMs - b.openMs)} of ${duration(b.lengthMs)} filled`;
  const c = b.contents ?? [];
  const name = (x: BreakContent) => x.shortName ?? x.business ?? x.title;
  const unique = (xs: string[]) => [...new Set(xs)];
  const main = c.filter((x) => x.kind === "spot" && x.rotation !== "backup");
  const backup = unique(c.filter((x) => x.kind === "spot" && x.rotation === "backup").map(name));
  const mainIds = unique(main.map((x) => x.spotId ?? name(x)));
  if (main.length || backup.length) {
    if (o.rotationSize >= 2 && mainIds.length >= o.rotationSize) {
      const all = o.rotationSize === 2 ? "Both spots" : `All ${o.rotationSize} spots`;
      return backup.length ? `${all}, then ${backup.join(", ")}` : all;
    }
    const backups = backup.length ? [`${backup.length > 1 ? `${backup.slice(0, -1).join(", ")} and ${backup.at(-1)}` : backup[0]} (backup)`] : [];
    return [...unique(main.map(name)), ...backups].join(", ");
  }
  const producer = c.filter((x) => x.kind === "producer").reduce((a, x) => a + x.lengthMs, 0);
  const station = c.filter((x) => x.kind !== "producer" && x.kind !== "open");
  if (producer && !station.length) return o.barterOwner ? `${o.barterOwner} fills ${duration(producer)}` : `Under barter, ${duration(producer)}`;
  if (station.some((x) => x.kind === "underwriting" || x.kind === "sponsor")) return "Underwriting only";
  if (station.length) return "ID and bumper only";
  return "Nothing in it yet";
}

/** The page's lede: "3:30 open across 4 breaks." (A28: computed from the rows.) */
export function openAcross(openMs: number, breaks: number): { open: string; rest: string } {
  const b = `${breaks} ${breaks === 1 ? "break" : "breaks"}`;
  return openMs > 0 ? { open: `${duration(openMs)} open`, rest: ` across ${b}.` } : { open: "No open time", rest: ` across ${b}.` };
}

// ---- Sponsorships ----

/** "All of BEAT, since June" / "Beat Tape Live, since August". */
export function sponsorScope(program: { title: string } | null, callSign: string, startsOn: string): string {
  return `${program ? program.title : `All of ${callSign}`}, since ${monthText(startsOn)}`;
}

/** The slate's lead: "Beat Tape Live is made possible by" / "Inland Beat is made possible by". */
export function creditLead(program: { title: string } | null, stationName: string): string {
  return `${program ? program.title : stationName} is made possible by`;
}

/** "from October 3": a program's first airing on or after a start date, by the station's calendar. Weekly programs step on a week at a time. */
export function firstAiring(startsOn: string, upcoming: { startsAt: string }[] | undefined, weekly: boolean, timeZone: string): string {
  const days = (upcoming ?? []).map((u) => u.startsAt).sort();
  const at = days.find((t) => localDate(t, timeZone) >= startsOn);
  if (at) return dateText(localDate(at, timeZone));
  const last = days.at(-1);
  if (weekly && last) {
    let t = Date.parse(last);
    while (localDate(new Date(t), timeZone) < startsOn) t += 7 * 86400e3;
    return dateText(localDate(new Date(t), timeZone));
  }
  return dateText(startsOn);
}
