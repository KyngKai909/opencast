import { describe, expect, it } from "vitest";
import type { LogEntry } from "@opencast/contracts";
import type { BreakSlot } from "@opencast/contracts";
import { breakLine, breakRows, buildRundown, currentIndex, entrySource, nextBreak, rundownFrom } from "./rundown";

const T = (hhmmss: string) => `2026-09-27T${hhmmss}.000Z`;
const REEL = { id: "00000000-0000-4000-8000-000000000024", kind: "station" as const, callSign: "REEL", handle: "reel", name: "Saturday Reel", colour: "#9A5412", band: "tv" as const, channel: "24.1", marketSlug: "inland-empire", homeCity: "Riverside" };

function entry(o: Partial<LogEntry> & Pick<LogEntry, "id" | "startsAt" | "endsAt" | "title">): LogEntry {
  return { kind: "program", code: "PGM", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null, ...o };
}

// Saturday Reel 8:30 to 8:59 (UTC 03:30 to 03:59) with REEL's break at 8:44.
const reel = entry({ id: "e1", title: "Saturday Reel", startsAt: T("03:30:00"), endsAt: T("03:59:00"), carriedFrom: REEL });
const live = entry({ id: "e2", title: "Beat Tape Live", kind: "live", startsAt: T("04:01:00"), endsAt: T("04:58:00") });
const brk: BreakSlot = {
  id: "b1",
  startsAt: T("03:44:00"),
  lengthMs: 120_000,
  context: "During Saturday Reel",
  origin: "carried_barter",
  producerShareMs: 60_000,
  filledMs: 60_000,
  openMs: 60_000,
  rows: [
    { code: "SPT", title: "Mission Soda", lengthMs: 30_000, whose: "producer", note: "REEL's break time, barter" },
    { code: "SPT", title: "Old Town Cinema", lengthMs: 30_000, whose: "producer", note: "REEL's break time, barter" },
    { code: "OPEN", title: "Open", lengthMs: 55_000, whose: "station", note: "Holds on the station ID slate" },
    { code: "SID", title: "BEAT station ID", lengthMs: 5_000, whose: "station", note: null }
  ]
};
const after: BreakSlot = { id: "b2", startsAt: T("03:59:00"), lengthMs: 120_000, context: "After Saturday Reel", origin: "rule", producerShareMs: 0, filledMs: 15_000, openMs: 105_000 };

describe("buildRundown", () => {
  const rows = buildRundown([reel, live], [brk, after]);

  it("splits a program around the break inside it, to the second", () => {
    expect(rows.map((r) => [r.at.slice(11, 19), r.code, r.title])).toEqual([
      ["03:30:00", "PGM", "Saturday Reel, part 1"],
      ["03:44:00", "SPT", "Mission Soda"],
      ["03:44:30", "SPT", "Old Town Cinema"],
      ["03:45:00", "OPEN", "Open"],
      ["03:45:55", "SID", "BEAT station ID"],
      ["03:46:00", "PGM", "Saturday Reel, part 2"],
      ["03:59:00", "OPEN", "Break"],
      ["04:01:00", "PGM", "Beat Tape Live"]
    ]);
    expect(rows[0].lengthMs).toBe(14 * 60_000);
    expect(rows[5].lengthMs).toBe(13 * 60_000);
    expect(rows[0].source).toBe("Carried from REEL 24.1");
    expect(rows[1].source).toBe("REEL's break time, barter");
  });

  it("says where each entry comes from", () => {
    expect(entrySource(live)).toBe("Live source");
    expect(entrySource(entry({ id: "x", title: "Late Crate", startsAt: T("01:00:00"), endsAt: T("02:00:00"), itemId: "i" }))).toBe("From your library");
    expect(entrySource(entry({ id: "y", title: "Off air", kind: "off_air", startsAt: T("01:00:00"), endsAt: T("02:00:00") }))).toBe("Off air");
  });

  it("marks the row on air and starts the list there", () => {
    const now = Date.parse(T("03:42:12"));
    expect(rows[currentIndex(rows, now)].title).toBe("Saturday Reel, part 1");
    expect(rundownFrom(rows, now, 3).map((r) => r.title)).toEqual(["Saturday Reel, part 1", "Mission Soda", "Old Town Cinema"]);
  });

  it("counts what follows the first spot of the next break", () => {
    const b = nextBreak(rows, Date.parse(T("03:42:12")))!;
    expect(b.at).toBe(T("03:44:00"));
    expect(breakLine(b)).toBe("Mission Soda, then 3 more");
    // Once a break has begun, the next one is the one after it.
    expect(nextBreak(rows, Date.parse(T("03:44:10")))!.first.title).toBe("Break");
  });

  it("draws time with nothing in it", () => {
    const r = buildRundown([reel, entry({ id: "e3", title: "Slow Hours", startsAt: T("05:00:00"), endsAt: T("06:40:00") })], []);
    const gap = r.find((x) => x.kind === "gap")!;
    expect(gap.at).toBe(T("03:59:00"));
    expect(gap.lengthMs).toBe(61 * 60_000);
  });

  it("leaves a break's unsold time open when its rows fall short", () => {
    const short = buildRundown([], [{ ...brk, rows: brk.rows!.slice(0, 2) }]);
    expect(short.at(-1)).toMatchObject({ code: "OPEN", title: "Open", lengthMs: 60_000 });
  });
});

describe("bumper sequences in a break (A243)", () => {
  const slot: BreakSlot = {
    id: "brk-9",
    startsAt: "2026-10-03T03:56:00.000Z",
    lengthMs: 20_000,
    context: "After Late Crate",
    origin: "rule",
    producerShareMs: 0,
    filledMs: 0,
    openMs: 0,
    rows: [
      { code: "BMP", title: "Right back", lengthMs: 5_000, whose: "station", note: "Into the break", element: { position: "open", role: "into_break", announces: null, fits: true } },
      { code: "BMP", title: "Up next", lengthMs: 0, whose: "station", note: "Didn't fit: Up next (:08)", element: { position: "open", role: "up_next", announces: { title: "Saturday Reel", startsAt: "2026-10-03T04:00:00.000Z" }, fits: false } },
      { code: "OPEN", title: "Station ID slate", lengthMs: 10_000, whose: "station", note: null },
      { code: "SID", title: "Station ID", lengthMs: 5_000, whose: "station", note: null }
    ]
  };
  it("lists a bumper that didn't fit, quieter and with no length, and never names the break by it", () => {
    const rows = breakRows(slot);
    expect(rows.map((r) => [r.title, r.source, r.lengthMs, !!r.dropped])).toEqual([
      ["Right back", "Into the break", 5_000, false],
      ["Up next", "Didn't fit: Up next (:08)", 0, true],
      ["Station ID slate", "Holds on the station ID slate", 10_000, false],
      ["Station ID", "Station ID", 5_000, false]
    ]);
    const next = nextBreak(rows, Date.parse("2026-10-03T03:50:00Z"))!;
    expect(next.first.title).toBe("Right back");
  });
});
