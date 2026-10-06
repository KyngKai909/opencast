// An external station's "what's on" (follow-up Phase 6): the source's own calendar or schedule
// feed, in whichever of the four shapes sources publish: iCalendar, RSS (with the RSS event
// module's start and end, else each item's date), JSON (an array of events, or an object holding them as `events`, `items`, `upcoming` and the like)
// or XMLTV (guide data). A241 (2026-10-01): or a web page's own event data, the schema.org JSON-LD
// in its `<script type="application/ld+json">` blocks (lib/jsonLd.ts). Titles are the source's own;
// nothing is made up, and an entry without a title or a start time is left out.
// 2026-10-03: a JSON feed keyed by channel (`{ "whiplash": {…}, "atlas": {…} }`, one feed for a
// brand's channels) is read for the station's own channel only: the address's `#channel=`, else
// the listing's name, else its stream's folder. No match, no events: never another channel's.
// A248 (2026-10-06): or a spreadsheet (`sheet`): a Google Sheet, a .csv, .tsv, .xlsx or .ods file, or
// an answer that's a spreadsheet's type or a workbook's bytes. Its rows are read by lib/sheetFiles.ts
// and its schedule by lib/sheetSchedule.ts, from the answer's bytes (network/external.ts).

import { parseIcs, type CalendarEvent } from "./ics.js";
import { parseJsonLdEvents } from "./jsonLd.js";
import { isSheetAddress, kindFromType } from "./sheetFiles.js";

export type ScheduleFormat = "ical" | "rss" | "json" | "xmltv" | "webpage" | "sheet";

/** A241: an answer that's a web page: an HTML type, or text that starts like one. */
function isWebpage(contentType: string | null, head: string): boolean {
  if (/^<!doctype\s+html|^<html[\s>]/i.test(head)) return true;
  // A server that labels everything text/html still sends its feeds as XML or JSON.
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType ?? "")) return false;
  return !/^(<\?xml|<rss[\s>]|<feed[\s>]|<tv[\s>]|<!doctype\s+tv|[{[]|BEGIN:VCALENDAR)/i.test(head);
}

/** A248: text that reads as comma- or tab-separated rows: a few lines, each with a separator, none of it markup. */
function looksDelimited(text: string): boolean {
  if (/^[<{[]/.test(text.trimStart())) return false;
  const lines = text.slice(0, 4000).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 6);
  return lines.length >= 2 && lines.every((l) => /[,\t]/.test(l));
}

/** The format from the address, then the answer's type, then the text itself. */
export function detectScheduleFormat(url: string, contentType: string | null, text: string): ScheduleFormat {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".ics") || /text\/calendar/i.test(contentType ?? "")) return "ical";
  // A248: a spreadsheet's address or type, or a workbook's bytes (a zip).
  if (isSheetAddress(url) || kindFromType(contentType) || text.startsWith("PK\u0003\u0004")) return "sheet";
  const head = text.trimStart().slice(0, 400);
  if (head.startsWith("BEGIN:VCALENDAR")) return "ical";
  if (isWebpage(contentType, head)) return "webpage";
  if (head.startsWith("{") || head.startsWith("[") || /json/i.test(contentType ?? "")) return "json";
  if (/<tv[\s>]/i.test(text.slice(0, 2000)) || path.endsWith(".xmltv")) return "xmltv";
  if (!/<(rss|feed|item|entry)[\s>]/i.test(text.slice(0, 4000)) && looksDelimited(text)) return "sheet";
  return "rss";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text inside an element, with CDATA unwrapped and entities decoded. */
function textOf(xml: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(xml);
  const raw = cdata ? cdata[1] : xml.replace(/<[^>]+>/g, "");
  return raw
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function element(block: string, names: string[]): string | null {
  for (const name of names) {
    const found = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
    if (found) return textOf(found[1]);
  }
  return null;
}

function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

function parseRss(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const [, block] of text.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)) {
    const summary = element(block, ["title"]);
    // The RSS event module's start, else a feed's own start field, else the item's date.
    const start = date(element(block, ["ev:startdate", "startdate", "start", "dtstart", "pubDate", "published", "updated"]));
    if (!summary || !start) continue;
    const end = date(element(block, ["ev:enddate", "enddate", "end", "dtend"]));
    events.push({ uid: element(block, ["guid", "id"]), summary, start, end: end && end > start ? end : null });
  }
  return events;
}

/** Where a schedule's lists go in the shapes seen in the wild; the single object for what's on now comes first. */
const JSON_NOW_KEYS = ["active", "current", "now_playing", "nowPlaying", "onNow"];
const JSON_LIST_KEYS = ["events", "items", "upcoming", "schedule", "shows", "programs", "programmes", "airings", "entries", "data", "results"];

/**
 * A JSON schedule's events: an array, or an object holding them under one of the usual names
 * (`{ "active": {…}, "upcoming": [ … ] }` from a show-schedule plugin, 2026-10-03), one level down
 * too (`{ "data": { "events": [ … ] } }`).
 */
function jsonEventList(data: unknown, depth = 0): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object" || depth > 1) return [];
  const o = data as Record<string, unknown>;
  const list: unknown[] = [];
  for (const k of JSON_NOW_KEYS) if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) list.push(o[k]);
  for (const k of JSON_LIST_KEYS) {
    const found = jsonEventList(o[k], depth + 1);
    if (found.length) return [...list, ...found];
  }
  return list;
}

const TITLE_KEYS = ["title", "name", "summary"];
const START_KEYS = ["start", "startsAt", "start_time", "startTime", "startDate", "dtstart"];
const END_KEYS = ["end", "endsAt", "end_time", "endTime", "endDate", "dtend", "stop"];

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
  return null;
}

