// A246: the Day view's rundown, worked out (dayRows.ts): rows in air order with their codes, a
// break's parts by kind and its line, dead air still ahead, planned off air, a block's edge and
// label, past and now; the health chips; tonight at a glance; and the week's columns.

import { describe, expect, it, vi } from "vitest";
import type { BlockSpan, BreakSlot, LogEntry, StationIdent } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { blockWords, breakKindOf, breakParts, breakSummary, dayRows, glanceOf, healthChips, rowLength, scrollTarget, templateChip, weekChips, weekColumns } from "./dayRows";

const T = (hms: string, day = "27") => `2026-09-${day}T${hms}.000Z`;
const NOW = Date.parse(T("03:42:12"));
const REEL: StationIdent = { id: "r", kind: "station", callSign: "REEL", handle: "reel", name: "Saturday Reel", colour: "#9A5412", band: "tv", channel: "24.1", marketSlug: null, homeCity: null } as StationIdent;

const entry = (id: string, startsAt: string, endsAt: string, o: Partial<LogEntry> = {}): LogEntry => ({ id, kind: "program", code: "PGM", startsAt, endsAt, title: id, episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null, ...o });
const slot = (startsAt: string, lengthMs: number, o: Partial<BreakSlot> = {}): BreakSlot => ({ id: null, startsAt, lengthMs, context: "After it", origin: "rule", producerShareMs: 0, filledMs: 0, openMs: 0, ...o });

const entries = [
  entry("Late Crate, ep. 14", T("03:00:00"), T("03:28:28")),
  entry("Saturday Reel", T("03:30:00"), T("03:59:00"), { carriedFrom: REEL, carriageAgreementId: "ag" }),
  entry("Beat Tape Live", T("04:01:00"), T("04:58:00"), { kind: "live", liveSourceId: "src" }),
  entry("Late Crate, ep. 15", T("05:00:00"), T("05:28:28"), { itemId: "i15" })
];
const breaks = [
  slot(T("03:28:28"), 90_000, {
    filledMs: 90_000,
    rows: [
      { code: "BMP", title: "Into the break", lengthMs: 10_000, whose: "station", note: null, element: { position: "open", role: "into_break", announces: null, fits: true } },
      { code: "SPT", title: "Inland Tire", lengthMs: 30_000, whose: "station", note: null },
      { code: "SPT", title: "Cypress Dental", lengthMs: 30_000, whose: "backup", note: null },
      { code: "UND", title: "Made possible by members", lengthMs: 15_000, whose: "station", note: null },
      { code: "BMP", title: "Up next", lengthMs: 8_000, whose: "station", note: null, element: { position: "between", role: "up_next", announces: null, fits: false } },
      { code: "SID", title: "BEAT station ID", lengthMs: 5_000, whose: "station", note: null }
    ]
  }),
  slot(T("03:44:00"), 120_000, { context: "During Saturday Reel", origin: "carried_barter", producerShareMs: 60_000, openMs: 60_000, rows: [{ code: "SPT", title: "Mission Soda", lengthMs: 60_000, whose: "producer", note: "REEL's break time, barter" }, { code: "OPEN", title: "Open", lengthMs: 60_000, whose: "station", note: null }] }),
  // An hour off: spots aren't placed yet.
  slot(T("04:58:00"), 120_000, { openMs: 105_000, rows: [{ code: "UND", title: "Credit", lengthMs: 10_000, whose: "station", note: null }, { code: "OPEN", title: "Open", lengthMs: 105_000, whose: "station", note: null }, { code: "SID", title: "ID", lengthMs: 5_000, whose: "station", note: null }] })
];
const span: BlockSpan = { id: "s1", blockId: "lcn", name: "Late Crate Nights", colour: "#6A3A86", startsAt: T("03:00:00"), endsAt: T("04:00:00"), airsFrom: T("03:00:00"), airsUntil: T("03:59:00"), pieces: [], templateId: null, entryIds: [], problems: [] };
const offAir = [{ startsAt: T("11:00:00"), endsAt: T("13:00:00"), backAt: T("13:00:00"), source: "hours" as const, logEntryId: null }];
const day = { entries, breaks, gaps: [{ startsAt: T("05:28:28"), endsAt: T("07:00:00") }], offAir, spans: [span], from: T("13:00:00", "26"), to: T("13:00:00"), now: NOW, liveSourceName: () => "Studio A" };

