import { describe, expect, it } from "vitest";
import { normaliseTvCode, spacedTvCode } from "./TvCode";

describe("the TV's code from the address", () => {
  it("reads it as typed or as the TV shows it", () => {
    expect(normaliseTvCode("K7Q4MP")).toBe("K7Q4MP");
    expect(normaliseTvCode("k7q 4mp")).toBe("K7Q4MP");
    expect(normaliseTvCode("K7Q-4MP-extra")).toBe("K7Q4MP");
    expect(normaliseTvCode(null)).toBe("");
  });
  it("shows it spaced, as the TV draws it", () => {
    expect(spacedTvCode("K7Q4MP")).toBe("K7Q 4MP");
    expect(spacedTvCode("K7")).toBe("K7");
  });
});
