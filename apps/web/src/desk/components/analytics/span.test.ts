import { describe, expect, it } from "vitest";
import { change, csv, minutesText, num, rangeText, spanFor } from "./span";

// Tuesday, October 6, 2026, 8:24 pm Pacific (the reference's day).
const NOW = new Date("2026-10-07T03:24:00.000Z");

describe("spans", () => {
  it("7 days are the 7 to yesterday, against the 7 before", () => {
    const s = spanFor("7d", NOW);
    expect(s.from.toISOString()).toBe("2026-09-29T07:00:00.000Z");
    expect(s.to.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(s.previousFrom.toISOString()).toBe("2026-09-22T07:00:00.000Z");
    expect(s.label).toBe("Sept 29 to Oct 5, vs Sept 22 to 28");
  });

  it("today runs to now, against the same weekday last week", () => {
    const s = spanFor("today", NOW);
    expect(s.from.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(s.to).toBe(NOW);
    expect(s.previousFrom.toISOString()).toBe("2026-09-29T07:00:00.000Z");
    expect(s.label).toBe("Today to 8:24 pm, vs Tuesday Sept 29");
  });

  it("a custom span takes its dates, across the clocks changing", () => {
    const s = spanFor("custom", new Date("2026-11-10T20:00:00.000Z"), { first: "2026-10-30", last: "2026-11-02" });
    expect(s.from.toISOString()).toBe("2026-10-30T07:00:00.000Z");
    expect(s.to.toISOString()).toBe("2026-11-03T08:00:00.000Z");
    expect(rangeText("2026-10-01", "2026-10-05")).toBe("Oct 1 to 5");
  });
});

describe("numbers", () => {
  it("says the change, flat under half a percent, nothing with nothing before", () => {
    expect(change(16_078, 14_103)).toMatchObject({ dir: "up", text: "↑ 14%" });
    expect(change(8710, 9266)).toMatchObject({ dir: "dn", text: "↓ 6%" });
    expect(change(9, 8.98)).toMatchObject({ dir: "fl", text: "Flat" });
    expect(change(5, null)).toBeNull();
    expect(change(5, 0)).toBeNull();
  });

  it("groups whole numbers and says minutes", () => {
    expect(num(76_783)).toBe("76,783");
    expect(num(4.04)).toBe("4");
    expect(num(3.24)).toBe("3.2");
    expect(num(null)).toBe("—");
    expect(minutesText(9)).toBe("9 min");
    expect(minutesText(80)).toBe("1 h 20 min");
  });

  it("writes CSV, quoting what needs it", () => {
    expect(csv(["Station", "Hours"], [["Tía Lupe's Kitchen, \"live\"", 5234]])).toBe('Station,Hours\n"Tía Lupe\'s Kitchen, ""live""",5234\n');
  });
});
