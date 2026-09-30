import { describe, expect, it } from "vitest";
import {
  callSignLabel,
  canShareCallSignOn,
  contrastOnWhite,
  familyHeadTenths,
  parseStationSlug,
  stationSlugOf,
  formatChannelNumber,
  isSubchannel,
  isValidCallSign,
  isValidChannelNumber,
  isValidStationColour,
  licenceAllowsCarriage,
  parseChannelNumber,
  RADIO_BAND_MAX_TENTHS,
  RADIO_BAND_MIN_TENTHS,
  radioBandTenths
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

  it("parses the radio band 88.2 to 107.8 in even tenths", () => {
    expect(parseChannelNumber("radio", "88.2")).toEqual({ band: "radio", tenths: 882 });
    expect(parseChannelNumber("radio", "99.2")).toEqual({ band: "radio", tenths: 992 });
    expect(parseChannelNumber("radio", "100.0")).toEqual({ band: "radio", tenths: 1000 });
    expect(parseChannelNumber("radio", "107.8")).toEqual({ band: "radio", tenths: 1078 });
    for (const bad of ["88.0", "87.8", "108.0", "88", "99.2.1"]) {
      expect(parseChannelNumber("radio", bad)).toBeUndefined();
    }
  });

  it("never takes a real FM number: every odd tenth is off the radio band", () => {
    for (let tenths = 881; tenths <= 1079; tenths += 2) {
      expect(isValidChannelNumber({ band: "radio", tenths })).toBe(false);
    }
    for (const real of ["88.1", "99.1", "101.9", "107.9"]) {
      expect(parseChannelNumber("radio", real)).toBeUndefined();
    }
  });

  it("lists the band: 99 frequencies from 88.2 to 107.8", () => {
    const band = radioBandTenths();
    expect(band).toHaveLength(99);
    expect([band[0], band[band.length - 1]]).toEqual([RADIO_BAND_MIN_TENTHS, RADIO_BAND_MAX_TENTHS]);
    expect(band.every((tenths) => isValidChannelNumber({ band: "radio", tenths }))).toBe(true);
  });

  it("leaves TV alone: 2.1 to 69.9 with subchannels, whatever broadcast uses", () => {
    expect(parseChannelNumber("tv", "4.1")).toEqual({ band: "tv", tenths: 41 });
    expect(parseChannelNumber("tv", "12.2")).toEqual({ band: "tv", tenths: 122 });
  });

  it("formats and spots subchannels", () => {
    expect(formatChannelNumber({ band: "tv", tenths: 122 })).toBe("12.2");
    expect(isSubchannel({ band: "tv", tenths: 122 })).toBe(true);
    expect(isSubchannel({ band: "tv", tenths: 121 })).toBe(false);
    expect(isSubchannel({ band: "radio", tenths: 882 })).toBe(false);
    expect(formatChannelNumber({ band: "radio", tenths: 1020 })).toBe("102.0");
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

describe("credit text", () => {
  it("passes who, where and what they do", async () => {
    const { checkCreditText } = await import("../src/index.js");
    expect(checkCreditText("Orange Street Coffee, roasting in Redlands since 2009.").passes).toBe(true);
    expect(checkCreditText("Redlands Hardware, a family hardware store on Orange Street.").passes).toBe(true);
  });

  it("flags prices and offers, comparisons, and calls to action, with a fix for each", async () => {
    const { checkCreditText } = await import("../src/index.js");
    const result = checkCreditText("The best coffee in Redlands. Come by this weekend for 10% off.");
    expect(result.passes).toBe(false);
    expect(result.flags.map((f) => [f.kind, f.text])).toEqual([
      ["comparison", "best"],
      ["call_to_action", "Come by"],
      ["price_or_offer", "10%"],
      ["price_or_offer", "off"]
    ]);
    expect(result.flags.every((f) => f.suggestion.length > 0)).toBe(true);
  });
});

describe("shared call signs (A229)", () => {
  it("lets X.n share X.1's call sign in the same major, on TV only", () => {
    expect(familyHeadTenths(153)).toBe(151);
    expect(canShareCallSignOn({ band: "tv", tenths: 152 }, { band: "tv", tenths: 151 })).toBe(true);
    expect(canShareCallSignOn({ band: "tv", tenths: 151 }, { band: "tv", tenths: 151 })).toBe(false);
    expect(canShareCallSignOn({ band: "tv", tenths: 162 }, { band: "tv", tenths: 151 })).toBe(false);
    expect(canShareCallSignOn({ band: "radio", tenths: 884 }, { band: "radio", tenths: 882 })).toBe(false);
  });

  it("gives a family member an address with its channel, and reads it back", () => {
    expect(stationSlugOf({ id: "x", callSign: "SBCO", channel: "15.1" })).toBe("sbco");
    expect(stationSlugOf({ id: "x", callSign: "SBCO", channel: "15.2", familyMember: true })).toBe("sbco-15-2");
    expect(stationSlugOf({ id: "x", callSign: null, handle: "bench" })).toBe("bench");
    expect(parseStationSlug("sbco-15-2")).toEqual({ callSign: "SBCO", tenths: 152 });
    expect(parseStationSlug("SBCO")).toEqual({ callSign: "SBCO", tenths: null });
    expect(parseStationSlug("beat-12-1")).toEqual({ callSign: "BEAT", tenths: 121 });
    expect(parseStationSlug("sbco-15-0")).toBeNull();
    expect(parseStationSlug("00000000-0000-4000-8000-000000000001")).toBeNull();
  });

  it("adds the channel where only a call sign would show, for a shared one", () => {
    expect(callSignLabel({ callSign: "SBCO", channel: "15.2", sharesCallSign: true })).toBe("SBCO 15.2");
    expect(callSignLabel({ callSign: "BEAT", channel: "12.1" })).toBe("BEAT");
    expect(callSignLabel({ callSign: null, name: "Bench" })).toBe("Bench");
  });
});
