import { describe, expect, it } from "vitest";
import { addDays, broadcastDay, countWord, dayClock, isoDate, localTime, spanText, timeOn, viewWindow, weekOf, wholeMinutes } from "./time";

const TZ = "America/Los_Angeles";
const SAT = { year: 2026, month: 9, day: 26 };

describe("the log's days and windows", () => {
  it("counts 2:00 am Sunday as Saturday night", () => {
    expect(isoDate(broadcastDay("2026-09-27T09:00:00.000Z", TZ))).toBe("2026-09-26");
    expect(isoDate(broadcastDay("2026-09-27T13:30:00.000Z", TZ))).toBe("2026-09-27");
  });

  it("draws the evening from 6 pm to 2 am, and the day from 6 am to 6 am", () => {
    expect(viewWindow("evening", SAT, TZ)).toEqual({ from: "2026-09-27T01:00:00.000Z", to: "2026-09-27T09:00:00.000Z" });
    expect(viewWindow("day", SAT, TZ)).toEqual({ from: "2026-09-26T13:00:00.000Z", to: "2026-09-27T13:00:00.000Z" });
  });

  it("runs the week Monday to Sunday", () => {
    expect(weekOf(SAT).map(isoDate)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(isoDate(addDays(SAT, 7))).toBe("2026-10-03");
  });

  it("reads local times across the change of day", () => {
    expect(localTime(SAT, 26, 0, TZ)).toBe("2026-09-27T09:00:00.000Z");
  });
});

describe("how the log writes times", () => {
  it("writes a gap within the night without a day, and one into another day with it", () => {
    expect(spanText("2026-09-27T06:40:00.000Z", "2026-09-27T09:00:00.000Z", TZ)).toBe("11:40 pm to 2:00 am");
    expect(spanText("2026-09-27T03:45:00.000Z", "2026-09-28T03:45:00.000Z", TZ)).toBe("8:45 pm to 8:45 pm Sunday");
    expect(timeOn("2026-09-28T01:00:00.000Z", "2026-09-27T03:42:00.000Z", TZ)).toBe("6:00 pm Sunday");
  });

  it("writes Log runs until with the day", () => {
    expect(dayClock("2026-09-28T03:42:00.000Z", TZ)).toBe("Sun 8:42 pm");
  });

  it("writes small counts in words", () => {
    expect(countWord(5, true)).toBe("Five");
    expect(countWord(1)).toBe("one");
    expect(countWord(12)).toBe("12");
  });

  it("places programs in whole minutes", () => {
    expect(wholeMinutes(28 * 60_000 + 10_000)).toBe(29 * 60_000);
    expect(wholeMinutes(29 * 60_000)).toBe(29 * 60_000);
  });
});
