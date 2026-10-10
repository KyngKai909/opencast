// The TV guide's rules, as plain functions (tv 03.1): six stations and two hours on screen, focus
// that follows the time of night (▲ ▼ keep the time, ◀ ▶ move a program), CH paging six stations
// at a time, numbers jumping to a channel, and what each cell and the header say.

import type { BlockBand } from "@opencast/contracts";
import type { Command } from "@opencast/player";
import { clock, clockRange, GUIDE_UNIT_MS } from "@opencast/ui";
import type { AiringX, StationIdentX } from "../../api/ext";
import { callSignLabel } from "../../lib/stationRef";
import { matchChannel } from "../search/searchLogic";
import { channelValue } from "../station/when";

export const MINUTE = 60_000;
/** A column in the head row. */
export const SLOT = 30 * MINUTE;
/** Two hours across the screen. */
export const SPAN = 4 * SLOT;
/** Six stations down it. */
export const PAGE = 6;

export interface GuideRowData {
  station: StationIdentX;
  airings: AiringX[];
  /** A244: the station's programming blocks (the guide's band above its row). */
  blocks?: BlockBand[];
}

/** A244: a programming block's band on a row: its name and colour, first program to last. */
export interface GuideBand {
  id: string;
  name: string;
  colour: string | null;
  start: number;
  end: number;
}

/** A place in a row: an airing, or the time a station is off air between airings. */
export interface Cell {
  /** The id the options route uses: the log entry, the listed meeting (B4), or station and time. */
  key: string;
  stationId: string;
  /** The airing's own times (the header says them); off-air cells start and end where the gap does. */
  start: number;
  end: number;
  /** Null: off air. */
  airing: AiringX | null;
  /** Off air: when the station is back, if the guide knows. */
  signOnAt: number | null;
  /**
   * An external station's time with nothing listed (follow-up Phase 6): it's still on, so the cell
   * is its name and "Live, nothing listed", never a made-up title (and no options: no airing).
   */
  nothingListed?: true;
}

export interface GuideRow {
  station: StationIdentX;
  cells: Cell[];
  /** A244: its programming blocks; empty with none. Focus never lands on them. */
  bands: GuideBand[];
}

export interface GuideModel {
  rows: GuideRow[];
  /** Focus can't go before the half hour that's on now. */
  earliest: number;
  /** The end of what the guide has fetched. */
  latest: number;
}

/** Where focus is: a row, the time of night it follows, and the first half hour on screen. */
export interface GuideFocus {
  row: number;
  t: number;
  from: number;
}

const ms = (iso: string) => Date.parse(iso);

/** The half hour a time falls in (the market's zones are whole hours off UTC). */
export function slotFloor(t: number): number {
  return Math.floor(t / SLOT) * SLOT;
}

export function airingKey(stationId: string, a: AiringX): string {
  return a.logEntryId ?? a.listedAiringId ?? `${stationId}~${ms(a.startsAt)}`;
}

/** An external station (follow-up Phase 6): the source's own stream, on while it's up. */
export function isExternal(s: Pick<StationIdentX, "kind">): boolean {
  return s.kind === "listed";
}

/**
 * A row's cells across [from, to): its airings in time order, and off air wherever there's a gap.
 * Planned off air (G9: an `off_air` airing) is an off air cell too, back at its `backAt`; a gap
 * that runs into it joins it. An external station's gaps aren't off air: it's on with nothing
 * listed (the guide only has it while its stream is up). The web's guide draws only gaps of 15
 * minutes or more (withNothingListed); here a row has no holes, since focus follows the time.
 */
