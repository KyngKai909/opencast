import { describe, expect, it } from "vitest";
import type { DbBreak } from "./evening";
import { coverageUntil, deadAirWarnings, placeRepeat, rowsOfBreak } from "./onair";

const MIN = 60_000;
const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;

describe("rowsOfBreak (G1)", () => {
  const b: DbBreak = {
    id: "b",
    stationId: "s",
    startsAt: T("03:59"),
    lengthMs: 2 * MIN,
    context: "After Saturday Reel",
    origin: "rule",
    producerShareMs: 0,
    fills: [
      { id: "1", kind: "station_id", title: "BEAT station ID", lengthMs: 5000 },
      { id: "2", kind: "bumper", title: "Beat Tape Live, trailer", lengthMs: 10_000 },
      { id: "3", kind: "spot", title: "Cypress Dental", lengthMs: 30_000, note: "Backup rotation" },
      { id: "4", kind: "producer", title: "Mission Soda", lengthMs: 30_000, note: "REEL's break time, barter" }
    ]
  };

  it("airs the maker's time first, the station's next, open time, and the station ID last", () => {
    expect(rowsOfBreak(b).map((r) => [r.code, r.title, r.lengthMs / 1000, r.whose])).toEqual([
      ["SPT", "Mission Soda", 30, "producer"],
      ["BMP", "Beat Tape Live, trailer", 10, "station"],
      ["SPT", "Cypress Dental", 30, "backup"],
      ["OPEN", "Open", 45, "station"],
      ["SID", "BEAT station ID", 5, "station"]
    ]);
  });

  it("has no open row when the break is full", () => {
    expect(rowsOfBreak({ ...b, lengthMs: 75_000 }).some((r) => r.code === "OPEN")).toBe(false);
  });
});

describe("placeRepeat", () => {
  const items = [
    { id: "a", title: "Late Crate, ep. 14", durationMs: 28.5 * MIN, programId: "p", episodeNumber: 14 },
    { id: "b", title: "Late Crate, ep. 15", durationMs: 29 * MIN + 10_000, programId: "p", episodeNumber: 15 }
  ];

  it("places programs in whole minutes with a break after each, from the next whole minute", () => {
    const p = placeRepeat(items, "2026-09-27T06:40:12.000Z", T("07:50"), 2 * MIN, true);
    expect(p.entries.map((e) => [e.startsAt.slice(11, 16), e.endsAt.slice(11, 16), e.title])).toEqual([
      ["06:41", "07:10", "Late Crate, ep. 14"],
      ["07:12", "07:42", "Late Crate, ep. 15"],
      ["07:44", "07:50", "Late Crate, ep. 14"]
    ]);
    expect(p.breaks.map((b) => b.startsAt.slice(11, 16))).toEqual(["07:10", "07:42"]);
  });

  it("lets the last program run its length at the end of the log", () => {
    const p = placeRepeat(items, T("06:40"), T("07:50"), 2 * MIN, false);
    expect(p.entries.at(-1)!.endsAt).toBe(T("08:12"));
  });

  it("places nothing without anything to air", () => {
    expect(placeRepeat([], T("06:40"), T("07:50"), 2 * MIN, true).entries).toEqual([]);
  });
});

describe("coverageUntil", () => {
  const log = [
    { startsAt: T("01:00"), endsAt: T("03:28") },
    { startsAt: T("03:30"), endsAt: T("03:59") },
    { startsAt: T("04:01"), endsAt: T("06:40") },
    { startsAt: T("09:00"), endsAt: T("13:00") }
  ];
  it("runs through breaks and stops at the first gap", () => {
    expect(coverageUntil(log, "2026-09-27T03:42:12.000Z")).toBe(T("06:40"));
  });
  it("is null when nothing is on now", () => {
    expect(coverageUntil(log, T("07:00"))).toBeNull();
  });
});

describe("deadAirWarnings (P.2)", () => {
  const gap = T("06:40");
  it("warns 30 minutes before, then again at 12", () => {
    expect(deadAirWarnings(gap, Date.parse(T("06:00")))).toEqual([]);
    expect(deadAirWarnings(gap, Date.parse(T("06:15"))).map((w) => w.minutesBefore)).toEqual([30]);
    expect(deadAirWarnings(gap, Date.parse(T("06:28"))).map((w) => w.minutesBefore)).toEqual([30, 12]);
  });
  it("stops once the gap has begun", () => {
    expect(deadAirWarnings(gap, Date.parse(T("06:45")))).toEqual([]);
  });
});
