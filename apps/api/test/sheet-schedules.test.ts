// A248 (2026-10-06, the user's request): an external station's schedule from a spreadsheet. A
// Google Sheet's link (read as its CSV export), a .csv, .tsv, .xlsx or .ods link, or a file uploaded
// on the desk. The layout is worked out (a week grid with times in the cells, a grid with a column
// of times, or a list), titles are the sheet's own, and a cell without a time it can read is
// skipped, never guessed. Every sheet here is made up; no network: every fetch is a fake.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { schema } from "@opencast/db";
import { readScheduleAt, ScheduleReadError, type Fetch } from "../src/v1/modules/network/external.js";
import { detectScheduleFormat } from "../src/v1/lib/schedules.js";
import { googleSheetCsvUrl, isSheetAddress, parseDelimited, readSheet, SheetError, sheetFragment } from "../src/v1/lib/sheetFiles.js";
import { bareTime, cellTime, dayLabel, durationMinutes, readSheetSchedule, sheetAirings, zonesIn, type SheetEntry } from "../src/v1/lib/sheetSchedule.js";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

const NY = "America/New_York";
const csv = (text: string) => readSheet(strToU8(text), { kind: "csv" });
const read = (text: string, now = "2026-10-08T16:00:00Z") => {
  const t = csv(text);
  return readSheetSchedule(t.rows, t.continues, new Date(now));
};
const hm = (m: number | null) => (m === null ? null : `${m >= 1440 ? "+" : ""}${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const rows = (entries: SheetEntry[]) => entries.map((e) => [e.date ?? e.day, hm(e.start), hm(e.end), e.title]);

/**
 * A made-up station's week, laid out the way the user's sheet is: a note row (a merged cell, so
 * one long cell with line breaks), a blank first column, days with dates, times in the cells and
 * varying day to day, blank rows, films over several lines, a time typo, a cell with no time.
 */
const WEEK = [
  `,,"Vote for the next marathon!\nVolunteer-run, non-profit. Eastern standard time.\nhttps://attic.example.org",,`,
  `,Friday 10/09,Saturday 10/10,Sunday 10/11`,
  `,Space Rangers 6:00 AM,Puppet Kitchen 6:00 AM,Puppet Kitchen 6:30 AM`,
  `,Office Dogs 6:25 AM,Garage Band Hour 6:30 AM,Garage Band Hour 7:00 AM`,
  `,,,`,
  `,"Night at the Drive-In\n(1987)\n8:30 PM",Detective Raccoon at 8:40 PM,Cooking With Grandma 8:35 PM`,
  `,,see website,`,
  `,Late Laughs 11:50 PM,Late Laughs 11:45 PM,Late Laughs 11:55 PM`,
  `,Static Hour 12:15 AM,Static Hour 12:10 AM,Static Hour 12:20 AM`,
  `,Test Card 2:55 PM,Night Owls 1:00 AM,Night Owls 1:05 AM`,
  `,Night Owls 3:20 AM,Sign-off 5:30 AM,Sign-off 2:00 AM`,
  `,,,`
].join("\n");

describe("a week grid with times in the cells", () => {
  it("reads the user's layout: note rows, a blank first column, blank rows, times that vary by day, and Saturday's and Sunday's own shows", () => {
    const s = read(WEEK);
    expect(s).toMatchObject({ layout: "week_grid", weekly: false, firstDay: "Friday 10/09", lastDay: "Sunday 10/11", firstDate: "2026-10-09", lastDate: "2026-10-11", zone: NY });
    expect(rows(s.entries)).toEqual([
      // Friday: a blank row and a blank cell end nothing (the show before has no end); past midnight
      // stays Friday's; the last show runs to Saturday's first start (2 hr 40 min later).
      ["2026-10-09", "06:00", "06:25", "Space Rangers"],
      ["2026-10-09", "06:25", null, "Office Dogs"],
      ["2026-10-09", "20:30", null, "Night at the Drive-In (1987)"],
      ["2026-10-09", "23:50", "+00:15", "Late Laughs"],
      ["2026-10-09", "+00:15", null, "Static Hour"],
      ["2026-10-09", "+03:20", "+06:00", "Night Owls"],
      // Saturday: "Title at 8:40 PM" is the title; the cell without a time is skipped and ends nothing.
      ["2026-10-10", "06:00", "06:30", "Puppet Kitchen"],
      ["2026-10-10", "06:30", null, "Garage Band Hour"],
      ["2026-10-10", "20:40", null, "Detective Raccoon"],
      ["2026-10-10", "23:45", "+00:10", "Late Laughs"],
      ["2026-10-10", "+00:10", "+01:00", "Static Hour"],
      ["2026-10-10", "+01:00", "+05:30", "Night Owls"],
      ["2026-10-10", "+05:30", "+06:30", "Sign-off"],
      // Sunday: the last day, so its last show has no next day to run to.
      ["2026-10-11", "06:30", "07:00", "Puppet Kitchen"],
      ["2026-10-11", "07:00", null, "Garage Band Hour"],
      ["2026-10-11", "20:35", null, "Cooking With Grandma"],
      ["2026-10-11", "23:55", "+00:20", "Late Laughs"],
      ["2026-10-11", "+00:20", "+01:05", "Static Hour"],
      ["2026-10-11", "+01:05", "+02:00", "Night Owls"],
      ["2026-10-11", "+02:00", null, "Sign-off"]
    ]);
    // "2:55 PM" between 12:15 am and 3:20 am would be more than a day after the column's first: a typo, skipped.
    expect(s.skippedCount).toBe(2);
    expect(s.skipped).toEqual([
      { text: "Test Card 2:55 PM", where: "Friday 10/09, row 10", why: "out_of_order" },
      { text: "see website", where: "Saturday 10/10, row 7", why: "no_time" }
    ]);
  });

  it("makes airings on the sheet's dates in the zone it names, past midnight the next morning", () => {
    const s = read(WEEK);
    const airings = sheetAirings(s.entries, s.zone!, new Date("2026-10-08T16:00:00Z"), new Date("2026-10-22T16:00:00Z"));
    expect(airings).toHaveLength(20);
    expect(airings[0]).toEqual({ uid: null, summary: "Space Rangers", start: new Date("2026-10-09T10:00:00Z"), end: new Date("2026-10-09T10:25:00Z") });
    expect(airings.find((a) => a.summary === "Night Owls")).toMatchObject({ start: new Date("2026-10-10T07:20:00Z"), end: new Date("2026-10-10T10:00:00Z") });
    // Those over by `from` are left out; one still on stays.
    expect(sheetAirings(s.entries, NY, new Date("2026-10-09T10:10:00Z"), new Date("2026-10-23T00:00:00Z"))[0]).toMatchObject({ summary: "Space Rangers" });
    expect(sheetAirings(s.entries, NY, new Date("2026-10-12T12:00:00Z"), new Date("2026-10-26T00:00:00Z"))).toEqual([]);
  });

  it("reads a time at either end or in brackets, 12- or 24-hour, noon and midnight, a range, a zone after it", () => {
    expect(cellTime("Trigun 6:00 AM")).toMatchObject({ start: 360, end: null, title: "Trigun", sure: true });
    expect(cellTime("6:00 AM Trigun")).toMatchObject({ start: 360, title: "Trigun" });
    expect(cellTime("Trigun (6am)")).toMatchObject({ start: 360, title: "Trigun" });
    expect(cellTime("News 18:30")).toMatchObject({ start: 1110, title: "News", sure: true });
    expect(cellTime("18:30 - News")).toMatchObject({ start: 1110, title: "News" });
    expect(cellTime("Lunch Live noon")).toMatchObject({ start: 720, title: "Lunch Live" });
    expect(cellTime("Late Show Midnight")).toMatchObject({ start: 0, title: "Late Show" });
    expect(cellTime("Movie Night 6–8 pm")).toMatchObject({ start: 1080, end: 1200, title: "Movie Night" });
    expect(cellTime("Brunch 11 to 1 pm")).toMatchObject({ start: 660, end: 780, title: "Brunch" });
    expect(cellTime("Evening News 6:00 PM ET")).toMatchObject({ start: 1080, title: "Evening News", zone: NY });
    expect(cellTime("Mr. Bean 6:50 a.m.")).toMatchObject({ start: 410, title: "Mr. Bean" });
    // A title's own "At" stays; numbers in a title aren't times.
    expect(cellTime("Where It's At 9:00 PM")).toMatchObject({ title: "Where It's At" });
    expect(cellTime("RENO 911! 2:30 PM")).toMatchObject({ start: 870, title: "RENO 911!" });
    expect(cellTime("Dragon Ball Z: The Movie (1990) 8:35 PM")).toMatchObject({ start: 1235, title: "Dragon Ball Z: The Movie (1990)" });
    // Not a time: no time at either end, a title that starts with "Midnight", a time in the middle.
    expect(cellTime("see website")).toBeNull();
    expect(cellTime("Midnight Run")).toBeNull();
    expect(cellTime("News at 6pm on the hour")).toBeNull();
    expect(cellTime("6:30")).toMatchObject({ start: 390, title: "", sure: false });
    expect(bareTime("7:00 PM")).toMatchObject({ start: 1140 });
    expect(bareTime("Town News")).toBeNull();
  });

  it("skips a time without am or pm in a sheet that writes them, and reads 24-hour sheets as they are", () => {
    const twelve = read([`Mon,Tue`, `News 6:00 PM,News 6:00 PM`, `Film 7:30,Film 7:30 PM`].join("\n"));
    expect(rows(twelve.entries)).toEqual([
      ["mon", "18:00", null, "News"],
      ["tue", "18:00", "19:30", "News"],
      ["tue", "19:30", null, "Film"]
    ]);
    expect(twelve.skipped).toEqual([{ text: "Film 7:30", where: "Mon, row 3", why: "no_am_pm" }]);
    const day = read([`Mon,Tue`, `Morning 06:00,Morning 06:00`, `Midday 12:00,Midday 12:30`, `Evening 18:00,Evening 19:00`].join("\n"));
    expect(rows(day.entries).filter((r) => r[0] === "tue")).toEqual([
      ["tue", "06:00", "12:30", "Morning"],
      ["tue", "12:30", "19:00", "Midday"],
      ["tue", "19:00", null, "Evening"]
    ]);
  });

  it("repeats a sheet of weekdays without dates every week: the last show runs into the next day's first, Sunday's into Monday's", () => {
    const s = read(
      [`All times Central.`, `,Mon,Tue,Wed,Thu,Fri,Sat,Sun`, `,Wake Up 6:00 AM,Wake Up 6:00 AM,Wake Up 6:00 AM,Wake Up 6:00 AM,Wake Up 6:00 AM,Cartoons 7:00 AM,Cartoons 7:00 AM`, `,Lunch Live noon,Lunch Live noon,,,,,`, `,Late Movie 11:00 PM,Night Shift midnight,,,,,Overnight 2:00 AM`].join("\n")
    );
    expect(s).toMatchObject({ layout: "week_grid", weekly: true, firstDay: "Mon", lastDay: "Sun", firstDate: null, zone: "America/Chicago" });
    expect(rows(s.entries).filter((r) => r[0] === "mon" || r[0] === "tue" || r[0] === "sun")).toEqual([
      ["mon", "06:00", "12:00", "Wake Up"],
      ["mon", "12:00", "23:00", "Lunch Live"],
      // 7 hours before Tuesday's first start: no end.
      ["mon", "23:00", null, "Late Movie"],
      ["tue", "06:00", "12:00", "Wake Up"],
      ["tue", "12:00", "+00:00", "Lunch Live"],
      ["tue", "+00:00", "+06:00", "Night Shift"],
      // A blank cell under it: no end.
      ["sun", "07:00", null, "Cartoons"],
      // Sunday's last runs into Monday's first: the week wraps.
      ["sun", "+02:00", "+06:00", "Overnight"]
    ]);
    // Made for the next 14 days, every week, as a schedule entered by hand is.
    const airings = sheetAirings(s.entries, "America/Chicago", new Date("2026-10-07T05:00:00Z"), new Date("2026-10-21T05:00:00Z"));
    expect(airings.filter((a) => a.summary === "Late Movie").map((a) => a.start.toISOString())).toEqual(["2026-10-13T04:00:00.000Z", "2026-10-20T04:00:00.000Z"]);
    expect(airings.filter((a) => a.summary === "Overnight").map((a) => [a.start.toISOString(), a.end?.toISOString()])).toEqual([
      ["2026-10-12T07:00:00.000Z", "2026-10-12T11:00:00.000Z"],
      ["2026-10-19T07:00:00.000Z", "2026-10-19T11:00:00.000Z"]
    ]);
  });

  it("reads dates from December into January, each year the one nearest the day before", () => {
    const grid = [`Mon 12/28,Tue 12/29,Wed 12/30,Thu 12/31,Fri 1/1,Sat 1/2`, `A 6:00 PM,B 6:00 PM,C 6:00 PM,D 6:00 PM,E 6:00 PM,F 6:00 PM`].join("\n");
    expect(read(grid, "2026-12-20T12:00:00Z").entries.map((e) => e.date)).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(read(grid, "2027-01-02T12:00:00Z").entries.map((e) => e.date)).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("reads days written in other ways, and day-first dates when the numbers or weekdays say so", () => {
    expect(dayLabel("Monday 10/05")).toMatchObject({ day: "mon", date: { a: 10, b: 5 } });
    expect(dayLabel("Mon 10/5")).toMatchObject({ day: "mon" });
    expect(dayLabel("10/05 Monday")).toMatchObject({ day: "mon" });
    expect(dayLabel("Mon Oct 5")).toMatchObject({ day: "mon", date: { a: 10, b: 5, numeric: false } });
    expect(dayLabel("Monday, October 5th, 2026")).toMatchObject({ day: "mon", date: { year: 2026 } });
    expect(dayLabel("Thurs.")).toMatchObject({ day: "thu", date: null });
    expect(dayLabel("Monday Night Football")).toBeNull();
    expect(dayLabel("Trigun 6:00 AM")).toBeNull();
    expect(read([`Tue 13/10,Wed 14/10`, `News 6pm,News 6pm`].join("\n")).entries.map((e) => e.date)).toEqual(["2026-10-13", "2026-10-14"]);
    // 05/10 and 06/10 fit both ways; the weekdays (Monday, Tuesday) say 5 and 6 October.
    expect(read([`Mon 05/10,Tue 06/10`, `News 6pm,News 6pm`].join("\n")).entries.map((e) => e.date)).toEqual(["2026-10-05", "2026-10-06"]);
  });
});

describe("a grid with a column of times", () => {
  const GRID = [`Weekly schedule,,,`, `Time,Mon,Tue,Wed`, `6:00 PM,Town News,Town News,Town News`, `6:30 PM,,Garden Club,`, `7:00 PM,Council (live),,Book Talk`, `7:30 PM,,,`, `8:00 PM,Late News,Late News,Late News`].join("\n");

  it("runs each title to the next row's time; in a CSV a blank cell is nothing listed", () => {
    const s = read(GRID);
    expect(s).toMatchObject({ layout: "time_grid", weekly: true, firstDay: "Mon", lastDay: "Wed" });
    expect(rows(s.entries)).toEqual([
      ["mon", "18:00", "18:30", "Town News"],
      ["mon", "19:00", "19:30", "Council (live)"],
      ["mon", "20:00", null, "Late News"],
      ["tue", "18:00", "18:30", "Town News"],
      ["tue", "18:30", "19:00", "Garden Club"],
      ["tue", "20:00", null, "Late News"],
      ["wed", "18:00", "18:30", "Town News"],
      ["wed", "19:00", "19:30", "Book Talk"],
      ["wed", "20:00", null, "Late News"]
    ]);
  });

  it("runs a title merged down several rows (an .xlsx) through them", () => {
    const t = readSheet(xlsx({ rows: GRID.split("\n").map((l) => l.split(",")), merges: ["B5:B6"] }));
    const s = readSheetSchedule(t.rows, t.continues, new Date("2026-10-08T16:00:00Z"));
    expect(rows(s.entries).filter((r) => r[0] === "mon")).toEqual([
      ["mon", "18:00", "18:30", "Town News"],
      ["mon", "19:00", "20:00", "Council (live)"],
      ["mon", "20:00", null, "Late News"]
    ]);
  });
});

describe("a list, one airing a row", () => {
  it("finds its columns by their names, under a note, with an End, a Length, the next row's start, or none", () => {
    const s = read(
      [
        `Channel 12 listings,,,,,`,
        `Date,Start,End,Show,Episode,Length`,
        `10/05/2026,6:00 PM,6:30 PM,Evening News,,`,
        `10/05/2026,18:30,,Quiz Night,Round 3,45 min`,
        `10/05/2026,7:15 PM,,Movie Club,,`,
        `,,,,,`,
        `10/06/2026,noon,,Lunch Live,,`,
        `10/07/2026,midnight,,Overnight,,`,
        `10/07/2026,6:00,,Morning Show,,`,
        `10/07/2026,TBA,,Special,,`,
        `10/07/2026,7:00 AM,,,,`
      ].join("\n")
    );
    expect(s).toMatchObject({ layout: "list", weekly: false, firstDay: "10/05/2026", lastDay: "10/07/2026", firstDate: "2026-10-05", lastDate: "2026-10-07" });
    expect(rows(s.entries)).toEqual([
      ["2026-10-05", "18:00", "18:30", "Evening News"],
      ["2026-10-05", "18:30", "19:15", "Quiz Night"],
      // A blank row after it: no end.
      ["2026-10-05", "19:15", null, "Movie Club"],
      // The next start is 12 hours on: no end.
      ["2026-10-06", "12:00", null, "Lunch Live"],
      ["2026-10-07", "00:00", null, "Overnight"]
    ]);
    expect(s.skipped.map((x) => [x.text, x.why])).toEqual([
      ["10/07/2026 6:00 Morning Show", "no_am_pm"],
      ["10/07/2026 TBA Special", "no_time"],
      ["10/07/2026 7:00 AM", "no_title"]
    ]);
  });

  it("reads a weekly list by day, 24-hour times, a programme column and a date and time in one cell", () => {
    expect(rows(read([`Day,Time,Programme,Duration`, `Monday,18:00,News,30`, `Monday,19:30,Film,1h 45m`, `Tuesday,00:00,Night,`].join("\n")).entries)).toEqual([
      ["mon", "18:00", "18:30", "News"],
      ["mon", "19:30", "21:15", "Film"],
      ["tue", "00:00", null, "Night"]
    ]);
    expect(rows(read([`Starts,Title`, `2026-10-05 18:00,News`, `10/5/2026 7:00 PM,Film`].join("\n")).entries)).toEqual([
      ["2026-10-05", "18:00", "19:00", "News"],
      ["2026-10-05", "19:00", null, "Film"]
    ]);
    expect(durationMinutes("1:30")).toBe(90);
    expect(durationMinutes("01:30:00")).toBe(90);
    expect(durationMinutes("90 mins")).toBe(90);
    expect(durationMinutes("2 hours")).toBe(120);
    expect(durationMinutes("soon")).toBeNull();
  });

  it("skips a row with no day or date", () => {
    const s = read([`Start,Title`, `6:00 PM,News`].join("\n"));
    expect(s.entries).toEqual([]);
    expect(s.layout).toBeNull();
    expect(s.skipped).toEqual([{ text: "6:00 PM News", where: "row 2", why: "no_day" }]);
  });
});

describe("the time zone a sheet names", () => {
  it("reads its words, abbreviations and zone names; several named is none", () => {
    expect(zonesIn("non-profit broadcast. eastern standard time.", true)).toEqual([NY]);
    expect(zonesIn("All times Pacific", true)).toEqual(["America/Los_Angeles"]);
    expect(zonesIn("Schedule (EDT)", false)).toEqual([NY]);
    expect(zonesIn("Times in America/Chicago", false)).toEqual(["America/Chicago"]);
    expect(zonesIn("UTC", true)).toEqual(["UTC"]);
    expect(zonesIn("GMT-5", true)).toEqual(["Etc/GMT+5"]);
    // "ET" counts in a note, not in a show's title; words that only contain the letters never do.
    expect(zonesIn("Times are ET", true)).toEqual([NY]);
    expect(zonesIn("E.T. the Extra-Terrestrial", true)).toEqual([]);
    expect(zonesIn("BEST OF THE WEST", true)).toEqual([]);
    const both = read([`Feeds in ET and PT`, `Mon,Tue`, `News 6pm,News 6pm`].join("\n"));
    expect(both).toMatchObject({ zone: null, zonesNamed: [NY, "America/Los_Angeles"] });
    expect(read([`Mon,Tue`, `News 6pm,News 6pm`].join("\n")).zone).toBeNull();
  });
});

// ---- Files ----

/** A tiny .xlsx: one or more sheets of strings (shared and inline), with merges, styles and a formula. */
function xlsx(o: { rows: string[][]; merges?: string[]; sheets?: Array<{ name: string; rows: string[][]; hidden?: boolean }>; extraCells?: string }): Uint8Array {
  const sheets = o.sheets ?? [{ name: "Week", rows: o.rows }];
  const strings: string[] = [];
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types/>`),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    // Style 1: a date (m/d/yyyy); style 2: a time (h:mm AM/PM).
    "xl/styles.xml": strToU8(`<?xml version="1.0"?><styleSheet><numFmts><numFmt numFmtId="164" formatCode="h:mm AM/PM"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`)
  };
  sheets.forEach((s, n) => {
    const body = s.rows
      .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v === "" ? "" : r % 2 ? `<c r="${col(c)}${r + 1}" t="s"><v>${strings.push(v) - 1}</v></c>` : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join("")}</row>`)
      .join("");
    const merges = n === 0 && o.merges?.length ? `<mergeCells>${o.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData>${body}${n === 0 ? (o.extraCells ?? "") : ""}</sheetData>${merges}</worksheet>`);
  });
  files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}

/** A tiny .ods: one sheet, its cells as given (raw table:table-cell XML). */
function ods(name: string, rowsXml: string[]): Uint8Array {
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet><table:table table:name="${name}"><table:table-column table:number-columns-repeated="4"/>${rowsXml.map((r) => `<table:table-row>${r}</table:table-row>`).join("")}<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;
  return zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.spreadsheet"), "content.xml": strToU8(content) });
}
const cell = (text: string, attrs = "") => `<table:table-cell office:value-type="string"${attrs}><text:p>${text}</text:p></table:table-cell>`;

describe("spreadsheet files", () => {
  it("reads CSV quoting (commas, quotes and line breaks in a cell), a byte-order mark, CRLF, and Windows-1252", () => {
    expect(parseDelimited(`a,"b, ""c""\nd",e\r\nf,g,h`)).toEqual([["a", 'b, "c"\nd', "e"], ["f", "g", "h"]]);
    expect(readSheet(new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("Mon,Tue\n")])).rows).toEqual([["Mon", "Tue"]]);
    // "Café" in Windows-1252 (an old Excel CSV).
    expect(readSheet(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x78])).rows).toEqual([["Café", "x"]]);
  });

  it("reads a TSV (by name, or by its tabs) and a semicolon CSV", () => {
    expect(readSheet(strToU8("Mon\tTue\nNews 6pm\tNews 6pm"), { kind: "tsv" })).toMatchObject({ kind: "tsv", rows: [["Mon", "Tue"], ["News 6pm", "News 6pm"]] });
    expect(readSheet(strToU8("Mon\tTue\nNews, live 6pm\tNews 6pm"))).toMatchObject({ kind: "tsv", rows: [["Mon", "Tue"], ["News, live 6pm", "News 6pm"]] });
    expect(readSheet(strToU8("Mon;Tue\nNews 6pm;News 6pm")).rows).toEqual([["Mon", "Tue"], ["News 6pm", "News 6pm"]]);
  });

  it("reads an .xlsx's first visible sheet (or one by name): shared and inline strings, dates and times by their style, a formula's value, never the formula", () => {
    const book = xlsx({
      rows: [],
      sheets: [
        { name: "Old", rows: [["Mon", "Tue"], ["Ignored 6pm", "Ignored 6pm"]], hidden: true },
        { name: "This week", rows: [["Mon", "Tue"], ["News 6:00 PM", "News 6:00 PM"]] },
        { name: "Next week", rows: [["Wed", "Thu"], ["Film 8pm", "Film 8pm"]] }
      ]
    });
    expect(readSheet(book)).toMatchObject({ kind: "xlsx", tab: "This week", tabs: ["This week", "Next week"], rows: [["Mon", "Tue"], ["News 6:00 PM", "News 6:00 PM"]] });
    expect(readSheet(book, { tab: "next week" })).toMatchObject({ tab: "Next week", rows: [["Wed", "Thu"], ["Film 8pm", "Film 8pm"]] });
    expect(() => readSheet(book, { tab: "Last year" })).toThrow(expect.objectContaining({ code: "no_tab" }));
    // A date header (style 1, day 46300 is 2026-10-05), a time cell (style 2, 0.75 is 6:00 pm) and a
    // formula whose cached value is read (its formula would say something else).
    const dated = xlsx({
      rows: [],
      extraCells: `<row r="1"><c r="A1" s="1"><v>46300</v></c><c r="B1" s="1"><v>46301</v></c></row><row r="2"><c r="A2" s="2"><v>0.75</v></c><c r="B2" t="str"><f>CONCAT("Rm -rf ",A1)</f><v>Film 8:00 PM</v></c></row>`
    });
    expect(readSheet(dated).rows).toEqual([["2026-10-05", "2026-10-06"], ["18:00", "Film 8:00 PM"]]);
  });

  it("reads an .ods: repeated cells and rows (to the sheet's edge), spaces, line breaks, dates, times, a merged block, and leaves comments out", () => {
    const book = ods("Grid", [
      cell("Time") + `<table:table-cell office:value-type="date" office:date-value="2026-10-05"><text:p>Mon 5</text:p></table:table-cell>` + `<table:table-cell office:value-type="date" office:date-value="2026-10-06T00:00:00"><text:p>Tue 6</text:p></table:table-cell>`,
      `<table:table-cell office:value-type="time" office:time-value="PT18H00M00S"><text:p>6:00 PM</text:p></table:table-cell>` + cell("Town<text:s/>News", ' table:number-columns-repeated="2"'),
      `<table:table-cell office:value-type="time" office:time-value="PT18H30M00S"><text:p>6:30 PM</text:p></table:table-cell>` + cell("Council<text:line-break/>(live)", ' table:number-rows-spanned="2"') + cell(`Garden Club<office:annotation><text:p>ask about the date</text:p></office:annotation>`),
      `<table:table-cell office:value-type="time" office:time-value="PT19H00M00S"><text:p>7:00 PM</text:p></table:table-cell><table:covered-table-cell/>` + cell("Book Talk"),
      `<table:table-cell office:value-type="time" office:time-value="PT19H30M00S"><text:p>7:30 PM</text:p></table:table-cell>` + cell("Late News", ' table:number-columns-repeated="2"')
    ]);
    const t = readSheet(book);
    expect(t).toMatchObject({ kind: "ods", tab: "Grid", tabs: ["Grid"] });
    expect(t.rows).toEqual([
      ["Time", "2026-10-05", "2026-10-06"],
      ["18:00", "Town News", "Town News"],
      ["18:30", "Council\n(live)", "Garden Club"],
      ["19:00", "", "Book Talk"],
      ["19:30", "Late News", "Late News"]
    ]);
    const s = readSheetSchedule(t.rows, t.continues, new Date("2026-10-04T16:00:00Z"));
    expect(s.layout).toBe("time_grid");
    expect(rows(s.entries).filter((r) => r[0] === "2026-10-05")).toEqual([
      ["2026-10-05", "18:00", "18:30", "Town News"],
      ["2026-10-05", "18:30", "19:30", "Council (live)"],
      ["2026-10-05", "19:30", null, "Late News"]
    ]);
  });

  it("refuses an old .xls, a zip that isn't a workbook, a web page, and a workbook that unzips too big", () => {
    expect(() => readSheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toThrow(expect.objectContaining({ code: "old_excel" }));
    expect(() => readSheet(zipSync({ "readme.txt": strToU8("hello") }))).toThrow(expect.objectContaining({ code: "not_a_spreadsheet" }));
    expect(() => readSheet(strToU8("<!DOCTYPE html><html><body>Sign in</body></html>"))).toThrow(expect.objectContaining({ code: "web_page" }));
    expect(() => readSheet(strToU8(`{"events":[]}`))).toThrow(SheetError);
    const huge = zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": new Uint8Array(31 * 1024 * 1024) });
    expect(() => readSheet(huge)).toThrow(expect.objectContaining({ code: "not_a_spreadsheet" }));
  });
});

describe("hostile files", () => {
  it("stay quick: tags that never close, a block merged over the whole sheet, and a cell of separators", () => {
    const started = Date.now();
    const open = "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>".repeat(100_000);
    const book = zipSync({
      "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
      "xl/sharedStrings.xml": strToU8("<sst>" + "<si><t>".repeat(100_000) + "</sst>"),
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${open}</sheetData><mergeCells>${'<mergeCell ref="A1:GR5000"/>'.repeat(5000)}</mergeCells></worksheet>`)
    });
    expect(readSheet(book).rows).toEqual([]);
    const t = csv(`Mon,Tue\n"News ${" -".repeat(200_000)}x",News 6pm`);
    expect(readSheetSchedule(t.rows, t.continues, new Date("2026-10-08T16:00:00Z")).entries).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("spreadsheet links", () => {
  const PUB = "https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUpPublishedId_abc123";
  const SHARED = "https://docs.google.com/spreadsheets/d/1MadeUpSharedId-0123456789abc";

  it("turns a Google Sheet's published or shared link into its CSV export, keeping the tab", () => {
    expect(googleSheetCsvUrl(`${PUB}/pubhtml`)).toBe(`${PUB}/pub?output=csv`);
    expect(googleSheetCsvUrl(`${PUB}/pubhtml?gid=1528354567&single=true`)).toBe(`${PUB}/pub?output=csv&gid=1528354567`);
    expect(googleSheetCsvUrl(`${PUB}/pub?output=xlsx&gid=55`)).toBe(`${PUB}/pub?output=csv&gid=55`);
    expect(googleSheetCsvUrl(`${PUB}/pubhtml/sheet?headers=false&gid=77`)).toBe(`${PUB}/pub?output=csv&gid=77`);
    expect(googleSheetCsvUrl(`${SHARED}/edit#gid=456`)).toBe(`${SHARED}/export?format=csv&gid=456`);
    expect(googleSheetCsvUrl(`${SHARED}/edit?usp=sharing`)).toBe(`${SHARED}/export?format=csv`);
    expect(googleSheetCsvUrl(`${SHARED}/edit?gid=9#gid=9`)).toBe(`${SHARED}/export?format=csv&gid=9`);
    expect(googleSheetCsvUrl(`${SHARED}/view`)).toBe(`${SHARED}/export?format=csv`);
    expect(googleSheetCsvUrl("https://docs.google.com/spreadsheets/u/0/d/1MadeUpSharedId-0123456789abc/edit#gid=3")).toBe(`${SHARED}/export?format=csv&gid=3`);
    expect(googleSheetCsvUrl("https://docs.google.com/document/d/1MadeUpDocId-0123456789/edit")).toBeNull();
    expect(googleSheetCsvUrl("https://sheets.example.org/spreadsheets/d/1MadeUpSharedId-0123456789abc/edit")).toBeNull();
  });

  it("knows a spreadsheet by its address, its type or its bytes, and a feed is still a feed", () => {
    for (const u of [`${PUB}/pubhtml`, "https://attic.example.org/week.csv", "https://attic.example.org/week.TSV", "https://attic.example.org/week.xlsx?dl=1", "https://attic.example.org/week.ods"]) expect(isSheetAddress(u)).toBe(true);
    expect(isSheetAddress("https://attic.example.org/calendar.ics")).toBe(false);
    expect(sheetFragment("https://attic.example.org/week.xlsx#sheet=Week%202")).toBe("Week 2");
    expect(detectScheduleFormat("https://attic.example.org/download", "text/csv; charset=utf-8", "Mon,Tue\n")).toBe("sheet");
    expect(detectScheduleFormat("https://attic.example.org/download", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK\u0003\u0004")).toBe("sheet");
    expect(detectScheduleFormat("https://attic.example.org/download", "application/octet-stream", "PK\u0003\u0004…")).toBe("sheet");
    expect(detectScheduleFormat("https://attic.example.org/download", "text/plain", "Day,Time,Show\nMonday,18:00,News\n")).toBe("sheet");
    expect(detectScheduleFormat("https://attic.example.org/feed", "text/plain", '<?xml version="1.0"?><rss><channel><item><title>A, B</title></item></channel></rss>')).toBe("rss");
    expect(detectScheduleFormat("https://attic.example.org/feed.json", null, '{"events":[]}')).toBe("json");
  });

  it("says a Google Sheet that isn't public isn't, for a 'not found' or a sign-in page; another address that fails isn't found", async () => {
    const now = new Date("2026-10-08T16:00:00Z");
    const answer = (res: () => Response): Fetch => (async () => res()) as Fetch;
    const notFound = answer(() => new Response("<!DOCTYPE html><html>Sorry, unable to open the file</html>", { status: 404, headers: { "content-type": "text/html" } }));
    const signIn = answer(() => new Response("<!doctype html><html><head><title>Sign in - Google Accounts</title></head></html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
    for (const fn of [notFound, signIn]) {
      await expect(readScheduleAt(`${SHARED}/edit#gid=1`, null, fn, {}, NY, now)).rejects.toMatchObject({ code: "not_public" });
    }
    await expect(readScheduleAt("https://attic.example.org/week.csv", null, notFound, {}, NY, now)).rejects.toMatchObject({ code: "calendar_not_found" });
    await expect(readScheduleAt("https://attic.example.org/week.csv", null, signIn, {}, NY, now)).rejects.toBeInstanceOf(ScheduleReadError);
    // The tab is kept: the fetch is for the CSV export of gid 1.
    const asked: string[] = [];
    const fn = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(WEEK, { headers: { "content-type": "text/csv" } });
    }) as Fetch;
    const got = await readScheduleAt(`${PUB}/pubhtml?gid=1`, null, fn, {}, NY, now);
    expect(asked).toEqual([`${PUB}/pub?output=csv&gid=1`]);
    expect(got).toMatchObject({ format: "sheet", gid: "1", table: { kind: "google_sheet" }, sheet: { layout: "week_grid", zone: NY } });
  });
});

// ---- On the desk, the dial and the guide ----

describe("a spreadsheet as a listing's schedule", () => {
  let h: Harness;
  let dee: User;
  let viewer: User;
  let marketId: string;
  const ids: Record<string, string> = {};
  const PUB = "https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUpAtticChannel_xyz/pubhtml?gid=7";
  const EXPORT = "https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUpAtticChannel_xyz/pub?output=csv&gid=7";
  let sheet = WEEK;
  let shared = true;
  const fn = (async (input: RequestInfo | URL) => {
    if (String(input) !== EXPORT) throw new TypeError("fetch failed");
    return shared ? new Response(sheet, { headers: { "content-type": "text/csv" } }) : new Response("<!DOCTYPE html><html>Sign in</html>", { status: 404, headers: { "content-type": "text/html" } });
  }) as Fetch;
  const airings = async (id: string) =>
    (await h.db.select().from(schema.listedAirings).where(eq(schema.listedAirings.listedSourceId, id)).orderBy(asc(schema.listedAirings.startsAt))).map((a) => [a.title, a.startsAt.toISOString(), a.endsAt?.toISOString() ?? null]);
  const listing = async (id: string) => (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((s: { id: string }) => s.id === id);
  const listIt = async (channel: string, callSign: string, name: string) =>
    (
      await dee
        .post("/v1/admin/listed-sources", { marketId, band: "tv", channel, callSign, name, streamUrl: `https://attic.example.org/${callSign.toLowerCase()}/index.m3u8`, plays: "stream_link", evidence: { publicBasis: "A volunteer channel's public stream" } })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    h = await createHarness({ externalFetch: fn });
    // Thursday, October 8, 9:00 am in the Inland Empire (Pacific).
    h.clock.set("2026-10-08T16:00:00.000Z");
    dee = await h.signIn("Dee A.", { admin: true });
    viewer = await h.signIn("Vi");
    marketId = (await market(h)).id;
  }, 60_000);
  afterAll(() => h.close());

  it("reads a Google Sheet's link on save: its shows on their dates, in the zone the sheet names, what was read for the desk", async () => {
    ids.ATIC = await listIt("46.1", "ATIC", "Attic Channel");
    const saved = await h.services.network.updateListedSource(null, ids.ATIC, { schedule: { source: "feed", calendarUrl: PUB } }, fn);
    expect(saved).toMatchObject({
      calendarSync: "synced",
      upcoming: 20,
      schedule: {
        source: "feed",
        format: "sheet",
        url: PUB,
        timeZone: null,
        file: null,
        sheet: { kind: "google_sheet", tab: null, gid: "7", layout: "week_grid", shows: 20, weekly: false, firstDay: "Friday 10/09", lastDay: "Sunday 10/11", firstDate: "2026-10-09", lastDate: "2026-10-11", timeZone: NY, timeZoneFrom: "sheet", zonesNamed: [], skippedCount: 2 }
      }
    });
    expect(saved.schedule!.sheet!.skipped.map((s) => s.why)).toEqual(["out_of_order", "no_time"]);
    expect((await airings(ids.ATIC)).slice(0, 2)).toEqual([
      ["Space Rangers", "2026-10-09T10:00:00.000Z", "2026-10-09T10:25:00.000Z"],
      ["Office Dogs", "2026-10-09T10:25:00.000Z", null]
    ]);
    // In the guide, in the market's own time (Pacific): 6:00 am Eastern is 3:00 am there.
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-10-09T09:00:00.000Z&to=2026-10-09T12:00:00.000Z").expect(200);
    const row = guide.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "ATIC");
    expect(row.airings.map((a: { title: string; startsAt: string }) => [a.title, a.startsAt])).toEqual([
      ["Space Rangers", "2026-10-09T10:00:00.000Z"],
      ["Office Dogs", "2026-10-09T10:25:00.000Z"]
    ]);
    // To apps it's the source's own schedule: a feed.
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    expect(dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "ATIC").external).toMatchObject({ schedule: "feed" });
  });

  it("reads it again hourly, in the listing's own time zone once one is set", async () => {
    sheet = WEEK.replace("Space Rangers 6:00 AM", "Space Rangers Marathon 6:00 AM");
    h.clock.advance(60 * 60_000);
    await h.services.network.syncExternalSchedules({ fetch: fn });
    expect((await airings(ids.ATIC))[0]).toEqual(["Space Rangers Marathon", "2026-10-09T10:00:00.000Z", "2026-10-09T10:25:00.000Z"]);
    const res = await h.services.network.updateListedSource(null, ids.ATIC, { schedule: { source: "feed", calendarUrl: PUB, timeZone: "America/Chicago" } }, fn);
    expect(res.schedule).toMatchObject({ timeZone: "America/Chicago", sheet: { timeZone: "America/Chicago", timeZoneFrom: "listing" } });
    expect((await airings(ids.ATIC))[0]).toEqual(["Space Rangers Marathon", "2026-10-09T11:00:00.000Z", "2026-10-09T11:25:00.000Z"]);
    const [change] = (await dee.get(`/v1/admin/listed-sources/${ids.ATIC}/changes`).expect(200)).body;
    expect(change.fields).toEqual([{ field: "scheduleTimeZone", from: null, to: "America/Chicago" }]);
  });

  it("says when the sheet stops being public, and keeps what it listed", async () => {
    shared = false;
    h.clock.advance(60 * 60_000);
    await h.services.network.syncExternalSchedules({ fetch: fn });
    expect(await listing(ids.ATIC)).toMatchObject({ calendarSync: "not_public", upcoming: 20 });
    shared = true;
  });

  it("previews a link without saving it, in the market's zone unless the sheet names one", async () => {
    const preview = await h.services.network.previewListedSchedule({ calendarUrl: PUB, marketId }, null, fn);
    expect(preview).toMatchObject({ format: "sheet", upcoming: 20, timeZone: NY, sheet: { layout: "week_grid", shows: 20, timeZoneFrom: "sheet" } });
    expect(preview.airings).toHaveLength(8);
    expect(preview.airings[0]).toEqual({ title: "Space Rangers Marathon", startsAt: "2026-10-09T10:00:00.000Z", endsAt: "2026-10-09T10:25:00.000Z" });
    shared = false;
    await expect(h.services.network.previewListedSchedule({ calendarUrl: PUB }, null, fn)).rejects.toMatchObject({ status: 422, code: "not_public" });
    shared = true;
    // Through the API (multipart, as the desk sends it).
    const res = await dee.post("/v1/admin/listed-sources/schedule-preview").field("calendarUrl", PUB).field("marketId", marketId).expect(200);
    expect(res.body).toMatchObject({ format: "sheet", sheet: { firstDay: "Friday 10/09" } });
    await dee.post("/v1/admin/listed-sources/schedule-preview").field("marketId", marketId).expect(400);
  });

  describe("an uploaded file", () => {
    const WEEKLY = [`All times Pacific`, `,Mon,Tue,Wed,Thu,Fri,Sat,Sun`, `,Morning Show 7:00 AM,Morning Show 7:00 AM,Morning Show 7:00 AM,Morning Show 7:00 AM,Morning Show 7:00 AM,Cartoons 8:00 AM,Cartoons 8:00 AM`, `,Movie 8:00 PM,Movie 8:00 PM,Movie 8:00 PM,Movie 8:00 PM,Movie 8:00 PM,Movie 9:00 PM,Movie 9:00 PM`].join("\n");
    const upload = (who: User, body: Buffer | Uint8Array, name: string, fields: Record<string, string> = {}) => {
      let req = who.post(`/v1/admin/listed-sources/${ids.WEEK}/schedule-file`).attach("file", Buffer.from(body), name);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    };

    it("is for admins, a spreadsheet, 2 MB at most, with shows in it", async () => {
      ids.WEEK = await listIt("47.1", "LOOP", "Loop Channel");
      await anon(h).post(`/v1/admin/listed-sources/${ids.WEEK}/schedule-file`).attach("file", Buffer.from(WEEKLY), "week.csv").expect(401);
      await upload(viewer, strToU8(WEEKLY), "week.csv").expect(403);
      // Cut off as it arrives (2026-10-06): 413, in the endpoint's own words.
      const big = await upload(dee, Buffer.alloc(2 * 1024 * 1024 + 1, 0x41), "week.csv").expect(413);
      expect(big.body.error).toMatchObject({ code: "too_big", message: "Use a file of 2 MB or less." });
      expect((await upload(dee, strToU8("%PDF-1.4"), "week.pdf").expect(422)).body.error.code).toBe("not_a_spreadsheet");
      expect((await upload(dee, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), "week.xls").expect(422)).body.error.code).toBe("old_excel");
      expect((await upload(dee, strToU8("Our schedule is on the website\n,\n"), "week.csv").expect(422)).body.error.code).toBe("no_event_data");
      await dee.post(`/v1/admin/listed-sources/${ids.WEEK}/schedule-file`).expect(400);
      // Nothing was saved by any of them.
      expect(await listing(ids.WEEK)).toMatchObject({ schedule: { source: "none" }, upcoming: 0 });
      expect((await dee.get(`/v1/admin/listed-sources/${ids.WEEK}/changes`).expect(200)).body).toEqual([]);
    });

    it("keeps what was read as the listing's schedule, a weekday sheet every week for the next 14 days, and its history", async () => {
      const res = await upload(dee, strToU8(WEEKLY), "attic-week.csv").expect(200);
      expect(res.body).toMatchObject({
        calendarSync: "synced",
        calendarUrl: null,
        // Thursday 9:00 am to two weeks on: 10 weekday mornings and nights, 4 weekend ones each.
        upcoming: 28,
        schedule: {
          source: "file",
          format: "sheet",
          file: { name: "attic-week.csv", kind: "csv", bytes: WEEKLY.length, uploadedAt: "2026-10-08T18:00:00.000Z", uploadedBy: "Dee A." },
          sheet: { layout: "week_grid", weekly: true, shows: 14, firstDay: "Mon", lastDay: "Sun", timeZone: "America/Los_Angeles", timeZoneFrom: "sheet" }
        }
      });
      const [change] = (await dee.get(`/v1/admin/listed-sources/${ids.WEEK}/changes`).expect(200)).body;
      expect(change).toMatchObject({ by: "Dee A.", effects: ["schedule_reread"] });
      expect(change.fields).toEqual([
        { field: "schedule", from: "none", to: "file" },
        { field: "scheduleFile", from: null, to: "attic-week.csv, 14 shows" }
      ]);
      // The morning show on now (to the 8:00 pm movie), then the movie (nothing listed after it within 6 hours).
      expect((await airings(ids.WEEK)).slice(0, 3)).toEqual([
        ["Morning Show", "2026-10-08T14:00:00.000Z", "2026-10-09T03:00:00.000Z"],
        ["Movie", "2026-10-09T03:00:00.000Z", null],
        ["Morning Show", "2026-10-09T14:00:00.000Z", "2026-10-10T03:00:00.000Z"]
      ]);
      // To apps, a feed.
      const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
      expect(dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "LOOP").external).toMatchObject({ schedule: "feed" });
    });

    it("rolls forward hourly, and takes a new time zone without uploading again", async () => {
      h.clock.set("2026-10-12T18:00:00.000Z");
      await h.services.network.syncExternalSchedules({ fetch: fn });
      const after = await airings(ids.WEEK);
      expect(after.at(-1)![1]! > "2026-10-25T00:00:00.000Z").toBe(true);
      const res = await dee.patch(`/v1/admin/listed-sources/${ids.WEEK}`, { schedule: { source: "file", timeZone: NY } }).expect(200);
      expect(res.body.schedule).toMatchObject({ source: "file", timeZone: NY, file: { name: "attic-week.csv" }, sheet: { timeZone: NY, timeZoneFrom: "listing" } });
      const fromNow = (await airings(ids.WEEK)).filter((a) => (a[2] ?? a[1])! > "2026-10-12T18:00:00.000Z");
      expect(fromNow.slice(0, 2)).toEqual([
        ["Morning Show", "2026-10-12T11:00:00.000Z", "2026-10-13T00:00:00.000Z"],
        ["Movie", "2026-10-13T00:00:00.000Z", null]
      ]);
      // A listing without a file can't keep one.
      expect((await dee.patch(`/v1/admin/listed-sources/${ids.ATIC}`, { schedule: { source: "file" } }).expect(409)).body.error.code).toBe("no_file");
    });

    it("reads an .xlsx's tab by name, and is given up for another schedule in the history", async () => {
      const book = xlsx({ rows: [], sheets: [{ name: "Notes", rows: [["Nothing here"]] }, { name: "Grid", rows: [["Mon", "Tue"], ["News 6:00 PM", "News 6:00 PM"]] }] });
      expect((await upload(dee, book, "week.xlsx").expect(422)).body.error.code).toBe("no_event_data");
      const res = await upload(dee, book, "week.xlsx", { sheet: "Grid", timeZone: "America/Denver" }).expect(200);
      expect(res.body.schedule).toMatchObject({ timeZone: "America/Denver", file: { name: "week.xlsx", kind: "xlsx" }, sheet: { tab: "Grid", tabs: ["Notes", "Grid"], shows: 2, timeZoneFrom: "listing" } });
      const back = await dee.patch(`/v1/admin/listed-sources/${ids.WEEK}`, { schedule: { source: "none" } }).expect(200);
      expect(back.body.schedule).toMatchObject({ source: "none", file: null, sheet: null, timeZone: null });
      const [change] = (await dee.get(`/v1/admin/listed-sources/${ids.WEEK}/changes`).expect(200)).body;
      expect(change.fields).toEqual([
        { field: "schedule", from: "file", to: "none" },
        { field: "scheduleFile", from: "week.xlsx, 2 shows", to: null },
        { field: "scheduleTimeZone", from: "America/Denver", to: null }
      ]);
    });

    it("previews an upload without keeping it", async () => {
      const res = await dee.post("/v1/admin/listed-sources/schedule-preview").attach("file", Buffer.from(WEEKLY), "week.csv").field("sourceId", ids.WEEK!).expect(200);
      expect(res.body).toMatchObject({ format: "sheet", sheet: { kind: "csv", weekly: true, shows: 14 }, timeZone: "America/Los_Angeles" });
      expect(res.body.airings).toHaveLength(8);
      expect(await listing(ids.WEEK)).toMatchObject({ schedule: { source: "none" } });
    });
  });
});
