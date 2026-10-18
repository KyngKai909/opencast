import { describe, expect, it } from "vitest";
import { spanStyle } from "./grid";

describe("spanStyle", () => {
  it("writes the spans it's given", () => {
    expect(spanStyle({ d: 7, t: 6 })).toBe("--d:7;--t:6");
    expect(spanStyle({ d: 3, t: 3, m: 1 })).toBe("--d:3;--t:3;--m:1");
    expect(spanStyle({})).toBe("");
  });
  it("refuses a tablet span over 6", () => {
    expect(() => spanStyle({ t: 7 }, "Cell #x")).toThrow(/--t may not exceed 6/);
  });
  it("refuses spans the other grids can't hold", () => {
    expect(() => spanStyle({ d: 13 })).toThrow(/12 columns/);
    expect(() => spanStyle({ m: 3 })).toThrow(/2 columns/);
    expect(() => spanStyle({ d: 0 })).toThrow(/whole number/);
    expect(() => spanStyle({ t: 2.5 })).toThrow(/whole number/);
  });
});
