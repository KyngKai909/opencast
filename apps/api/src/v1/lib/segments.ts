// The stream changes item at segment boundaries (platform prompt, Phase 5: prepare once, then
// assemble), so the log's times are on them: programs, live blocks, off air and breaks start and
// end on a 4-second boundary of the wall clock. The log editor snaps; the API rounds what it's
// sent to the nearest boundary (existing times are accepted and rounded, never refused).
//
// The rule lives in `@opencast/contracts` (G12), shared with the apps; re-exported here so the
// API's callers keep importing it from this file.

import { snapToSegment } from "@opencast/contracts";

export { SEGMENT_MS, endEarlyAt, nextSegment, snapToSegment } from "@opencast/contracts";
export const snapDate = (d: Date) => new Date(snapToSegment(d.getTime()));
