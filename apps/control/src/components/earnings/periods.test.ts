import { describe, expect, it } from "vitest";
import { phoneNowLine, audienceWindow, earningsRange, earningsTotalLabel, hoursCaption, lastWeekLabel, peakCaption, wallTime, weekStart, weekdayOf } from "./periods";

const TZ = "America/Los_Angeles";
// Saturday, September 26, 8:42:12 pm.
const NOW = new Date("2026-09-27T03:42:12Z");

describe("the station's calendar", () => {
  it("finds wall-clock times in the station's zone, across the day line", () => {
    expect(wallTime(2026, 8, 26, 18, 0, TZ).toISOString()).toBe("2026-09-27T01:00:00.000Z");
    expect(wallTime(2026, 8, 26, 26, 0, TZ).toISOString()).toBe("2026-09-27T09:00:00.000Z");
    // Winter time: UTC-8.
    expect(wallTime(2026, 11, 1, 0, 0, TZ).toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart(NOW, TZ).toISOString()).toBe("2026-09-21T07:00:00.000Z");
    expect(weekdayOf("2026-09-28")).toBe("Monday, September 28");
  });
});

describe("audience windows", () => {
  it("tonight runs 6:00 pm to 11:00 pm, and on past 11 when it's later", () => {
    const w = audienceWindow("tonight", NOW, TZ);
    expect(w.from.toISOString()).toBe("2026-09-27T01:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-27T06:00:00.000Z");
    const late = audienceWindow("tonight", new Date("2026-09-27T07:10:00Z"), TZ);
    expect(late.to.toISOString()).toBe("2026-09-27T08:00:00.000Z");
  });

  it("after midnight it's still last night, to the hour after now, never past 6:00 am", () => {
    const w = audienceWindow("tonight", new Date("2026-09-27T09:30:00Z"), TZ);
    expect(w.from.toISOString()).toBe("2026-09-27T01:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-27T10:00:00.000Z");
    expect(audienceWindow("tonight", new Date("2026-09-27T12:59:00Z"), TZ).to.toISOString()).toBe("2026-09-27T13:00:00.000Z");
  });

  it("a week from Monday and a month from the 1st, each to now", () => {
    expect(audienceWindow("week", NOW, TZ).from.toISOString()).toBe("2026-09-21T07:00:00.000Z");
    expect(audienceWindow("month", NOW, TZ).from.toISOString()).toBe("2026-09-01T07:00:00.000Z");
    expect(audienceWindow("month", NOW, TZ).to).toBe(NOW);
  });

  it("captions the numbers for the period", () => {
    expect(peakCaption("tonight", "2026-09-27T03:36:00Z", NOW, TZ)).toBe("Tonight's peak, at 8:36 pm");
    expect(peakCaption("week", "2026-09-27T03:36:00Z", NOW, TZ)).toBe("This week's peak, Saturday at 8:36 pm");
    expect(peakCaption("month", "2026-09-20T04:40:00Z", NOW, TZ)).toBe("September's peak, September 19 at 9:40 pm");
    expect(hoursCaption("tonight", false, NOW, TZ)).toBe("Hours watched tonight");
    expect(hoursCaption("month", true, NOW, TZ)).toBe("Hours listened in September");
    expect(phoneNowLine("tonight", { tunedIn: 318, at: "2026-09-27T03:36:00Z" }, TZ)).toBe("Tuned in now. Peak tonight 318 at 8:36 pm");
    expect(phoneNowLine("month", { tunedIn: 410, at: "2026-09-20T04:40:00Z" }, TZ)).toBe("Tuned in now. Peak this month 410, September 19 at 9:40 pm");
    expect(lastWeekLabel(audienceWindow("tonight", NOW, TZ).from, TZ)).toBe("Last Saturday");
  });
});

describe("earnings periods", () => {
  it("names the period so far", () => {
    expect(earningsRange("month", NOW, TZ)).toBe("September 1 to 26");
    expect(earningsRange("week", NOW, TZ)).toBe("September 21 to 26");
    expect(earningsRange("year", NOW, TZ)).toBe("January 1 to September 26");
    expect(earningsRange("week", new Date("2026-09-05T19:00:00Z"), TZ)).toBe("August 31 to September 5");
    expect(earningsRange("month", new Date("2026-09-01T19:00:00Z"), TZ)).toBe("September 1");
    expect(earningsTotalLabel("month", NOW, TZ)).toBe("September so far");
    expect(earningsTotalLabel("year", NOW, TZ)).toBe("2026 so far");
  });
});
