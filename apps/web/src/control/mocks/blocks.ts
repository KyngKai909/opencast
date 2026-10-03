// A244: programming blocks on the mocks, as the API keeps them (apps/api library/blocks.ts,
// log/blocks.ts): the blocks themselves, their spans on dates' logs, and their places in day
// templates. Membership is by start: a program or live block starting inside a span is its, and the
// block airs from its first member's start to its last member's end (a member running past the end
// stays in it). Kept in its own saved state (like the other areas' own data); "Reset mock data":
// localStorage.removeItem("oc-mock-control-blocks").
//
// BEAT's (the illustration): Late Crate Nights, tonight 8:00 to 9:00 pm, so Late Crate, ep. 14 and
// Saturday Reel are in it, and every Saturday from the Saturdays template. Saturday Matinee isn't
// on the log yet.

import type { BlockSpan, BumperSequences, DayTemplateBlock, LogChange, LogChangesResult, ProgramBlock, StationIdent } from "@opencast/contracts";
import { clock, snapTime } from "@opencast/ui";
import { STATION_TZ, now } from "../../lib/clock";
import { DAY_SHORT, localParts } from "../components/onair/time";
import { dbStation, getDb, stationLog } from "./db";
import { offAirFor, templatesOf } from "./schedule";
import { BEAT } from "./fixtures/stations";
import { TEMPLATE_IDS } from "./fixtures/templates";
import { at } from "./fixtures/time";

const KEY = "oc-mock-control-blocks";
const MIN = 60_000;
const HOUR = 60 * MIN;
export const LATE_CRATE_NIGHTS_ID = "00000000-0000-4000-8000-0000000b1001";

export interface MockBlock {
  id: string;
  stationId: string;
  name: string;
  description: string | null;
  colour: string | null;
  logoUrl: string | null;
  bug: "station" | "logo" | "off";
  intro: boolean;
  outro: boolean;
  sequences: BumperSequences | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface MockSpan {
  id: string;
  stationId: string;
  blockId: string;
  startsAt: string;
  endsAt: string;
  templateId: string | null;
}

export interface MockTemplateBlock {
  id: string;
  templateId: string;
  blockId: string;
  startTime: string;
  lengthMs: number;
}

interface State {
  version: number;
  blocks: MockBlock[];
  spans: MockSpan[];
  templateBlocks: MockTemplateBlock[];
}

const VERSION = 1;
let state: State | null = null;

function seed(): State {
  const made = at("-21 12:00");
  return {
    version: VERSION,
    blocks: [
      {
        id: LATE_CRATE_NIGHTS_ID,
        stationId: BEAT.id,
        name: "Late Crate Nights",
        description: "Records after dark: Late Crate, then the Saturday Reel.",
        colour: "#1F5C99",
        logoUrl: null,
        bug: "logo",
        intro: true,
        outro: true,
        sequences: null,
        createdAt: made,
        updatedAt: made,
        archivedAt: null
      },
      {
        id: "00000000-0000-4000-8000-0000000b1002",
        stationId: BEAT.id,
        name: "Sunday Matinee",
        description: "Old films on a Sunday afternoon.",
        colour: "#7E2F35",
        logoUrl: null,
        bug: "station",
        intro: true,
        outro: false,
        sequences: null,
        createdAt: made,
        updatedAt: made,
        archivedAt: null
      }
    ],
    spans: [
      { id: "00000000-0000-4000-8000-0000000b5001", stationId: BEAT.id, blockId: LATE_CRATE_NIGHTS_ID, startsAt: at("20:00"), endsAt: at("21:00"), templateId: TEMPLATE_IDS.saturdays },
      { id: "00000000-0000-4000-8000-0000000b5002", stationId: BEAT.id, blockId: LATE_CRATE_NIGHTS_ID, startsAt: at("+7 20:00"), endsAt: at("+7 21:00"), templateId: TEMPLATE_IDS.saturdays }
    ],
    templateBlocks: [{ id: "00000000-0000-4000-8000-0000000b7001", templateId: TEMPLATE_IDS.saturdays, blockId: LATE_CRATE_NIGHTS_ID, startTime: "20:00", lengthMs: HOUR }]
  };
}

export function blocksState(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as State) : null;
    state = saved && saved.version === VERSION ? saved : seed();
  } catch {
    state = seed();
  }
  return state;
}

