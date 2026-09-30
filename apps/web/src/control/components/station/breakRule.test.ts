import { describe, expect, it } from "vitest";
import { cadenceDetail, cadenceFromKey, cadenceKey, cadenceOf, cadenceOptions, cadenceWords, capCells, capMinutes, fillOrder, ladder, ladderWithPartners, moveFill, placeFill, ruleLabel, spotMsPerBreak } from "./breakRule";

describe("what fills every break (station-settings 02.1)", () => {
  it("keeps the bumper and the station ID last, whatever it's given", () => {
    expect(fillOrder(["SID", "UND", "SPT", "BMP"])).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(fillOrder(["SPT"])).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(fillOrder(["PGM", "BMP", "BMP", "OPEN"])).toEqual(["SPT", "UND", "BMP", "SID"]);
  });

  it("moves a part up or down, but never past the station ID", () => {
    const order = ["SPT", "UND", "BMP", "SID"] as const;
    expect(moveFill(order, "UND", -1)).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(moveFill(order, "BMP", 1)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(moveFill(order, "SPT", -1)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(moveFill(order, "SID", -1)).toEqual(["SPT", "UND", "BMP", "SID"]);
  });

  it("places a dragged part among the spots and the credit; the bumpers and a drop past them land above the bumper out", () => {
    const order = ["SPT", "UND", "BMP", "SID"] as const;
    expect(placeFill(order, "BMP", 0)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(placeFill(order, "SPT", 3)).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(placeFill(order, "UND", 0)).toEqual(["UND", "SPT", "BMP", "SID"]);
  });

  it("puts ads from partners at step 4 of 6, before the bumper out of the break, as the reference now draws it (A151)", () => {
    const rows = ladderWithPartners({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"], adsFromPartners: false });
    expect(rows.map((r) => [r.n, r.code, r.title])).toEqual([
      [1, "BMP", "A bumper into the break"],
      [2, "SPT", "Spots from your rotation"],
      [3, "UND", "Thank-you credit"],
      [4, "SPT", "Ads from partners"],
      [5, "BMP", "A bumper out of the break"],
      [6, "SID", "Station ID"]
    ]);
    expect(rows[3]).toMatchObject({ partner: true, detail: "Off. Only time still open", time: "0:00 – 1:00" });
  });

  it("gives spots what the fixed parts leave of the break (a bumper at each end)", () => {
    expect(spotMsPerBreak({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"] })).toBe(80_000);
    expect(spotMsPerBreak({ lengthMs: 20_000, fillOrder: ["SPT", "UND", "BMP", "SID"] })).toBe(0);
  });

  it("draws the ladder: a bumper into the break, the spots and credit in the station's order, a bumper out, the station ID", () => {
    const rows = ladder({ lengthMs: 120_000, fillOrder: ["UND", "SPT", "BMP", "SID"] });
    expect(rows.map((r) => [r.n, r.code, r.time, r.fillIndex])).toEqual([
      [1, "BMP", ":10", null],
      [2, "UND", ":15", 0],
      [3, "SPT", "0:00 – 1:20", 1],
      [4, "BMP", ":10", null],
      [5, "SID", ":05", null]
    ]);
    expect(rows.map((r) => r.title)).toEqual(["A bumper into the break", "Thank-you credit", "Spots from your rotation", "A bumper out of the break", "Station ID"]);
    expect(rows[4]!.detail).toBe("Always last, can't be removed");
  });
});

describe("how much advertising", () => {
  it("fills a cell a minute against broadcast TV's 16", () => {
    const cells = capCells(180_000);
    expect(cells).toHaveLength(16);
    expect(cells.filter(Boolean)).toHaveLength(3);
    expect(capMinutes(180_000)).toBe("3");
    expect(capMinutes(150_000)).toBe("2.5");
  });

  it("labels the break rule", () => {
    expect(ruleLabel("every_n_minutes", 30)).toBe("Every 30 min");
    expect(ruleLabel("every_n_minutes", null)).toBe("Every 30 min");
    expect(ruleLabel("after_every_program", null)).toBe("After every program");
    expect(ruleLabel("none", null)).toBe("None");
  });
});

describe("how often the station ID, bumpers, credit and spots air (added 2026-09-29)", () => {
  it("reads a rule without a cadence as every break, and says each choice in words", () => {
    expect(cadenceOf({})).toEqual({ stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } });
    // A rule saved before spots had a choice: every break.
    expect(cadenceOf({ cadence: { stationId: { every: "hour" }, bumpers: { every: "break" }, underwriting: { every: "break" } } }).spots).toEqual({ every: "break" });
    expect(cadenceOf({ cadence: { stationId: { every: "hour" }, bumpers: { every: "never" }, underwriting: { every: "n_programs", n: 3 } } }).underwriting).toEqual({ every: "n_programs", n: 3 });
    expect(cadenceWords({ every: "break" })).toBe("In every break");
    expect(cadenceWords({ every: "program" })).toBe("After every program");
    expect(cadenceWords({ every: "n_programs", n: 3 })).toBe("After every 3 programs");
    expect(cadenceWords({ every: "hour" })).toBe("Once an hour");
    expect(cadenceWords({ every: "never" })).toBe("Never");
  });

  it("offers never for bumpers and the credit, not the station ID", () => {
    expect(cadenceOptions("stationId").map((o) => o.label)).toEqual(["In every break", "After every program", "After every 2 programs", "After every 3 programs", "After every 4 programs", "Once an hour"]);
    expect(cadenceOptions("bumpers").at(-1)).toEqual({ value: "never", label: "Never" });
    expect(cadenceOptions("underwriting").at(-1)).toEqual({ value: "never", label: "Never" });
    expect(cadenceOptions("spots").map((o) => o.value)).toEqual(["break", "program", "n:2", "n:3", "n:4", "hour", "never"]);
  });

  it("goes to a select's value and back", () => {
    for (const c of [{ every: "break" }, { every: "program" }, { every: "n_programs", n: 4 }, { every: "hour" }, { every: "never" }] as const) expect(cadenceFromKey(cadenceKey(c))).toEqual(c);
    expect(cadenceDetail("stationId", { every: "hour" })).toBe("Last in the first break after the top of the hour");
    expect(cadenceDetail("bumpers", { every: "never" })).toBe("No bumpers in breaks");
    expect(cadenceDetail("bumpers", { every: "break" })).toBe("One into the break and one out of it");
    expect(cadenceDetail("spots", { every: "break" })).toBe("In every break, up to the hourly cap");
    expect(cadenceDetail("spots", { every: "hour" })).toBe("Up to the hourly cap. Other breaks are only as long as the rest needs");
    expect(cadenceDetail("spots", { every: "never" })).toBe("Breaks are only as long as the rest needs. Nothing is sold in them");
  });
});
