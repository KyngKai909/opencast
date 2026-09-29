import { describe, expect, it } from "vitest";
import { breakCue, crc32Mpeg2, decodeSpliceInsert, encodeSpliceInsert } from "../src/v1/modules/playout/engine/scte35.js";

describe("SCTE-35", () => {
  it("CRC-32/MPEG-2 matches the standard check value", () => {
    // The catalogue check value for CRC-32/MPEG-2 over "123456789".
    expect(crc32Mpeg2(Buffer.from("123456789"))).toBe(0x0376e6e7);
  });

  it("a splice_insert round-trips, with a valid CRC", () => {
    const out = encodeSpliceInsert({ eventId: 1234, outOfNetwork: true, durationMs: 120_000, autoReturn: true });
    expect(out[0]).toBe(0xfc);
    expect(decodeSpliceInsert(out)).toEqual({ eventId: 1234, outOfNetwork: true, durationMs: 120_000, autoReturn: true, crcOk: true });
    const back = decodeSpliceInsert(encodeSpliceInsert({ eventId: 1234, outOfNetwork: false }));
    expect(back).toMatchObject({ outOfNetwork: false, durationMs: undefined, crcOk: true });
  });

  it("a corrupted cue fails its CRC", () => {
    const bytes = encodeSpliceInsert({ eventId: 7, outOfNetwork: true, durationMs: 90_000 });
    bytes[16] ^= 0xff;
    expect(decodeSpliceInsert(bytes).crcOk).toBe(false);
  });

  it("cues every break the same way on every playlist refresh, stored or not", () => {
    const stored = breakCue("station-1", { id: "9f1c2d3e-0000-4000-8000-000000000000", startsAt: "2026-10-01T03:28:30.000Z", lengthMs: 90_000 });
    expect(stored).toMatchObject({ id: "9f1c2d3e-0000-4000-8000-000000000000", durationMs: 90_000, eventId: 0x9f1c2d3e });
    const generated = breakCue("station-1", { id: null, startsAt: "2026-10-01T03:28:30.000Z", lengthMs: 90_000 });
    expect(generated.id).toBe(`brk-station-1-${Date.parse("2026-10-01T03:28:30.000Z")}`);
    expect(breakCue("station-1", { id: null, startsAt: "2026-10-01T03:28:30.000Z", lengthMs: 90_000 })).toEqual(generated);
  });
});
