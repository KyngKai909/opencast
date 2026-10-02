import { describe, expect, it } from "vitest";
import { clockAfter, clockColumn, fraction, hourLabel, minutesText, shortSpan, timeLeft } from "./time";

const TZ = "America/Los_Angeles";
const at = (h: number, m = 0, s = 0) => new Date(Date.parse("2026-09-26T00:00:00-07:00") + ((h * 60 + m) * 60 + s) * 1000);

describe("broadcast time helpers", () => {
  it("counts the time left up to the minute", () => {
    expect(timeLeft(at(20, 42), at(21))).toBe("18 min left");
    expect(timeLeft(at(20, 42, 12), at(21))).toBe("18 min left");
    expect(timeLeft(at(20, 42), at(21, 30))).toBe("48 min left");
    expect(minutesText(140 * 60_000)).toBe("2 hr 20 min");
    expect(minutesText(60 * 60_000)).toBe("1 hr");
  });
  it("drops am/pm when a time shares it with now", () => {
    expect(clockAfter(at(21), at(20, 42), TZ)).toBe("9:00");
    expect(clockAfter(at(30), at(20, 42), TZ)).toBe("6:00 am");
    expect(clockAfter(at(24), at(20, 42), TZ)).toBe("12:00 am");
  });
  it("says am/pm at the top of a column and where it changes", () => {
    expect(clockColumn([at(18), at(20), at(20, 30), at(23), at(24)], TZ)).toEqual(["6:00 pm", "8:00", "8:30", "11:00", "12:00 am"]);
  });
  it("writes guide spans and timeline hours", () => {
    expect(shortSpan(at(20), at(21, 30), TZ)).toBe("8:00 – 9:30");
    expect(hourLabel(at(18), TZ)).toBe("6 pm");
    expect(hourLabel(at(24), TZ)).toBe("12 am");
  });
  it("places now within a span", () => {
    expect(fraction(at(20, 42), at(20, 30), at(21))).toBeCloseTo(0.4);
    expect(fraction(at(19), at(20, 30), at(21))).toBe(0);
    expect(fraction(at(22), at(20, 30), at(21))).toBe(1);
  });
});
