// The rules home, the radio band and first visit follow: which program gets the hero, what the
// chips keep, when a market is thin, which market is nearest, and how a few lines are worded.
// Plain functions, so the rules are tested on their own (logic.test.ts).

import { clock } from "@opencast/ui";
import type { AiringX, DialRowX, DialX } from "../../api/ext";

// ---------- channel order ----------

/** "12.1" → [12, 1]; "88.3" → [88, 3]. */
function channelParts(channel: string | null | undefined): [number, number] {
  const [a = "0", b = "0"] = (channel ?? "0.0").split(".");
  return [Number(a) || 0, Number(b) || 0];
}

/** Sorts by channel (or frequency), the same every time. */
export function byChannel<T extends { station: { channel?: string | null } }>(a: T, b: T): number {
  const [a1, a2] = channelParts(a.station.channel);
  const [b1, b2] = channelParts(b.station.channel);
  return a1 - b1 || a2 - b2;
}

// ---------- the hero ----------

export type HeroWhy = "local" | "carried" | "preset";
export interface HeroPick {
  row: DialRowX;
  why: HeroWhy;
}

/** A live airing on a station in `marketSlug` that the market makes itself (not carried in from elsewhere). */
function carriedIn(row: DialRowX, marketSlug: string): boolean {
  const from = row.now?.carriedFrom;
  return !!from && !!from.marketSlug && from.marketSlug !== marketSlug;
}

/**
 * What gets the hero (home 01 note): live programming in your market first, then a live program
 * carried into your market, then whatever preset 1 is airing. Never popularity. Ties go to channel
 * order. The hero is a picture, so it's picked from the TV band; preset 1 may be on either band.
 */
export function pickHero(rows: DialRowX[], marketSlug: string, preset1?: DialRowX | null): HeroPick | null {
  const live = rows
    .filter((r) => r.station.band !== "radio" && r.onAir && r.now?.live)
    .sort(byChannel);
  const local = live.find((r) => !carriedIn(r, marketSlug));
  if (local) return { row: local, why: "local" };
  const carried = live.find((r) => carriedIn(r, marketSlug));
  if (carried) return { row: carried, why: "carried" };
  if (preset1 && preset1.onAir && preset1.now) return { row: preset1, why: "preset" };
  return null;
}

// ---------- chips ----------

export const CHIP_ALL = "all";
export const CHIP_LIVE = "live";
/** The reference's order for the categories; any others follow, A to Z. */
const CATEGORY_ORDER = ["Public affairs", "Music", "Classic", "Food", "Sports"];

/** All, Live now, then each category the dial actually has. */
export function chipOptions(rows: DialRowX[]): Array<{ value: string; label: string }> {
  const present = new Set(rows.map((r) => r.station.category).filter((c): c is string => !!c));
  const known = CATEGORY_ORDER.filter((c) => present.has(c));
  const others = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b));
  return [{ value: CHIP_ALL, label: "All" }, { value: CHIP_LIVE, label: "Live now" }, ...[...known, ...others].map((c) => ({ value: c, label: c }))];
}

/** The rows a chip keeps, still in channel order. */
export function filterRows(rows: DialRowX[], chip: string): DialRowX[] {
  if (chip === CHIP_ALL) return rows;
  if (chip === CHIP_LIVE) return rows.filter((r) => r.onAir && !!r.now?.live);
  return rows.filter((r) => r.station.category === chip);
}

// ---------- thin markets ----------

/** Fewer stations than this, on both bands together, and the market is thin. */
export const THIN_BELOW = 3;

/**
 * A market is thin when the API sends a nearby market with its dial (it does that only for thin
 * markets), or, failing that, when both bands together have fewer than three stations.
 */
export function isThin(tv: Pick<DialX, "rows" | "nearby"> | undefined, radio: Pick<DialX, "rows" | "nearby"> | undefined): boolean {
  if (!tv && !radio) return false;
  if ((tv?.nearby.length ?? 0) > 0 || (radio?.nearby.length ?? 0) > 0) return true;
  return (tv?.rows.length ?? 0) + (radio?.rows.length ?? 0) < THIN_BELOW;
}

/** A thin dial lists both bands in one list: the TV band, then the radio band, each in channel order. */
export function thinRows(tv: DialRowX[], radio: DialRowX[]): DialRowX[] {
  return [...[...tv].sort(byChannel), ...[...radio].sort(byChannel)];
}

/** "2 stations so far", "1 station so far", "No stations so far". */
export function soFarText(n: number): string {
  return n === 0 ? "No stations so far" : `${n} ${n === 1 ? "station" : "stations"} so far`;
}

/** "6 stations", "1 station". */
export function stationsText(n: number): string {
  return `${n} ${n === 1 ? "station" : "stations"}`;
}

