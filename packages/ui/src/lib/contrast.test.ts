import { describe, expect, it } from "vitest";
import { contrastRatio, ratioLabel, stationColourPasses } from "./contrast";

describe("station colours", () => {
  it("matches the style guide's ratios", () => {
    // CIVC 6.2:1, BEAT 6.9:1, REEL 5.8:1, NITE 8.2:1 against white.
    expect(ratioLabel(contrastRatio("#2E6B5A", "#FFFFFF"))).toBe("6.2:1");
    expect(ratioLabel(contrastRatio("#8C3B7A", "#FFFFFF"))).toBe("6.9:1");
    expect(ratioLabel(contrastRatio("#9A5412", "#FFFFFF"))).toBe("5.8:1");
    expect(ratioLabel(contrastRatio("#33507A", "#FFFFFF"))).toBe("8.2:1");
  });
  it("never labels a failing colour as 4.5:1", () => {
    expect(ratioLabel(4.47)).toBe("4.4:1");
    expect(ratioLabel(4.5)).toBe("4.5:1");
  });
  it("refuses colours under 4.5:1", () => {
    expect(stationColourPasses("#8C3B7A")).toBe(true);
    expect(stationColourPasses("#E9A93A")).toBe(false);
    expect(stationColourPasses("#6CCFEA")).toBe(false);
  });
});
