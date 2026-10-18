import { describe, expect, it } from "vitest";
import { compare, coverage, estimate, LIBRARY_STOPS, minutesLabel, money, pct, price, RUN_DEFAULTS, size } from "./pricing";

const d = RUN_DEFAULTS;
const lib = LIBRARY_STOPS[d.libraryStop]!;

describe("Run: estimate your month", () => {
  it("matches the reference default: $29.95", () => {
    const e = estimate({ gb: d.gb, live: d.live, relays: d.relays, library: lib });
    expect(money(e.storage)).toBe("$1.20");
    expect(money(e.relays)).toBe("$25.00");
    expect(money(e.live)).toBe("$3.75");
    expect(money(e.total)).toBe("$29.95");
  });
  it("is free inside the allowance with relays off or live only", () => {
    expect(estimate({ gb: 10, live: 5, relays: 0 }).total).toBe(0);
    expect(estimate({ gb: 10, live: 5, relays: 1 }).total).toBe(0);
  });
  it("caps relays at $25 and storage at the library", () => {
    expect(estimate({ gb: 0, live: 0, relays: 2 }).relays).toBe(25);
    expect(estimate({ gb: 300, live: 0, relays: 0, library: 25 })).toMatchObject({ gb: 25, storage: 0.6 });
  });
  it("tops out at $182.85", () => expect(money(estimate({ gb: 300, live: 200, relays: 2 }).total)).toBe("$182.85"));
  it("about $26 for 40 GB on air, relayed all month (the comparison table)", () => expect(Math.round(estimate({ gb: 40, live: 0, relays: 2 }).total)).toBe(26));
});

describe("Run: the same channel elsewhere", () => {
  it("says nothing fits a 500 GB library", () => {
    const c = compare(500, 29.95);
    expect(c.map((x) => [x.n, x.fits, x.plan, size(x.over)])).toEqual([
      ["Livepush", false, "Largest published plan holds 100 GB", "400 GB"],
      ["Upstream", false, "Largest published plan holds 100 GB", "400 GB"],
      ["Gyre", false, "Largest published plan holds 150 GB", "350 GB"]
    ]);
  });
  it("prices the cheapest tier that holds it", () => {
    const c = compare(50, 1.6);
    expect(c[0]).toMatchObject({ fits: true, price: 69, plan: "Creators, 50 GB" });
    expect(c[1]).toMatchObject({ fits: true, price: 30, plan: "1 stream, 100 GB · 100 GB is its free plan; paid storage not published" });
    expect(c[2]).toMatchObject({ fits: true, price: 99, plan: "Start+, 75 GB" });
    expect(c[0]!.diff).toBeCloseTo(67.4);
  });
  it("formats sizes", () => {
    expect(size(500)).toBe("500 GB");
    expect(size(1000)).toBe("1 TB");
    expect(size(1500)).toBe("1.5 TB");
  });
});

describe("Run: does it cover your costs?", () => {
  it("matches the reference default: $121.23 left, 5× over", () => {
    const bill = estimate({ gb: d.gb, live: d.live, relays: d.relays, library: lib }).total;
    const c = coverage({ tuned: d.tuned, minutes: d.minutes, pledges: d.pledges, bill });
    expect(money(c.spots)).toBe("$103.68");
    expect(money(c.pledges)).toBe("$47.50");
    expect(money(c.paid)).toBe("$29.95");
    expect(money(c.left)).toBe("$121.23");
    expect(c.verdict).toBe("Covers your month 5× over");
  });
  it("says how much of the month it covers", () => {
    expect(coverage({ tuned: 1, minutes: 0, pledges: 10, bill: 29.95 }).verdict).toBe("Covers 32% of your month");
    expect(coverage({ tuned: 1, minutes: 0, pledges: 40, bill: 29.95 }).verdict).toBe("Covers your month, with some left");
    expect(coverage({ tuned: 500, minutes: 3, pledges: 1000, bill: 29.95 }).verdict).toMatch(/^Covers your month \d+× over$/);
    expect(coverage({ tuned: 1, minutes: 0, pledges: 0, bill: 0 }).verdict).toBe("Your month costs nothing to run");
  });
  it("labels spot time", () => {
    expect(minutesLabel(0)).toBe("None");
    expect(minutesLabel(0.5)).toBe("30 sec");
    expect(minutesLabel(1)).toBe("1 min");
    expect(minutesLabel(1.25)).toBe("1.25 min");
    expect(minutesLabel(1.5)).toBe("1.5 min");
  });
});

describe("formatting", () => {
  it("writes shares and prices", () => {
    expect(pct(0.1)).toBe("10%");
    expect(price(0.04)).toBe("$0.04");
    expect(price(25)).toBe("$25");
  });
});

import { carriage, moneyC, SYND_DEFAULTS, wholeC } from "./pricing";

