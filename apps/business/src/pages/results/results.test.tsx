// The Results pages' rules: the statement's words and rows, and the results each period answers.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../config", () => ({ config: { mock: true, apiBase: "", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" } }));

const { balanceRows, statementWords } = await import("./Statement");
const { buildResults, rangeFor, weekOf } = await import("../../mocks/handlers/results");
const { statementsOf } = await import("../../mocks/fixtures/results");
const { OSC_ID } = await import("../../mocks/fixtures/businesses");
const { getDb, move } = await import("../../mocks/db");
const { can } = await import("../../business/abilities");

const $ = (d: number) => Math.round(d * 1_000_000);
const NOW = new Date("2026-09-27T03:42:12Z");
const asStatement = (s: ReturnType<typeof statementsOf>[number]) => ({ ...s, period: "month" as const, csvUrl: "", pdfUrl: null, lines: s.lines.map((l) => ({ ...l, notSetYet: false })) });

describe("the statement page", () => {
  it("says the month in progress and when the final one is ready", () => {
    const [sept, aug] = statementsOf(OSC_ID, NOW).map(asStatement);
    expect(statementWords(sept!, "Orange Street Coffee")).toEqual({
      title: "September statement",
      description: "Orange Street Coffee. September 1 to 26 so far; the final statement is ready October 1."
    });
    expect(statementWords(aug!, "Orange Street Coffee").description).toBe("Orange Street Coffee. August 1 to 31.");
  });

  it("starts and ends with the balance, returns shown but not added in", () => {
    const rows = balanceRows(asStatement(statementsOf(OSC_ID, NOW)[0]!));
    expect(rows.map((r) => [r.title, r.amount])).toEqual([
      ["Started the month", $(175.6)],
      ["Added", $(500)],
      ["Spent on airings", -$(248.9)],
      ["Returned from short airings", $(1.86)],
      ["Fees", 0],
      ["Balance now", $(426.7)]
    ]);
    expect(rows[3]!.quiet).toBe(true);
    expect(rows[5]).toMatchObject({ total: true, detail: "$412.50 available, $14.20 held" });
  });
});

describe("results by period", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("answers the month as the frame draws it", () => {
    const r = buildResults(OSC_ID, rangeFor(q("month=2026-09"), OSC_ID, NOW), NOW);
    expect([r.totals.airings, r.totals.spentMicros, r.totals.customers, r.from, r.to]).toEqual([118, $(248.9), 37, "2026-09-01", "2026-09-26"]);
    expect(r.byStation.map((s) => [s.station.callSign, s.airings, s.spentMicros, s.customers, s.category])).toEqual([
      ["BEAT", 62, $(127.97), 21, "Music"],
      ["CIVC", 31, $(81.84), 9, "Public affairs"],
      ["SAZN", 25, $(39.09), 7, "Food"]
    ]);
    expect(r.byDaypart.map((d) => [d.daypart, d.airings, d.customers])).toEqual([
      ["afternoons", 38, 7],
      ["evenings", 80, 30]
    ]);
    expect(r.bySpot.map((s) => [s.title, s.airings, s.customers])).toEqual([
      ["Fall menu", 94, 31],
      ["Pumpkin latte", 24, 6]
    ]);
    const orange = r.codes.find((c) => c.code === "ORANGE10")!;
    expect([orange.scans, orange.saves, orange.uses, orange.usesBy]).toEqual([214, 61, 31, { clearPay: 24, marked: 7, online: null }]);
    expect(orange.savedMostFrom?.callSign).toBe("BEAT");
    expect(r.airings[0]).toMatchObject({ tunedIn: 262, costMicros: $(2.1), scansNextHour: 4, inFull: true, proofCapturedAt: "2026-09-27T03:28:45.000Z" });
  });

  it("answers the week of September 20 as the Monday summary does", () => {
    const range = rangeFor(q("period=week"), OSC_ID, NOW);
    expect([range.from, range.to, weekOf("2026-09-26")]).toEqual(["2026-09-20", "2026-09-26", "2026-09-20"]);
    const r = buildResults(OSC_ID, range, NOW);
    expect([r.totals.airings, r.totals.spentMicros, r.totals.customers]).toEqual([31, $(64.02), 11]);
    expect(r.byStation.map((s) => [s.station.callSign, s.airings, s.customers])).toEqual([
      ["BEAT", 17, 6],
      ["CIVC", 8, 3],
      ["SAZN", 6, 2]
    ]);
  });

  it("answers all time from August 1, with Summer cold brew", () => {
    const r = buildResults(OSC_ID, rangeFor(q("period=all"), OSC_ID, NOW), NOW);
    expect([r.from, r.totals.airings, r.totals.spentMicros]).toEqual(["2026-08-01", 214, $(489.3)]);
  });

  it("reads an airing the Spots area's mock makes, telling spots of one length apart by rate", () => {
    const colton = getDb().spots.find((s) => s.title === "Now open in Colton")!;
    colton.state = "in_rotation";
    move(OSC_ID, { kind: "aired", label: "Aired on BEAT 12.1", amountMicros: -$(4), detail: ":30 spot, 150 tuned in, $4.00 an airing" });
    const r = buildResults(OSC_ID, rangeFor(q(""), OSC_ID, new Date(Date.now() + 1)), new Date(Date.now() + 1));
    expect(r.bySpot.find((s) => s.title === "Now open in Colton")?.airings).toBe(1);
  });
});

describe("who can redeem", () => {
  it("is owners and managers; viewers see results only", () => {
    expect([can("owner", "advertise"), can("manager", "advertise"), can("viewer", "advertise"), can("viewer", "see")]).toEqual([true, true, false, true]);
  });
});
