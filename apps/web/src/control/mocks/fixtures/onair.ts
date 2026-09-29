// The On air area's mock data and rules: the dial's channels (setup A.1), what the log places
// when a gap is filled (A.4, P.2), what a break holds, row by row (the Monitor's rundown, G1),
// the preview monitor's cards (G2), and this area's own saved state (how each day repeats).
// Tonight's log and breaks themselves live in the shared db (fixtures/evening.ts).

import type { LibraryItem, LogEntry } from "@opencast/contracts";
import type { BreakRow } from "@opencast/contracts";
import type { DbBreak, DbFill, DbLogEntry } from "./evening";
import { BEAT } from "./stations";
import { at } from "./time";

// ---- Channels (A.1) ----

/** The TV band's main channels as the frame draws them: 2 to 41, ten to a row. */
export const TV_CHANNELS = { first: 2, last: 41 };

/** Radio: FM frequencies, 88.1 to 107.9. */
export function radioFrequencies(): string[] {
  const out: string[] = [];
  for (let f = 881; f <= 1079; f += 2) out.push((f / 10).toFixed(1));
  return out;
}

/** Channels held for reserved call signs: drawn as taken (the frame's `taken` array ends with 44). */
export const HELD = { tv: ["44.1"], radio: [] as string[] };

/** The mock streams (`npm run mock:streams -w @opencast/player`): a station's output plays only if it has one. */
export const MOCK_STREAMS = ["civc", "beat", "reel", "sazn", "prep", "nite", "hall", "crat", "voze"];

// ---- Sign-on (A.6) ----

/** "Test signal received": what the test output measured (the mock's encoder). */
export const TEST_SIGNAL = { detail: "720p at 3.2 Mbps, audio at −16 LUFS", bitrateKbps: 3200 };

/** A new station's break rule until its settings say otherwise: a 2:00 break after every program. */
export const DEFAULT_BREAK_MS = 2 * 60_000;

// ---- The preview monitor (G2) ----

/** Cards for spots with no stored picture: the frame's Mission Soda, and the spot market's. */
export const PREVIEW_CARDS: Record<string, { detail: string | null; colour: string }> = {
  "Mission Soda": { detail: "Bottled in Riverside since 1946", colour: "#1D6A70" },
  "Old Town Cinema": { detail: null, colour: "#7E2F35" },
  "Orange Street Coffee": { detail: "Open till midnight on Orange St.", colour: "#5A3A22" },
  "Inland Tire and Wheel": { detail: null, colour: "#1F5E8C" },
  "Cypress Dental": { detail: null, colour: "#1D6A70" },
  "Redlands Hardware": { detail: null, colour: "#4F5B2A" }
};

// ---- What a break holds, row by row (G1) ----

const FILL_CODE: Record<DbFill["kind"], BreakRow["code"]> = {
  producer: "SPT",
  spot: "SPT",
  sponsor: "UND",
  underwriting: "UND",
  bumper: "BMP",
  station_id: "SID",
  open: "OPEN"
};

/**
 * A break in the order it airs: the maker's barter time first, then the station's spots,
 * underwriting and bumpers, then open time (the station ID slate), and the station ID last,
 * as the break settings fix it (open question A8).
 */
export function rowsOfBreak(b: DbBreak): BreakRow[] {
  const row = (f: DbFill): BreakRow => ({
    code: FILL_CODE[f.kind],
    title: f.title,
    lengthMs: f.lengthMs,
    whose: f.kind === "producer" ? "producer" : /backup/i.test(f.note ?? "") ? "backup" : "station",
    note: f.note ?? null
  });
  const producer = b.fills.filter((f) => f.kind === "producer").map(row);
  const station = b.fills.filter((f) => f.kind !== "producer" && f.kind !== "station_id" && f.kind !== "open").map(row);
  const ids = b.fills.filter((f) => f.kind === "station_id").map(row);
  const filled = [...producer, ...station, ...ids].reduce((a, r) => a + r.lengthMs, 0);
  const open = Math.max(0, b.lengthMs - filled);
  return [...producer, ...station, ...(open >= 1000 ? [{ code: "OPEN" as const, title: "Open", lengthMs: open, whose: "station" as const, note: "Holds on the station ID slate" }] : []), ...ids];
}

// ---- Filling a gap (A.4, P.2) ----

