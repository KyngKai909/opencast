import { describe, expect, it } from "vitest";
import type { StationEarningsX, StatementX } from "../../api/ext/earnings";
import { andList, earningsSections, heldTonightDetail, parseAmount, perThousandMicros, phoneRows, pledgesDetail, plural, sponsorsDetail, spotsDetail, statementLineDetail, statementSections, statementSubtitle, statementTitle } from "./lines";
import { airedTimes, sourceLine } from "./audience";

const $ = (d: number) => Math.round(d * 1_000_000);

const september: StationEarningsX = {
  period: "month",
  lines: {
    spots: { micros: $(486.2), airings: 212, businesses: 5 },
    sponsors: { micros: $(200), sponsors: 2, list: [{ name: "Redlands Hardware", monthlyMicros: $(100) }, { name: "Clear", monthlyMicros: $(100) }] },
    pledges: { micros: $(1386), members: 214, newMembers: 11 },
    carriageIn: { micros: $(43.2), detail: "Barter share and cash fees, Late Crate and Beat Tape Live" },
    carriageOut: { micros: -$(2.5), detail: "Newsreel hour from REEL, cash, 1 airing" },
    production: { micros: 0, orders: 0 },
    opencastShare: { micros: 0, notSetYet: true },
    pool: { micros: 0, notSetYet: true }
  },
  totalMicros: $(2112.9),
  held: { tonightMicros: $(21.6), tonightAirings: 9, tonightBreaks: 4, restOfWeekMicros: $(16.8), restOfWeekAirings: 41 },
  account: { availableMicros: $(640.12), paidOutThisMonthMicros: $(1472.78) },
  nextPayout: { on: "2026-09-28", schedule: "weekly", destination: "Chase ending 2231", amountMicros: $(640.12) }
};

describe("earnings lines", () => {
  it("says each line as the frame does", () => {
    expect(spotsDetail(september.lines.spots)).toBe("212 airings from 5 businesses, settled after each airing");
    expect(sponsorsDetail(september.lines.sponsors)).toBe("Redlands Hardware and Clear, $100.00 a month each");
    expect(pledgesDetail(september.lines.pledges, "month")).toBe("214 members, 11 new this month. After card fees");
    expect(heldTonightDetail(september.held)).toBe("9 airings in 4 breaks");
  });

  it("singular, plural, and lists of names", () => {
    expect(plural(1, "airing")).toBe("1 airing");
    expect(plural(1204, "airing")).toBe("1,204 airings");
    expect(plural(1, "business", "businesses")).toBe("1 business");
    expect(andList(["A", "B", "C"])).toBe("A, B and C");
    expect(sponsorsDetail({ micros: $(100), sponsors: 1, list: [{ name: "Clear", monthlyMicros: $(100) }] })).toBe("Clear, $100.00 a month");
    expect(sponsorsDetail({ micros: $(175), sponsors: 2, list: [{ name: "A", monthlyMicros: $(100) }, { name: "B", monthlyMicros: $(75) }] })).toBe("A and B");
    expect(sponsorsDetail({ micros: 0, sponsors: 2 })).toBe("2 sponsors");
  });

  it("groups by where it comes from, keeping the undecided lines at $0.00", () => {
    const s = earningsSections(september, "month", false);
    expect(s.map((x) => x.title)).toEqual(["From your breaks", "From viewers", "Carriage", "Shared"]);
    expect(s[3].rows).toEqual([
      expect.objectContaining({ title: "Opencast's share", amount: 0, notSetYet: true }),
      expect.objectContaining({ title: "The pool", amount: 0, notSetYet: true })
    ]);
    const all = s.flatMap((x) => x.rows).reduce((a, r) => a + r.amount, 0);
    expect(all).toBe(september.totalMicros);
  });

  it("a studio has carriage and the shared lines only; production shows once it earns", () => {
    const studio = earningsSections({ ...september, lines: { ...september.lines, carriageOut: { micros: 0, detail: "" } } }, "month", true);
    expect(studio.map((x) => x.title)).toEqual(["Carriage", "Shared"]);
    expect(studio[0].rows.map((r) => r.title)).toEqual(["Your programs on other stations"]);
    const made = earningsSections({ ...september, lines: { ...september.lines, production: { micros: $(80), orders: 1 } } }, "month", false);
    expect(made.find((x) => x.key === "production")!.rows[0]).toMatchObject({ title: "Spots you made", detail: "1 order for businesses" });
  });

  it("nets carriage on the phone, $43.20 in less $2.50 out, and leaves off the shared lines while they're undecided", () => {
    const rows = phoneRows(september, false);
    expect(rows.map((r) => [r.title, r.amount])).toEqual([
      ["Spots", $(486.2)],
      ["Sponsors", $(200)],
      ["Pledges", $(1386)],
      ["Carriage", $(40.7)]
    ]);
    const decided = phoneRows({ ...september, lines: { ...september.lines, opencastShare: { micros: -$(24.31), notSetYet: false } } }, false);
    expect(decided.at(-1)).toMatchObject({ title: "Shared", amount: -$(24.31) });
  });
});

