// A241 (2026-10-01, the user's decision): a schedule address that answers with a web page is read
// for its own structured event data, the schema.org JSON-LD in every
// `<script type="application/ld+json">` block. Text only: nothing on the page is run, and nothing
// else on it is read (microdata and RDFa are a follow-up).
//
// What counts: a node whose `@type` (a string or an array) is Event, BroadcastEvent,
// PublicationEvent, ScreeningEvent, TVEpisode, Episode or any other type ending in "Event", found
// in a single object, an array, `@graph`, an ItemList's `itemListElement` (items, or `{ item }`), or
// nested under `subEvent` / `event` (a BroadcastService, TelevisionChannel, Organization, Place or
// WebPage carrying its events), `mainEntity`, or a work's `publication`. Each needs the source's own
// title (`name`, else `workPerformed.name`, `about.name` or `broadcastOfEvent.name`; a publication
// event takes the work's name) and a `startDate` with a time; its end is `endDate`, or the start plus
// its ISO 8601 `duration`. A start without an offset is read in the market's time zone. Anything
// without a title or a start is left out, a cancelled event too, and nothing is made up. An event
// whose own sub-events are usable gives way to them (a day's listing, not the day and its shows).

import type { CalendarEvent } from "./ics.js";
import { zonedTime } from "./time.js";

const EVENT_TYPES = new Set(["Event", "BroadcastEvent", "PublicationEvent", "ScreeningEvent", "TVEpisode", "Episode"]);
/** Where events hang off other nodes. */
const NESTED = ["subEvent", "subEvents", "event", "events", "mainEntity", "itemListElement"] as const;
/** A page can't make the walk run away: this deep, and this many nodes, at most. */
const MAX_DEPTH = 16;
const MAX_NODES = 20_000;
const TITLE_MAX = 300;

type Node = Record<string, unknown>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

/** Entities decoded (sites often put `&amp;` in JSON-LD strings), tags dropped, spaces collapsed. */
function clean(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** A text value: a string, the first of an array, or a `{ "@value" }`. */
function text(value: unknown, depth = 0): string | null {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === "string") return clean(value) || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = text(v, depth + 1);
      if (t) return t;
    }
    return null;
  }
  if (typeof value === "object" && "@value" in (value as Node)) return text((value as Node)["@value"], depth + 1);
  return null;
}

const isNode = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);

/** `schema:Event`, `https://schema.org/Event` and `Event` are all Event. */
const bare = (t: string) => t.replace(/^.*[/:#]/, "");

function types(node: Node): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map(bare);
}

const isEvent = (node: Node) => types(node).some((t) => EVENT_TYPES.has(t) || (t.length > 5 && t.endsWith("Event")));

/** The name of a node (or of the first node in an array) under `key`. */
function nameUnder(node: Node, key: string): string | null {
  const v = node[key];
  for (const x of Array.isArray(v) ? v : [v]) if (isNode(x)) {
    const n = text(x.name);
    if (n) return n;
  }
  return null;
}

function titleOf(node: Node, fallback: string | null): string | null {
  const t = text(node.name) ?? nameUnder(node, "workPerformed") ?? nameUnder(node, "about") ?? nameUnder(node, "broadcastOfEvent") ?? fallback;
  return t ? t.slice(0, TITLE_MAX) : null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * A `startDate` or `endDate`. With an offset (or Z) it's that instant; without one, the wall-clock
 * time in `timeZone`. A date with no time isn't a time on the dial: null.
 */
export function jsonLdDate(value: unknown, timeZone: string): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const m = ISO.exec(raw);
  if (!m) {
    // Not ISO 8601: only a date that names its own time and zone ("Mon, 05 Oct 2026 01:00:00 GMT").
    if (!/\d{1,2}:\d{2}/.test(raw) || !/(GMT|UTC|Z\b|[+-]\d{4})/i.test(raw)) return null;
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const [, y, mo, d, h, mi, s = "00", off] = m;
  if (+mo! < 1 || +mo! > 12 || +d! < 1 || +d! > 31 || +h! > 23 || +mi! > 59 || +s! > 59) return null;
  if (off) {
    if (/^z$/i.test(off)) return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
    const sign = off[0] === "-" ? -1 : 1;
    const digits = off.slice(1).replace(":", "");
    const minutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || "0"));
    return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!) - minutes * 60_000);
  }
  try {
    return new Date(zonedTime(`${y}-${mo}-${d}`, `${h}:${mi}`, timeZone).getTime() + Number(s) * 1000);
  } catch {
    return null;
  }
}