export function saveBlocks() {
  try {
    localStorage.setItem(KEY, JSON.stringify(blocksState()));
  } catch {
    // Private windows: this visit only.
  }
}

export function resetBlocks() {
  state = seed();
  saveBlocks();
}

const clockOf = (t: string | number) => clock(t, { timeZone: STATION_TZ });
const minuteClock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h % 24 < 12 ? "am" : "pm"}`;
};
const plusMinutes = (hhmm: string, ms: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + Math.round(ms / MIN)) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function blocksOf(stationId: string): MockBlock[] {
  return blocksState().blocks.filter((b) => b.stationId === stationId && !b.archivedAt);
}

export function blockById(id: string): MockBlock | undefined {
  return blocksState().blocks.find((b) => b.id === id);
}

export function spansOf(stationId: string, from?: string, to?: string): MockSpan[] {
  return blocksState()
    .spans.filter((s) => s.stationId === stationId && (!from || s.endsAt > new Date(Date.parse(from) - 12 * HOUR).toISOString()) && (!to || s.startsAt < to))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** A span's members and where it airs (pieces split by off-air time between members). */
export function membersOf(span: MockSpan) {
  const log = stationLog(span.stationId);
  const members = log.filter((e) => e.kind !== "off_air" && e.startsAt >= span.startsAt && e.startsAt < span.endsAt);
  const offAir = [...log.filter((e) => e.kind === "off_air"), ...offAirFor(span.stationId, span.startsAt, new Date(Date.parse(span.endsAt) + 6 * HOUR).toISOString())];
  const pieces: Array<{ startsAt: string; endsAt: string }> = [];
  for (const m of members) {
    const last = pieces[pieces.length - 1];
    const paused = last && offAir.some((o) => o.startsAt < m.startsAt && o.endsAt > last.endsAt);
    if (last && !paused) last.endsAt = m.endsAt > last.endsAt ? m.endsAt : last.endsAt;
    else pieces.push({ startsAt: m.startsAt, endsAt: m.endsAt });
  }
  return { members, pieces };
}

/** The log's spans in a window, as `getLog`'s `blocks`. */
export function spanViews(stationId: string, from: string, to: string): BlockSpan[] {
  return spansOf(stationId, from, to).flatMap((span) => {
    const block = blockById(span.blockId);
    if (!block) return [];
    const { members, pieces } = membersOf(span);
    const airsUntil = pieces.length ? pieces[pieces.length - 1].endsAt : null;
    if (span.endsAt <= from && (!airsUntil || airsUntil <= from)) return [];
    const problems: BlockSpan["problems"] = [];
    if (!members.length) problems.push({ code: "empty", message: `Nothing in this block yet. Put programs between ${clockOf(span.startsAt)} and ${clockOf(span.endsAt)}.` });
    for (const m of members) {
      const over = Date.parse(m.endsAt) - Date.parse(span.endsAt);
      if (over > 0) problems.push({ code: "overrun", message: `${m.title} runs ${Math.round(over / MIN)} minutes past the block's end, ${clockOf(span.endsAt)}. It stays in the block.` });
    }
    return [
      {
        id: span.id,
        blockId: block.id,
        name: block.name,
        colour: block.colour,
        startsAt: span.startsAt,
        endsAt: span.endsAt,
        airsFrom: pieces[0]?.startsAt ?? null,
        airsUntil,
        pieces,
        templateId: span.templateId,
        entryIds: members.map((m) => m.id),
        problems
      }
    ];
  });
}