describe("a break's parts", () => {
  it("reads up next as a bumper's role and the maker's spots as barter", () => {
    expect(breaks[0].rows!.map(breakKindOf)).toEqual(["bumper", "spots", "spots", "credit", "upnext", "id"]);
    expect(breakKindOf({ code: "SPT", whose: "producer" })).toBe("barter");
    expect(breakKindOf({ code: "OPEN", whose: "station" })).toBe("open");
  });

  it("leaves out what didn't fit, and labels the strip's parts", () => {
    expect(breakParts(breaks[0]).map((p) => p.kind)).toEqual(["bumper", "spots", "spots", "credit", "id"]);
    expect(breakParts(breaks[1], "REEL").map((p) => p.label)).toEqual(["REEL's barter", "1:00 open"]);
  });

  it("says what fills a break in a line, and when spots will be placed in one still far off", () => {
    expect(breakSummary(breaks[0], null, NOW)).toBe("2 spots, credit, ID");
    expect(breakSummary(breaks[1], "REEL", NOW)).toBe("REEL's 1:00 barter, 1:00 open");
    expect(breakSummary(breaks[2], null, NOW)).toBe("Spots placed at 9:38 pm");
    expect(breakSummary(slot(T("03:50:00"), 40_000), null, NOW)).toBe("0:40 open");
  });

  it("writes lengths as the rundown does", () => {
    expect([rowLength(40_000), rowLength(29 * 60_000 + 10_000), rowLength(3_600_000)]).toEqual(["0:40", "29:10", "1:00:00"]);
  });
});

describe("the day's rows", () => {
  const rows = dayRows(day);

  it("lists everything in air order with the rundown's codes, a block's label where it starts", () => {
    expect(rows.map((r) => [r.kind, r.code, r.title])).toEqual([
      ["band", "PGM", "Late Crate Nights"],
      ["entry", "PGM", "Late Crate, ep. 14"],
      ["break", "BRK", "2 spots, credit, ID"],
      ["entry", "PGM", "Saturday Reel"],
      ["break", "BRK", "REEL's 1:00 barter, 1:00 open"],
      ["entry", "LIVE", "Beat Tape Live"],
      ["break", "BRK", "Spots placed at 9:38 pm"],
      ["entry", "PGM", "Late Crate, ep. 15"],
      ["gap", "GAP", "Dead air"],
      ["off_air", "OFF", "Off air"]
    ]);
    expect(rows[0].detail).toBe("Block, 8:00 to 9:00 pm");
  });

  it("says where each comes from: carried, live with its source, dead air and planned off air", () => {
    const by = (title: string) => rows.find((r) => r.title === title)!;
    expect(by("Saturday Reel").source).toBe("Carried from REEL 24.1");
    expect(by("Beat Tape Live").source).toBe("Live source: Studio A. Breaks cued from the booth");
    expect(by("Dead air").source).toBe("Nothing until 12:00 am");
    expect(by("Off air").source).toBe("Planned, back at 6:00 am");
  });

  it("dims what has aired, marks what's on now, and runs the block's colour down its rows", () => {
    expect(rows.filter((r) => r.state === "past").map((r) => r.title)).toEqual(["Late Crate, ep. 14", "2 spots, credit, ID"]);
    expect(rows.find((r) => r.state === "now")?.title).toBe("Saturday Reel");
    expect(rows.filter((r) => r.block?.spanId === "s1").map((r) => r.title)).toEqual(["Late Crate Nights", "Late Crate, ep. 14", "2 spots, credit, ID", "Saturday Reel", "REEL's 1:00 barter, 1:00 open"]);
  });

  it("leaves out dead air that has passed, and starts what's left of it now", () => {
    const later = dayRows({ ...day, gaps: [{ startsAt: T("02:00:00"), endsAt: T("03:00:00") }, { startsAt: T("03:40:00"), endsAt: T("03:58:00") }] });
    expect(later.filter((r) => r.kind === "gap").map((r) => [r.at, r.endsAt])).toEqual([[T("03:42:00"), T("03:58:00")]]);
  });

  it("opens at the row asked for, else at now", () => {
    expect(scrollTarget(rows, "Beat Tape Live")).toBe("Beat Tape Live");
    expect(scrollTarget(rows, null)).toBe("Saturday Reel");
  });

  it("in edit mode, breaks say they follow the programs, and removed rows stay, struck through", () => {
    const edit = dayRows({ ...day, entries: entries.slice(0, 3), removed: [entries[3]], editing: true });
    expect(edit.filter((r) => r.kind === "break").map((r) => r.title)).toEqual(["Follows the programs", "Follows the programs", "Follows the programs"]);
    expect(edit.find((r) => r.title === "Late Crate, ep. 15")?.removed).toBe(true);
  });

  it("names a block's own bumpers and ID, or the station's", () => {
    expect(blockWords({ items: { intro: [], outro: [], id: [{} as never], bumpers: { into_break: 2, out_of_break: 0, up_next: 0, any: 0 } }, sequences: null }, "BEAT")).toBe("Its own bumpers and ID");
    expect(blockWords({ items: { intro: [], outro: [], id: [], bumpers: { into_break: 0, out_of_break: 0, up_next: 0, any: 0 } }, sequences: null }, "BEAT")).toBe("BEAT's bumpers and ID");
  });
});

