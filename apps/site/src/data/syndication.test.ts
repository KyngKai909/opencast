import { describe, expect, it } from "vitest";
import { FILTER_OPTIONS, FILTER_START, filterPrograms, fitCount, showCount } from "./syndication";

const f = (o: Partial<typeof FILTER_START>) => filterPrograms({ ...FILTER_START, ...o });

describe("the syndication market", () => {
  it("shows all 11 examples to start", () => {
    expect(f({}).length).toBe(11);
    expect(fitCount(11)).toBe("11 programs fit");
    expect(showCount(11)).toBe("Show 11 programs");
  });
  it("filters by terms, length, slot and search", () => {
    expect(f({ terms: "free" }).length).toBe(5);
    expect(f({ len: "30" }).length).toBe(5);
    expect(f({ len: "120" }).map((p) => p.t)).toEqual(["Saturday Reel", "Wind at Amboy"]);
    expect(f({ terms: "free", len: "30" }).map((p) => p.t)).toEqual(["Serial Saturday"]);
    expect(f({ slot: "late" }).length).toBe(6);
    expect(f({ q: "sazn" }).length).toBe(2);
    expect(f({ q: "zzz" })).toEqual([]);
    expect(fitCount(1)).toBe("1 program fits");
    expect(showCount(0)).toBe("Nothing fits");
  });
  it("sorts", () => {
    expect(f({ sort: "az" })[0]!.t).toBe("Abuela’s Pantry");
    expect(f({ sort: "short" })[0]!.len).toBe(30);
    expect(f({ sort: "long" })[0]!.len).toBe(120);
  });
  it("lists each filter's options with Any first", () => {
    for (const opts of Object.values(FILTER_OPTIONS)) expect(["any", "fit"]).toContain(opts[0][0]);
  });
});
