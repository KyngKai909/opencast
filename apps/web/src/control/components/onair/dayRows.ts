// A246: the Schedule's Day view as a rundown (opencast-schedule 01, 02): the broadcast day in air
// order, one row each, with its start, code, title, source and length. A break is one thin row
// with a bar of what fills it, by kind (bumpers, spots, the maker's barter, the credit, the station
// ID, open time, up next); dead air and planned off air are rows of their own; a programming
// block is an edge down its rows and a label where it starts. Past rows dim, the row on air is
// marked. The same rows are drawn in edit mode from the draft (removed rows kept, struck through).
// Also here: the health chips above the rundown, "Tonight at a glance", and the week's columns.
//
// The rundown's codes are drawn by the app, not `LogCode`: the contracts' codes have no LIVE, BRK
// or GAP, and OFF there means the off-air card. Each says what it is in words for screen readers.

import type { BlockSpan, BreakRow, BreakSlot, LogDay, LogEntry, OffAirSpan, PlayoutStatus, ProgramBlock } from "@opencast/contracts";
import { clock, clockRange, duration, minutesText, type BreakKind, type BreakStripPart } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import type { DraftEntry } from "./logEdit";
import { entrySource } from "./rundown";
import { DAY_SHORT, DAY_WORDS, broadcastDay, isoDate, localTime, weekdayOf, type Ymd } from "./time";

const MIN = 60_000;
const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();

/** Spots are placed into a break about this long before it airs (the playout engine's `FILL_AHEAD_MS`, not in contracts). */
export const FILL_AHEAD_MS = 20 * MIN;
/** Shorter than this, time between two things is a break, not dead air. */
const GAP_MIN_MS = 5 * MIN;

/** The rundown's own codes. */
export type RowCode = "PGM" | "LIVE" | "BRK" | "GAP" | "OFF";

/** What each code is, for screen readers (OFF is planned off air here, not the off-air card). */
export const ROW_CODE_WORDS: Record<RowCode, string> = { PGM: "Program", LIVE: "Live", BRK: "Break", GAP: "Dead air", OFF: "Off air, planned" };

/** The block a row is part of: its colour runs down the row's edge. */
export interface RowBlock {
  spanId: string;
  blockId: string;
  name: string;
  colour: string | null;
}

export interface DayRow {
  /** The entry's id; `brk:<startsAt>`, `gap:<startsAt>`, `off:<startsAt>`, or `band:<spanId>`. */
  id: string;
  kind: "entry" | "break" | "gap" | "off_air" | "band";
  code: RowCode;
  at: string;
  endsAt: string;
  title: string;
  /** The line under the title. */
  source: string | null;
  /** past: it has aired. now: on now. ahead: still to come. */
  state: "past" | "now" | "ahead";
  /** The block it's part of. */
  block: RowBlock | null;
  /** An entry row's entry, as the draft leaves it. */
  entry?: DraftEntry;
  /** Edit mode: coming off the log (drawn struck through). */
  removed?: boolean;
  /** A break row's break, and its parts by kind. */
  slot?: BreakSlot;
  parts?: BreakStripPart[];
  /** A band row's span, with its words. */
  span?: Pick<BlockSpan, "id" | "blockId" | "name" | "colour" | "startsAt" | "endsAt">;
  /** The line under a band's name: "Block, 9:00 pm to 1:00 am. Its own bumpers and ID". */
  detail?: string;
  /** A row to look at: an item still preparing (its words are in `source`). */
  warn?: boolean;
}

/** The id a break goes by on the log (`?break=`): its start, as the API's id is null until it's stored. */
export const breakKey = (startsAt: string) => `brk:${startsAt}`;

/** "6:00 pm"; "10:30:28 pm" off the minute; a break's to the second without am/pm ("8:59:20"). */
export function rowTime(at: string, kind: DayRow["kind"], tz = STATION_TZ): string {
  if (kind === "break") return clock(at, { timeZone: tz, seconds: true, suffix: false });
  return new Date(at).getUTCSeconds() ? clock(at, { timeZone: tz, seconds: true }) : clock(at, { timeZone: tz });
}

