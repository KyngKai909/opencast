import { describe, expect, it } from "vitest";
import { highlight, matchChannel, namedOnce, nearestChannels, numberQuery, orderAirings, type Orderable } from "./searchLogic";
import { withRecent } from "./recent";

const DIAL = ["7.1", "9.1", "12.1", "18.1", "24.1", "31.1", "88.3", "90.7", "101.9", "104.3"];

describe("numbers tune", () => {
  it("tells a channel or frequency from a title", () => {
    expect(numberQuery("12")).toBe("12");
    expect(numberQuery(" 883 ")).toBe("883");
    expect(numberQuery("88.3")).toBe("88.3");
    expect(numberQuery("12.")).toBe("12.");
    expect(numberQuery("24 Hours")).toBeNull();
    expect(numberQuery("town hall")).toBeNull();
    expect(numberQuery("12345")).toBeNull();
    expect(numberQuery("")).toBeNull();
  });

  it("reads digits as the keypad does: 12 is 12.1, 883 is 88.3", () => {
    expect(matchChannel("12", DIAL)).toEqual({ channel: "12.1", found: true });
    expect(matchChannel("24", DIAL)).toEqual({ channel: "24.1", found: true });
    expect(matchChannel("883", DIAL)).toEqual({ channel: "88.3", found: true });
    expect(matchChannel("1019", DIAL)).toEqual({ channel: "101.9", found: true });
    expect(matchChannel("88.3", DIAL)).toEqual({ channel: "88.3", found: true });
    expect(matchChannel("12.", DIAL)).toEqual({ channel: "12.1", found: true });
  });

  it("says when a number has no station, and names the nearest two in channel order", () => {
    expect(matchChannel("13", DIAL)).toEqual({ channel: "13.1", found: false });
    expect(matchChannel("12.2", DIAL)).toEqual({ channel: "12.2", found: false });
    expect(nearestChannels("13.1", DIAL)).toEqual(["9.1", "12.1"]);
    expect(matchChannel("24 Hours", DIAL)).toBeNull();
  });
});

describe("result ordering", () => {
  const now = new Date("2026-09-27T03:42:00Z");
  const row = (id: string, start: string, end: string, market: string, carried = false, channel = "7.1") =>
    ({ id, station: { marketSlug: market, channel }, airing: { startsAt: start, endsAt: end, carriedFrom: carried ? {} : null } }) as Orderable & { id: string };

  it("puts what's on now first, then airing next first, and drops what has ended", () => {
    const rows = [
      row("next-month", "2026-10-27T03:00:00Z", "2026-10-27T04:00:00Z", "ie"),
      row("tuesday", "2026-09-30T02:00:00Z", "2026-09-30T03:30:00Z", "ie"),
      row("on-now", "2026-09-27T03:00:00Z", "2026-09-27T04:30:00Z", "ie"),
      row("ended", "2026-09-27T01:00:00Z", "2026-09-27T02:00:00Z", "ie")
    ];
    expect(orderAirings(rows, now, "ie").map((r) => r.id)).toEqual(["on-now", "tuesday", "next-month"]);
  });

  it("at the same time, puts the market's own before carried copies, and those before other markets", () => {
    const at = ["2026-09-28T02:00:00Z", "2026-09-28T03:00:00Z"] as const;
    const rows = [
      row("elsewhere", ...at, "la", false, "5.1"),
      row("carried-here", ...at, "ie", true, "12.1"),
      row("carried-elsewhere", ...at, "la", true, "2.1"),
      row("own", ...at, "ie", false, "24.1")
    ];
    expect(orderAirings(rows, now, "ie").map((r) => r.id)).toEqual(["own", "carried-here", "elsewhere", "carried-elsewhere"]);
  });

  it("counts two programs on now as airing at the same time", () => {
    const rows = [row("began-7", "2026-09-27T02:00:00Z", "2026-09-27T05:00:00Z", "ie", true), row("began-8", "2026-09-27T03:00:00Z", "2026-09-27T04:00:00Z", "ie")];
    expect(orderAirings(rows, now, "ie").map((r) => r.id)).toEqual(["began-8", "began-7"]);
  });
});

describe("result details", () => {
  it("marks the query's words in a title, whatever their case", () => {
    expect(highlight("Co-op town hall: members’ questions", "Town Hall")).toEqual([
      { text: "Co-op ", hit: false },
      { text: "town hall", hit: true },
      { text: ": members’ questions", hit: false }
    ]);
    expect(highlight("24 hours at the fair", "24")[0]).toEqual({ text: "24", hit: true });
    expect(highlight("Slow Hours", "")).toEqual([{ text: "Slow Hours", hit: false }]);
  });

  it("names a station on its first result only", () => {
    expect(namedOnce(["civc", "civc", "rdls"])).toEqual([true, false, true]);
  });

  it("keeps recent searches newest first, each once, at most eight", () => {
    expect(withRecent(["cartoons", "council"], "Council")).toEqual(["Council", "cartoons"]);
    expect(withRecent(["a"], "  ")).toEqual(["a"]);
    expect(withRecent(["1", "2", "3", "4", "5", "6", "7", "8"], "9")).toEqual(["9", "1", "2", "3", "4", "5", "6", "7"]);
  });
});
