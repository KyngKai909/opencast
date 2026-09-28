import { describe, expect, it } from "vitest";
import {
  airingWhen,
  dayWord,
  deadAirMinutes,
  expiresIn,
  invitedLine,
  lastIn,
  longDate,
  marketName,
  noMoreThan,
  rangeText,
  shortAddress,
  shortDate,
  shortName
} from "./format";

const TZ = "America/Los_Angeles";
// Saturday September 26, 8:42:12 pm in Redlands.
const NOW = new Date("2026-09-27T03:42:12Z");
const local = (s: string) => new Date(`${s}-07:00`).toISOString();

describe("days and dates, in the station's zone", () => {
  it("names the day as the team and rights pages do", () => {
    expect(dayWord(local("2026-09-26T15:12:00"), NOW, TZ)).toBe("Today");
    expect(dayWord(local("2026-09-25T23:00:00"), NOW, TZ)).toBe("Yesterday");
    expect(dayWord(local("2026-09-24T10:00:00"), NOW, TZ)).toBe("Thursday");
    expect(dayWord(local("2026-09-19T21:00:00"), NOW, TZ)).toBe("Last Saturday");
    expect(dayWord(local("2026-08-19T11:02:00"), NOW, TZ)).toBe("August 19");
    expect(dayWord(local("2026-09-28T20:00:00"), NOW, TZ)).toBe("Monday");
  });

  it("counts a day by the calendar there, not by 24 hours", () => {
    // 11:30 pm Friday is yesterday at 8:42 pm Saturday, though it's under 24 hours ago.
    expect(dayWord(local("2026-09-25T23:30:00"), NOW, TZ)).toBe("Yesterday");
    // Past midnight UTC is still Saturday in Redlands.
    expect(dayWord("2026-09-27T01:00:00Z", NOW, TZ)).toBe("Today");
  });

  it("writes long and short dates", () => {
    expect(longDate(local("2026-10-05T15:12:00"), TZ)).toBe("October 5");
    expect(shortDate(local("2026-08-19T11:02:00"), TZ)).toBe("Aug 19");
  });

  it("says when an airing was, with the time", () => {
    expect(airingWhen(local("2026-09-28T20:00:00"), NOW, TZ)).toBe("Monday, 8:00 pm");
    expect(airingWhen(local("2026-09-26T15:12:00"), NOW, TZ)).toBe("Today, 3:12 pm");
  });
});

describe("the team's lines (station-settings 03.1)", () => {
  it("says when someone was last in", () => {
    expect(lastIn(new Date(NOW.getTime() - 60_000).toISOString(), NOW, TZ)).toBe("Now");
    expect(lastIn(local("2026-09-26T16:10:00"), NOW, TZ)).toBe("Today, 4:10 pm");
    expect(lastIn(local("2026-09-19T21:00:00"), NOW, TZ)).toBe("Last Saturday");
    expect(lastIn(null, NOW, TZ)).toBe("Not yet");
  });

  it("describes a waiting invite and when it runs out", () => {
    expect(invitedLine(local("2026-09-24T10:00:00"), NOW, TZ)).toBe("Invited Thursday, not accepted yet");
    expect(invitedLine(local("2026-09-26T10:00:00"), NOW, TZ)).toBe("Invited today, not accepted yet");
    expect(expiresIn(local("2026-10-01T10:00:00"), NOW)).toBe("Expires in 4 days");
    expect(expiresIn(new Date(NOW.getTime() + 30 * 3600e3), NOW)).toBe("Expires tomorrow");
    expect(expiresIn(new Date(NOW.getTime() + 3600e3), NOW)).toBe("Expires today");
    expect(expiresIn(new Date(NOW.getTime() - 1), NOW)).toBe("Expired");
  });
});

describe("dead air in the switcher", () => {
  it("rounds up to the minute, and only says it within the hour", () => {
    expect(deadAirMinutes(local("2026-09-26T21:22:12"), NOW)).toBe(40);
    expect(deadAirMinutes(local("2026-09-26T21:22:00"), NOW)).toBe(40);
    expect(deadAirMinutes(local("2026-09-26T23:40:00"), NOW)).toBeNull();
    expect(deadAirMinutes(null, NOW)).toBeNull();
    expect(deadAirMinutes(local("2026-09-26T20:00:00"), NOW)).toBeNull();
  });
});

describe("small words", () => {
  it("writes a claimed range", () => {
    expect(rangeText(760_000, 1_865_000)).toBe("12:40 to 31:05");
    expect(rangeText(null, 5)).toBeNull();
  });
  it("drops a company's legal ending", () => {
    expect(shortName("Westside Tapes LLC")).toBe("Westside Tapes");
    expect(shortName("Loopdeck, Inc.")).toBe("Loopdeck");
    expect(shortName("R. Delgado")).toBe("R. Delgado");
  });
  it("shortens an address", () => {
    expect(shortAddress("0x5ee2b8f04c1d3a97e6b2f0d4c8a1e3b5f7d9a41d")).toBe("0x5ee2…a41d");
  });
  it("says the same-spot limit", () => {
    expect(noMoreThan(2)).toBe("No more than twice an hour");
    expect(noMoreThan(1)).toBe("No more than once an hour");
    expect(noMoreThan(3)).toBe("No more than 3 times an hour");
  });
  it("names a market", () => {
    expect(marketName("inland-empire")).toBe("Inland Empire");
    expect(marketName("inland-empire", { slug: "inland-empire", name: "The Inland Empire" })).toBe("The Inland Empire");
    expect(marketName(null)).toBe("");
  });
});
