import { describe, expect, it } from "vitest";
import { breakDateRanges, crc32Mpeg2, decodeSpliceInsert, decoratePlaylist, encodeSpliceInsert } from "../src/v1/modules/playout/engine/scte35.js";

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

  it("writes EXT-X-DATERANGE pairs into a live playlist before the first segment", () => {
    const playlist = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-TARGETDURATION:2", "#EXT-X-PROGRAM-DATE-TIME:2026-10-01T03:28:28.000Z", "#EXTINF:2.0,", "seg_1.ts", ""].join("\n");
    const decorated = decoratePlaylist(playlist, [{ id: "brk-1", startsAt: new Date("2026-10-01T03:28:30Z"), durationMs: 90_000, eventId: 1 }]);
    const lines = decorated.split("\n");
    expect(lines[3]).toMatch(/^#EXT-X-DATERANGE:ID="brk-1",START-DATE="2026-10-01T03:28:30.000Z",PLANNED-DURATION=90.000,SCTE35-OUT=0xFC/);
    expect(lines[4]).toMatch(/DURATION=90.000,SCTE35-IN=0xFC/);
    expect(breakDateRanges({ id: "b", startsAt: new Date(0), durationMs: 1000, eventId: 2 })).toHaveLength(2);
  });
});
