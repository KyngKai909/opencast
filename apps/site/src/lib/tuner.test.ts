import { describe, expect, it } from "vitest";
import { contrastRatio } from "@opencast/ui";
import { SAMPLE_DIAL, noStation, readEntry, step, typeKey } from "./tuner";

describe("the tuner's dial", () => {
  it("is in channel order, TV then radio, the reference's eight", () => {
    expect(SAMPLE_DIAL.map((s) => s.callSign)).toEqual(["CIVC", "RDLS", "BEAT", "SAZN", "REEL", "PREP", "NITE", "CRAT"]);
    const numbers = SAMPLE_DIAL.map((s) => Number(s.channel));
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
  });

  it("marks the radio band and what's live", () => {
    expect(SAMPLE_DIAL.filter((s) => s.radio).map((s) => s.channel)).toEqual(["88.3", "101.9"]);
    expect(SAMPLE_DIAL.filter((s) => s.live).map((s) => s.callSign)).toEqual(["CIVC", "CRAT"]);
  });

  it("holds 4.5:1 against white in every station colour", () => {
    for (const s of SAMPLE_DIAL) expect(contrastRatio(s.colour, "#FFFFFF"), s.callSign).toBeGreaterThanOrEqual(4.5);
  });

  it("steps up and down and wraps at both ends", () => {
    expect(step(0, 1)).toBe(1);
    expect(step(0, -1)).toBe(SAMPLE_DIAL.length - 1);
    expect(step(SAMPLE_DIAL.length - 1, 1)).toBe(0);
    let i = 0;
    for (let n = 0; n < SAMPLE_DIAL.length; n++) i = step(i, 1);
    expect(i).toBe(0);
  });
});

describe("numbers tune", () => {
  const at = (typed: string) => {
    const e = readEntry(typed);
    return e.match === null ? null : SAMPLE_DIAL[e.match]!.callSign;
  };

  it("fills in .1 for a TV channel", () => {
    expect(readEntry("12")).toMatchObject({ filled: ".1" });
    expect(at("12")).toBe("BEAT");
    expect(at("7")).toBe("CIVC");
    expect(at("31")).toBe("PREP");
  });

  it("reads three or four digits as a radio frequency", () => {
    expect(at("883")).toBe("NITE");
    expect(readEntry("883").filled).toBe("");
    expect(at("1019")).toBe("CRAT");
  });

  it("takes the dot", () => {
    expect(at("88.3")).toBe("NITE");
    expect(at("24.")).toBe("REEL");
    expect(readEntry("24.").filled).toBe("1");
    expect(at("12.2")).toBeNull();
  });

  it("says when a number has no station", () => {
    const e = readEntry("13");
    expect(e.match).toBeNull();
    expect(noStation(e)).toBe("No station on 13");
  });

  it("types digits and one dot, five keys at most", () => {
    expect(typeKey("", "1")).toBe("1");
    expect(typeKey("1", "2")).toBe("12");
    expect(typeKey("", ".")).toBeNull();
    expect(typeKey("12", ".")).toBe("12.");
    expect(typeKey("12.", ".")).toBeNull();
    expect(typeKey("12345", "6")).toBeNull();
    expect(typeKey("1", "a")).toBeNull();
  });
});
