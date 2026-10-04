// A246 (decision 1): moving rows on the rundown. The rundown isn't drawn to scale, so a drag
// reorders: the row dropped starts right after the row above it (after that row's own break), and
// the rows after it shift down only as far as the next fixed point: a live block, a carried program
// (its times are the carriage agreement's), planned off air, a row kept at its time (G18), what's
// locked near air, or a block's edge (a row isn't pushed into or out of a block). Time freed or
// lost isn't hidden: it shows as dead air, or as an overlap the dry run refuses, in the tray. The
// same push makes room for something added ("Add here", the drawer) and follows a live block or
// sign-off given a new end. Exact times can still be typed in the pane.
//
// Block membership while dragging is worked out here with the API's start-time rule (`spanAt`); the
// tray's lines are the dry run's.

import type { BreakSlot, LogChange } from "@opencast/contracts";
import { spanAt, type DraftEntry, type DraftSpan } from "./logEdit";

const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();

/** Why a row stays where it is when the rows around it move. */
export type FixedReason = "locked" | "live" | "carried" | "kept" | "off_air";

/** A fixed row's line in edit mode (a locked one says why in the API's words instead). */
export const FIXED_WORDS: Record<Exclude<FixedReason, "locked">, string> = {
  live: "Live, so it keeps its start",
  carried: "Carried, so it keeps its time",
  kept: "Kept at this time",
  off_air: "Off air, so it keeps its time"
};

/** Why an entry is a fixed point, or null when it moves with the rows around it. */
export function fixedReason(e: Pick<DraftEntry, "kind" | "keepTime" | "carriageAgreementId">, locked: boolean): FixedReason | null {
  if (locked) return "locked";
  if (e.kind === "live") return "live";
  if (e.kind === "off_air") return "off_air";
  if (e.keepTime) return "kept";
  if (e.carriageAgreementId) return "carried";
  return null;
}

export interface Reflow {
  /** The draft's entries (removed ones left out). */
  entries: DraftEntry[];
  /** The draft's breaks: each follows its program. */
  breaks: BreakSlot[];
  /** A fixed point: nothing pushes it. */
  fixed: (e: DraftEntry) => boolean;
  /** Times a row isn't pushed across: blocks' starts and ends, and planned off air's starts. */
  edges: string[];
}

/** The draft's edges: its blocks' starts and ends, and where planned off air begins. */
export function edgesOf(spans: Array<Pick<DraftSpan, "startsAt" | "endsAt">>, offAir: Array<{ startsAt: string }>): string[] {
  return [...spans.flatMap((s) => [s.startsAt, s.endsAt]), ...offAir.map((o) => o.startsAt)];
}

const sorted = (entries: DraftEntry[]) => [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

/** Where the row after an entry can start: after the entry's own break, when one follows it. */
export function endWithBreak(e: Pick<DraftEntry, "endsAt">, breaks: BreakSlot[]): number {
  const end = t(e.endsAt);
  return breaks.filter((b) => t(b.startsAt) === end).reduce((a, b) => Math.max(a, t(b.startsAt) + b.lengthMs), end);
}

const span = (e: DraftEntry) => t(e.endsAt) - t(e.startsAt);

/**
 * The rows from `list[from]` on pushed down from `cursor`, each just after the last, until one
 * starts later anyway (a gap takes the rest), or a fixed point or an edge stops them.
 */
function pushFrom(r: Reflow, list: DraftEntry[], from: number, cursor: number): LogChange[] {
  const moves: LogChange[] = [];
  for (const e of list.slice(from)) {
    const start = t(e.startsAt);
    if (start >= cursor || r.fixed(e)) break;
    if (r.edges.some((x) => start < t(x) && t(x) <= cursor)) break;
    moves.push({ op: "move", entryId: e.id, startsAt: iso(cursor) });
    cursor += span(e) + (endWithBreak(e, r.breaks) - t(e.endsAt));
  }
  return moves;
}

/** Where a row dropped after `afterId` would start (null: at the top, where the first row starts). */
export function dropStart(r: Reflow, id: string, afterId: string | null): string | null {
  const list = sorted(r.entries).filter((e) => e.id !== id);
  if (afterId === null) return list[0]?.startsAt ?? null;
  const above = list.find((e) => e.id === afterId);
  return above ? iso(endWithBreak(above, r.breaks)) : null;
}

/**
 * A row dropped after another (`afterId`; null: at the top): it starts right after that row (and
 * its break), and the rows below it shift down as far as the next fixed point.
 */
export function dropAfter(r: Reflow, id: string, afterId: string | null): LogChange[] {
  const moved = r.entries.find((e) => e.id === id);
  if (!moved || afterId === id) return [];
  const list = sorted(r.entries).filter((e) => e.id !== id);
  const at = afterId === null ? 0 : list.findIndex((e) => e.id === afterId) + 1;
  if (afterId !== null && at === 0) return [];
  const start = afterId === null ? (list[0] ? t(list[0].startsAt) : t(moved.startsAt)) : endWithBreak(list[at - 1], r.breaks);
  const changes: LogChange[] = start === t(moved.startsAt) ? [] : [{ op: "move", entryId: id, startsAt: iso(start) }];
  return [...changes, ...pushFrom(r, list, at, start + span(moved) + (endWithBreak(moved, r.breaks) - t(moved.endsAt)))];
}

/**
 * The arrow keys: a row one place up or down (after the row two above it, or after the row below).
 * Null when it can't go that way: at either end, or up past a row that can't change.
 */
export function nudge(r: Reflow, id: string, dir: -1 | 1, locked: (e: DraftEntry) => boolean): LogChange[] | null {
  const list = sorted(r.entries);
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return null;
  if (dir < 0) {
    if (i === 0 || locked(list[i - 1])) return null;
    return dropAfter(r, id, i >= 2 ? list[i - 2].id : null);
  }
  if (i === list.length - 1) return null;
  return dropAfter(r, id, list[i + 1].id);
}

/** Something put on at `at` for `lengthMs`: what's after it shifts down as far as the next fixed point. */
export function makeRoom(r: Reflow, at: string, lengthMs: number): LogChange[] {
  const list = sorted(r.entries).filter((e) => e.startsAt >= at);
  return pushFrom(r, list, 0, t(at) + lengthMs);
}

/** A live block or sign-off given a new end: what follows it shifts down as far as the next fixed point. */
export function resizeTo(r: Reflow, id: string, endsAt: string): LogChange[] {
  const e = r.entries.find((x) => x.id === id);
  if (!e || endsAt === e.endsAt) return [];
  const list = sorted(r.entries).filter((x) => x.id !== id && x.startsAt >= e.startsAt);
  const trail = endWithBreak(e, r.breaks) - t(e.endsAt);
  return [{ op: "resize", entryId: id, endsAt }, ...pushFrom(r, list, 0, t(endsAt) + trail)];
}

/** Where the drop would put a row, in a block's words: "Joins Late Crate Nights", "Leaves Late Crate Nights". */
export function membershipNote(spans: DraftSpan[], from: string, to: string): string | null {
  const before = spanAt(spans, from);
  const after = spanAt(spans, to);
  if (before?.id === after?.id) return after ? `In ${after.name}` : null;
  if (after) return `Joins ${after.name}`;
  return before ? `Leaves ${before.name}` : null;
}
