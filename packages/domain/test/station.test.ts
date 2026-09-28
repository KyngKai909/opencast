import { describe, expect, it } from "vitest";
import {
  contrastOnWhite,
  formatChannelNumber,
  isSubchannel,
  isValidCallSign,
  isValidStationColour,
  licenceAllowsCarriage,
  parseChannelNumber
} from "../src/index.js";

describe("call signs", () => {
  it("accepts 3 to 5 capital letters only", () => {
    expect(["KBT", "KINB", "WXYZA"].every(isValidCallSign)).toBe(true);
    expect(["KB", "KINBTX", "kinb", "K1NB", "KIN B"].some(isValidCallSign)).toBe(false);
  });
});

describe("channel numbers", () => {
  it("parses the TV band 2.1 to 69.9", () => {
    expect(parseChannelNumber("tv", "2.1")).toEqual({ band: "tv", tenths: 21 });
    expect(parseChannelNumber("tv", "69.9")).toEqual({ band: "tv", tenths: 699 });
    for (const bad of ["1.9", "70.1", "12.0", "12", "12.10"]) {
      expect(parseChannelNumber("tv", bad)).toBeUndefined();
    }
  });

  it("parses the radio band 88.1 to 107.9 in odd tenths", () => {
    expect(parseChannelNumber("radio", "88.1")).toEqual({ band: "radio", tenths: 881 });
    expect(parseChannelNumber("radio", "107.9")).toEqual({ band: "radio", tenths: 1079 });
    for (const bad of ["88.2", "87.9", "108.1", "100.0"]) {
      expect(parseChannelNumber("radio", bad)).toBeUndefined();
    }
  });

  it("formats and spots subchannels", () => {
    expect(formatChannelNumber({ band: "tv", tenths: 122 })).toBe("12.2");
    expect(isSubchannel({ band: "tv", tenths: 122 })).toBe(true);
    expect(isSubchannel({ band: "tv", tenths: 121 })).toBe(false);
    expect(isSubchannel({ band: "radio", tenths: 881 })).toBe(false);
  });
});

describe("station colour", () => {
  it("needs 4.5:1 against white", () => {
    expect(contrastOnWhite("#000000")).toBeCloseTo(21, 5);
    expect(contrastOnWhite("#ffffff")).toBeCloseTo(1, 5);
    // The old default fails.
    expect(contrastOnWhite("#00a96b")).toBeCloseTo(3.05, 2);
    expect(isValidStationColour("#00a96b")).toBe(false);
    expect(isValidStationColour("#767676")).toBe(true);
    expect(isValidStationColour("#777777")).toBe(false);
    expect(isValidStationColour("#12345")).toBe(false);
  });
});

describe("licences", () => {
  it("only commercial, derivative-allowing licences count", () => {
    expect(["cc0", "cc_by", "cc_by_sa"].every((l) => licenceAllowsCarriage(l as never))).toBe(true);
    expect(
      ["cc_by_nc", "cc_by_nd", "cc_by_nc_sa", "cc_by_nc_nd", "other"].some((l) => licenceAllowsCarriage(l as never))
    ).toBe(false);
  });
});

describe("one day of a spot's budget", () => {
  it("is the daily cap, else the total over its dates, else the total", async () => {
    const { oneDayOfBudgetMicros } = await import("../src/index.js");
    expect(oneDayOfBudgetMicros({ totalBudgetMicros: 300_000_000, dailyCapMicros: 12_000_000 })).toBe(12_000_000);
    expect(
      oneDayOfBudgetMicros({ totalBudgetMicros: 300_000_000, startsOn: "2026-10-01", endsOn: "2026-10-25" })
    ).toBe(12_000_000);
    expect(oneDayOfBudgetMicros({ totalBudgetMicros: 300_000_000 })).toBe(300_000_000);
  });
});
