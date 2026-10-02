// Edit mode's draft (the user's request of 2026-09-29): the changes an operator makes to the log
// before publishing them, as the API's batch takes them (`applyLogChanges`), and the log as the
// draft leaves it. Times are snapped with the 4-second rule shared with the API (G12, open
// question A135): a drag moves to the nearest whole minute (always a segment boundary), a typed
// time to the nearest segment. On air, what's airing and anything inside the assembler's lead
// (`LOG_EDIT_LEAD_MS`) is locked, in the API's words.

import { LOG_EDIT_LEAD_MS, snapTime, snapToSegment, type BreakSlot, type LogChange, type LogEntry } from "@opencast/contracts";
import { STATION_TZ } from "../../../lib/clock";
import { broadcastDay, localParts, localTime } from "./time";

const MIN = 60_000;

/** What the draft knows about an item it puts on the log (a replacement, an insert). */
export interface DraftItem {
  id: string;
  title: string;
  durationMs: number | null;
  code?: LogEntry["code"];
  programId?: string | null;
  carriageAgreementId?: string;
  carriedFrom?: LogEntry["carriedFrom"];
}

/** An entry as the draft leaves it: what changed about it, and its insert's key. */
export type DraftEntry = LogEntry & { change?: "moved" | "resized" | "replaced" | "inserted"; key?: string };

/** The draft's own name for an insert (it has no id until it's published). */
export const insertId = (key: string) => `new:${key}`;

const entryOf = (c: LogChange): string | null => (c.op === "insert" ? (c.key ? insertId(c.key) : null) : c.entryId);

/**
 * Adds a change to the draft, keeping one of each kind per entry: a second move replaces the first,
 * a removal drops what was drafted for the entry before, and changing an insert changes the insert
 * itself (it has no id to send yet).
 */
export function withChange(changes: LogChange[], change: LogChange): LogChange[] {
  const target = entryOf(change);
  // An insert's own changes fold into it.
  if (change.op !== "insert" && change.entryId.startsWith("new:")) {
    const key = change.entryId.slice(4);
    if (change.op === "remove") return changes.filter((c) => !(c.op === "insert" && c.key === key));
    return changes.map((c) => {
      if (c.op !== "insert" || c.key !== key) return c;
      const e = c.entry;
      if (change.op === "move") {
        const length = e.endsAt ? Date.parse(e.endsAt) - Date.parse(e.startsAt) : null;
        return { ...c, entry: { ...e, startsAt: change.startsAt, ...(length ? { endsAt: new Date(Date.parse(change.startsAt) + length).toISOString() } : {}) } };
      }
      if (change.op === "resize") return { ...c, entry: { ...e, endsAt: change.endsAt } };
      return { ...c, entry: { ...e, itemId: change.itemId, carriageAgreementId: change.carriageAgreementId, endsAt: undefined } };
    });
  }
  if (change.op === "remove") return [...changes.filter((c) => entryOf(c) !== target), change];
  const same = changes.findIndex((c) => c.op === change.op && entryOf(c) === target);
  if (same < 0) return [...changes, change];
  return changes.map((c, i) => (i === same ? change : c));
}

