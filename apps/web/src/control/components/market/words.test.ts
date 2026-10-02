import { describe, expect, it } from "vitest";
import type { Offer, StationIdent } from "@opencast/contracts";
import { airingsText, breakPointsText, captionsText, carrierRows, dealLines, formatFromLibrary, formatLine, lengthLong, lengthText, readDuration, readMoney, slotText, termNames, termsTwoLines } from "./words";

const MIN = 60_000;
const st = (callSign: string, channel: string, market: string, o: Partial<StationIdent> = {}): StationIdent => ({ id: `id-${callSign}`, kind: "station", callSign, handle: callSign.toLowerCase(), name: `${callSign} name`, colour: "#33507A", band: "tv", channel, marketSlug: market, homeCity: null, ...o });
const HALL = st("HALL", "90.8", "inland-empire", { name: "Study Hall", band: "radio" });
const BEAT = st("BEAT", "12.1", "inland-empire", { name: "Inland Beat" });

function offer(o: Partial<Offer> = {}): Offer {
  return {
    id: "o1",
    program: { id: "p1", title: "Slow Hours", description: null, category: "Music", live: false, episodeCount: 22, rightsNote: null, format: { kind: "series", cadence: null, episodeLengthMs: 140 * MIN, bands: ["tv", "radio"] } },
    maker: HALL,
    makerKind: "station",
    status: "offered",
    carriers: 5,
    fitsYourSchedule: true,
    previews: 0,
    termsOffered: ["barter", "cash"],
    cashPriceMicros: 1_500_000,
    cashPriceUnit: "per_hour",
    barterMakerMsPerHour: 2 * MIN,
    airingsPerEpisode: null,
    windowDays: 30,
    liveOnly: false,
    noticeDays: 7,
    approval: "any_station",
    radioBandAllowed: true,
    breakMsPerHour: 4 * MIN,
    ...o
  };
}

