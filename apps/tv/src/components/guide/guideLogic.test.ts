import { describe, expect, it } from "vitest";
import type { AiringX, StationIdentX } from "../../api/ext";
import {
  blockLine,
  buildModel,
  cellLine,
  cellTitle,
  describe as describeAiring,
  externalLine,
  isExternal,
  focusedCell,
  focusOn,
  guideCommand,
  initialFocus,
  jump,
  move,
  offAirLine,
  okAction,
  okHint,
  page,
  pageCount,
  rowCells,
  rowForTyped,
  slotFloor,
  SPAN,
  typeKey,
  visibleRows,
  whenLine,
  type GuideRowData
} from "./guideLogic";

const TZ = "America/Los_Angeles";
// Saturday September 26, 2026 in Pacific time (UTC-7): "20:42" is 8:42 pm.
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 8, 26, h! + 7, m!);
};
const iso = (hhmm: string) => new Date(at(hhmm)).toISOString();
const NOW = at("20:42");
const FROM = at("20:30");
const TO = FROM + 24 * 3600e3;

function station(callSign: string, channel: string, band: "tv" | "radio" = "tv"): StationIdentX {
  return { id: `st-${callSign}`, kind: "station", callSign, handle: callSign.toLowerCase(), name: callSign, colour: null, band, channel, marketSlug: "inland-empire", homeCity: null };
}
let n = 0;
function airing(start: string, end: string, title: string, o: Partial<AiringX> = {}): AiringX {
  return { logEntryId: `log-${++n}`, title, episodeTitle: null, code: "PGM", kind: o.live ? "live" : "program", startsAt: iso(start), endsAt: iso(end), live: false, carriedFrom: null, programId: `p-${title}`, note: null, episodeDescription: null, listedAiringId: null, ...o };
}
const REEL = station("REEL", "24.1");
function row(s: StationIdentX, airings: AiringX[]): GuideRowData {
  return { station: s, airings };
}

// The frame's six rows (tv 03.1), plus the radio band.
const tv: GuideRowData[] = [
  row(station("BEAT", "12.1"), [
    airing("20:30", "21:00", "Saturday Reel", { carriedFrom: REEL }),
    airing("21:00", "22:00", "Beat Tape Live", { live: true, kind: "live", note: "Live from the Redlands studio" }),
    airing("22:00", "23:00", "Late Crate, ep. 15")
  ]),
  row(station("CIVC", "7.1"), [
    airing("20:00", "21:30", "Town Hall: backyard homes", { live: true, kind: "live" }),
    airing("21:30", "23:00", "Planning Commission"),
    airing("23:00", "25:00", "Council Watch"),
    airing("30:00", "31:00", "Morning meeting")
  ]),
  row(station("RDLS", "9.1"), [
    airing("19:00", "21:15", "City Council, Sept 16", { kind: "listed", logEntryId: null, listedAiringId: "listed-1" }),
    airing("21:15", "21:45", "Community calendar", { kind: "listed", logEntryId: null, listedAiringId: "listed-2" })
  ]),
  row(station("SAZN", "18.1"), [airing("20:00", "21:00", "Tamales for forty"), airing("21:00", "22:00", "Orange Street after hours")]),
  row(station("REEL", "24.1"), [airing("20:00", "21:00", "Cartoons, 1928 to 1934"), airing("21:00", "22:00", "Newsreel hour")]),
  row(station("PREP", "31.1"), [airing("19:30", "22:00", "Football"), airing("22:00", "22:30", "Friday scoreboard")])
];
const radio: GuideRowData[] = [
  row(station("CRAT", "102.0", "radio"), [airing("20:00", "21:00", "The Producers' Hour", { live: true, kind: "live" })]),
  row(station("NITE", "88.4", "radio"), [airing("20:00", "30:00", "Radio dramas")])
];
const model = buildModel(tv, radio, FROM, TO);
const rowOf = (cs: string) => model.rows.findIndex((r) => r.station.callSign === cs);