export function rowCells(row: GuideRowData, from: number, to: number): Cell[] {
  const id = row.station.id;
  const external = isExternal(row.station);
  const airings = row.airings.filter((a) => ms(a.endsAt) > from && ms(a.startsAt) < to).sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  const cells: Cell[] = [];
  let cursor = from;
  const offAir = (start: number, end: number, signOnAt: number | null) =>
    cells.push(
      external
        ? { key: `${id}@live@${new Date(start).toISOString()}`, stationId: id, start, end, airing: null, signOnAt: null, nothingListed: true }
        : { key: `${id}~off~${start}`, stationId: id, start, end, airing: null, signOnAt }
    );
  // As the grid draws them (guideCells): whole five-minute columns. A cell that rounds to none
  // isn't drawn, so it isn't a cell to focus either.
  const col = (t: number) => Math.round((Math.min(Math.max(t, from), to) - from) / GUIDE_UNIT_MS);
  const drawn = (c: { start: number; end: number }) => col(c.end) > col(c.start);
  for (const a of airings) {
    let s = ms(a.startsAt);
    const e = ms(a.endsAt);
    if (e <= cursor) continue; // overlaps what's already placed
    if (s < cursor && a.kind !== "off_air" && cells.length > 0) {
      // An outside guide overlapping itself (2026-10-06): the earlier program ends where this one
      // starts; cut down to nothing, it goes, and this one takes its place.
      const prev = cells[cells.length - 1]!;
      prev.end = s;
      if (!drawn(prev)) {
        cells.pop();
        s = Math.min(s, prev.start);
      }
      cursor = s;
    }
    if (a.kind === "off_air") {
      // From the gap it closes (or its own start, before the window's first cell) to its end.
      offAir(cursor === from ? Math.min(s, from) : cursor, e, ms(a.backAt ?? a.endsAt));
      cursor = e;
      continue;
    }
    if (s > cursor) offAir(cursor, s, s);
    const cell: Cell = { key: airingKey(id, a), stationId: id, start: s, end: e, airing: a, signOnAt: null };
    const last = cells[cells.length - 1];
    if (!drawn(cell) && last) {
      // Shorter than the grid draws (a two-minute filler): what's before it runs on over it.
      last.end = e;
      cursor = e;
      continue;
    }
    cells.push(cell);
    cursor = e;
  }
  if (cursor < to) offAir(cursor, to, null);
  return cells;
}

/** The guide's rows: the TV band, then the radio band, each in channel order. */
export function buildModel(tv: GuideRowData[], radio: GuideRowData[], from: number, to: number): GuideModel {
  const order = (rows: GuideRowData[]) => [...rows].sort((a, b) => channelValue(a.station.channel) - channelValue(b.station.channel));
  const rows = [...order(tv), ...order(radio)].map((r) => ({
    station: r.station,
    cells: rowCells(r, from, to),
    bands: (r.blocks ?? []).map((b) => ({ id: b.id, name: b.name, colour: b.colour, start: ms(b.startsAt), end: ms(b.endsAt) })).filter((b) => b.end > from && b.start < to)
  }));
  return { rows, earliest: from, latest: to };
}

function clampT(f: GuideFocus): number {
  return Math.min(Math.max(f.t, f.from), f.from + SPAN - 1);
}

function indexAt(cells: Cell[], t: number): number {
  const i = cells.findIndex((c) => c.start <= t && t < c.end);
  if (i >= 0) return i;
  return t < (cells[0]?.start ?? 0) ? 0 : cells.length - 1;
}

/** The focused cell: the one in the focused row at the time focus follows. */
export function focusedCell(m: GuideModel, f: GuideFocus): Cell | null {
  const cells = m.rows[f.row]?.cells;
  if (!cells?.length) return null;
  return cells[indexAt(cells, clampT(f))] ?? null;
}

/** Opening the guide: the channel you're watching, now. */
export function initialFocus(m: GuideModel, stationId: string | null, now: number): GuideFocus {
  const row = Math.max(0, m.rows.findIndex((r) => r.station.id === stationId));
  const from = Math.max(m.earliest, slotFloor(now));
  return { row, t: Math.max(now, from), from };
}

/** Focus on a cell by its id (coming back to the options dialog), with the window showing it. Null if it's gone. */
export function focusOn(m: GuideModel, key: string, now: number): GuideFocus | null {
  const row = m.rows.findIndex((r) => r.cells.some((c) => c.key === key));
  if (row < 0) return null;
  const c = m.rows[row]!.cells.find((x) => x.key === key)!;
  let from = Math.max(m.earliest, slotFloor(now));
  const t = Math.max(c.start, from);
  if (t >= from + SPAN) from = slotFloor(t) - SPAN + SLOT;
  return { row, t, from };
}

