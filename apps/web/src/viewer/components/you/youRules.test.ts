import { describe, expect, it } from "vitest";
import { dayLabel, isActiveMonthly, lastUsedLabel, monthlyTotal, openChannelsLine, pledgeAmount, pledgeLine, type PledgeLike } from "./youRules";

const TZ = "America/Los_Angeles";
// Saturday, September 26, 8:42 pm in the Inland Empire (the reference's moment).
const NOW = new Date("2026-09-27T03:42:00Z");
const pt = (iso: string) => new Date(`${iso}-07:00`);

describe("which day a reminder says", () => {
  it("tonight from 5 pm, today before", () => {
    expect(dayLabel(pt("2026-09-26T21:00:00"), NOW, TZ)).toBe("Tonight");
    expect(dayLabel(pt("2026-09-26T16:00:00"), new Date("2026-09-26T15:00:00Z"), TZ)).toBe("Today");
  });
  it("tomorrow, then the weekday within the week, then the date", () => {
    expect(dayLabel(pt("2026-09-27T09:00:00"), NOW, TZ)).toBe("Tomorrow");
    expect(dayLabel(pt("2026-09-28T18:00:00"), NOW, TZ)).toBe("Monday");
    expect(dayLabel(pt("2026-09-29T19:00:00"), NOW, TZ)).toBe("Tuesday");
    expect(dayLabel(pt("2026-10-03T19:00:00"), NOW, TZ)).toBe("October 3");
  });
  it("goes by the market's day, not UTC's", () => {
    // 11:30 pm Saturday in the market is Sunday in UTC.
    expect(dayLabel(pt("2026-09-26T23:30:00"), NOW, TZ)).toBe("Tonight");
  });
});

describe("when a TV was last used", () => {
  it("tonight, yesterday, the weekday, the date", () => {
    expect(lastUsedLabel(NOW, NOW, TZ)).toBe("tonight");
    expect(lastUsedLabel(pt("2026-09-25T20:00:00"), NOW, TZ)).toBe("yesterday");
    expect(lastUsedLabel(pt("2026-09-22T20:00:00"), NOW, TZ)).toBe("Tuesday");
    expect(lastUsedLabel(pt("2026-09-10T20:00:00"), NOW, TZ)).toBe("September 10");
  });
});

describe("the monthly pledge total", () => {
  const beat: PledgeLike = { cadence: "monthly", amountMicros: 10_000_000, endsAfter: null, creditOnAir: true, startedAt: "2026-06-14T19:00:00Z" };
  const civcOnce: PledgeLike = { cadence: "once", amountMicros: 25_000_000, endsAfter: null, creditOnAir: false, startedAt: "2026-08-14T19:00:00Z" };
  const stopped: PledgeLike = { ...beat, amountMicros: 5_000_000, endsAfter: "2026-09-30" };
  it("adds the monthly pledges that will be charged again", () => {
    expect(monthlyTotal([beat, civcOnce])).toBe(10_000_000);
    expect(monthlyTotal([beat, { ...beat, amountMicros: 20_000_000 }])).toBe(30_000_000);
  });
  it("leaves out one-time and stopped pledges", () => {
    expect(monthlyTotal([civcOnce, stopped])).toBe(0);
    expect(isActiveMonthly(stopped)).toBe(false);
  });
  it("says what each row says", () => {
    expect(pledgeLine(beat, "Kai M.", TZ)).toBe("Credited on air as Kai M.");
    expect(pledgeLine({ ...beat, creditOnAir: false }, "Kai M.", TZ)).toBe("Since June");
    expect(pledgeLine(civcOnce, "Kai M.", TZ)).toBe("August 14");
    expect(pledgeLine(stopped, "Kai M.", TZ)).toBe("Ends after September");
    expect(pledgeAmount(beat)).toEqual({ amount: "$10.00", per: "a month" });
    expect(pledgeAmount(civcOnce)).toEqual({ amount: "$25.00", per: "once" });
  });
});

describe("run a station", () => {
  it("counts the open channels on both bands", () => {
    expect(openChannelsLine("Inland Empire", 12, 30)).toBe("12 channels are open on the Inland Empire TV band, and 30 on the radio band. Setting up takes about 20 minutes.");
    expect(openChannelsLine("High Desert", 1, 5)).toBe("1 channel is open on the High Desert TV band, and 5 on the radio band. Setting up takes about 20 minutes.");
  });
});