describe("the guide's rows and cells", () => {
  it("puts the TV band first, then radio, each in channel order", () => {
    expect(model.rows.map((r) => r.station.callSign)).toEqual(["CIVC", "RDLS", "BEAT", "SAZN", "REEL", "PREP", "NITE", "CRAT"]);
  });

  it("fills the gaps with off air, saying when the station signs on again", () => {
    const civc = model.rows[rowOf("CIVC")]!.cells;
    const gap = civc.find((c) => !c.airing)!;
    expect(gap.start).toBe(at("25:00"));
    expect(gap.signOnAt).toBe(at("30:00"));
    // After the last airing it's off air to the end of what's fetched, with no sign-on known.
    expect(civc[civc.length - 1]!.airing).toBeNull();
    expect(civc[civc.length - 1]!.signOnAt).toBeNull();
    const rdls = model.rows[rowOf("RDLS")]!.cells;
    expect(rdls.map((c) => c.airing?.title ?? "off")).toEqual(["City Council, Sept 16", "Community calendar", "off"]);
  });

  it("keys listed meetings by their own id (B4), log entries by theirs", () => {
    const rdls = model.rows[rowOf("RDLS")]!.cells;
    expect(rdls[0]!.key).toBe("listed-1");
    expect(model.rows[rowOf("BEAT")]!.cells[0]!.key).toMatch(/^log-/);
  });

  it("draws planned off air (G9) as one off air cell back at its backAt, joining the gap before it", () => {
    const off = airing("23:00", "30:00", "Off air", { kind: "off_air", code: "OPEN", programId: null, backAt: iso("30:00") });
    const cells = rowCells(row(station("PREP", "31.1"), [airing("22:00", "22:30", "Friday scoreboard"), off, airing("30:00", "31:00", "Morning")]), FROM, at("31:00"));
    expect(cells.map((c) => [c.airing?.title ?? "off", c.start, c.signOnAt])).toEqual([
      ["off", FROM, at("22:00")],
      ["Friday scoreboard", at("22:00"), null],
      ["off", at("22:30"), at("30:00")],
      ["Morning", at("30:00"), null]
    ]);
    expect(offAirLine(cells[2]!, station("PREP", "31.1"), TZ)).toBe("PREP 31.1 signs on again at 6:00 am.");
  });

  it("skips an airing that overlaps one already placed", () => {
    const cells = rowCells(row(station("X", "40.1"), [airing("20:30", "21:30", "A"), airing("21:00", "21:15", "B"), airing("21:30", "22:00", "C")]), FROM, at("22:00"));
    expect(cells.map((c) => c.airing?.title)).toEqual(["A", "C"]);
  });

  it("ends an airing where an overlapping one starts, and lets a sliver the grid can't draw run into what's before it", () => {
    const cells = rowCells(
      row(station("FIZZ", "32.1"), [airing("20:30", "21:05", "Cartoons"), airing("21:00", "21:25", "Batman"), airing("21:25", "21:27", "Filler"), airing("21:27", "22:00", "Superman")]),
      FROM,
      at("22:00")
    );
    expect(cells.map((c) => [c.airing?.title, c.start, c.end])).toEqual([
      ["Cartoons", at("20:30"), at("21:00")],
      ["Batman", at("21:00"), at("21:27")],
      ["Superman", at("21:27"), at("22:00")]
    ]);
  });
});

