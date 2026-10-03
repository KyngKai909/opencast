// Programming blocks on the log (A244, 2026-10-02; Build B of design-bumpers-blocks). A block is
// placed on a date's log as a span (`program_block_spans`: the station's intent), or in a day
// template (`day_template_blocks`), and generated onto each date with the template's entries.
//
// Membership is by start time (A244's answers to the design's questions 6 and 7):
// - a program or live block whose start is inside `[span.startsAt, span.endsAt)` is a member;
// - the block airs from its first member's start to its last member's end (`airsFrom`,
//   `airsUntil`): a member that runs past the span's end stays in the block to its end, and the
//   block's band reaches that far; one that starts before the span and runs into it isn't a member;
// - a span with no members airs nothing as a block;
// - a member's breaks are the block's (they belong to their entry), its closing break included;
// - open time between two members is in the block; planned off-air time isn't (the block pauses,
//   and its members on either side still belong: two pieces).
// A span may cross 6:00 am on a date's log (it belongs to the broadcast day it starts in, and an
// edit marks both days edited); a day template's blocks end by 6:00 am.
//
// Pure functions here; the log service loads spans, entries and off-air time.

import { and, asc, gt, inArray, lt } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Executor } from "../../context.js";

const S = schema.programBlockSpans;

export type SpanRow = typeof S.$inferSelect;
type EntryLike = { id: string; kind: string; startsAt: Date; endsAt: Date };

/** A span and what's in it. Times are milliseconds. */
export interface Membership<E extends EntryLike = EntryLike> {
  span: SpanRow;
  members: E[];
  airsFrom: number | null;
  airsUntil: number | null;
  /** Where the block is on air: its members, with the open time between them, split by off-air time. */
  pieces: Array<{ s: number; e: number }>;
}

/** A span that ended this long before a window can still reach into it (a member running past its end). */
export const SPAN_REACH_MS = 12 * 3_600_000;

/** Spans on these stations that start before `to` and end after `from` less a span's reach (an overrunning member can air into the window). */
export async function loadSpans(db: Executor, stationIds: string[], from: Date, to: Date): Promise<SpanRow[]> {
  if (!stationIds.length) return [];
  return db
    .select()
    .from(S)
    .where(and(inArray(S.stationId, stationIds), lt(S.startsAt, to), gt(S.endsAt, new Date(from.getTime() - SPAN_REACH_MS))))
    .orderBy(asc(S.startsAt));
}

/** Whether an entry belongs to a span: a program or live block starting inside it. */
export const isMember = (span: { startsAt: Date; endsAt: Date }, e: EntryLike) => e.kind !== "off_air" && e.startsAt >= span.startsAt && e.startsAt < span.endsAt;

/**
 * Each span's members, where it airs, and its pieces. `offAir` is planned off-air time (off-air
 * hours and sign-offs); time between two members that has any of it splits the block.
 */
export function memberships<E extends EntryLike>(spans: SpanRow[], rows: E[], offAir: Array<{ s: number; e: number }>): Array<Membership<E>> {
  const sorted = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return spans.map((span) => {
    const members = sorted.filter((r) => isMember(span, r));
    const pieces: Array<{ s: number; e: number }> = [];
    for (const m of members) {
      const s = m.startsAt.getTime();
      const e = m.endsAt.getTime();
      const last = pieces[pieces.length - 1];
      const paused = last && offAir.some((o) => o.s < s && o.e > last.e);
      if (last && !paused) last.e = Math.max(last.e, e);
      else pieces.push({ s, e });
    }
    return {
      span,
      members,
      airsFrom: pieces.length ? pieces[0].s : null,
      airsUntil: pieces.length ? Math.max(...pieces.map((p) => p.e)) : null,
      pieces
    };
  });
}

/** Each member entry's span (by entry id). */
export function memberOf<E extends EntryLike>(list: Array<Membership<E>>): Map<string, SpanRow> {
  const out = new Map<string, SpanRow>();
  for (const m of list) for (const e of m.members) out.set(e.id, m.span);
  return out;
}

/** The block on air at `t` (by its pieces), if any. */
export function blockAt<E extends EntryLike>(list: Array<Membership<E>>, t: number): SpanRow | null {
  for (const m of list) if (m.pieces.some((p) => p.s <= t && t < p.e)) return m.span;
  return null;
}

/** Two spans' times overlap. */
export const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