describe("the market's words", () => {
  it("names the deals the way the row does", () => {
    expect(termNames(["barter", "cash"])).toBe("Barter or cash");
    expect(termNames(["free"])).toBe("Free");
    expect(termNames(["cash", "barter", "cash_plus_barter"])).toBe("Cash, barter or cash plus barter");
  });

  it("writes lengths and format lines as the frames do", () => {
    expect(lengthText(30 * MIN)).toBe("30 min");
    expect(lengthText(60 * MIN)).toBe("60 min");
    expect(lengthText(120 * MIN)).toBe("2 hr");
    expect(lengthText(140 * MIN)).toBe("2 hr 20 min");
    expect(lengthLong(60 * MIN)).toBe("60 minutes");
    expect(formatLine(offer().program)).toBe("Series, 22 episodes of 2 hr 20 min");
    expect(formatLine({ episodeCount: 8, live: true, format: { kind: "series", cadence: "weekly", episodeLengthMs: 60 * MIN, bands: ["radio"] } })).toBe("Weekly, live, 60 min, radio band");
    expect(formatLine({ episodeCount: 8, live: true, format: { kind: "series", cadence: "weekly", episodeLengthMs: 60 * MIN, bands: ["tv"] } }, { long: true })).toBe("Weekly, live, 60 minutes");
  });

  it("puts the terms in two lines, from where the reader stands", () => {
    expect(termsTwoLines(offer(), BEAT.id)).toEqual({ names: "Barter or cash", detail: "HALL fills 2:00 an hour, or $1.50 an hour" });
    // The maker's own list; half-hour programs count their share per half hour.
    const lateCrate = offer({ maker: BEAT, program: { ...offer().program, title: "Late Crate", format: { kind: "series", cadence: null, episodeLengthMs: 30 * MIN, bands: ["tv"] } }, cashPriceMicros: 2_000_000, cashPriceUnit: "per_airing" });
    expect(termsTwoLines(lateCrate, BEAT.id).detail).toBe("You fill 1:00 a half hour, or $2.00 an airing");
    expect(termsTwoLines(offer({ termsOffered: ["cash"], liveOnly: true, cashPriceMicros: 3_000_000, cashPriceUnit: "per_airing" }), BEAT.id).detail).toBe("$3.00 an airing, live only");
    expect(termsTwoLines(offer({ termsOffered: ["free"], underwriter: "Clear" }), BEAT.id)).toEqual({ names: "Free", detail: "One sponsor credit an hour" });
    expect(termsTwoLines(offer({ termsOffered: ["barter"], barterFill: "credit_only" }), BEAT.id).detail).toBe("Underwriting credit only");
  });

  it("describes each deal with its price, $0.00 included, in a fixed order", () => {
    const newsreel = offer({ termsOffered: ["cash", "barter", "cash_plus_barter"], cashPriceMicros: 2_500_000, cashPriceUnit: "per_airing", cashPlusBarter: { priceMicros: 1_250_000, unit: "per_airing", makerMsPerHour: MIN } });
    expect(dealLines(newsreel, "long")).toEqual([
      { term: "barter", title: "Barter", helper: "No fee. HALL fills 2:00 with its spots; you sell the other 2:00.", price: "$0.00" },
      { term: "cash", title: "Cash", helper: "You pay per airing and sell all 4:00 of breaks.", price: "$2.50 an airing" },
      { term: "cash_plus_barter", title: "Cash plus barter", helper: "A lower fee. HALL fills 1:00; you sell 3:00.", price: "$1.25 an airing" }
    ]);
    expect(dealLines(offer(), "short").map((d) => d.helper)).toEqual(["HALL fills 2:00 an hour; you sell 2:00", "All 4:00 an hour is yours"]);
  });

  it("says how many airings the terms allow", () => {
    expect(airingsText({ airingsPerEpisode: null, windowDays: 30 })).toBe("Any, within 30 days");
    expect(airingsText({ airingsPerEpisode: 3, windowDays: 7 })).toBe("Up to 3, within 7 days");
    expect(airingsText({ airingsPerEpisode: 1, windowDays: 7 })).toBe("Once, within 7 days");
  });

  it("writes a carrier's slots", () => {
    const every = (time: string, days: number[]) => days.map((weekday) => ({ weekday, time }));
    expect(slotText(every("23:00", [0, 1, 2, 3, 4, 5, 6]))).toBe("Nightly at 11:00 pm");
    expect(slotText(every("01:00", [1, 2, 3, 4, 5]))).toBe("Weeknights at 1:00 am");
    expect(slotText(every("01:00", [6, 0]))).toBe("Weekends at 1:00 am");
    expect(slotText(every("03:00", [0, 1, 2, 3, 4, 5, 6]), "comma")).toBe("Nightly, 3:00 am");
    expect(slotText(every("23:00", [0]), "comma")).toBe("Sundays, 11:00 pm");
    expect(slotText(every("12:00", [1, 3]))).toBe("Mondays and Wednesdays at 12:00 pm");
  });

  it("names carriers in the market, a lone station elsewhere with its market, and counts the rest", () => {
    const LA = (n: number) => st(`LA${"ABC"[n]}`, `3${n}.1`, "los-angeles");
    const rows = carrierRows(
      [
        { station: st("DUST", "96.2", "high-desert"), since: "2026-08-01T00:00:00Z", slots: [{ weekday: 6, time: "01:00" }, { weekday: 0, time: "01:00" }] },
        { station: BEAT, since: "2026-08-17T19:00:00Z", slots: [{ weekday: 1, time: "22:30" }] },
        { station: LA(0), since: "2026-08-01T00:00:00Z" },
        { station: LA(1), since: "2026-08-01T00:00:00Z" },
        { station: LA(2), since: "2026-08-01T00:00:00Z" }
      ],
      BEAT,
      () => "August"
    );
    expect(rows.map((r) => [r.title, r.detail, r.you])).toEqual([
      ["BEAT 12.1", "Mondays at 10:30 pm, since August", true],
      ["DUST 96.2, High Desert", "Weekends at 1:00 am", false],
      ["3 stations in Los Angeles", null, false]
    ]);
  });

  it("describes a preview's break points and captions", () => {
    expect(breakPointsText([30, 60, 90, 120].map((m) => m * MIN))).toBe("4, every 30 minutes, marked in amber");
    expect(breakPointsText([])).toBe("None");
    expect(captionsText("none", false)).toBe("None, no speech");
    expect(captionsText("generated", true)).toBe("Generated");
  });

  it("reads a program's format from its library until the API has one", () => {
    expect(formatFromLibrary({ live: true, episodeCount: 6 }, [44 * MIN + 20_000])).toEqual({ kind: "series", cadence: "weekly", episodeLengthMs: 60 * MIN, bands: ["tv", "radio"] });
    expect(formatFromLibrary({ live: false, episodeCount: 15 }, [29 * MIN + 10_000, 28 * MIN]).episodeLengthMs).toBe(30 * MIN);
  });

  it("reads the offer form's fields", () => {
    expect(readDuration("2:00")).toBe(2 * MIN);
    expect(readDuration(":30")).toBe(30_000);
    expect(readDuration("1:75")).toBeNull();
    expect(readMoney("$3.00")).toBe(3_000_000);
    expect(readMoney("1.5")).toBe(1_500_000);
    expect(readMoney("three")).toBeNull();
  });
});