const REGION_WORDS = /\b(Desert|Empire|Valley|Coast|Bay|Basin|Plains|Hills|Mountains|Delta|Islands|Peninsula|Panhandle|Area|Region|Shore|Keys)$/;

/** "the High Desert", but "Los Angeles": regions take "the", cities don't. */
export function placeName(name: string): string {
  return REGION_WORDS.test(name.trim()) ? `the ${name}` : name;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The TV band's channels: 2 to 69. */
export const TV_CHANNELS: [number, number] = [2, 69];

/**
 * "The High Desert has room on the dial. Any channel from 2 to 69 is open except 5." Names the open
 * channels from the dial's open list (contract request S11).
 */
export function openChannelsText(marketName: string, openTv: string[] | undefined): string {
  const room = `${sentenceCase(placeName(marketName))} has room on the dial.`;
  if (!openTv) return room;
  const [lo, hi] = TV_CHANNELS;
  const open = new Set(openTv.map((c) => parseInt(c, 10)).filter((n) => n >= lo && n <= hi));
  if (open.size === 0) return room;
  const taken: string[] = [];
  for (let c = lo; c <= hi; c++) if (!open.has(c)) taken.push(String(c));
  if (taken.length === 0) return `${room} Any channel from ${lo} to ${hi} is open.`;
  if (taken.length <= 6) return `${room} Any channel from ${lo} to ${hi} is open except ${listWords(taken)}.`;
  return `${room} ${open.size} channels from ${lo} to ${hi} are open.`;
}

// ---------- first visit: the nearest market ----------

export interface Point {
  lat: number;
  lng: number;
}

/** Miles between two points, as the crow flies. */
export function milesApart(a: Point, b: Point): number {
  const R = 3959;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Farther than this from every market, and "Use my location" says there's none near you. */
export const NEAREST_WITHIN_MILES = 150;

/**
 * The open market nearest to where you are, from each market's centre, worked out on the device so
 * your location isn't sent anywhere. Null when no open market is within 150 miles, or none has a centre.
 */
export function nearestMarket<M extends { open: boolean; centre?: Point }>(here: Point, markets: M[], within = NEAREST_WITHIN_MILES): { market: M; miles: number } | null {
  let best: { market: M; miles: number } | null = null;
  for (const m of markets) {
    if (!m.open || !m.centre) continue;
    const miles = milesApart(here, m.centre);
    if (miles <= within && (!best || miles < best.miles)) best = { market: m, miles };
  }
  return best;
}

// ---------- wording ----------

function localDay(t: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86400e3;
}

function localHour(t: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(t));
}

/** "Tonight" (from 5:00 pm), "Today", "Tomorrow", a weekday within the week, then "Sat, Oct 10". */
export function dayLabel(at: string | Date, now: Date, timeZone: string): string {
  const t = at instanceof Date ? at : new Date(at);
  const days = localDay(t, timeZone) - localDay(now, timeZone);
  if (days <= 0) return localHour(t, timeZone) >= 17 ? "Tonight" : "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(t);
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(t);
}

type Ident = { callSign?: string | null; channel?: string | null };
export function identText(s: Ident): string {
  return [s.callSign, s.channel].filter(Boolean).join(" ");
}

/** Where a widely carried program is on in this market: "On BEAT 12.1 now", "Next on CIVC at 11:30 pm". */
export function carriedWhere(where: { station: Ident & { id: string }; airing: AiringX; onNow: boolean } | null, makerId: string, timeZone: string): { live: boolean; text: string } | null {
  if (!where) return null;
  const cs = where.station.callSign ?? "";
  if (where.onNow && where.airing.live) return { live: true, text: `Live on ${cs} now` };
  if (where.onNow) return { live: false, text: where.station.id === makerId ? `On ${cs} until ${clock(where.airing.endsAt, { timeZone })}` : `On ${identText(where.station)} now` };
  return { live: false, text: `Next on ${cs} at ${clock(where.airing.startsAt, { timeZone })}` };
}

/** "BEAT 12.1", or "RDLS 9.1, listed from the city’s stream". */
export function upStationLine(station: Ident, listed: boolean): string {
  return listed ? `${identText(station)}, listed from the city’s stream` : identText(station);
}

/**
 * The line under a radio row's title: the episode ("Now: The Hollow Door, part 2"), or the airing's
 * note. A live airing leads with Live, in red text; a note that already starts with "Live" isn't doubled.
 */
export function radioDetail(now: Pick<AiringX, "live" | "episodeTitle" | "note"> | null): { live: boolean; text: string | null } {
  if (!now) return { live: false, text: null };
  if (now.episodeTitle) return { live: !!now.live, text: `Now: ${now.episodeTitle}` };
  let text = now.note?.trim() || null;
  if (now.live && text && /^live\b/i.test(text)) text = text.replace(/^live\s*/i, "") || null;
  return { live: !!now.live, text };
}