/** The arrows. ▲ ▼ keep the time of night; ◀ ▶ go a program at a time, moving the window when needed. */
export function move(m: GuideModel, f: GuideFocus, dir: "up" | "down" | "left" | "right"): GuideFocus {
  if (dir === "up" || dir === "down") {
    const row = Math.min(Math.max(f.row + (dir === "up" ? -1 : 1), 0), m.rows.length - 1);
    return row === f.row ? f : { ...f, row };
  }
  const cells = m.rows[f.row]?.cells;
  if (!cells?.length) return f;
  const i = indexAt(cells, clampT(f));
  if (dir === "left") {
    const prev = cells[i - 1];
    if (!prev || prev.end <= m.earliest) return f;
    const t = Math.max(prev.start, m.earliest);
    return { ...f, t, from: t < f.from ? Math.max(m.earliest, slotFloor(t)) : f.from };
  }
  const next = cells[i + 1];
  if (!next || next.start >= m.latest) return f;
  const t = next.start;
  return { ...f, t, from: t >= f.from + SPAN ? Math.max(m.earliest, slotFloor(t) - SPAN + SLOT) : f.from };
}

export function pageCount(m: GuideModel): number {
  return Math.max(1, Math.ceil(m.rows.length / PAGE));
}

export function pageOf(row: number): number {
  return Math.floor(row / PAGE);
}

/** CH ▲ ▼: the previous or next six stations (round the dial), at the same place on the page. */
export function page(m: GuideModel, f: GuideFocus, dir: "up" | "down"): GuideFocus {
  const pages = pageCount(m);
  if (pages < 2) return f;
  const p = (pageOf(f.row) + (dir === "up" ? -1 : 1) + pages) % pages;
  return { ...f, row: Math.min(p * PAGE + (f.row % PAGE), m.rows.length - 1) };
}

/** The rows on screen: the focused row's page. */
export function visibleRows(m: GuideModel, f: GuideFocus): GuideRow[] {
  const p = pageOf(f.row);
  return m.rows.slice(p * PAGE, p * PAGE + PAGE);
}

/** Numbers: digits typed so far, then the row they name ("12" is 12.1, "884" is 88.4), or -1. */
export function typeKey(typed: string, key: number | "."): string {
  return (typed + String(key)).slice(-5);
}

export function rowForTyped(m: GuideModel, typed: string): number {
  const channels = m.rows.map((r) => r.station.channel ?? "");
  const match = matchChannel(typed, channels.filter(Boolean));
  if (!match?.found) return -1;
  return channels.indexOf(match.channel);
}

/** Jump to a row, keeping the time. */
export function jump(f: GuideFocus, row: number): GuideFocus {
  return row < 0 || row === f.row ? f : { ...f, row };
}

// ---------- What it says ----------

export function onNow(c: Cell, now: number): boolean {
  return c.start <= now && now < c.end;
}

/** What OK does on a cell: tune (on now), options (later), or nothing (off air later). */
export function okAction(c: Cell, now: number): "tune" | "options" | "none" {
  if (onNow(c, now)) return "tune";
  return c.airing ? "options" : "none";
}

const short = (t: number, timeZone?: string) => clock(t, { timeZone, suffix: false });
/** "9:00", or "6:00 am" when it's on the other side of noon or midnight from now. */
const until = (t: number, now: number, timeZone?: string) => clock(t, { timeZone, suffix: clock(t, { timeZone }).slice(-2) !== clock(now, { timeZone }).slice(-2) });

/**
 * The line under a cell's title: "Live, until 9:30", "External, until 9:15", "From REEL", "Until
 * 9:00" (or "Until 6:00 am" past midnight) for what's on now; "Live, 9:00 – 10:00", "From CIVC" or "9:00" for later; "Signs on at
 * 6:00 am" off air; "Live, nothing listed" for an external station with nothing listed. `live` puts "Live" first in red.
 */
export function cellLine(c: Cell, now: number, timeZone?: string): { live: boolean; text: string } {
  const a = c.airing;
  if (c.nothingListed) return { live: true, text: "nothing listed" };
  if (!a) return { live: false, text: c.signOnAt ? `Signs on at ${clock(c.signOnAt, { timeZone })}` : "" };
  const isNow = onNow(c, now);
  if (a.live) return { live: true, text: isNow ? `until ${until(c.end, now, timeZone)}` : `${short(c.start, timeZone)} – ${short(c.end, timeZone)}` };
  if (isNow && a.kind === "listed") return { live: false, text: `External, until ${until(c.end, now, timeZone)}` };
  if (a.carriedFrom?.callSign) return { live: false, text: `From ${callSignLabel(a.carriedFrom)}` };
  if (isNow) return { live: false, text: `Until ${until(c.end, now, timeZone)}` };
  return { live: false, text: short(c.start, timeZone) };
}

/** A cell's title: the airing's, an external station's name when nothing's listed, else "Off air". */
export function cellTitle(c: Cell, s: Pick<StationIdentX, "name">): string {
  return c.airing?.title ?? (c.nothingListed ? s.name : "Off air");
}