describe("focus", () => {
  const open = initialFocus(model, "st-BEAT", NOW);

  it("opens on the channel you're watching, now, from the half hour", () => {
    expect(open).toEqual({ row: rowOf("BEAT"), t: NOW, from: slotFloor(NOW) });
    expect(focusedCell(model, open)!.airing!.title).toBe("Saturday Reel");
    // Tuned to nothing yet: the first row.
    expect(initialFocus(model, null, NOW).row).toBe(0);
  });

  it("▶ goes to the next program; ▲ ▼ keep the time of night", () => {
    const right = move(model, open, "right");
    expect(focusedCell(model, right)!.airing!.title).toBe("Beat Tape Live");
    expect(right.t).toBe(at("21:00"));
    const down = move(model, right, "down");
    expect(focusedCell(model, down)!.airing!.title).toBe("Orange Street after hours");
    const up2 = move(model, move(model, right, "up"), "up");
    expect(focusedCell(model, up2)!.airing!.title).toBe("Town Hall: backyard homes");
    // …and back down to the same program.
    expect(focusedCell(model, move(model, move(model, up2, "down"), "down"))!.airing!.title).toBe("Beat Tape Live");
  });

  it("stops at the top and bottom rows", () => {
    const top = { ...open, row: 0 };
    expect(move(model, top, "up")).toBe(top);
    const bottom = { ...open, row: model.rows.length - 1 };
    expect(move(model, bottom, "down")).toBe(bottom);
  });

  it("◀ never goes before the half hour that's on now", () => {
    expect(move(model, open, "left")).toBe(open);
    const civc = { ...open, row: rowOf("CIVC") };
    expect(move(model, civc, "left")).toBe(civc);
  });

  it("moves the window when ▶ goes past its end, and back with ◀", () => {
    let f = { ...open, row: rowOf("CIVC") };
    f = move(model, f, "right"); // Planning Commission, 9:30
    expect(f.from).toBe(FROM);
    f = move(model, f, "right"); // Council Watch, 11:00: past 10:30
    expect(focusedCell(model, f)!.airing!.title).toBe("Council Watch");
    expect(f.from).toBe(at("21:30"));
    expect(f.t).toBeLessThan(f.from + SPAN);
    f = move(model, f, "left"); // Planning Commission again, still on screen
    expect(focusedCell(model, f)!.airing!.title).toBe("Planning Commission");
    expect(f.from).toBe(at("21:30"));
    f = move(model, f, "left"); // Town Hall began at 8:00: the window goes back to the now half hour
    expect(focusedCell(model, f)!.airing!.title).toBe("Town Hall: backyard homes");
    expect(f.from).toBe(FROM);
  });

  it("goes into off air and out again", () => {
    let f = { ...open, row: rowOf("RDLS") };
    f = move(model, move(model, f, "right"), "right");
    expect(focusedCell(model, f)!.airing).toBeNull();
    expect(move(model, f, "right")).toBe(f); // nothing after it
  });

  it("CH pages six stations at a time, round the dial, keeping the place on the page", () => {
    expect(pageCount(model)).toBe(2);
    const f = { ...open, row: rowOf("CIVC") }; // row 0
    const next = page(model, f, "down");
    expect(model.rows[next.row]!.station.callSign).toBe("NITE");
    expect(visibleRows(model, next).map((r) => r.station.callSign)).toEqual(["NITE", "CRAT"]);
    expect(page(model, next, "down").row).toBe(0);
    // Row 4 on a page of two: the last row there.
    const fromReel = page(model, { ...open, row: rowOf("REEL") }, "up");
    expect(model.rows[fromReel.row]!.station.callSign).toBe("CRAT");
  });

  it("doesn't page a market with six stations or fewer", () => {
    const thin = buildModel([tv[0]!, tv[1]!], [], FROM, TO);
    const f = initialFocus(thin, null, NOW);
    expect(page(thin, f, "down")).toBe(f);
    expect(visibleRows(thin, f)).toHaveLength(2);
  });

  it("jumps to a channel by number, keeping the time", () => {
    const right = move(model, open, "right");
    expect(rowForTyped(model, typeKey(typeKey("", 1), 8))).toBe(rowOf("SAZN"));
    const j = jump(right, rowForTyped(model, "18"));
    expect(focusedCell(model, j)!.airing!.title).toBe("Orange Street after hours");
    expect(rowForTyped(model, "7")).toBe(rowOf("CIVC"));
    expect(rowForTyped(model, "884")).toBe(rowOf("NITE"));
    expect(rowForTyped(model, "88.4")).toBe(rowOf("NITE"));
    expect(rowForTyped(model, "13")).toBe(-1);
    // A real FM number is never on the radio band (even tenths): no row.
    expect(rowForTyped(model, "883")).toBe(-1);
    expect(rowForTyped(model, "1019")).toBe(-1);
    expect(rowForTyped(model, "1020")).toBe(rowOf("CRAT"));
    expect(rowForTyped(model, "102.")).toBe(rowOf("CRAT"));
    expect(jump(open, -1)).toBe(open);
    expect(typeKey("10199", 1)).toBe("01991");
  });

  it("finds a cell again by its id, with the window showing it", () => {
    const beatRow = model.rows[rowOf("BEAT")]!;
    const late = beatRow.cells.find((c) => c.airing?.title === "Late Crate, ep. 15")!;
    const f = focusOn(model, late.key, NOW)!;
    expect(focusedCell(model, f)!.key).toBe(late.key);
    expect(f.from).toBe(FROM);
    const council = model.rows[rowOf("CIVC")]!.cells.find((c) => c.airing?.title === "Council Watch")!;
    const g = focusOn(model, council.key, NOW)!;
    expect(focusedCell(model, g)!.key).toBe(council.key);
    expect(g.from).toBe(at("21:30"));
    expect(focusOn(model, "gone", NOW)).toBeNull();
  });
});