describe("Syndication: what a show earns", () => {
  it("matches the reference default (revenue share): $48.00 a station, $576.00, about $6,912 a year", () => {
    const e = carriage(SYND_DEFAULTS);
    expect(moneyC(e.one)).toBe("$48.00");
    expect(moneyC(e.total)).toBe("$576.00");
    expect(wholeC(e.year)).toBe("$6,912");
  });
  it("matches the reference in cash mode: 13 airings, −$1.63, $30.88, $370.50, about $4,446", () => {
    const e = carriage({ ...SYND_DEFAULTS, mode: "cash" });
    expect((Math.round(e.monthly * 10) / 10).toString()).toBe("13");
    expect(moneyC(e.fee)).toBe("$1.63");
    expect(moneyC(e.one)).toBe("$30.88");
    expect(moneyC(e.total)).toBe("$370.50");
    expect(wholeC(e.year)).toBe("$4,446");
  });
  it("caps the maker's share at 80%", () => {
    expect(carriage({ ...SYND_DEFAULTS, share: 0.95, stations: 1 }).one).toBeCloseTo(600 * 0.2 * 0.8);
  });
  it("formats thousands", () => expect(moneyC(1284.6)).toBe("$1,284.60"));
});

import { airingCost, airingsLabel, daysLabel, pickLabel, plan, type PlanInput } from "./pricing";
import { PLAN_START, PLAN_STATIONS, KINDS, TIMES, AIRINGS, MONTH } from "./spots";

const startPlan = (o: Partial<PlanInput> = {}): PlanInput => ({ where: PLAN_START.where, miles: PLAN_START.miles, markets: new Set(PLAN_START.markets), kinds: new Set(KINDS), times: new Set(TIMES.map((t) => t[0])), rateKind: "k", rate: 8, budget: 300, cap: 15, ...o });

describe("Spots: the planner", () => {
  it("matches the reference default: 3 stations, 9.5 airings, 1,875 tuned in, 20 days, Many will", () => {
    const p = plan(PLAN_STATIONS, startPlan());
    expect(p.fits.map((r) => r.s.cs)).toEqual(["NITE", "SAZN", "CIVC"]);
    expect(airingsLabel(p.airings)).toBe("9.5");
    expect(Math.round(p.tuned).toLocaleString("en-US")).toBe("1,875");
    expect(daysLabel(p)).toBe("20 days");
    expect(Math.round(p.pick * 100)).toBe(69);
    expect(pickLabel(p)).toBe("Many will");
    expect(p.scale).toBeLessThan(1);
    expect(p.fits.map((r) => [r.cost.toFixed(2), (r.ad * p.scale).toFixed(1)])).toEqual([["1.44", "3.4"], ["2.08", "3.4"], ["1.12", "2.8"]]);
    expect(p.out.slice(0, 3).map((r) => r.why)).toEqual(["Farther than 12 mi", "Farther than 12 mi", "Farther than 12 mi"]);
  });
  it("matches the reference online: 8 fit, 6.7 airings, 1,875 tuned in, 20 days", () => {
    const p = plan(PLAN_STATIONS, startPlan({ where: "online" }));
    expect(p.fits.length).toBe(8);
    expect(airingsLabel(p.airings)).toBe("6.7");
    expect(Math.round(p.tuned).toLocaleString("en-US")).toBe("1,875");
    expect(daysLabel(p)).toBe("20 days");
  });
  it("matches the reference per airing at $2.50: 3 fit, 6.0, 1,156, Most will", () => {
    const p = plan(PLAN_STATIONS, startPlan({ rateKind: "a", rate: 2.5 }));
    expect(p.fits.length).toBe(3);
    expect(airingsLabel(p.airings)).toBe("6.0");
    expect(Math.round(p.tuned).toLocaleString("en-US")).toBe("1,156");
    expect(pickLabel(p)).toBe("Most will");
  });
  it("says why a station won't air", () => {
    expect(plan(PLAN_STATIONS, startPlan({ kinds: new Set(["Talk"]) })).fits).toEqual([]);
    expect(plan(PLAN_STATIONS, startPlan({ times: new Set() })).out[0]!.why).toBe("No breaks at those times");
    expect(daysLabel(plan(PLAN_STATIONS, startPlan({ kinds: new Set() })))).toBe("—");
  });
});

describe("Spots: what airings cost", () => {
  it("settles at $8 per 1,000", () => {
    expect(AIRINGS.map((a) => a.cost)).toEqual([2.5, 2.7, 0]);
    expect(airingCost(312).toFixed(2)).toBe("2.50");
    expect(MONTH.spent.toFixed(2)).toBe("147.36");
    expect((MONTH.spent / MONTH.customers).toFixed(2)).toBe("3.59");
  });
});
