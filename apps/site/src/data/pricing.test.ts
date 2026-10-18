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