describe("what OK does and what the cells say", () => {
  const beat = model.rows[rowOf("BEAT")]!.cells;
  const civc = model.rows[rowOf("CIVC")]!.cells;
  const rdls = model.rows[rowOf("RDLS")]!.cells;
  const sazn = model.rows[rowOf("SAZN")]!.cells;

  it("tunes what's on now, opens options on later programs, does nothing on later off air", () => {
    expect(okAction(beat[0]!, NOW)).toBe("tune");
    expect(okAction(beat[1]!, NOW)).toBe("options");
    expect(okAction(civc.find((c) => !c.airing)!, NOW)).toBe("none");
    expect(okHint(beat[0]!, NOW)).toBe("Tune in");
    expect(okHint(beat[1]!, NOW)).toBe("Options");
    expect(okHint(civc.find((c) => !c.airing)!, NOW)).toBeNull();
  });

  it("writes the lines as the frame does", () => {
    expect(cellLine(civc[0]!, NOW, TZ)).toEqual({ live: true, text: "until 9:30" });
    expect(cellLine(rdls[0]!, NOW, TZ)).toEqual({ live: false, text: "External, until 9:15" });
    expect(cellLine(rdls[1]!, NOW, TZ)).toEqual({ live: false, text: "9:15" });
    expect(cellLine(beat[0]!, NOW, TZ)).toEqual({ live: false, text: "From REEL" });
    expect(cellLine(beat[1]!, NOW, TZ)).toEqual({ live: true, text: "9:00 – 10:00" });
    expect(cellLine(sazn[0]!, NOW, TZ)).toEqual({ live: false, text: "Until 9:00" });
    expect(cellLine(sazn[1]!, NOW, TZ)).toEqual({ live: false, text: "9:00" });
    expect(cellLine(civc.find((c) => !c.airing)!, NOW, TZ)).toEqual({ live: false, text: "Signs on at 6:00 am" });
    // Past midnight, the time says am.
    const nite = model.rows[rowOf("NITE")]!.cells[0]!;
    expect(cellLine(nite, NOW, TZ)).toEqual({ live: false, text: "Until 6:00 am" });
  });

  it("heads the focused program with its time range and station", () => {
    const s = model.rows[rowOf("BEAT")]!.station;
    expect(whenLine(beat[1]!, s, TZ)).toBe("9:00 – 10:00 pm, BEAT 12.1");
    const off = civc.find((c) => !c.airing)!;
    const cs = model.rows[rowOf("CIVC")]!.station;
    expect(whenLine(off, cs, TZ)).toBe("CIVC 7.1");
    expect(offAirLine(off, cs, TZ)).toBe("CIVC 7.1 signs on again at 6:00 am.");
    expect(offAirLine(beat[0]!, s, TZ)).toBeNull();
  });
});