const MIN = 60_000;
const ceilMinute = (t: number) => Math.ceil(t / MIN) * MIN;

export interface Placed {
  entries: Array<Pick<LogEntry, "startsAt" | "endsAt" | "title" | "itemId" | "programId" | "episodeTitle">>;
  breaks: Array<{ startsAt: string; lengthMs: number; context: string }>;
}

/**
 * Repeat items in order from `startsAt`, in whole minutes, with a break after each program, until
 * `endsAt`. With something after the gap (`closed`), the last program is cut where it starts;
 * at the end of the log, the last one runs its length, so the log doesn't end mid-program.
 */
export function placeRepeat(items: Pick<LibraryItem, "id" | "title" | "durationMs" | "programId" | "episodeNumber">[], startsAt: string, endsAt: string, breakMs: number, closed: boolean): Placed {
  const out: Placed = { entries: [], breaks: [] };
  const usable = items.filter((i) => (i.durationMs ?? 0) > 0);
  if (!usable.length) return out;
  const end = Date.parse(endsAt);
  let cursor = ceilMinute(Date.parse(startsAt));
  for (let n = 0; cursor < end && n < 500; n++) {
    const it = usable[n % usable.length];
    let stop = cursor + ceilMinute(it.durationMs ?? 0);
    if (closed && stop > end) stop = end;
    if (stop - cursor < MIN) break;
    out.entries.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(stop).toISOString(), title: it.title, itemId: it.id, programId: it.programId, episodeTitle: it.episodeNumber ? `ep. ${it.episodeNumber}` : null });
    cursor = stop;
    // A break after the program, when there's room for it and more after it.
    if (cursor + breakMs < end) {
      out.breaks.push({ startsAt: new Date(cursor).toISOString(), lengthMs: breakMs, context: `After ${it.title}` });
      cursor += breakMs;
    }
  }
  return out;
}

/**
 * How far the log runs without a gap, from `from`: through breaks shorter than five minutes.
 * Null when nothing is on the log at `from` or within five minutes of it.
 */
export function coverageUntil(entries: Pick<DbLogEntry, "startsAt" | "endsAt">[], from: string, gapMinMs = 5 * MIN): string | null {
  const sorted = [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  let cursor = Date.parse(from);
  let covered = false;
  for (const e of sorted) {
    const s = Date.parse(e.startsAt);
    const f = Date.parse(e.endsAt);
    if (f <= cursor) continue;
    if (s - cursor >= gapMinMs) break;
    covered = true;
    cursor = Math.max(cursor, f);
  }
  return covered ? new Date(cursor).toISOString() : null;
}

/** Dead-air warnings go out 30 and 12 minutes before a gap (P.2); the ones due by `now`. */
export function deadAirWarnings(gapStartsAt: string, now: number) {
  const start = Date.parse(gapStartsAt);
  return ([30, 12] as const)
    .filter((mins) => now >= start - mins * MIN && now < start + MIN)
    .map((mins) => ({ gapStartsAt, warnedAt: new Date(start - mins * MIN).toISOString(), minutesBefore: mins }));
}

// ---- This area's saved state ----

export interface OnAirState {
  version: number;
  /** How each station's days repeat (G7): the day copied, how, and until when. Copies carry its id as their repeatGroupId. */
  repeats: Array<{ id: string; stationId: string; day: string; pattern: "once" | "daily" | "weekly"; until: string | null }>;
  /** Breaks the log placed with a fill, so taking the program off takes its break too. */
  placedBreaks: Array<{ breakId: string; entryId: string }>;
}

const KEY = "oc-mock-control-onair";
const VERSION = 2;
let state: OnAirState | null = null;

function seedState(): OnAirState {
  // BEAT's Saturday repeats every Saturday (A.4: "Every Saturday").
  return { version: VERSION, repeats: [{ id: "6c1f0d7e-2b4a-4e9b-9d51-0a7c3e5b8f21", stationId: BEAT.id, day: at("12:00").slice(0, 10), pattern: "weekly", until: null }], placedBreaks: [] };
}

export function onAirState(): OnAirState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as OnAirState) : null;
    state = saved && saved.version === VERSION ? saved : seedState();
  } catch {
    state = seedState();
  }
  return state;
}

export function saveOnAirState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(onAirState()));
  } catch {
    // Private windows keep it for this visit.
  }
}