/** The block on air at `t`, and the one an entry enters (the Monitor). */
export function blockBandAt(stationId: string, t: string, nextEntryId: string | null) {
  let current: { band: ReturnType<typeof band>; piece: { startsAt: string; endsAt: string } } | null = null;
  let next: ReturnType<typeof band> | null = null;
  for (const span of spansOf(stationId)) {
    const block = blockById(span.blockId);
    if (!block) continue;
    const { members, pieces } = membersOf(span);
    const on = pieces.find((p) => p.startsAt <= t && t < p.endsAt);
    if (on) current = { band: band(block, on), piece: on };
    const entry = nextEntryId ? members.find((m) => m.id === nextEntryId) : undefined;
    const piece = entry ? pieces.find((p) => p.startsAt <= entry.startsAt && entry.startsAt < p.endsAt) : undefined;
    if (piece && piece !== on) next = band(block, piece);
  }
  return { now: current?.band ?? null, next };
}

function band(b: MockBlock, p: { startsAt: string; endsAt: string }) {
  return { id: b.id, name: b.name, colour: b.colour, logoUrl: b.logoUrl, startsAt: p.startsAt, endsAt: p.endsAt };
}

/** A block as `getBlock` answers it (`withPlacements`: where it's on the log). */
export function blockView(b: MockBlock, withPlacements = false): ProgramBlock {
  const items = getDb().library.items.filter((i) => (i as { programBlockId?: string | null }).programBlockId === b.id);
  const item = (i: (typeof items)[number]) => ({ id: i.id, title: i.title, durationMs: i.durationMs });
  const bumpers = { into_break: 0, out_of_break: 0, up_next: 0, any: 0 };
  for (const i of items) if (i.code === "BMP" && !i.identCode) bumpers[i.bumperRole ?? "any"]++;
  const t = now().toISOString();
  const templates = blocksState()
    .templateBlocks.filter((tb) => tb.blockId === b.id)
    .flatMap((tb) => {
      const tpl = templatesOf(b.stationId).find((x) => x.id === tb.templateId);
      return tpl ? [{ tb, tpl }] : [];
    });
  const label = (tpl: { pattern: string; weekday: number | null }) =>
    tpl.pattern === "weekly" ? `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][tpl.weekday ?? 6]}` : tpl.pattern === "weekdays" ? "Weekdays" : tpl.pattern === "daily" ? "Every day" : "Once";
  const ahead = blocksState().spans.filter((s) => s.blockId === b.id && s.endsAt > t).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  const next = ahead[0] ? (membersOf(ahead[0]).pieces[0]?.startsAt ?? ahead[0].startsAt) : null;
  const oneOff = ahead[0] ? `${DAY_SHORT[localParts(ahead[0].startsAt).weekday]} ${clockOf(ahead[0].startsAt)} to ${clockOf(ahead[0].endsAt)}` : null;
  const st = dbStation(b.stationId)?.ident as StationIdent;
  return {
    id: b.id,
    stationId: b.stationId,
    name: b.name,
    description: b.description,
    colour: b.colour,
    logoUrl: b.logoUrl,
    bug: b.bug,
    intro: b.intro,
    outro: b.outro,
    sequences: b.sequences,
    owner: st,
    carried: false,
    reskin: "owner_only",
    items: { intro: items.filter((i) => i.identCode === "OPN").map(item), outro: items.filter((i) => i.identCode === "CLS").map(item), id: items.filter((i) => i.code === "SID" && !i.identCode).map(item), bumpers },
    schedule: { label: templates.map(({ tb, tpl }) => `${label(tpl)}, ${minuteClock(tb.startTime)} to ${minuteClock(plusMinutes(tb.startTime, tb.lengthMs))}`).join("; ") || oneOff, next },
    ...(withPlacements
      ? {
          onLog: {
            templates: templates.map(({ tb, tpl }) => ({ templateId: tpl.id, name: tpl.name, label: label(tpl), startTime: tb.startTime, lengthMs: tb.lengthMs })),
            dates: ahead.slice(0, 20).map((s) => ({ spanId: s.id, startsAt: s.startsAt, endsAt: s.endsAt, templateId: s.templateId })),
            ahead: ahead.filter((s) => s.startsAt > t).length
          }
        }
      : {}),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  };
}