describe("the focused program's description", () => {
  const base = airing("21:00", "22:00", "Beat Tape Live", { live: true, kind: "live", note: "Live from the Redlands studio" });

  it("leads with the line under the title, and says a sentence once (the frame's order)", () => {
    const d = describeAiring(base, "Producers play unreleased tapes and talk through how they were made. Live from the Redlands studio.");
    expect(d).toEqual({ text: "Live from the Redlands studio. Producers play unreleased tapes and talk through how they were made.", liveLead: true });
  });

  it("keeps a description that already contains the line in a sentence", () => {
    const a = { ...base, live: false, kind: "program" as const, note: "A family kitchen in Fontana" };
    expect(describeAiring(a, "A family kitchen in Fontana makes tamales for forty.")!.text).toBe("A family kitchen in Fontana makes tamales for forty.");
  });

  it("prefers tonight's episode (G5), and puts a line that isn't there first", () => {
    const a = { ...base, live: false, kind: "program" as const, note: "Beat showcase", episodeDescription: "Tonight: records from 1994." };
    expect(describeAiring(a, "One producer, one crate.")).toEqual({ text: "Beat showcase. Tonight: records from 1994.", liveLead: false });
  });

  it("has nothing for listed meetings, or with nothing to say", () => {
    expect(describeAiring({ ...base, kind: "listed" }, "Anything")).toBeNull();
    expect(describeAiring({ ...base, note: null }, null)).toBeNull();
    expect(describeAiring(null, "x")).toBeNull();
  });
});

describe("the guide's command layer", () => {
  const open = initialFocus(model, "st-BEAT", NOW);

  it("moves focus with the arrows and chooses with OK", () => {
    const r = guideCommand({ type: "focus", dir: "right" }, model, open);
    expect(r.handled).toBe(true);
    expect(focusedCell(model, r.focus!)!.airing!.title).toBe("Beat Tape Live");
    expect(guideCommand({ type: "select" }, model, open)).toEqual({ handled: true, choose: true });
  });

  it("pages with CH instead of changing channel underneath", () => {
    const r = guideCommand({ type: "channel", dir: "down" }, model, open);
    expect(r.handled).toBe(true);
    expect(r.focus!.row).toBe(page(model, open, "down").row);
  });

  it("takes numbers and Info; leaves Back, Guide, Menu and pause to TV mode", () => {
    expect(guideCommand({ type: "digit", digit: 1 }, model, open)).toEqual({ handled: true, typed: 1 });
    expect(guideCommand({ type: "dot" }, model, open)).toEqual({ handled: true, typed: "." });
    expect(guideCommand({ type: "info" }, model, open)).toEqual({ handled: true });
    for (const type of ["back", "guide", "menu", "togglePlay"] as const) expect(guideCommand({ type }, model, open).handled).toBe(false);
  });

  it("holds its keys while the listings load", () => {
    expect(guideCommand({ type: "focus", dir: "down" }, null, null)).toEqual({ handled: true });
    expect(guideCommand({ type: "channel", dir: "up" }, null, null)).toEqual({ handled: true });
    expect(guideCommand({ type: "back" }, null, null)).toEqual({ handled: false });
  });
});