/** The log's entries as the draft leaves them, in time order. */
export function draftEntries(entries: LogEntry[], changes: LogChange[], items: (id: string) => DraftItem | undefined): DraftEntry[] {
  const out = new Map<string, DraftEntry>(entries.map((e) => [e.id, { ...e }]));
  for (const c of changes) {
    if (c.op === "insert") {
      const key = c.key ?? String(Math.random());
      const item = c.entry.itemId ? items(c.entry.itemId) : undefined;
      const startsAt = snapTime(c.entry.startsAt);
      const endsAt = c.entry.endsAt ? snapTime(c.entry.endsAt) : new Date(Date.parse(startsAt) + wholeMinutes(item?.durationMs ?? 30 * MIN)).toISOString();
      out.set(insertId(key), {
        id: insertId(key),
        key,
        change: "inserted",
        kind: c.entry.kind,
        code: item?.code ?? "PGM",
        startsAt,
        endsAt,
        title: item?.title ?? "Program",
        episodeTitle: null,
        itemId: c.entry.itemId ?? null,
        programId: item?.programId ?? c.entry.programId ?? null,
        liveSourceId: c.entry.liveSourceId ?? null,
        carriedFrom: item?.carriedFrom ?? null,
        carriageAgreementId: c.entry.carriageAgreementId ?? null,
        repeatGroupId: null,
        localNote: null
      });
      continue;
    }
    const e = out.get(c.entryId);
    if (!e) continue;
    if (c.op === "remove") out.delete(c.entryId);
    else if (c.op === "move") {
      const startsAt = snapTime(c.startsAt);
      const length = Date.parse(e.endsAt) - Date.parse(e.startsAt);
      out.set(e.id, { ...e, startsAt, endsAt: new Date(Date.parse(startsAt) + length).toISOString(), change: e.change ?? "moved" });
    } else if (c.op === "resize") out.set(e.id, { ...e, endsAt: snapTime(c.endsAt), change: e.change ?? "resized" });
    else {
      const item = items(c.itemId);
      out.set(e.id, {
        ...e,
        itemId: c.itemId,
        title: item?.title ?? e.title,
        episodeTitle: null,
        carriageAgreementId: c.carriageAgreementId ?? null,
        carriedFrom: item?.carriedFrom ?? null,
        endsAt: new Date(Date.parse(e.startsAt) + wholeMinutes(item?.durationMs ?? 30 * MIN)).toISOString(),
        change: "replaced"
      });
    }
  }
  return [...out.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Breaks as the draft leaves them: they follow their programs (a break inside a program, or
 * right after it, moves with it) and go with a program that comes off. The API generates them
 * again from the break rule on publish; this is how they'll fall until then.
 */
export function draftBreaks(breaks: BreakSlot[], entries: LogEntry[], changes: LogChange[], drafted: DraftEntry[]): BreakSlot[] {
  const byId = new Map(drafted.map((e) => [e.id, e]));
  const removed = new Set(changes.flatMap((c) => (c.op === "remove" ? [c.entryId] : [])));
  return breaks.flatMap((b) => {
    const start = Date.parse(b.startsAt);
    // Its program: the one it's inside, or the one it follows.
    const owner = entries.find((e) => Date.parse(e.startsAt) <= start && start <= Date.parse(e.endsAt) && !(start === Date.parse(e.endsAt) && entries.some((x) => x.startsAt === b.startsAt)));
    if (!owner) return [b];
    if (removed.has(owner.id)) return [];
    const now = byId.get(owner.id);
    if (!now) return [b];
    const shift = Date.parse(now.startsAt) - Date.parse(owner.startsAt);
    return shift ? [{ ...b, startsAt: new Date(start + shift).toISOString() }] : [b];
  });
}

/** Why an entry can't change now, in the API's words, or null. Off air, only what's started is locked. */
export function lockOf(entry: Pick<LogEntry, "startsAt" | "endsAt">, now: number, onAir: boolean): string | null {
  const start = Date.parse(entry.startsAt);
  if (start >= now + (onAir ? LOG_EDIT_LEAD_MS : 0)) return null;
  if (Date.parse(entry.endsAt) <= now) return "It has already aired.";
  if (start <= now) return onAir ? "On air now, too late to change." : "It has already started.";
  return `Airs in ${Math.max(1, Math.ceil((start - now) / 1000))} s, too late to change.`;
}

/** A start dragged `dy` pixels on a timeline drawn at `pxPerMinute`: to the nearest whole minute. */
export function dragTo(startsAt: string, dy: number, pxPerMinute: number): string {
  const moved = Date.parse(startsAt) + (dy / pxPerMinute) * MIN;
  return snapTime(Math.round(moved / MIN) * MIN);
}

/**
 * A typed time ("21:10", "9:10 pm", "21:10:43") on the broadcast day of `near` (6:00 am to
 * 6:00 am: "1:30" is after midnight), snapped to the nearest segment. Null when it isn't a time.
 */
export function typedTime(text: string, near: string, tz = STATION_TZ): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm|a|p)?\s*$/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const second = Number(m[3] ?? 0);
  const period = m[4]?.toLowerCase();
  if (minute > 59 || second > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period.startsWith("p") ? 12 : 0);
  } else if (hour > 23) return null;
  const day = broadcastDay(near, tz);
  // Before 6:00 am is the night after the broadcast day's date.
  const at = Date.parse(localTime(day, hour < 6 ? hour + 24 : hour, minute, tz)) + second * 1000;
  return new Date(snapToSegment(at)).toISOString();
}

/** "21:10:44": an entry's start as the time field shows it (24-hour, in the station's zone). */
export function timeValue(iso: string, tz = STATION_TZ): string {
  const p = localParts(iso, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * Putting something on at `at` for `lengthMs`: what comes after moves down just enough, in order,
 * until a gap takes the rest. A locked entry doesn't move (the dry run then says it overlaps).
 */
export function rippleFrom(entries: DraftEntry[], at: string, lengthMs: number, locked: (e: DraftEntry) => boolean): LogChange[] {
  const moves: LogChange[] = [];
  let end = Date.parse(at) + lengthMs;
  for (const e of entries.filter((x) => x.startsAt >= at).sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const start = Date.parse(e.startsAt);
    if (start >= end || locked(e)) break;
    moves.push({ op: "move", entryId: e.id, startsAt: new Date(end).toISOString() });
    end += Date.parse(e.endsAt) - start;
  }
  return moves;
}

/** Programs are placed in whole minutes. */
export function wholeMinutes(lengthMs: number): number {
  return Math.ceil(lengthMs / MIN) * MIN;
}