export function identText(s: StationIdentX): string {
  return [s.callSign, s.channel].filter(Boolean).join(" ");
}

/** The header's first line: "9:00 – 10:00 pm, BEAT 12.1". Off air, the station alone. */
export function whenLine(c: Cell, s: StationIdentX, timeZone?: string): string {
  if (!c.airing) return identText(s);
  return `${clockRange(c.start, c.end, { separator: "–", timeZone })}, ${identText(s)}`;
}

/**
 * The header's description: the line under the title (S4) leads, then tonight's episode (G5) or the
 * program's description. A sentence the description already has isn't said twice; a description
 * that contains the line only as part of a sentence is said alone. External meetings have none.
 * `liveLead`: the text starts with "Live", which is drawn in red.
 */
export function describe(a: AiringX | null, programDescription: string | null | undefined): { text: string; liveLead: boolean } | null {
  if (!a || a.kind === "listed") return null;
  const note = a.note?.trim().replace(/\.$/, "") || null;
  let desc = (a.episodeDescription ?? programDescription ?? "").trim();
  let text: string;
  if (note && desc) {
    const sentences = desc.match(/[^.]+\.?/g)?.map((s) => s.trim()) ?? [desc];
    const own = sentences.findIndex((s) => s.replace(/\.$/, "").toLowerCase() === note.toLowerCase());
    if (own >= 0) {
      desc = sentences.filter((_, i) => i !== own).join(" ");
      text = `${note}. ${desc}`.trim();
    } else if (desc.toLowerCase().includes(note.toLowerCase())) text = desc;
    else text = `${note}. ${desc}`;
  } else text = note ? `${note}.` : desc;
  if (!text) return null;
  return { text, liveLead: a.live && /^Live\b/.test(text) };
}

/**
 * The header's line for an external station's cell (follow-up Phase 6), which has no description:
 * whose stream it is ("City of Colton's own stream."), when the dial says. Null otherwise.
 */
export function externalLine(c: Cell, s: Pick<StationIdentX, "kind">, source: string | null | undefined): string | null {
  if (!isExternal(s) || !source || (!c.airing && !c.nothingListed)) return null;
  return `${source}'s own stream.`;
}

/** The OK hint in the header: "Options" for later programs, "Tune in" for what's on now. */
export function okHint(c: Cell, now: number): string | null {
  const act = okAction(c, now);
  return act === "tune" ? "Tune in" : act === "options" ? "Options" : null;
}

/** Off air, the header's line: "CIVC 7.1 signs on again at 6:00 am." */
export function offAirLine(c: Cell, s: StationIdentX, timeZone?: string): string | null {
  return c.airing || !c.signOnAt ? null : `${identText(s)} signs on again at ${clock(c.signOnAt, { timeZone })}.`;
}

// ---------- The guide's command layer ----------

export interface GuideCommandResult {
  /** Taken by the guide (true), or left to TV mode's routing (Back, Guide, Menu, pause…). */
  handled: boolean;
  focus?: GuideFocus;
  /** OK: tune or open options for the focused cell. */
  choose?: boolean;
  /** A number key, for jumping. */
  typed?: number | ".";
}

const WAITING = new Set<Command["type"]>(["focus", "select", "channel", "digit", "dot", "info"]);

/**
 * What the guide does with a command while it's up (before the options dialog opens): arrows move
 * focus, OK chooses, CH pages (instead of changing channel underneath), numbers jump, Info does
 * nothing (the header already has the details). While the listings load, those keys wait.
 */
export function guideCommand(c: Command, m: GuideModel | null, f: GuideFocus | null): GuideCommandResult {
  if (!m || !f) return { handled: WAITING.has(c.type) };
  switch (c.type) {
    case "focus":
      return { handled: true, focus: move(m, f, c.dir) };
    case "select":
      return { handled: true, choose: true };
    case "channel":
      return { handled: true, focus: page(m, f, c.dir) };
    case "digit":
      return { handled: true, typed: c.digit };
    case "dot":
      return { handled: true, typed: "." };
    case "info":
      return { handled: true };
    default:
      return { handled: false };
  }
}

/** A244: "Part of Late Crate Nights", for the focused cell's details; null outside a block. */
export function blockLine(c: Cell): string | null {
  return c.airing?.block ? `Part of ${c.airing.block.name}` : null;
}
