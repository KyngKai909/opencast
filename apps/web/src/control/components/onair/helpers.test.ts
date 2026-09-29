import { describe, expect, it } from "vitest";
import { callSignState, readColour } from "./StationForm";
import { openGaps, timelineBlocks } from "./LogPage";

const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;

describe("the call sign field", () => {
  it("reads free, taken and not three to five capitals", () => {
    expect(callSignState("", null, undefined)).toBe("empty");
    expect(callSignState("BE", null, undefined)).toBe("invalid");
    expect(callSignState("BEAT", null, { valid: true, available: false })).toBe("taken");
    expect(callSignState("TAPE", null, { valid: true, available: true })).toBe("free");
    expect(callSignState("TAPE", null, undefined)).toBe("checking");
  });
  it("counts the station's own call sign as free", () => {
    expect(callSignState("BEAT", "BEAT", { valid: true, available: false })).toBe("free");
  });
});

describe("the colour field", () => {
  it("reads #rrggbb with or without the #", () => {
    expect(readColour("8c3b7a")).toBe("#8C3B7A");
    expect(readColour("#1F5E8C ")).toBe("#1F5E8C");
    expect(readColour("#12345")).toBeNull();
  });
});

describe("the log's timeline", () => {
  const log = {
    entries: [
      { id: "a", kind: "program" as const, code: "PGM" as const, startsAt: T("03:30"), endsAt: T("03:59"), title: "Saturday Reel", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: { id: "r", kind: "station" as const, callSign: "REEL", handle: "reel", name: "Saturday Reel", colour: "#9A5412", band: "tv" as const, channel: "24.1", marketSlug: null, homeCity: null }, carriageAgreementId: null, repeatGroupId: null, localNote: null },
      { id: "b", kind: "live" as const, code: "PGM" as const, startsAt: T("04:01"), endsAt: T("04:58"), title: "Beat Tape Live", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null }
    ],
    breaks: [
      { id: "in", startsAt: T("03:44"), lengthMs: 120_000, context: "", origin: "carried_barter" as const, producerShareMs: 0, filledMs: 0, openMs: 0 },
      { id: "after", startsAt: T("03:59"), lengthMs: 120_000, context: "", origin: "rule" as const, producerShareMs: 0, filledMs: 0, openMs: 0 }
    ],
    gaps: [
      { startsAt: T("01:00"), endsAt: T("03:30") },
      { startsAt: T("06:40"), endsAt: T("09:00") }
    ]
  };

  it("draws programs, the breaks between them, and dead air still ahead", () => {
    const blocks = timelineBlocks(log, T("01:00"), T("09:00"), Date.parse(T("03:42")));
    expect(blocks.map((b) => [b.kind, b.id])).toEqual([
      ["car", "a"],
      ["brk", "after"],
      ["pgm", "b"],
      ["dead", `gap:${T("06:40")}`]
    ]);
    expect(blocks[2].source).toBe("Live source");
  });

  it("starts a gap no earlier than now, and follows it past the window's edge", () => {
    const deadAir = [{ startsAt: T("06:40"), endsAt: T("13:00") }];
    expect(openGaps([{ startsAt: T("06:40"), endsAt: T("09:00") }], deadAir, T("09:00"), Date.parse("2026-09-27T06:30:30.000Z"))).toEqual([{ key: T("06:40"), startsAt: T("06:40"), endsAt: T("13:00") }]);
    expect(openGaps([{ startsAt: T("06:40"), endsAt: T("09:00") }], [], T("10:00"), Date.parse("2026-09-27T07:00:30.000Z"))).toEqual([{ key: T("06:40"), startsAt: T("07:01"), endsAt: T("09:00") }]);
  });

  it("draws and offers times on 4-second segment boundaries, as the API answers them", () => {
    const S = (hms: string) => `2026-09-27T${hms}.000Z`;
    const odd = { ...log, entries: [{ ...log.entries[0], startsAt: S("03:30:01"), endsAt: S("03:58:30") }], breaks: [], gaps: [] };
    const [b] = timelineBlocks(odd, T("01:00"), T("09:00"), Date.parse(T("03:42")));
    expect([b.start, b.end]).toEqual([S("03:30:00"), S("03:58:32")]);
    expect(openGaps([{ startsAt: S("06:40:30"), endsAt: S("08:59:59") }], [], T("10:00"), Date.parse(T("03:42")))).toEqual([{ key: S("06:40:30"), startsAt: S("06:40:32"), endsAt: T("09:00") }]);
  });
});
