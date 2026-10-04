// A246 (opencast-schedule 07, f-blockplace): a programming block's start and end as handles on the
// rundown in edit mode, the Log's and a template's. A handle drops between rows and takes the start
// of the row below (where membership changes anyway: a program starting inside the block is its
// member), or the day's end; the arrow keys move it a row at a time; exact times are still typed in
// the pane. A block on air can only change its end, blocks never overlap, and a handle stays inside
// the day shown (on a template, that's "ends by 6:00 am").
//
// Membership while dragging is worked out here with the API's start-time rule (`isMember` in
// apps/api log/blocks.ts, mirrored by `spanPieces` and `spanAt` in logEdit.ts): the rows say who
// joins or leaves. The tray's lines are the dry run's (on the Log), or the template's own check.

import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import type { DayRow } from "./dayRows";
import { spanAt, spanPieces, type DraftEntry, type DraftSpan } from "./logEdit";

const t = (s: string) => Date.parse(s);

export type HandleEdge = "start" | "end";

/** Whether an entry is a span's member: a program or live block starting inside it. */
export const isMember = (span: Pick<DraftSpan, "startsAt" | "endsAt">, e: Pick<DraftEntry, "kind" | "startsAt">) => e.kind !== "off_air" && e.startsAt >= span.startsAt && e.startsAt < span.endsAt;

/**
 * Where a handle can land: the start of each row a block's edge can sit above (a program, live
 * block, sign-off, dead air or planned off air, not a break: it belongs to its program), and the
 * day's end. Sorted, each once.
 */
export function handleSpots(rows: DayRow[], dayEnd: string): string[] {
  const at = rows.filter((r) => (r.kind === "entry" && !r.removed) || r.kind === "gap" || r.kind === "off_air").map((r) => r.at);
  return [...new Set([...at, dayEnd])].sort();
}

export interface HandleLimits {
  /** Nothing earlier than this can change (now, and the assembler's lead on air). */
  earliest: number;
  /** The day shown ends here: a handle stays inside it. */
  dayEnd: string;
}

/**
 * How far an edge can go, both ends exclusive of the other edge: a start between the block before
 * and its own end, an end between its own start and the block after. Null when it can't move (a
 * start that's on air or past, an end that's already gone by).
 */
export function handleRange(span: Pick<DraftSpan, "id" | "startsAt" | "endsAt">, spans: Array<Pick<DraftSpan, "id" | "startsAt" | "endsAt">>, edge: HandleEdge, o: HandleLimits): { min: number; max: number } | null {
  const others = spans.filter((s) => s.id !== span.id);
  if (edge === "start") {
    if (t(span.startsAt) < o.earliest) return null;
    const before = Math.max(o.earliest, ...others.filter((s) => s.endsAt <= span.startsAt).map((s) => t(s.endsAt)));
    return { min: before, max: t(span.endsAt) - 1 };
  }
  if (t(span.endsAt) <= o.earliest) return null;
  const after = Math.min(t(o.dayEnd), ...others.filter((s) => s.startsAt >= span.endsAt).map((s) => t(s.startsAt)));
  return { min: Math.max(t(span.startsAt), o.earliest) + 1, max: after };
}

/** The spots inside a range, in order. */
export function spotsIn(spots: string[], range: { min: number; max: number }): string[] {
  return spots.filter((s) => t(s) >= range.min && t(s) <= range.max);
}

/**
 * The arrow keys: the edge a row up or down. An edge sits above the row it's at or before (the
 * first spot at or after it); a row down is above the next row, a row up above the one before.
 * Null at either end, or past what the edge can reach.
 */
export function nudgeHandle(spots: string[], current: string, dir: -1 | 1, range: { min: number; max: number }): string | null {
  const here = spots.findIndex((s) => s >= current);
  const target = here < 0 ? (dir < 0 ? spots[spots.length - 1] : undefined) : spots[here + dir];
  if (!target || target === current || t(target) < range.min || t(target) > range.max) return null;
  return target;
}