/** A template's blocks, as `DayTemplate.blocks`. */
export function templateBlocksOf(templateId: string): DayTemplateBlock[] {
  return blocksState()
    .templateBlocks.filter((tb) => tb.templateId === templateId)
    .map((tb) => {
      const b = blockById(tb.blockId);
      return { id: tb.id, blockId: tb.blockId, name: b?.name ?? "Block", colour: b?.colour ?? null, startTime: tb.startTime, lengthMs: tb.lengthMs };
    });
}

/** The words for a block that would run past 6:00 am in a template. */
export const BLOCK_CROSSES_DAY = "A block in a day template ends by 6:00 am, when the next broadcast day starts. Make it two blocks, or place it on the date.";

/** Replaces a template's blocks (each ending by 6:00 am). Returns the problem's message, or null. */
export function setTemplateBlocks(templateId: string, list: Array<{ blockId: string; startTime: string; lengthMs: number }>): string | null {
  const order = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h * 60 + m - 360 + 1440) % 1440;
  };
  for (const b of list) if (order(b.startTime) * MIN + b.lengthMs > 1440 * MIN) return BLOCK_CROSSES_DAY;
  const s = blocksState();
  s.templateBlocks = [...s.templateBlocks.filter((tb) => tb.templateId !== templateId), ...list.map((b) => ({ id: crypto.randomUUID(), templateId, ...b }))];
  saveBlocks();
  return null;
}

type BlockChange = Extract<LogChange, { op: "block_add" | "block_resize" | "block_remove" }>;
export const isBlockChange = (c: LogChange): c is BlockChange => c.op === "block_add" || c.op === "block_resize" || c.op === "block_remove";

/**
 * Edit mode's block changes, checked as the API checks them: the block is the station's (and not
 * archived), a span runs up to 24 hours, one on air can only change its end, blocks never overlap.
 * `publish` puts them on and answers the spans' ids by change.
 */
