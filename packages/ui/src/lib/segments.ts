// The log's times sit on segment boundaries (platform prompt, Phase 5: prepare once, then
// assemble). Every item is prepared in 4-second segments, and a channel changes item only between
// segments, so programs, live blocks, off air and breaks start and end on a 4-second boundary of
// the wall clock, counted from the Unix epoch (every whole minute is one, in any time zone).
//
// The same rule as the API's (apps/api/src/v1/lib/segments.ts): the API rounds what it's sent to
// the nearest boundary, a cued break starts at the next one, and a live block ended early ends at
// the nearest one after its start. Master control snaps with these, so the times it shows are the
// ones the API answers; the mocks snap with them too.

import type { TimeInput } from "./format";

/** One segment, in milliseconds. */
export const SEGMENT_MS = 4_000;

const msOf = (t: TimeInput): number => (typeof t === "number" ? t : t instanceof Date ? t.getTime() : new Date(t).getTime());

/** The nearest segment boundary (a tie goes later, as Math.round does). */
export function snapToSegment(t: number): number {
  return Math.round(t / SEGMENT_MS) * SEGMENT_MS;
}

/** The next segment boundary at or after `t`. */
export function nextSegment(t: number): number {
  return Math.ceil(t / SEGMENT_MS) * SEGMENT_MS;
}

/** A time on the nearest boundary, as an ISO string (what the log's endpoints answer). */
export function snapTime(t: TimeInput): string {
  return new Date(snapToSegment(msOf(t))).toISOString();
}

/** Whether a time is on a boundary already. */
export function onSegment(t: TimeInput): boolean {
  return msOf(t) % SEGMENT_MS === 0;
}

/** A length rounded to whole segments, as a template entry's slot is: never below one segment. */
export function snapLength(lengthMs: number): number {
  return Math.max(SEGMENT_MS, snapToSegment(lengthMs));
}

/**
 * A span of the log on boundaries: the start and end each to the nearest, and never shorter than
 * a segment (an end that rounds onto the start moves a segment on).
 */
export function snapSpan<T extends { startsAt: string; endsAt: string }>(span: T): T {
  const a = snapToSegment(msOf(span.startsAt));
  const z = Math.max(a + SEGMENT_MS, snapToSegment(msOf(span.endsAt)));
  return { ...span, startsAt: new Date(a).toISOString(), endsAt: new Date(z).toISOString() };
}

/**
 * Where a live block ended early ends: the nearest boundary to `t`, or the next one when the
 * nearest is at or before the block's start (the API's endEarly).
 */
export function endEarlyAt(t: number, startsAt: TimeInput): number {
  const near = snapToSegment(t);
  return near > msOf(startsAt) ? near : nextSegment(t);
}
