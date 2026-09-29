// The log's times sit on 4-second segment boundaries (platform prompt, Phase 5: prepare once, then
// assemble). The rule lives in `@opencast/contracts` (G12), shared with the API: the API rounds
// what it's sent to the nearest boundary, a cued break starts at the next one, and a live block
// ended early ends at the nearest one after its start. Master control snaps with these, so the
// times it shows are the ones the API answers; the mocks snap with them too.
//
// Re-exported here so master control and the mocks keep importing them from `@opencast/ui`.

export { SEGMENT_MS, endEarlyAt, nextSegment, onSegment, snapLength, snapSpan, snapTime, snapToSegment } from "@opencast/contracts";
