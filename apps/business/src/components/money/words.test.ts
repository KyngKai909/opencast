// How the Money area says things, on the reference's Saturday, September 26, 8:42 pm in Redlands.

import { describe, expect, it } from "vitest";
import { estimateLine, methodPhrase } from "./fund";
import { reachWords, townOf, websiteUrl } from "./start";
import { afterWithdrawal } from "./Withdraw";
import { clearFundingState, clearHelper } from "./ClearFunding";
import {
  aboutDays,
  arrivalDay,
  autoTopUpText,
  daysCovered,
  feeText,
  heldCaption,
  momentText,
  movementDay,
  movementDirection,
  parseDollars,
  pickSource,
  sourceParts,
  spentCaption,
  spotsLine,
  untilArrival,
  usualAmount,
  warnText
} from "./words";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:00Z"); // Saturday 8:42 pm
const $ = (d: number) => Math.round(d * 1_000_000);

describe("the day on a movement", () => {
  it("says Tonight, then the weekday, then the date without a time", () => {
    expect(movementDay("2026-09-27T03:28:00Z", NOW, TZ)).toEqual({ day: "Tonight", showTime: true });
    expect(movementDay("2026-09-26T17:00:00Z", NOW, TZ)).toEqual({ day: "Today", showTime: true });
    expect(movementDay("2026-09-26T04:59:00Z", NOW, TZ)).toEqual({ day: "Friday", showTime: true });
    expect(movementDay("2026-09-01T17:00:00Z", NOW, TZ)).toEqual({ day: "Sept 1", showTime: false });
  });

  it("reads holds in standby, money in with a plus, money out quieter", () => {
    expect(movementDirection({ kind: "held", amountMicros: $(4.6) })).toBe("hold");
    expect(movementDirection({ kind: "order", amountMicros: $(140) })).toBe("hold");
    expect(movementDirection({ kind: "returned", amountMicros: $(0.84) })).toBe("in");
    expect(movementDirection({ kind: "aired", amountMicros: -$(2.1) })).toBe("out");
    expect(movementDirection({ kind: "withdrawn", amountMicros: -$(300) })).toBe("out");
  });
});

describe("amounts and days", () => {
  it("reads typed dollars", () => {
    expect(parseDollars("$300.00")).toBe($(300));
    expect(parseDollars("1,250.5")).toBe($(1250.5));
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
  });

  it("counts whole days at the pace, and none without one", () => {
    expect(daysCovered($(412.5), $(9.2))).toBe(44);
    expect(daysCovered($(112.5), $(9.2))).toBe(12);
    expect(daysCovered($(100), 0)).toBeNull();
    expect(aboutDays(1)).toBe("about 1 day");
    expect(aboutDays(0)).toBe("less than a day");
  });

  it("says what's left after taking money out, and when the spots would pause", () => {
    const b = { availableMicros: $(412.5), pacePerDayMicros: $(9.2) };
    expect(afterWithdrawal(b, $(300))).toEqual({ left: $(112.5), days: 12, over: false, underADay: false });
    expect(afterWithdrawal(b, $(410)).underADay).toBe(true);
    expect(afterWithdrawal(b, $(500)).over).toBe(true);
  });
});

describe("money on its way", () => {
  it("names the day it arrives and when what's available runs out", () => {
    expect(arrivalDay("2026-09-29T16:00:00Z", NOW, TZ)).toBe("Tuesday");
    expect(arrivalDay("2026-09-27T16:00:00Z", NOW, TZ)).toBe("tomorrow");
    expect(momentText(new Date("2026-09-29T21:00:00Z"), NOW, TZ)).toBe("Tuesday afternoon");
    expect(momentText(new Date("2026-11-09T21:00:00Z"), NOW, TZ)).toBe("November 9");
  });

  it("says the spots keep running when the money lasts past the arrival (06.2)", () => {
    // $27.40 at $9.20 a day from Saturday 1:03 pm lasts until Tuesday afternoon; the transfer lands Tuesday at 9:00 am.
    const sat = new Date("2026-09-26T20:03:00Z");
    const r = untilArrival({ availableMicros: $(27.4), pacePerDayMicros: $(9.2) }, "2026-09-29T16:00:00Z", sat, TZ);
    expect(r.keepsRunning).toBe(true);
    expect(r.sentence).toBe("Your spots keep running until then. At about $9.20 a day, what's available lasts until Tuesday afternoon.");
    const short = untilArrival({ availableMicros: $(9.2), pacePerDayMicros: $(9.2) }, "2026-09-29T16:00:00Z", sat, TZ);
    expect(short.keepsRunning).toBe(false);
    expect(short.sentence).toContain("Your spots pause then, and resume when it does.");
  });
});

