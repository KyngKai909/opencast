import { describe, expect, it } from "vitest";
import type { BreakContent } from "../../api/ext/spots";
import { readRow } from "./SponsorshipSettings";
import { backDetail, backTitle, pausedDetail, pausedTitle } from "./PauseNotices";
import { breakParts, breakSummary, creditLead, dateText, firstAiring, milesText, openAcross, parseMoney, rateText, runwayParts, runsText, spotLength, sponsorScope, tonightWindow, upToText, type BreakView } from "./format";

const TZ = "America/Los_Angeles";
let n = 0;
const c = (kind: BreakContent["kind"], sec: number, o: Partial<BreakContent> = {}): BreakContent => ({
  id: `c${++n}`,
  kind,
  title: o.business ?? kind,
  lengthMs: sec * 1000,
  spotId: null,
  business: null,
  shortName: null,
  rotation: null,
  note: null,
  ...o
});
const spot = (id: string, business: string, shortName: string, sec = 30, rotation: "main" | "backup" = "main") => c("spot", sec, { spotId: id, business, shortName, rotation });
const view = (contents: BreakContent[] | null, o: Partial<BreakView> = {}): BreakView => ({ aired: false, lengthMs: 120_000, producerShareMs: 0, openMs: 0, contents, ...o });

describe("the market's words", () => {
  it("writes rates as the business listed them", () => {
    expect(rateText({ kind: "per_thousand", micros: 8_000_000 })).toBe("$8.00 per 1,000 tuned in");
    expect(rateText({ kind: "per_airing", micros: 4_000_000 })).toBe("$4.00 an airing");
  });
  it("writes spot lengths the broadcast way", () => {
    expect(spotLength(15)).toBe(":15");
    expect(spotLength(60)).toBe(":60");
    expect(runsText(30, "A code for 10% off")).toBe(":30, code on screen");
  });
  it("gives runway in days, never the balance", () => {
    expect(runwayParts({ kind: "days", days: 44 })).toEqual({ main: "About 44 days", sub: "at the current pace" });
    expect(runwayParts({ kind: "tops_up" })).toEqual({ main: "Tops up automatically", sub: null });
  });
  it("writes distances and daily limits", () => {
    expect(milesText(1.2)).toBe("1.2 miles");
    expect(milesText(5, true)).toBe("5.0 mi");
    expect(upToText(6, "BEAT")).toBe("6 airings a day on BEAT");
  });
  it("reads typed amounts", () => {
    expect(parseMoney("$140.00")).toBe(140_000_000);
    expect(parseMoney("1,200.5")).toBe(1_200_500_000);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
  });
  it("writes dates", () => {
    expect(dateText("2026-10-01")).toBe("October 1");
    expect(dateText("2026-10-01", true)).toBe("Oct 1");
  });
});

describe("tonight", () => {
  it("runs from 5:00 pm to 6:00 am in the station's zone", () => {
    const w = tonightWindow(new Date("2026-09-27T03:42:12Z"), TZ); // 8:42 pm Saturday
    expect(w).toEqual({ from: "2026-09-27T00:00:00.000Z", to: "2026-09-27T13:00:00.000Z" });
  });
  it("is still last night before 6:00 am", () => {
    const w = tonightWindow(new Date("2026-09-27T09:00:00Z"), TZ); // 2:00 am Sunday
    expect(w.from).toBe("2026-09-27T00:00:00.000Z");
  });
});

