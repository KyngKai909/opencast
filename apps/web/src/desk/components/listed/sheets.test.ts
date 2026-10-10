// A248: a spreadsheet's read in the desk's words: the summary, the tab, the zone and why, what was
// skipped, a dated sheet whose days have passed. Every sheet here is made up.
import { describe, expect, it } from "vitest";
import type { SheetRead } from "@opencast/contracts";
import { datesPassed, fileWords, isSharedGoogleLink, isSheetLink, sheetSummary, skippedWords, tabWords, zoneOptions, zoneShort, zonesNamedWords } from "./sheets";
import { sheetDraftOf, sheetProblems } from "./SheetScheduleFields";

const read: SheetRead = {
  kind: "google_sheet",
  tab: null,
  gid: "7",
  tabs: [],
  layout: "week_grid",
  shows: 152,
  weekly: false,
  firstDay: "Monday 10/05",
  lastDay: "Sunday 10/11",
  firstDate: "2026-10-05",
  lastDate: "2026-10-11",
  timeZone: "America/New_York",
  timeZoneFrom: "sheet",
  zonesNamed: [],
  skipped: [{ text: "Super Robot 2:55 PM", where: "Tuesday 10/06, row 52", why: "out_of_order" }],
  skippedCount: 1,
  readAt: "2026-10-06T16:00:00.000Z"
};

describe("what was read", () => {
  it("says it in a line: how many shows, the layout, the days, the zone", () => {
    expect(sheetSummary(read)).toBe("Read 152 shows from a week grid, Monday 10/05 to Sunday 10/11, times in Eastern");
    expect(sheetSummary({ ...read, layout: "list", shows: 1, firstDay: "10/05/2026", lastDay: "10/05/2026", timeZone: "UTC" })).toBe("Read 1 show from a list, 10/05/2026, times in UTC");
    expect(sheetSummary({ ...read, layout: "time_grid", weekly: true, firstDay: "Mon", lastDay: "Fri", timeZone: "America/Chicago" })).toBe("Read 152 shows from a grid with a column of times, Mon to Fri, every week, times in Central");
    expect(zoneShort("America/Los_Angeles")).toBe("Pacific");
  });

  it("names the tab: a workbook's by name, a Google Sheet's by its link", () => {
    expect(tabWords(read)).toBe("The tab in the link (gid 7)");
    expect(tabWords({ ...read, gid: null })).toBe("The first tab");
    expect(tabWords({ ...read, kind: "xlsx", tab: "Week", tabs: ["Week", "Notes"] })).toBe("“Week”, of 2 tabs");
    expect(tabWords({ ...read, kind: "csv", gid: null })).toBeNull();
  });

  it("lists what was skipped, and why", () => {
    expect(skippedWords(read)).toEqual({ title: "1 cell skipped", lines: ["“Super Robot 2:55 PM”, Tuesday 10/06, row 52: out of order in its day (a typo?)"] });
    expect(skippedWords({ ...read, layout: "list", skippedCount: 25 })).toEqual({ title: "25 rows skipped", lines: [expect.any(String), "And 24 more"] });
    expect(skippedWords({ ...read, skipped: [], skippedCount: 0 })).toBeNull();
  });

  it("says when a dated sheet's days have passed, and when it names several zones", () => {
    expect(datesPassed(read, "2026-10-11", false)).toBeNull();
    expect(datesPassed(read, "2026-10-12", false)).toBe("Its days have passed: the last is Sunday 10/11. It's read again every hour, so the new week shows once they add it.");
    expect(datesPassed(read, "2026-10-12", true)).toBe("Its days have passed: the last is Sunday 10/11. Upload the new week.");
    expect(datesPassed({ ...read, weekly: true, lastDate: null }, "2027-01-01", true)).toBeNull();
    expect(zonesNamedWords({ ...read, zonesNamed: ["America/New_York", "America/Los_Angeles"], timeZoneFrom: "market" })).toBe("It names Eastern and Pacific, so the market's is used.");
  });

  it("knows a spreadsheet's link, and a Google link for editing", () => {
    expect(isSheetLink("https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUp/pubhtml")).toBe(true);
    expect(isSheetLink("https://attic.example.org/week.xlsx?dl=1")).toBe(true);
    expect(isSheetLink("https://attic.example.org/calendar.ics")).toBe(false);
    expect(isSharedGoogleLink("https://docs.google.com/spreadsheets/d/1MadeUp/edit#gid=0")).toBe(true);
    expect(isSharedGoogleLink("https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUp/pubhtml")).toBe(false);
  });

  it("offers the US zones, the market's and the one set", () => {
    const zones = zoneOptions("America/Los_Angeles", "Europe/London").map((z) => z.value);
    expect(zones).toContain("America/New_York");
    expect(zones).toContain("Europe/London");
    expect(new Set(zones).size).toBe(zones.length);
    expect(fileWords({ name: "week.xlsx", kind: "xlsx", bytes: 18_500, uploadedBy: "Dee A." }, "Oct 6")).toBe("week.xlsx, Excel workbook, 18 KB, uploaded Oct 6 by Dee A.");
  });
});

describe("the fields", () => {
  it("say what's missing before anything is sent", () => {
    const d = sheetDraftOf();
    expect(d).toEqual({ from: "link", url: "", file: null, tab: "", timeZone: "" });
    expect(sheetProblems(d)).toEqual({ sheetUrl: expect.stringContaining("Paste the link") });
    expect(sheetProblems({ ...d, url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUp/pubhtml" })).toEqual({});
    expect(sheetProblems({ ...d, from: "file" })).toEqual({ sheetFile: "Choose their spreadsheet file." });
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "week.csv");
    expect(sheetProblems({ ...d, from: "file", file: big })).toEqual({ sheetFile: "Use a file of 2 MB or less." });
  });
});
