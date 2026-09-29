import { describe, expect, it } from "vitest";
import { capCells, capMinutes, fillOrder, ladder, moveFill, placeFill, ruleLabel, spotMsPerBreak } from "./breakRule";

describe("what fills every break (station-settings 02.1)", () => {
  it("keeps the station ID last, whatever it's given", () => {
    expect(fillOrder(["SID", "UND", "SPT", "BMP"])).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(fillOrder(["SPT"])).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(fillOrder(["PGM", "BMP", "BMP", "OPEN"])).toEqual(["BMP", "SPT", "UND", "SID"]);
  });

  it("moves a part up or down, but never past the station ID", () => {
    const order = ["SPT", "UND", "BMP", "SID"] as const;
    expect(moveFill(order, "UND", -1)).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(moveFill(order, "BMP", 1)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(moveFill(order, "SPT", -1)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(moveFill(order, "SID", -1)).toEqual(["SPT", "UND", "BMP", "SID"]);
  });

  it("places a dragged part, and a drop on the station ID lands above it", () => {
    const order = ["SPT", "UND", "BMP", "SID"] as const;
    expect(placeFill(order, "BMP", 0)).toEqual(["BMP", "SPT", "UND", "SID"]);
    expect(placeFill(order, "SPT", 3)).toEqual(["UND", "BMP", "SPT", "SID"]);
  });

  it("gives spots what the fixed parts leave of the break", () => {
    expect(spotMsPerBreak({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"] })).toBe(90_000);
    expect(spotMsPerBreak({ lengthMs: 20_000, fillOrder: ["SPT", "UND", "BMP", "SID"] })).toBe(0);
  });

  it("draws the ladder as the frame does", () => {
    const rows = ladder({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"] });
    expect(rows.map((r) => [r.n, r.code, r.time])).toEqual([
      [1, "SPT", "0:00 – 1:30"],
      [2, "UND", ":15"],
      [3, "BMP", ":10"],
      [4, "SID", ":05"]
    ]);
    expect(rows[3]!.detail).toBe("Always last, can't be removed");
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