/**
 * An ISO 8601 duration in milliseconds: `PT1H30M`, `PT90M`, `P1DT2H`, `P1W`. Years and months have
 * no fixed length, so they aren't read (null), and neither is anything zero or malformed.
 */
export function isoDurationMs(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const m = /^P(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i.exec(raw.replace(/\s/g, ""));
  if (!m || raw.toUpperCase().endsWith("T")) return null;
  const n = (v: string | undefined) => (v ? Number(v.replace(",", ".")) : 0);
  const ms = (((n(m[1]) * 7 + n(m[2])) * 24 + n(m[3])) * 60 + n(m[4])) * 60_000 + n(m[5]) * 1000;
  return ms > 0 && Number.isFinite(ms) ? Math.round(ms) : null;
}

/** The JSON in each `<script type="application/ld+json">` block, as written (malformed ones too). */
export function jsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']?\s*application\/ld\+json/i.test(attrs!)) continue;
    blocks.push(
      body!
        .trim()
        .replace(/^<!--/, "")
        .replace(/-->$/, "")
        .replace(/^\s*(?:\/\*\s*)?<!\[CDATA\[(?:\s*\*\/)?/, "")
        .replace(/(?:\/\*\s*)?\]\]>(?:\s*\*\/)?\s*$/, "")
        .trim()
    );
  }
  return blocks;
}

/** A block's JSON, or undefined when it isn't JSON (a stray newline inside a string is forgiven). */
function parseBlock(block: string): unknown {
  try {
    return JSON.parse(block);
  } catch {
    try {
      // Raw control characters inside strings are the commonest fault; as spaces they're harmless.
      return JSON.parse(block.replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      return undefined;
    }
  }
}

/**
 * A page's events from its JSON-LD: each with the source's own title and a start (and its end when
 * the page gives one), in page order, without repeats. Empty when the page has none: the sync says
 * `no_event_data`.
 */
export function parseJsonLdEvents(html: string, timeZone: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  let visited = 0;

  /** The events at `node` and under it; true when anything usable was found there. */
  const walk = (value: unknown, depth: number, fallbackTitle: string | null): boolean => {
    if (depth > MAX_DEPTH || ++visited > MAX_NODES || value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) {
      let found = false;
      for (const v of value) found = walk(v, depth + 1, fallbackTitle) || found;
      return found;
    }
    const node = value as Node;
    let found = false;
    if (Array.isArray(node["@graph"]) || isNode(node["@graph"])) found = walk(node["@graph"], depth + 1, null) || found;
    // An ItemList's entries: `{ "@type": "ListItem", "item": {…} }`, or the items themselves.
    if (isNode(node.item) || Array.isArray(node.item)) found = walk(node.item, depth + 1, null) || found;
    const own = isEvent(node) ? node : null;
    // A work's publication (a TVEpisode's BroadcastEvent) takes the work's name when it has none.
    const pubTitle = text(node.name);
    if (node.publication) found = walk(node.publication, depth + 1, pubTitle) || found;
    let nested = false;
    for (const key of NESTED) if (node[key] !== undefined) nested = walk(node[key], depth + 1, null) || nested;
    found = nested || found;
    // An event whose sub-events are listed gives way to them.
    if (own && !nested) found = take(own, fallbackTitle) || found;
    return found;
  };

  const take = (node: Node, fallbackTitle: string | null): boolean => {
    const status = text(node.eventStatus);
    if (status && /EventCancelled$/i.test(status)) return false;
    const summary = titleOf(node, fallbackTitle);
    const start = jsonLdDate(node.startDate, timeZone);
    if (!summary || !start) return false;
    let end = jsonLdDate(node.endDate, timeZone);
    if (!end) {
      const ms = isoDurationMs(node.duration);
      end = ms ? new Date(start.getTime() + ms) : null;
    }
    const key = `${summary}|${start.toISOString()}`;
    if (seen.has(key)) return true;
    seen.add(key);
    const id = text(node["@id"]) ?? text(node.url);
    events.push({ uid: id ? id.slice(0, 500) : null, summary, start, end: end && end > start ? end : null });
    return true;
  };

  for (const block of jsonLdBlocks(html)) {
    const data = parseBlock(block);
    if (data !== undefined) walk(data, 0, null);
  }
  return events;
}