describe("the health chips", () => {
  const rows = dayRows(day);
  it("says what's on, dead air coming, items not ready, planned off air and a paused spot, each with its row", () => {
    const chips = healthChips({ rows, now: NOW, onAirToday: true, readiness: { items: 13, ready: 12, failed: 0, preparing: 1, firstNotReady: { itemId: "i15", title: "Late Crate, ep. 15", airsAt: T("05:00:00"), status: "preparing", entryId: "Late Crate, ep. 15" } }, pausedSpots: 1 });
    expect(chips.map((c) => [c.tone, c.text, c.rowId])).toEqual([
      ["live", "On air: Saturday Reel, 17 min left", "Saturday Reel"],
      ["warn", "Dead air at 10:28 pm, 1 hr 32 min", `gap:${T("05:28:28")}`],
      ["warn", "1 item still preparing", "Late Crate, ep. 15"],
      ["off", "Off air 4:00 to 6:00 am, planned", `off:${T("11:00:00")}`],
      ["warn", "A spot paused; your station ID and bumpers fill its time", null]
    ]);
  });

  it("says which break the backup rotation fills for a paused spot", () => {
    const backed = dayRows({ ...day, breaks: [...breaks, slot(T("05:28:28"), 60_000, { filledMs: 60_000, rows: [{ code: "SPT", title: "Redlands Hardware", lengthMs: 60_000, whose: "backup", note: null }] })] });
    expect(healthChips({ rows: backed, now: NOW, onAirToday: true, pausedSpots: 2 }).find((c) => c.key === "paused")).toEqual({ key: "paused", tone: "warn", text: "2 spots paused; backup fills 10:28 pm", rowId: `brk:${T("05:28:28")}` });
  });

  it("says nothing of on air for another day, or off air", () => {
    expect(healthChips({ rows, now: NOW, onAirToday: false }).map((c) => c.key)).toEqual(["gap", "off"]);
  });

  it("names the day's template, and whether it was edited", () => {
    const days = [{ date: "2026-09-26", templateId: "t", templateName: null, label: "Every Saturday", edited: true }];
    expect(templateChip(days, "2026-09-26", (d) => d.label!)).toEqual({ text: 'From "Every Saturday", edited', edited: true, templateId: "t" });
    expect(templateChip(days, "2026-09-27", (d) => d.label!)).toBeNull();
  });
});

describe("tonight at a glance", () => {
  it("counts the evening and night: programs, breaks, spots, open time and barter owed", () => {
    const g = glanceOf({ year: 2026, month: 9, day: 26 }, entries, breaks);
    expect(g.span).toBe("Saturday, 6:00 pm to 6:00 am");
    expect(g.breaks).toBe(3);
    expect(g.spots).toBe(2);
    expect(g.openMs).toBe(165_000);
    expect(g.barterMs).toBe(60_000);
  });
});

describe("the week", () => {
  const week = [{ year: 2026, month: 9, day: 26 }];
  const cols = weekColumns(week, { entries, gaps: [{ startsAt: T("05:28:28"), endsAt: T("07:00:00") }], offAir, days: [{ date: "2026-09-26", templateId: "t", templateName: "Saturdays", label: "Every Saturday", edited: true }], blocks: [span] }, { now: NOW, stationColour: "#8C3B7A", templateName: (d) => d.templateName ?? d.label! });

  it("heads each day with its template and colours programs by source, live in the station's", () => {
    const [c] = cols;
    expect([c.label, c.template, c.edited, c.today]).toEqual(["Sat, Sep 26", "Saturdays", true, true]);
    expect(c.events.map((e) => [e.kind, e.colour])).toEqual([
      ["program", "#8C3B7A"],
      ["program", "#9A5412"],
      ["live", "#8C3B7A"],
      ["program", "#8C3B7A"],
      ["gap", null],
      ["off", null]
    ]);
    expect(c.bands).toHaveLength(1);
    expect(c.nowAt).toBeCloseTo((NOW - Date.parse(T("13:00:00", "26"))) / 86_400_000, 5);
  });

  it("chips dead air by day and blocks by the days they run", () => {
    expect(weekChips(cols, [span], NOW).map((c) => c.text)).toEqual(["Dead air tonight at 10:28 pm, 1 hr 32 min", "Late Crate Nights, Sat"]);
  });
});