/** Who joins a span and who leaves it when its times change, by the start-time rule. */
export function membershipChange(span: Pick<DraftSpan, "startsAt" | "endsAt">, next: Pick<DraftSpan, "startsAt" | "endsAt">, entries: DraftEntry[]): { joins: DraftEntry[]; leaves: DraftEntry[] } {
  const before = entries.filter((e) => isMember(span, e));
  const after = entries.filter((e) => isMember(next, e));
  return { joins: after.filter((e) => !before.includes(e)), leaves: before.filter((e) => !after.includes(e)) };
}

const names = (list: DraftEntry[]) => {
  const titles = list.map((e) => e.title);
  return titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}` : titles[0];
};

/** While dragging an edge: "Crate Session 01 leaves it", "Late Crate, ep. 13 joins it", or that nothing changes. */
export function membershipWords(change: { joins: DraftEntry[]; leaves: DraftEntry[] }): string {
  const words = [change.joins.length ? `${names(change.joins)} ${change.joins.length === 1 ? "joins" : "join"} it` : null, change.leaves.length ? `${names(change.leaves)} ${change.leaves.length === 1 ? "leaves" : "leave"} it` : null].filter(Boolean);
  return words.length ? words.join(". ") : "Its programs stay the same";
}

/** A handle's line, as f-blockplace draws them, and the small words under it. */
export function handleWords(span: DraftSpan, edge: HandleEdge, o: { was?: Pick<DraftSpan, "startsAt" | "endsAt">; entries: DraftEntry[]; outro?: boolean; locked?: boolean }, tz = STATION_TZ): { title: string; detail: string } {
  const at = (iso: string) => clock(iso, { timeZone: tz });
  if (edge === "start") {
    const was = o.was && o.was.startsAt !== span.startsAt ? `, was ${at(o.was.startsAt)}` : "";
    if (o.locked) return { title: `${span.name} started ${at(span.startsAt)}`, detail: "On air, so only its end can change" };
    return { title: `${span.name} starts ${at(span.startsAt)}${was}`, detail: "Drag to change. Programs that start inside it become its members" };
  }
  const was = o.was && o.was.endsAt !== span.endsAt ? `, was ${at(o.was.endsAt)}` : "";
  const pieces = spanPieces(span, o.entries);
  const last = pieces[pieces.length - 1];
  const detail = !pieces.length ? "Nothing in it yet" : o.outro ? `Its outro airs at ${clock(last.endsAt, { timeZone: tz, seconds: true })}` : `It airs until ${at(last.endsAt)}`;
  return { title: `Ends ${at(span.endsAt)}${was}`, detail };
}

/**
 * What a row says about the block around it in edit mode: "Member. Its intro airs just before"
 * (the first, when the block has an intro), "Member, runs to 12:29 am" (one running past the end),
 * "Member", "Not a member: starts after the block ends" (the first after it), "Not a member: starts
 * before the block" (one running into it). Null with no block near.
 */
export function memberNote(e: DraftEntry, spans: DraftSpan[], entries: DraftEntry[], o: { intro?: (blockId: string) => boolean } = {}, tz = STATION_TZ): string | null {
  if (e.kind === "off_air") return null;
  const span = spanAt(spans, e.startsAt);
  if (span) {
    const members = entries.filter((x) => isMember(span, x)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    if (members[0]?.id === e.id && o.intro?.(span.blockId)) return "Member. Its intro airs just before";
    if (e.endsAt > span.endsAt) return `Member, runs to ${clock(e.endsAt, { timeZone: tz })}`;
    return "Member";
  }
  if (spans.some((s) => e.startsAt < s.startsAt && s.startsAt < e.endsAt)) return "Not a member: starts before the block";
  const sorted = entries.filter((x) => x.kind !== "off_air").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const prev = sorted[sorted.findIndex((x) => x.id === e.id) - 1];
  if (prev && spans.some((s) => isMember(s, prev) && s.endsAt <= e.startsAt)) return "Not a member: starts after the block ends";
  return null;
}