describe("sources and the page's lines", () => {
  const chase = { id: "a", kind: "clear_bank" as const, label: "Clear, Chase ending 8810", isDefault: true };
  const visa = { id: "b", kind: "card" as const, label: "Visa ending 4417", isDefault: false };

  it("splits a source for its row, and says the fee", () => {
    expect(sourceParts(chase)).toEqual({ name: "Clear", account: "Chase ending 8810" });
    expect(sourceParts(visa)).toEqual({ name: "Visa ending 4417", account: null });
    expect(feeText(0)).toBe("no fee");
    expect(feeText($(7.55))).toBe("$7.55 fee, Stripe's at cost");
  });

  it("starts on the preselected source, else the default", () => {
    expect(pickSource([chase, visa], "b")).toBe(visa);
    expect(pickSource([visa, chase])).toBe(chase);
    expect(pickSource([])).toBeNull();
  });

  it("offers the last amount added, else $250", () => {
    expect(usualAmount([{ kind: "withdrawn", amountMicros: -$(10) }, { kind: "added", amountMicros: $(500) }])).toBe($(500));
    expect(usualAmount([])).toBe($(250));
  });

  it("writes the subtitle and captions as the frame does", () => {
    const spots = [
      { state: "in_rotation" as const, inRotationOn: 3 },
      { state: "paused_daily_cap" as const, inRotationOn: 2 },
      { state: "in_review" as const, inRotationOn: 0 },
      { state: "ended" as const, inRotationOn: 0 }
    ];
    expect(spotsLine("Orange Street Coffee", spots)).toBe("Orange Street Coffee. 3 spots listed, in rotation on 3 stations.");
    expect(spotsLine("Orange Street Coffee", [])).toBe("Orange Street Coffee. No spots listed yet.");
    expect(heldCaption(41)).toBe("Held for 41 airings stations have scheduled");
    expect(spentCaption("September", 118)).toBe("Spent in September, on 118 airings");
    expect(warnText([1, 3])).toBe("At 3 days and 1 day of airings left");
    expect(autoTopUpText({ on: false, amountMicros: null, belowDays: 3 })).toBe("Off");
    expect(autoTopUpText({ on: true, amountMicros: $(250), belowDays: 3 })).toBe("Add $250 whenever what's available drops below 3 days of airings");
  });
});

describe("getting started", () => {
  it("turns the website into a URL and finds the town in the address", () => {
    expect(websiteUrl("orangestreet.example")).toBe("https://orangestreet.example");
    expect(websiteUrl(" ")).toBeUndefined();
    expect(townOf("204 Orange St, Redlands, CA 92373")).toBe("Redlands");
  });

  it("says how many stations can carry the category", () => {
    const base = { marketName: "Inland Empire", total: 8, sometimesBlocked: ["alcohol", "gambling"] };
    expect(reachWords({ ...base, category: "Coffee and food", reached: 8, blockedBy: [] })).toEqual({
      title: "Every station can carry coffee and food",
      detail: "8 of 8 stations in the Inland Empire. Some stations don't carry categories like alcohol or gambling; yours isn't one of them."
    });
    expect(reachWords({ ...base, category: "Alcohol", reached: 6, blockedBy: ["PREP", "HALL"] }).detail).toBe("6 of 8 stations in the Inland Empire. PREP and HALL don't carry it.");
  });

  it("says what an amount buys, and how", () => {
    const station = { callSign: "BEAT", channel: "12.1", name: "Inland Beat" } as never;
    expect(estimateLine({ roughAirings: 120, basis: { rateKind: "per_thousand", rateMicros: $(8), station } }, $(250))).toBe(
      "At $8.00 per 1,000 people tuned in, $250 is roughly 120 airings on a station like BEAT 12.1."
    );
    expect(estimateLine({ roughAirings: 62, basis: null }, $(250))).toBe("$250 is roughly 62 airings.");
    expect(methodPhrase("clear_bank")).toBe("by bank transfer");
  });

  it("knows the three Clear states", () => {
    expect(clearFundingState({ available: true, account: null })).toBe("not_linked");
    expect(clearFundingState({ available: false, account: null })).toBe("unavailable");
    expect(clearFundingState({ available: true, account: { access: "read_only" } })).toBe("read_only");
    expect(clearHelper("not_linked", null)).toBe("Instant, once connected. Connect it here");
    expect(clearHelper("full", "0x1234567890abcdef1234567890abcdef12345678")).toBe("Instant, from 0x1234…5678");
  });
});
