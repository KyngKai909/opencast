import { describe, expect, it } from "vitest";
import { DESKS, deskById, isOpen } from "./contact";

describe("the desks", () => {
  it("has six, each with an address", () => {
    expect(DESKS.map((d) => d.jack)).toEqual(["Stations", "Makers", "Advertisers", "Public channels", "Press", "Rights"]);
    expect(DESKS.map((d) => d.email)).toEqual(["stations@usedial.com", "makers@usedial.com", "spots@usedial.com", "public@usedial.com", "press@usedial.com", "rights@usedial.com"]);
    expect(deskById("rights")?.fields.map((f) => f.name)).toEqual(["program", "work", "role"]);
    expect(deskById("nope")).toBeUndefined();
  });
  it("is open 9 am to 6 pm Pacific", () => {
    expect(isOpen(new Date("2026-10-17T09:00:00-07:00"))).toBe(true);
    expect(isOpen(new Date("2026-10-17T17:59:00-07:00"))).toBe(true);
    expect(isOpen(new Date("2026-10-17T18:00:00-07:00"))).toBe(false);
    expect(isOpen(new Date("2026-10-17T08:59:00-07:00"))).toBe(false);
    // 8:14 pm Pacific is 3:14 am UTC the next day: closed.
    expect(isOpen(new Date("2026-10-18T03:14:00Z"))).toBe(false);
  });
});
