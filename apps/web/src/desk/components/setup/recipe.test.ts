// A recipe's day (network-desk 04.1) and tonight's schedule in the message (03.1).
import { describe, expect, it } from "vitest";
import { seedRecipes } from "../../mocks/fixtures/recipes";
import { seedWorks } from "../../mocks/fixtures/creators";
import type { CreatorWorkX } from "../../api/ext";
import { interleave } from "../ask/works";
import { blockLabel, breakLine, breakRuleOf, clockOfMinutes, daySegments, hoursBySource, tonightSchedule } from "./recipe";

const [cooking, films] = seedRecipes();

describe("the recipe day", () => {
  it("fills 24 hours: her videos 13, the carried program 1, the catalog 10", () => {
    expect(hoursBySource(cooking!)).toEqual({ creator: 13, carried: 1, catalog: 10, total: 24 });
    expect(hoursBySource(films!).total).toBe(24);
  });

  it("runs the bar from 6 am in the frame's order and widths", () => {
    const segs = daySegments(cooking!);
    expect(segs.map((s) => [blockLabel(s.block, "Lupe"), s.minutes / 60])).toEqual([
      ["Catalog", 2], ["Lupe's kitchen", 4], ["CIVC", 1], ["Lupe's kitchen", 5], ["Catalog films", 4], ["Lupe, repeats", 4], ["Catalog, overnight", 4]
    ]);
  });

  it("says the break rule in words", () => {
    expect(breakLine(breakRuleOf(cooking!))).toBe("Every 30 min, 2:00, spots from the market, never alcohol");
    expect(breakLine({})).toBe("The market's usual breaks");
  });
});

describe("tonight, if they say yes", () => {
  it("is the frame's: a film, a park session, then the catalog", () => {
    const works = seedWorks()
      .filter((w) => w.creatorId === "00000000-0000-4000-8000-000000000202" && !w.leftOutReason)
      .map((w) => ({ ...w, covered: "none" }) as CreatorWorkX);
    const rows = tonightSchedule(films!, interleave(works));
    expect(rows.map((r) => `${clockOfMinutes(r.at)} ${r.title}`)).toEqual(["7:00 pm Joshua Tree, full film", "8:10 pm Park sessions: Palm Springs", "8:30 pm Classic films from the catalog"]);
  });
});