/** A length as the rundown writes it: "0:40", "29:10", "1:00:00". */
export function rowLength(ms: number): string {
  const d = duration(ms);
  return d.startsWith(":") ? `0${d}` : d;
}

// ---- Breaks ----

/** Which kind a break's row is: up next is a bumper with that role; the maker's spots are barter. */
export function breakKindOf(r: Pick<BreakRow, "code" | "whose" | "element">): BreakKind {
  switch (r.code) {
    case "BMP":
      return r.element?.role === "up_next" ? "upnext" : "bumper";
    case "SPT":
      return r.whose === "producer" ? "barter" : "spots";
    case "UND":
      return "credit";
    case "SID":
      return "id";
    case "OPEN":
      return "open";
    default:
      return "spots";
  }
}

const dropped = (r: BreakRow) => (r.element && !r.element.fits) || (r.block && !r.block.fits);

/** A break's rows (without them, its time: the maker's barter, then open), in air order, with what didn't fit left out. */
export function breakRowsOf(slot: BreakSlot): BreakRow[] {
  if (slot.rows) return slot.rows.filter((r) => !dropped(r));
  const rows: BreakRow[] = [];
  if (slot.producerShareMs) rows.push({ code: "SPT", title: "Barter", lengthMs: slot.producerShareMs, whose: "producer", note: null });
  const rest = slot.lengthMs - slot.producerShareMs;
  if (rest > 0) rows.push({ code: "OPEN", title: "Open", lengthMs: rest, whose: "station", note: null });
  return rows;
}

/** Whose program a break is in or after: its maker's call sign for barter ("REEL"), or null. */
export function breakOwner(slot: Pick<BreakSlot, "startsAt">, entries: Array<Pick<LogEntry, "startsAt" | "endsAt" | "carriedFrom">>): string | null {
  const s = t(slot.startsAt);
  const owner = entries.find((e) => t(e.startsAt) < s && s < t(e.endsAt)) ?? entries.find((e) => t(e.endsAt) === s);
  return owner?.carriedFrom?.callSign ?? null;
}

/** Spots aren't placed yet: there's open time, nothing sold, and it's further off than they're placed. */
export function spotsPending(slot: BreakSlot, now: number): boolean {
  const rows = breakRowsOf(slot);
  return slot.openMs > 0 && !rows.some((r) => breakKindOf(r) === "spots") && t(slot.startsAt) - FILL_AHEAD_MS > now;
}

/** When spots go into a break: about 20 minutes before it airs. */
export function spotsPlacedAt(slot: Pick<BreakSlot, "startsAt">): string {
  return iso(t(slot.startsAt) - FILL_AHEAD_MS);
}

