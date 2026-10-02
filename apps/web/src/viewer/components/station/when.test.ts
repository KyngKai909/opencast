import { describe, expect, it } from "vitest";
import { scheduleStatus } from "@opencast/ui";
import { broadcastDayKey, clockAfter, dayAndTime, dayWord, monthYear, onDay, weekTabs } from "./when";

const TZ = "America/Los_Angeles";
// Saturday, September 26, 2026, 8:42 pm in the Inland Empire (the frames' moment).
const NOW = new Date("2026-09-27T03:42:00Z");
const pt = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 8, day, hh + 7, mm)).toISOString();

describe("the week's day tabs", () => {
  it("runs Sun to Sat, each the next time that day comes round, with today selected", () => {
    const tabs = weekTabs(NOW, TZ);
    expect(tabs.map((t) => t.label)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(tabs.find((t) => t.today)?.label).toBe("Sat");
    expect(tabs[6]!.value).toBe("2026-09-26");
    expect(tabs[0]!.value).toBe("2026-09-27"); // Sunday is tomorrow, not last Sunday.
    expect(tabs[5]!.value).toBe("2026-10-02");
    expect(tabs[0]!.long).toBe("Sunday, September 27");
  });

  it("keeps a program after midnight in the night it belongs to", () => {
    expect(broadcastDayKey(pt(27, 0, 30), TZ)).toBe("2026-09-26"); // 12:30 am Sunday is Saturday night.
    expect(broadcastDayKey(pt(27, 6), TZ)).toBe("2026-09-27");
    // At 2:00 am on Sunday it's still Saturday's tab.
    expect(weekTabs(pt(27, 2), TZ).find((t) => t.today)?.label).toBe("Sat");
  });

  it("files a day's airings under it, in time order", () => {
    const list = [
      { id: "overnight", startsAt: pt(27, 0) },
      { id: "sun-morning", startsAt: pt(27, 9) },
      { id: "reel", startsAt: pt(26, 20, 30) },
      { id: "crate", startsAt: pt(26, 18) }
    ];
    expect(onDay(list, "2026-09-26", TZ).map((a) => a.id)).toEqual(["crate", "reel", "overnight"]);
    expect(onDay(list, "2026-09-27", TZ).map((a) => a.id)).toEqual(["sun-morning"]);
  });

  it("marks today's rows past, now and next as the frame does", () => {
    const rows = [
      { id: "crate", start: pt(26, 18), end: pt(26, 20) },
      { id: "late", start: pt(26, 20), end: pt(26, 20, 30) },
      { id: "reel", start: pt(26, 20, 30), end: pt(26, 21) },
      { id: "tape", start: pt(26, 21), end: pt(26, 22) }
    ].map((r) => ({ ...r, title: r.id }));
    expect(scheduleStatus(rows, NOW)).toEqual(["past", "past", "now", "next"]);
    // Another day's tab: everything is still to come.
    expect(scheduleStatus([{ id: "sun", start: pt(27, 9), end: pt(27, 10), title: "" }], NOW)).toEqual(["next"]);
  });
});

describe("days and times in words", () => {
  it("says tonight, the weekday for the next six days, then the date", () => {
    expect(dayWord(pt(26, 22), NOW, TZ)).toBe("tonight");
    expect(dayWord(pt(26, 10), NOW, TZ)).toBe("today");
    expect(dayWord(pt(27, 9), NOW, TZ)).toBe("Sunday");
    expect(dayWord(pt(29, 19), NOW, TZ)).toBe("Tuesday");
    expect(dayWord(pt(26 + 7, 20), NOW, TZ)).toBe("October 3");
    expect(dayWord(pt(26 + 12, 18, 30), NOW, TZ)).toBe("October 8");
  });

  it("writes the day and time the frames' ways", () => {
    expect(dayAndTime(pt(27, 9), NOW, TZ)).toBe("Sunday 9:00 am");
    expect(dayAndTime(pt(33, 20), NOW, TZ)).toBe("October 3, 8:00 pm");
    expect(clockAfter(pt(26, 21), pt(26, 21), TZ)).toBe("9:00");
    expect(clockAfter(pt(27, 6), NOW, TZ)).toBe("6:00 am");
    expect(monthYear("2026-09-05")).toBe("September 2026");
  });
});
