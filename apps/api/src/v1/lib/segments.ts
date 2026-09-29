// The stream changes item at segment boundaries (platform prompt, Phase 5: prepare once, then
// assemble), so the log's times are on them: programs, live blocks, off air and breaks start and
// end on a 4-second boundary of the wall clock. The log editor snaps; the API rounds what it's
// sent to the nearest boundary (existing times are accepted and rounded, never refused).

export const SEGMENT_MS = 4_000;

/** The nearest segment boundary. */
export const snapToSegment = (ms: number) => Math.round(ms / SEGMENT_MS) * SEGMENT_MS;
/** The next segment boundary at or after `ms`. */
export const nextSegment = (ms: number) => Math.ceil(ms / SEGMENT_MS) * SEGMENT_MS;
export const snapDate = (d: Date) => new Date(snapToSegment(d.getTime()));