/** A break's parts by kind, in air order, each with the words the pane's strip shows on it. */
export function breakParts(slot: BreakSlot, owner: string | null = null): BreakStripPart[] {
  return breakRowsOf(slot).map((r) => {
    const kind = breakKindOf(r);
    const label = kind === "barter" ? `${owner ? `${owner}'s` : "Maker's"} barter` : kind === "open" ? `${rowLength(r.lengthMs)} open` : kind === "spots" ? "Spot" : kind === "bumper" ? "Bumper" : kind === "credit" ? "Credit" : kind === "id" ? "ID" : "Up next";
    return { kind, length: r.lengthMs, label };
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A break's row in words: "2 spots, credit, ID", "REEL's 0:30 barter, ID", "Spots placed at 10:09 pm". */
export function breakSummary(slot: BreakSlot, owner: string | null, now: number, tz = STATION_TZ): string {
  if (spotsPending(slot, now)) return `Spots placed at ${clock(spotsPlacedAt(slot), { timeZone: tz })}`;
  const rows = breakRowsOf(slot);
  const of = (k: BreakKind) => rows.filter((r) => breakKindOf(r) === k);
  const barter = of("barter").reduce((a, r) => a + r.lengthMs, 0);
  const spots = of("spots").length;
  const open = of("open").reduce((a, r) => a + r.lengthMs, 0);
  const words = [
    barter ? `${owner ? `${owner}'s` : "the maker's"} ${rowLength(barter)} barter` : null,
    spots ? plural(spots, "spot") : null,
    of("credit").length ? "credit" : null,
    of("upnext").length ? "up next" : null,
    // Open time worth saying: a few seconds of slack holds on the slate unremarked.
    open >= 15_000 ? `${rowLength(open)} open` : null,
    of("id").length ? "ID" : null
  ].filter((w): w is string => !!w);
  return words.length ? capital(words.join(", ")) : "Holds on the station ID slate";
}

// ---- The rows ----

export interface DayRowsInput {
  /** The entries as the draft leaves them (or the log's). */
  entries: DraftEntry[];
  /** Edit mode: entries coming off the log, drawn where they were. */
  removed?: LogEntry[];
  breaks: BreakSlot[];
  /** Dead air (`getLog.gaps`, or the draft's). */
  gaps: Array<{ startsAt: string; endsAt: string }>;
  offAir: OffAirSpan[];
  spans: Array<Pick<BlockSpan, "id" | "blockId" | "name" | "colour" | "startsAt" | "endsAt"> & Partial<Pick<BlockSpan, "airsUntil">>>;
  from: string;
  to: string;
  now: number;
  /** "Studio A, OBS" for a live source, if known. */
  liveSourceName?: (id: string) => string | null;
  /** "Its own bumpers and ID" for a block, if known. */
  blockWords?: (blockId: string) => string | null;
  /** "Preparing for air, 62%" for an item that isn't ready, if known. */
  preparing?: (itemId: string) => string | null;
  /** Edit mode: breaks follow the programs (their line says so). */
  editing?: boolean;
}

/** The span a moment falls in (a program starting there is its member; the API's start-time rule). */
function spanOfTime<S extends DayRowsInput["spans"][number]>(spans: S[], at: string, reach = false): S | undefined {
  return spans.find((s) => s.startsAt <= at && at < (reach && s.airsUntil && s.airsUntil > s.endsAt ? s.airsUntil : s.endsAt));
}

const blockOf = (s: DayRowsInput["spans"][number] | undefined): RowBlock | null => (s ? { spanId: s.id, blockId: s.blockId, name: s.name, colour: s.colour } : null);

/** The broadcast day's rows in air order, between `from` and `to`. */
export function dayRows(input: DayRowsInput, tz = STATION_TZ): DayRow[] {
  const { from, to, now } = input;
  const a = t(from);
  const z = t(to);
  const inside = (s: string, e: string) => t(e) > a && t(s) < z;
  const state = (s: string, e: string): DayRow["state"] => (t(e) <= now ? "past" : t(s) <= now ? "now" : "ahead");
  const offAir = input.offAir.filter((o) => inside(o.startsAt, o.endsAt));
  const backAt = (e: LogEntry) => offAir.find((o) => o.logEntryId === e.id)?.backAt ?? e.endsAt;
  const rows: DayRow[] = [];

  const entryRow = (e: DraftEntry, removed = false): DayRow => {
    const code: RowCode = e.kind === "live" ? "LIVE" : e.kind === "off_air" ? "OFF" : "PGM";
    let source: string;
    let warn = false;
    if (e.kind === "off_air") source = `Planned, back at ${clock(backAt(e), { timeZone: tz })}`;
    else if (e.kind === "live") {
      const name = e.liveSourceId ? input.liveSourceName?.(e.liveSourceId) : null;
      source = `${name ? `Live source: ${name}` : "Live source"}. Breaks cued from the booth`;
    } else {
      source = entrySource(e);
      const prep = e.itemId ? input.preparing?.(e.itemId) : null;
      if (prep) {
        source = `${source}. ${prep}`;
        warn = true;
      }
    }
    return {
      id: e.id,
      kind: "entry",
      code,
      at: e.startsAt,
      endsAt: e.endsAt,
      title: e.kind === "off_air" ? "Off air" : e.title,
      source,
      state: state(e.startsAt, e.endsAt),
      block: e.kind === "off_air" ? null : blockOf(spanOfTime(input.spans, e.startsAt)),
      entry: e,
      ...(removed ? { removed: true } : {}),
      ...(warn ? { warn: true } : {})
    };
  };

  for (const e of input.entries) if (inside(e.startsAt, e.endsAt)) rows.push(entryRow(e));
  for (const e of input.removed ?? []) if (inside(e.startsAt, e.endsAt)) rows.push(entryRow(e, true));

  for (const b of input.breaks) {
    const end = iso(t(b.startsAt) + b.lengthMs);
    if (!inside(b.startsAt, end)) continue;
    const owner = breakOwner(b, input.entries);
    rows.push({
      id: breakKey(b.startsAt),
      kind: "break",
      code: "BRK",
      at: b.startsAt,
      endsAt: end,
      title: input.editing ? "Follows the programs" : breakSummary(b, owner, now, tz),
      source: null,
      state: state(b.startsAt, end),
      block: blockOf(spanOfTime(input.spans, b.startsAt, true)),
      slot: b,
      parts: breakParts(b, owner)
    });
  }

  // Dead air still ahead: a gap that has passed was filled from the library as it came.
  const nowMin = Math.floor(now / MIN) * MIN;
  for (const g of input.gaps) {
    const s = Math.max(t(g.startsAt), nowMin, a);
    const e = Math.min(t(g.endsAt), z);
    // As Fill offers it: five minutes or more still to come.
    if (e - Math.max(t(g.startsAt), now) < GAP_MIN_MS) continue;
    const at = iso(s);
    rows.push({ id: `gap:${g.startsAt}`, kind: "gap", code: "GAP", at, endsAt: iso(e), title: "Dead air", source: `Nothing until ${clock(iso(e), { timeZone: tz })}`, state: state(at, iso(e)), block: blockOf(spanOfTime(input.spans, at, true)) });
  }

  // The off air hours: a sign-off is its own entry, drawn above.
  for (const o of offAir) {
    if (o.source !== "hours") continue;
    rows.push({ id: `off:${o.startsAt}`, kind: "off_air", code: "OFF", at: o.startsAt, endsAt: o.endsAt, title: "Off air", source: `Planned, back at ${clock(o.backAt, { timeZone: tz })}`, state: state(o.startsAt, o.endsAt), block: null });
  }

  const order: Record<DayRow["kind"], number> = { band: 0, off_air: 1, entry: 2, break: 3, gap: 4 };
  rows.sort((x, y) => t(x.at) - t(y.at) || order[x.kind] - order[y.kind]);

  // A break on air takes the mark from the program it's inside.
  if (rows.some((r) => r.kind === "break" && r.state === "now")) for (const r of rows) if (r.kind === "entry" && r.state === "now") r.state = "ahead";

  // A block's label where it starts, before its first row.
  for (const s of input.spans) {
    if (!inside(s.startsAt, s.endsAt) || s.startsAt < from) continue;
    const at = rows.findIndex((r) => r.at >= s.startsAt);
    const words = input.blockWords?.(s.blockId);
    const band: DayRow = {
      id: `band:${s.id}`,
      kind: "band",
      code: "PGM",
      at: s.startsAt,
      endsAt: s.endsAt,
      title: s.name,
      source: null,
      // A label isn't on air: the rows under it are.
      state: t(s.endsAt) <= now ? "past" : "ahead",
      block: blockOf(s),
      span: { id: s.id, blockId: s.blockId, name: s.name, colour: s.colour, startsAt: s.startsAt, endsAt: s.endsAt },
      detail: `Block, ${clockRange(s.startsAt, s.endsAt, { timeZone: tz })}${words ? `. ${words}` : ""}`
    };
    rows.splice(at < 0 ? rows.length : at, 0, band);
  }
  return rows;
}

/** What a block airs of its own, for its label: "Its own bumpers and ID", "BEAT's bumpers and ID". */
export function blockWords(b: Pick<ProgramBlock, "items" | "sequences">, callSign: string): string {
  const bumpers = Object.values(b.items.bumpers).some((n) => n > 0) || !!b.sequences;
  const id = b.items.id.length > 0;
  if (bumpers && id) return "Its own bumpers and ID";
  if (bumpers) return `Its own bumpers, ${callSign}'s ID`;
  if (id) return `Its own ID, ${callSign}'s bumpers`;
  return `${callSign}'s bumpers and ID`;
}

/** The row on air now (an entry, or the break inside it), or null. */
export function nowRow(rows: DayRow[]): DayRow | null {
  return rows.find((r) => r.state === "now" && r.kind === "break") ?? rows.find((r) => r.state === "now" && r.kind === "entry" && !r.removed) ?? null;
}

/** Where the day opens: the row picked, else the one on now, else the first still to come. */
export function scrollTarget(rows: DayRow[], picked: string | null): string | null {
  if (picked && rows.some((r) => r.id === picked)) return picked;
  return nowRow(rows)?.id ?? rows.find((r) => r.state === "ahead" && r.kind !== "band")?.id ?? null;
}

// ---- Health chips ----

export interface HealthChip {
  key: string;
  /** live: on air now (the only red). warn: to look at (amber). off: planned off air. plain: a fact. */
  tone: "live" | "warn" | "off" | "plain";
  text: string;
  /** The row it scrolls to, or null. */
  rowId: string | null;
}

export interface ChipsInput {
  rows: DayRow[];
  now: number;
  /** The day shown is today, and the station is signed on: "On air" can be said. */
  onAirToday: boolean;
  readiness?: PlayoutStatus["readiness"];
  /** Spots paused in the station's rotation with time in tonight's breaks. */
  pausedSpots?: number;
}

/** The chips above the rundown: on air now, dead air coming, items not ready, planned off air, a paused spot. */
export function healthChips({ rows, now, onAirToday, readiness, pausedSpots = 0 }: ChipsInput, tz = STATION_TZ): HealthChip[] {
  const chips: HealthChip[] = [];
  const on = onAirToday ? rows.find((r) => r.kind === "entry" && !r.removed && r.state === "now" && r.code !== "OFF") ?? rows.find((r) => r.kind === "entry" && !r.removed && t(r.at) <= now && now < t(r.endsAt) && r.code !== "OFF") : undefined;
  if (on) chips.push({ key: "on", tone: "live", text: `On air: ${on.title}, ${minutesText(t(on.endsAt) - now)} left`, rowId: on.id });
  const gap = rows.find((r) => r.kind === "gap" && r.state !== "past");
  if (gap) {
    const len = minutesText(t(gap.endsAt) - Math.max(t(gap.at), now));
    chips.push({ key: "gap", tone: "warn", text: t(gap.at) <= now ? `Dead air now, ${len}` : `Dead air at ${clock(gap.at, { timeZone: tz })}, ${len}`, rowId: gap.id });
  }
  if (readiness && readiness.items > readiness.ready) {
    const failed = readiness.failed ?? (readiness.firstNotReady?.status === "failed" ? 1 : 0);
    const waiting = readiness.items - readiness.ready - failed;
    const target = readiness.firstNotReady?.entryId && rows.some((r) => r.id === readiness.firstNotReady!.entryId) ? readiness.firstNotReady.entryId : null;
    if (failed) chips.push({ key: "failed", tone: "warn", text: `${plural(failed, "item")} couldn't be prepared`, rowId: target });
    if (waiting > 0) chips.push({ key: "preparing", tone: "warn", text: `${plural(waiting, "item")} still preparing`, rowId: failed ? null : target });
  }
  const off = rows.find((r) => r.code === "OFF" && !r.removed && r.state !== "past");
  if (off) chips.push({ key: "off", tone: "off", text: `Off air ${clockRange(off.at, off.endsAt, { timeZone: tz })}, planned`, rowId: off.id });
  if (pausedSpots > 0) {
    const backup = rows.find((r) => r.kind === "break" && r.state !== "past" && r.slot?.rows?.some((x) => x.whose === "backup"));
    const who = pausedSpots === 1 ? "A spot paused" : `${pausedSpots} spots paused`;
    chips.push({ key: "paused", tone: "warn", text: backup ? `${who}; backup fills ${clock(backup.at, { timeZone: tz })}` : `${who}; your station ID and bumpers fill its time`, rowId: backup?.id ?? null });
  }
  return chips;
}

/** The day's template chip: `From "Saturdays", edited`; null for a day no template made. */
export function templateChip(days: LogDay[] | undefined, date: string, name: (d: LogDay) => string): { text: string; edited: boolean; templateId: string } | null {
  const d = days?.find((x) => x.date === date);
  if (!d?.templateId) return null;
  return { text: `From "${name(d)}"${d.edited ? ", edited" : ""}`, edited: d.edited, templateId: d.templateId };
}

// ---- Tonight at a glance ----

export interface Glance {
  /** "Saturday, 6:00 pm to 6:00 am". */
  span: string;
  programsMs: number;
  breaks: number;
  breaksMs: number;
  spots: number;
  openMs: number;
  barterMs: number;
}

/** Tonight, from 6:00 pm to the end of the broadcast day (6:00 am): its programs, breaks, spots, open time and barter. */
export function glanceOf(day: Ymd, entries: LogEntry[], breaks: BreakSlot[], tz = STATION_TZ): Glance {
  const from = t(localTime(day, 18, 0, tz));
  const to = t(localTime(day, 30, 0, tz));
  const within = (s: number, e: number) => Math.max(0, Math.min(e, to) - Math.max(s, from));
  const programsMs = entries.filter((e) => e.kind !== "off_air").reduce((a, e) => a + within(t(e.startsAt), t(e.endsAt)), 0);
  const tonight = breaks.filter((b) => t(b.startsAt) >= from && t(b.startsAt) < to);
  const rows = tonight.flatMap(breakRowsOf);
  return {
    span: `${DAY_WORDS[weekdayOf(day)]}, ${clockRange(iso(from), iso(to), { timeZone: tz })}`,
    programsMs,
    breaks: tonight.length,
    breaksMs: tonight.reduce((a, b) => a + b.lengthMs, 0),
    spots: rows.filter((r) => breakKindOf(r) === "spots").length,
    openMs: tonight.reduce((a, b) => a + b.openMs, 0),
    barterMs: tonight.reduce((a, b) => a + b.producerShareMs, 0)
  };
}

// ---- The week ----

export interface WeekEvent {
  id: string;
  kind: "program" | "live" | "gap" | "off";
  title: string;
  at: string;
  endsAt: string;
  /** The program's colour: carried, its maker's; the station's own and live, the station's. */
  colour: string | null;
  /** Where it sits in the day, 0 to 1 from 6:00 am. */
  top: number;
  height: number;
  /** The entry, for its time and source. */
  entryId?: string;
}

export interface WeekColumn {
  day: Ymd;
  date: string;
  /** "Mon, Sep 21". */
  label: string;
  template: string | null;
  edited: boolean;
  today: boolean;
  events: WeekEvent[];
  bands: Array<{ id: string; name: string; colour: string | null; top: number; height: number }>;
  /** Where now falls, 0 to 1; null on other days. */
  nowAt: number | null;
}

/** Seven broadcast days as columns: programs by source colour, dead air and off air, blocks as edges, and now. */
export function weekColumns(
  week: Ymd[],
  log: { entries: LogEntry[]; gaps: Array<{ startsAt: string; endsAt: string }>; offAir?: OffAirSpan[]; days?: LogDay[]; blocks?: BlockSpan[] },
  opts: { now: number; stationColour: string | null; templateName: (d: LogDay) => string },
  tz = STATION_TZ
): WeekColumn[] {
  const today = isoDate(broadcastDay(opts.now, tz));
  return week.map((day) => {
    const from = t(localTime(day, 6, 0, tz));
    const to = t(localTime(day, 30, 0, tz));
    const span = to - from;
    const place = (s: string, e: string) => {
      const a = Math.max(t(s), from);
      const b = Math.min(t(e), to);
      return { top: (a - from) / span, height: Math.max(0, b - a) / span };
    };
    const inDay = (s: string, e: string) => t(e) > from && t(s) < to;
    const events: WeekEvent[] = [];
    for (const e of log.entries) {
      if (!inDay(e.startsAt, e.endsAt)) continue;
      if (e.kind === "off_air") {
        events.push({ id: e.id, kind: "off", title: "Off air", at: e.startsAt, endsAt: e.endsAt, colour: null, ...place(e.startsAt, e.endsAt), entryId: e.id });
        continue;
      }
      events.push({ id: e.id, kind: e.kind === "live" ? "live" : "program", title: e.title, at: e.startsAt, endsAt: e.endsAt, colour: e.carriedFrom?.colour ?? opts.stationColour, ...place(e.startsAt, e.endsAt), entryId: e.id });
    }
    for (const g of log.gaps) {
      const s = Math.max(t(g.startsAt), Math.floor(opts.now / MIN) * MIN);
      if (!inDay(g.startsAt, g.endsAt) || t(g.endsAt) - s < GAP_MIN_MS) continue;
      events.push({ id: `gap:${g.startsAt}`, kind: "gap", title: "Dead air", at: iso(s), endsAt: g.endsAt, colour: null, ...place(iso(s), g.endsAt) });
    }
    for (const o of log.offAir ?? []) {
      if (o.source !== "hours" || !inDay(o.startsAt, o.endsAt)) continue;
      events.push({ id: `off:${o.startsAt}`, kind: "off", title: "Off air", at: o.startsAt, endsAt: o.endsAt, colour: null, ...place(o.startsAt, o.endsAt) });
    }
    events.sort((x, y) => t(x.at) - t(y.at));
    const date = isoDate(day);
    const d = log.days?.find((x) => x.date === date);
    const bands = (log.blocks ?? [])
      .filter((b) => inDay(b.airsFrom ?? b.startsAt, b.airsUntil ?? b.endsAt))
      .map((b) => ({ id: b.id, name: b.name, colour: b.colour, ...place(b.airsFrom ?? b.startsAt, b.airsUntil ?? b.endsAt) }));
    return {
      day,
      date,
      label: `${DAY_SHORT[weekdayOf(day)]}, ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}`,
      template: d?.templateId ? opts.templateName(d) : null,
      edited: !!d?.edited,
      today: date === today,
      events,
      bands,
      nowAt: date === today && opts.now >= from && opts.now < to ? (opts.now - from) / span : null
    };
  });
}

/** The week's chips: each dead air still ahead ("Dead air Thursday at 11:00 pm, 1 hr"), and each block with its days. */
export function weekChips(columns: WeekColumn[], blocks: BlockSpan[], now: number, tz = STATION_TZ): Array<HealthChip & { date: string | null; colour?: string | null }> {
  const chips: Array<HealthChip & { date: string | null; colour?: string | null }> = [];
  for (const c of columns) {
    for (const g of c.events.filter((e) => e.kind === "gap")) {
      const when = c.today ? "tonight" : DAY_WORDS[weekdayOf(c.day)];
      const at = t(g.at) <= now ? `Dead air now, ${minutesText(t(g.endsAt) - now)}` : `Dead air ${when} at ${clock(g.at, { timeZone: tz })}, ${minutesText(t(g.endsAt) - t(g.at))}`;
      chips.push({ key: g.id, tone: "warn", text: at, rowId: g.id, date: c.date });
    }
  }
  const byBlock = new Map<string, { name: string; colour: string | null; days: Set<number> }>();
  for (const b of blocks) {
    const entry = byBlock.get(b.blockId) ?? { name: b.name, colour: b.colour, days: new Set<number>() };
    entry.days.add(weekdayOf(broadcastDay(b.startsAt, tz)));
    byBlock.set(b.blockId, entry);
  }
  for (const [id, b] of byBlock) {
    // Monday first, as the week's columns run.
    const days = [...b.days].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => DAY_SHORT[d]);
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
    chips.push({ key: `block:${id}`, tone: "plain", text: `${b.name}, ${list}`, rowId: null, date: null, colour: b.colour });
  }
  return chips;
}

/** "Week of Sep 21". */
export function weekLabel(week: Ymd[]): string {
  const m = week[0];
  return `Week of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate(m)}T12:00:00Z`))}`;
}

/** "Saturday, Sep 26": the day nav's day. */
export function dayLabel(day: Ymd): string {
  return `${DAY_WORDS[weekdayOf(day)]}, ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate(day)}T12:00:00Z`))}`;
}
