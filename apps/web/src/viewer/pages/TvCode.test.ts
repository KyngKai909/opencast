import { describe, expect, it } from "vitest";
import { codeFromAddress, normaliseTvCode, spacedTvCode, tvCodeKind } from "./TvCode";

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

describe("four digits or six characters", () => {
  it("pairs the remote with four digits and signs the TV in with six characters", () => {
    expect(tvCodeKind("4821")).toEqual({ kind: "pair", code: "4821" });
    expect(tvCodeKind("48 21")).toEqual({ kind: "pair", code: "4821" });
    expect(tvCodeKind("k7q 4mp")).toEqual({ kind: "sign_in", code: "K7Q4MP" });
    expect(tvCodeKind("123456")).toEqual({ kind: "sign_in", code: "123456" });
    expect(tvCodeKind("482")).toBeNull();
    expect(tvCodeKind("K7Q4")).toBeNull();
    expect(tvCodeKind("")).toBeNull();
  });
  it("fills the field from the address either way", () => {
    expect(codeFromAddress("4821")).toBe("4821");
    expect(codeFromAddress("K7Q4MP")).toBe("K7Q 4MP");
    expect(codeFromAddress(null)).toBe("");
  });
});