describe("statements", () => {
  const week: StatementX = {
    id: "00000000-0000-4000-8000-000000630003",
    period: "week",
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
    openingMicros: 0,
    closingMicros: $(553.42),
    issuedAt: "2026-09-20T15:00:00.000Z",
    csvUrl: "",
    pdfUrl: null,
    paidOn: "2026-09-21",
    destination: "Chase ending 2231",
    lines: [
      { label: "Orange Street Coffee", detail: null, amountMicros: $(37.73), notSetYet: false, group: "spots", airings: 18, rate: { kind: "per_thousand", micros: $(8) }, averageTunedIn: 262 },
      { label: "Inland Tire and Wheel", detail: null, amountMicros: $(56), notSetYet: false, group: "spots", airings: 14, rate: { kind: "per_airing", micros: $(4) } },
      { label: "Pledges", detail: "61 members charged this week", amountMicros: $(374), notSetYet: false, group: "sponsors_pledges" },
      { label: "Opencast's share", detail: null, amountMicros: 0, notSetYet: true, group: "shared" },
      { label: "Pledges paid by card", detail: "Stripe's fee, passed through at cost", amountMicros: -$(12.66), notSetYet: false, group: "card_fees" }
    ]
  };

  it("shows the per-thousand math, and it adds up", () => {
    expect(statementLineDetail(week.lines[0])).toBe("18 airings, $8.00 per 1,000 tuned in, average 262");
    expect(statementLineDetail(week.lines[1])).toBe("14 airings, $4.00 an airing");
    expect(perThousandMicros($(8), 18, 262)).toBe($(37.73));
  });

  it("puts spots, sponsors and pledges on the left and the rest on the right", () => {
    const s = statementSections(week);
    expect(s.map((x) => [x.title, x.column, x.sub])).toEqual([
      ["Spots", "left", "32 airings"],
      ["Sponsors and pledges", "left", undefined],
      ["Shared", "right", undefined],
      ["Card fees", "right", undefined]
    ]);
  });

  it("without groups from the API, one list with no heading", () => {
    const s = statementSections({ ...week, lines: week.lines.map(({ group: _g, ...l }) => l) });
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe("");
  });

  it("is titled by its week and says where it was paid", () => {
    expect(statementTitle(week)).toBe("Week of September 14");
    expect(statementSubtitle(week)).toBe("Paid Monday, September 21, to Chase ending 2231.");
    expect(statementSubtitle({ ...week, paidOn: null })).toBe("September 14 to September 20.");
  });
});

describe("amounts typed in", () => {
  it("reads dollars and cents, with or without the sign and commas", () => {
    expect(parseAmount("$640.12")).toBe($(640.12));
    expect(parseAmount("1,200")).toBe($(1200));
    expect(parseAmount(" 300.5 ")).toBe($(300.5));
    expect(parseAmount("12.345")).toBeNull();
    expect(parseAmount("ten")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("audience rows", () => {
  it("names where a program came from", () => {
    expect(sourceLine({ source: "library", carriedFrom: null })).toBe("From your library");
    expect(sourceLine({ source: "carried", carriedFrom: { id: "x", kind: "station", callSign: "REEL", channel: "24.1", name: "Saturday Reel", handle: "reel", colour: "#9A5412", band: "tv", marketSlug: null, homeCity: null } })).toBe("Carried from REEL 24.1");
    expect(sourceLine({ source: "live", carriedFrom: null })).toBe("Live");
  });

  it("says am or pm on the first time and where it changes", () => {
    const tz = "America/Los_Angeles";
    expect(airedTimes(["2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z", "2026-09-27T03:30:00Z"], tz)).toEqual(["6:00 pm", "8:00", "8:30"]);
    expect(airedTimes(["2026-09-27T06:30:00Z", "2026-09-27T09:00:00Z"], tz)).toEqual(["11:30 pm", "2:00 am"]);
  });
});