/** An object that reads as one event: a title and a start under the usual names. */
function eventLike(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return pick(o, TITLE_KEYS) !== null && pick(o, START_KEYS) !== null;
}

/** What a station gives to find its channel in a feed keyed by channel. */
export interface ChannelHints {
  name?: string | null;
  streamUrl?: string | null;
}

/** Lowercase letters and digits only: "Whiplash II" and "whiplashii" are the same. */
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The stream address's folders, nearest the file first: `…/whiplash-biwi/tracks-v1a1/mono.m3u8` →
 * "tracks-v1a1", "whiplash-biwi" (a player's own folders can sit under the channel's).
 */
function streamFolders(url: string | null | undefined): string[] {
  if (!url) return [];
  try {
    return new URL(url).pathname.split("/").slice(1, -1).reverse().map((p) => decodeURIComponent(p));
  } catch {
    return [];
  }
}

/** Words a station's name adds that a feed's key leaves off: "Biwi Channel" → "Biwi" (2026-10-04). */
const NAME_EXTRAS = /(\s+(channel|tv|television|network|live|hd))+$/i;

/**
 * 2026-10-03: the station's channel in a feed keyed by channel. The fragment names it
 * (`#channel=atlas`); else the listing's name (as given, then without a trailing "Channel", "TV"
 * and the like) or one of its stream's folders, made plain, is a key ("Window TV" → windowtv,
 * "Biwi Channel" → biwi) or, failing that, ends with the longest key ("Whiplash Atlas" → atlas,
 * the folder "whiplash-biwi" → biwi).
 */
function pickChannel(keys: string[], fragment: string | null, hints: ChannelHints): string | null {
  if (fragment !== null) return keys.find((k) => k === fragment) ?? keys.find((k) => plain(k) === plain(fragment)) ?? null;
  const name = hints.name ?? "";
  const names = [...new Set([name, name.replace(NAME_EXTRAS, ""), ...streamFolders(hints.streamUrl)].map(plain).filter(Boolean))];
  for (const n of names) {
    const exact = keys.find((k) => plain(k) === n);
    if (exact) return exact;
  }
  for (const n of names) {
    // Three letters at least, so a stray "tv" or "2" never claims a station.
    const ends = keys.filter((k) => plain(k).length >= 3 && n.endsWith(plain(k))).sort((a, b) => plain(b).length - plain(a).length);
    if (ends.length) return ends[0];
  }
  return null;
}

/**
 * 2026-10-03: an object keyed by channel whose values are (mostly) events, or lists of them:
 * the station's channel's events, or none. Null when it isn't that shape.
 */
function channelEvents(data: unknown, fragment: string | null, hints: ChannelHints): unknown[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const values = Object.values(o).filter((v) => v !== null && v !== undefined);
  const events = values.filter((v) => eventLike(v) || (Array.isArray(v) && v.length > 0 && eventLike(v.find((x) => x !== null))));
  if (!events.length || events.length * 2 < values.length) return null;
  const key = pickChannel(Object.keys(o), fragment, hints);
  if (key === null) return [];
  const value = o[key];
  return eventLike(value) ? [value] : jsonEventList(value);
}

function parseJson(text: string, fragment: string | null, hints: ChannelHints): CalendarEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const found = jsonEventList(data);
  const list = found.length ? found : (channelEvents(data, fragment, hints) ?? []);
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const summary = pick(o, TITLE_KEYS);
    const start = date(pick(o, START_KEYS));
    if (!summary || !start) continue;
    const end = date(pick(o, END_KEYS));
    // What's on now can be listed twice (on its own and in the list): once is enough.
    const key = `${summary}@${start.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = o.id ?? o.uid;
    events.push({ uid: id === undefined || id === null ? null : String(id), summary, start, end: end && end > start ? end : null });
  }
  return events;
}

/** XMLTV's time: `20260926190000 -0700` (the offset optional: UTC). */
function xmltvDate(value: string | null): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value?.trim() ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", off] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!off) return new Date(utc);
  const sign = off[0] === "-" ? -1 : 1;
  const minutes = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5)));
  return new Date(utc - minutes * 60_000);
}

function parseXmltv(text: string, channel: string | null): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const [, attrs, block] of text.matchAll(/<programme\s([^>]*)>([\s\S]*?)<\/programme>/gi)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attrs)?.[1] ?? null;
    if (channel && attr("channel") !== channel) continue;
    const summary = element(block, ["title"]);
    const start = xmltvDate(attr("start"));
    if (!summary || !start) continue;
    const end = xmltvDate(attr("stop"));
    events.push({ uid: `${attr("channel") ?? ""}@${attr("start")}`, summary, start, end: end && end > start ? end : null });
  }
  return events;
}

/**
 * The feed's events. An XMLTV file with several channels is read for the one the address's
 * fragment names (`…/guide.xml#channel=NASA.us`); without one, every programme in it. A241: a
 * webpage's event data, a start without an offset read in `timeZone` (the market's). 2026-10-03:
 * a JSON feed keyed by channel is read for the fragment's channel too, else the one `hints` (the
 * listing's name and stream address) point to.
 */
export function parseSchedule(text: string, format: Exclude<ScheduleFormat, "sheet">, url = "", timeZone = "UTC", hints: ChannelHints = {}): CalendarEvent[] {
  const named = /#channel=([^&]+)/.exec(url)?.[1];
  const fragment = named ? decodeURIComponent(named) : null;
  if (format === "ical") return parseIcs(text);
  if (format === "webpage") return parseJsonLdEvents(text, timeZone);
  if (format === "json") return parseJson(text, fragment, hints);
  if (format === "xmltv") return parseXmltv(text, fragment);
  return parseRss(text);
}