describe("a break's bar and line (C.1, C.3)", () => {
  it("draws the aired break as it aired", () => {
    const b = view(null, { aired: true, lengthMs: 90_000 });
    expect(breakParts(b)).toEqual([{ kind: "filled", length: 90_000 }]);
    expect(breakSummary(b, { rotationSize: 0 })).toBe("1:30 of 1:30 filled");
  });
  it("draws REEL's barter time and names REEL", () => {
    const b = view([c("producer", 30), c("producer", 30)], { producerShareMs: 60_000, openMs: 60_000 });
    expect(breakParts(b)).toEqual([
      { kind: "barter", length: 60_000 },
      { kind: "open", length: 60_000 }
    ]);
    expect(breakSummary(b, { rotationSize: 0, barterOwner: "REEL" })).toBe("REEL fills 1:00");
  });
  it("says what the station's own time holds", () => {
    expect(breakSummary(view([c("station_id", 5), c("bumper", 10)]), { rotationSize: 0 })).toBe("ID and bumper only");
    expect(breakSummary(view([c("underwriting", 15)]), { rotationSize: 0 })).toBe("Underwriting only");
    expect(breakSummary(view([]), { rotationSize: 0 })).toBe("Nothing in it yet");
  });
  it("names the spots, or all of them, then the backups", () => {
    const orange = spot("o", "Orange Street Coffee", "Orange Street");
    const tire = spot("t", "Inland Tire and Wheel", "Inland Tire");
    const dental = spot("d", "Cypress Dental", "Cypress Dental");
    const hardware = spot("h", "Redlands Hardware", "Redlands Hardware", 15, "backup");
    expect(breakSummary(view([c("producer", 60), orange, tire]), { rotationSize: 3 })).toBe("Orange Street, Inland Tire");
    expect(breakSummary(view([c("underwriting", 15), tire, dental, orange, hardware]), { rotationSize: 3 })).toBe("All 3 spots, then Redlands Hardware");
    expect(breakSummary(view([dental, hardware]), { rotationSize: 3 })).toBe("Cypress Dental, Redlands Hardware (backup)");
    expect(breakSummary(view([tire, dental]), { rotationSize: 2 })).toBe("Both spots");
    const farmers = spot("f", "Citrus Valley Farmers Market", "Citrus Valley", 15, "backup");
    expect(breakSummary(view([tire, hardware, farmers]), { rotationSize: 3 })).toBe("Inland Tire, Redlands Hardware and Citrus Valley (backup)");
  });
  it("draws just-added spots amber, after what was there", () => {
    const added = spot("o", "Orange Street Coffee", "Orange Street");
    const b = view([added, c("station_id", 5), c("bumper", 10), c("station_id", 5), c("bumper", 10)], { openMs: 60_000 });
    expect(breakParts(b, (x) => x.id === added.id)).toEqual([
      { kind: "filled", length: 30_000 },
      { kind: "added", length: 30_000 },
      { kind: "open", length: 60_000 }
    ]);
  });
  it("totals open time from the rows (A28)", () => {
    expect(openAcross(255_000, 4)).toEqual({ open: "4:15 open", rest: " across 4 breaks." });
    expect(openAcross(0, 1)).toEqual({ open: "No open time", rest: " across 1 break." });
  });
});

describe("the pause story, station side (biz-spots 05.1)", () => {
  const base = {
    spot: { id: "s", title: "Fall menu", lengthSec: 30, category: "Food", onScreen: null },
    business: { id: "b", name: "Orange Street Coffee", category: "Coffee and food", city: "Redlands", online: false, shortName: "Orange Street" },
    miles: 1.2,
    rate: { kind: "per_thousand" as const, micros: 8_000_000 },
    upToPerDay: 6,
    listedUntil: null,
    runway: { kind: "days" as const, days: 17 },
    inRotation: "main" as const,
    customersFromThisStation: 0
  };
  it("reports a paused spot as handled", () => {
    const s = { ...base, state: "paused" as const, pause: { reason: "budget_spent" as const, pausedAt: "2026-09-27T03:42:12.000Z", heldTonightMs: 90_000, filledBy: ["Redlands Hardware"] } };
    expect(pausedTitle(s)).toBe("Orange Street Coffee paused Fall menu. Its budget is spent.");
    expect(pausedDetail(s)).toBe("It had 1:30 in tonight's breaks. Filled from your backup rotation: Redlands Hardware");
    expect(pausedDetail({ ...s, pause: { ...s.pause, filledBy: [] } })).toBe("It had 1:30 in tonight's breaks. Your station ID and bumpers fill it.");
  });
  it("says it's back, and that it isn't in the rotation", () => {
    const s = { ...base, state: "its_back" as const, inRotation: null, back: { reason: "raised_budget" as const, backAt: "2026-09-27T03:50:00.000Z" } };
    expect(backTitle(s)).toBe("Fall menu is back. Orange Street raised its budget.");
    expect(backDetail(s)).toBe("It isn't in your rotation now. About 17 days of budget");
  });
});

describe("sponsorship", () => {
  it("writes who's credited and since when", () => {
    expect(sponsorScope(null, "BEAT", "2026-06-01")).toBe("All of BEAT, since June");
    expect(creditLead({ title: "Beat Tape Live" }, "Inland Beat")).toBe("Beat Tape Live is made possible by");
  });
  it("finds the first airing on or after the start, a week at a time", () => {
    const tonight = [{ startsAt: "2026-09-27T04:01:00.000Z" }]; // Saturday 9:01 pm
    expect(firstAiring("2026-10-01", tonight, true, TZ)).toBe("October 3");
    expect(firstAiring("2026-10-01", tonight, false, TZ)).toBe("October 1");
    expect(firstAiring("2026-09-26", tonight, true, TZ)).toBe("September 26");
  });
  it("reads a minimums row: None closes it", () => {
    expect(readRow({ min: "None", max: "" })).toEqual({ minMonthlyMicros: 0, maxSponsors: 0, closed: true });
    expect(readRow({ min: "$75.00", max: "2" })).toEqual({ minMonthlyMicros: 75_000_000, maxSponsors: 2, closed: false });
    expect(readRow({ min: "$75.00", max: "0" })).toBeNull();
    expect(readRow({ min: "lots", max: "2" })).toBeNull();
  });
});
