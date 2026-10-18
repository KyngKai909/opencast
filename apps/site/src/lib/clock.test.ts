import { describe, expect, it } from "vitest";
import { clock, nowMinutes } from "./clock";
import { STATIONS, slot } from "../data/stations";

describe("clock", () => {
  it("reads a 12-hour clock like the reference", () => {
    expect(clock(0)).toBe("12 am");
    expect(clock(494)).toBe("8:14 am");
    expect(clock(1214)).toBe("8:14 pm");
    expect(clock(720)).toBe("12 pm");
    expect(clock(1260)).toBe("9 pm");
    expect(clock(-60)).toBe("11 pm");
    expect(clock(59.6)).toBe("1 am");
  });
  it("tells the visitor's local time", () => {
    expect(nowMinutes(new Date(2026, 9, 17, 20, 14, 30))).toBe(20 * 60 + 14.5);
  });
});

describe("slot", () => {
  it("finds what's on", () => {
    const beat = STATIONS.find((s) => s.cs === "BEAT")!;
    const s = slot(beat, 20 * 60 + 14);
    expect(s).toMatchObject({ i: 20, start: 1200, end: 1260, prog: "Late Crate", next: "Crate Session", left: 46 });
    expect(s.pct).toBeCloseTo(14 / 60);
  });
});