describe("an external station's row (follow-up Phase 6)", () => {
  const COLT: StationIdentX = { ...station("COLT", "9.2"), kind: "listed", name: "City of Colton" };
  const meeting = airing("18:00", "21:30", "City Council, regular meeting", { kind: "listed", live: true, logEntryId: null, listedAiringId: "listed-colt" });

  it("is on between what the source lists: its name and Live, nothing listed, never off air", () => {
    expect(isExternal(COLT)).toBe(true);
    expect(isExternal(station("BEAT", "12.1"))).toBe(false);
    const cells = rowCells(row(COLT, [meeting]), FROM, at("22:30"));
    expect(cells.map((c) => [c.airing?.title ?? cellTitle(c, COLT), c.start, c.end, !!c.nothingListed])).toEqual([
      ["City Council, regular meeting", at("18:00"), at("21:30"), false],
      ["City of Colton", at("21:30"), at("22:30"), true]
    ]);
    // The same ids as the web's guide.
    expect(cells[1]!.key).toBe(`st-COLT@live@${iso("21:30")}`);
    expect(cellLine(cells[1]!, NOW, TZ)).toEqual({ live: true, text: "nothing listed" });
    expect(cells[1]!.signOnAt).toBeNull();
    expect(offAirLine(cells[1]!, COLT, TZ)).toBeNull();
  });

  it("with nothing in the window, is one cell for the whole of it", () => {
    const cells = rowCells(row(COLT, []), FROM, TO);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ start: FROM, end: TO, airing: null, nothingListed: true });
    expect(cellTitle(cells[0]!, COLT)).toBe("City of Colton");
  });

  it("fills the gaps before and between listed airings too", () => {
    const cells = rowCells(row(COLT, [airing("21:00", "21:30", "A", { kind: "listed" }), airing("22:00", "22:30", "B", { kind: "listed" })]), FROM, at("23:00"));
    expect(cells.map((c) => c.airing?.title ?? (c.nothingListed ? "nothing listed" : "off"))).toEqual(["nothing listed", "A", "nothing listed", "B", "nothing listed"]);
  });

  it("tunes in on what's on now; later, nothing to set: no options, no reminders", () => {
    const model = buildModel([row(COLT, [])], [], FROM, TO);
    const cell = model.rows[0]!.cells[0]!;
    expect(okAction(cell, NOW)).toBe("tune");
    expect(okHint(cell, NOW)).toBe("Tune in");
    const later = rowCells(row(COLT, [meeting]), FROM, at("23:00"))[1]!;
    expect(okAction(later, at("20:40"))).toBe("none");
    expect(okHint(later, at("20:40"))).toBeNull();
    expect(describeAiring(later.airing, null)).toBeNull();
  });

  it("keeps the scheduled cell's line, and says whose stream it is in the header", () => {
    const listed = airing("19:00", "21:15", "City Council, Sept 16", { kind: "listed", logEntryId: null, listedAiringId: "listed-1" });
    const cells = rowCells(row(COLT, [listed]), FROM, at("22:30"));
    expect(cellLine(cells[0]!, NOW, TZ)).toEqual({ live: false, text: "External, until 9:15" });
    expect(externalLine(cells[0]!, COLT, "City of Colton")).toBe("City of Colton's own stream.");
    expect(externalLine(cells[1]!, COLT, "City of Colton")).toBe("City of Colton's own stream.");
    expect(externalLine(cells[1]!, COLT, null)).toBeNull();
    const beat = rowCells(row(station("BEAT", "12.1"), []), FROM, at("22:30"));
    expect(externalLine(beat[0]!, station("BEAT", "12.1"), "Anyone")).toBeNull();
    expect(cellTitle(beat[0]!, station("BEAT", "12.1"))).toBe("Off air");
  });
});

// A244: programming blocks on the TV guide.
describe("programming blocks", () => {
  const station = { id: "s-beat", kind: "station", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: null, band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: null } as never;
  const block = { id: "b-lcn", name: "Late Crate Nights", colour: "#1F5C99" };
  const t = (h: number) => Date.parse("2026-10-04T00:00:00Z") + h * 3600e3;
  const airing = (h: number, title: string, inBlock: boolean) => ({ logEntryId: `e${h}`, title, episodeTitle: null, code: "PGM", kind: "program", startsAt: new Date(t(h)).toISOString(), endsAt: new Date(t(h + 1)).toISOString(), live: false, carriedFrom: null, programId: null, ...(inBlock ? { block } : {}) });

  it("a row keeps its blocks in the window as bands (focus never lands on them)", () => {
    const m = buildModel([{ station, airings: [airing(4, "Late Crate", true), airing(5, "Saturday Reel", true)] as never, blocks: [{ ...block, logoUrl: null, startsAt: new Date(t(4)).toISOString(), endsAt: new Date(t(6)).toISOString() }, { ...block, logoUrl: null, startsAt: new Date(t(20)).toISOString(), endsAt: new Date(t(21)).toISOString() }] }], [], t(3), t(7));
    expect(m.rows[0]!.bands).toEqual([{ id: "b-lcn", name: "Late Crate Nights", colour: "#1F5C99", start: t(4), end: t(6) }]);
    expect(m.rows[0]!.cells.every((c) => !c.key.startsWith("b-lcn"))).toBe(true);
  });

  it("the focused cell's details say 'Part of Late Crate Nights'", () => {
    const m = buildModel([{ station, airings: [airing(4, "Late Crate", true), airing(5, "Night Desk", false)] as never }], [], t(3), t(7));
    const [, inBlock, outside] = m.rows[0]!.cells;
    expect(blockLine(inBlock!)).toBe("Part of Late Crate Nights");
    expect(blockLine(outside!)).toBeNull();
    expect(m.rows[0]!.bands).toEqual([]);
  });
});