export function checkBlockChanges(stationId: string, changes: LogChange[], o: { t: number; boundary: number; tooSoon: string }) {
  const problems: LogChangesResult["problems"] = [];
  const lines = new Map<number, string>();
  const results = new Map<number, { key: string | null; spanId: string | null; startsAt: string | null; endsAt: string | null }>();
  const s = blocksState();
  const drafts = new Map<string, { span: MockSpan | null; next: { startsAt: string; endsAt: string } | null; index: number; blockId: string; key: string | null }>();
  const day = (iso: string) => DAY_SHORT[localParts(iso).weekday];
  for (const [index, c] of changes.entries()) {
    if (!isBlockChange(c)) continue;
    if (c.op === "block_add") {
      const b = blockById(c.blockId);
      const next = { startsAt: snapTime(c.startsAt), endsAt: snapTime(c.endsAt) };
      drafts.set(`new:${index}`, { span: null, next, index, blockId: c.blockId, key: c.key ?? null });
      lines.set(index, `${b?.name ?? "A block"} added, ${day(next.startsAt)} ${clockOf(next.startsAt)} to ${clockOf(next.endsAt)}`);
      results.set(index, { key: c.key ?? null, spanId: null, ...next });
      if (!b || b.stationId !== stationId) problems.push({ index, code: "not_found", message: "That block isn't this station's." });
      else if (b.archivedAt) problems.push({ index, code: "block_archived", message: `${b.name} is archived.` });
      else if (Date.parse(next.startsAt) < o.boundary) problems.push({ index, code: "too_soon", message: o.tooSoon });
      continue;
    }
    const span = s.spans.find((x) => x.id === c.spanId && x.stationId === stationId);
    if (!span) {
      lines.set(index, "A block that isn't on the log any more");
      problems.push({ index, code: "not_found", message: "That block isn't on the log any more." });
      continue;
    }
    const name = blockById(span.blockId)?.name ?? "The block";
    const d = drafts.get(span.id) ?? { span, next: { startsAt: span.startsAt, endsAt: span.endsAt }, index, blockId: span.blockId, key: null };
    drafts.set(span.id, d);
    d.index = index;
    const onAir = Date.parse(span.startsAt) < o.boundary;
    if (c.op === "block_remove") {
      lines.set(index, `${name} comes off the log`);
      if (Date.parse(span.endsAt) <= o.t) problems.push({ index, code: "block_locked", message: "It has already aired." });
      else if (onAir) problems.push({ index, code: "block_locked", message: `${name} is on air. Change it after ${clockOf(span.endsAt)}.` });
      else d.next = null;
      results.set(index, { key: null, spanId: span.id, startsAt: null, endsAt: null });
      continue;
    }
    const cur = d.next ?? { startsAt: span.startsAt, endsAt: span.endsAt };
    const startsAt = c.startsAt ? snapTime(c.startsAt) : cur.startsAt;
    const endsAt = c.endsAt ? snapTime(c.endsAt) : cur.endsAt;
    const startMoves = startsAt !== cur.startsAt;
    const endMoves = endsAt !== cur.endsAt;
    lines.set(index, startMoves && endMoves ? `${name} now runs ${clockOf(startsAt)} to ${clockOf(endsAt)}` : startMoves ? `${name} now starts at ${clockOf(startsAt)}` : `${name} now ends at ${clockOf(endsAt)}`);
    if (Date.parse(span.endsAt) <= o.t) problems.push({ index, code: "block_locked", message: "It has already aired." });
    else if (onAir && (startMoves || Date.parse(endsAt) < o.boundary)) problems.push({ index, code: "block_locked", message: `${name} is on air. Change it after ${clockOf(span.endsAt)}.` });
    else if (!onAir && Date.parse(startsAt) < o.boundary) problems.push({ index, code: "too_soon", message: o.tooSoon });
    d.next = { startsAt, endsAt };
    results.set(index, { key: null, spanId: span.id, startsAt, endsAt });
  }
  const placed = [...drafts.entries()].filter(([, d]) => d.next);
  for (const [, d] of placed) {
    if (problems.some((p) => p.index === d.index)) continue;
    const ms = Date.parse(d.next!.endsAt) - Date.parse(d.next!.startsAt);
    if (ms <= 0) problems.push({ index: d.index, code: "bad_request", message: "It has to end after it starts." });
    else if (ms > 24 * HOUR) problems.push({ index: d.index, code: "bad_request", message: "A block runs 24 hours at most." });
  }
  const others = s.spans.filter((x) => x.stationId === stationId && !drafts.has(x.id)).map((x) => ({ key: x.id, blockId: x.blockId, startsAt: x.startsAt, endsAt: x.endsAt }));
  const all = [...others, ...placed.map(([key, d]) => ({ key, blockId: d.blockId, ...d.next! }))];
  for (const [key, d] of placed) {
    if (problems.some((p) => p.index === d.index)) continue;
    const other = all.find((x) => x.key !== key && x.startsAt < d.next!.endsAt && d.next!.startsAt < x.endsAt);
    if (other) problems.push({ index: d.index, code: "block_overlap", message: `Blocks can't overlap: ${blockById(other.blockId)?.name ?? "another block"} is on until ${clockOf(other.endsAt)}.` });
  }
  const times = [...drafts.values()].flatMap((d) => [d.span?.startsAt, d.span ? new Date(Date.parse(d.span.endsAt) - 1).toISOString() : undefined, d.next?.startsAt, d.next ? new Date(Date.parse(d.next.endsAt) - 1).toISOString() : undefined].filter((v): v is string => Boolean(v)));
  return {
    problems,
    lines,
    results,
    times,
    publish() {
      for (const [key, d] of drafts) {
        if (!d.span) {
          if (!d.next) continue;
          const span: MockSpan = { id: crypto.randomUUID(), stationId, blockId: d.blockId, startsAt: d.next.startsAt, endsAt: d.next.endsAt, templateId: null };
          s.spans.push(span);
          results.set(d.index, { ...results.get(d.index)!, spanId: span.id });
          void key;
        } else if (!d.next) s.spans = s.spans.filter((x) => x.id !== d.span!.id);
        else Object.assign(d.span, { startsAt: d.next.startsAt, endsAt: d.next.endsAt, templateId: null });
      }
      saveBlocks();
    }
  };
}
