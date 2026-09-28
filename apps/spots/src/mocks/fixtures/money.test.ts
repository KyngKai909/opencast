// The Money mock's small rules: Stripe's fee at cost, when a bank transfer arrives (two business
// days on, 9:00 am in Redlands), the airings estimate, the pretend geocoder and category reach.

import { describe, expect, it } from "vitest";
import { bankArrival, categoryReach, depositFee, findPlace, roughAirings } from "./money";

const $ = (d: number) => Math.round(d * 1_000_000);

describe("deposits", () => {
  it("charges Stripe's fee on cards only: 2.9% plus 30 cents, to the cent", () => {
    expect(depositFee($(250), "card")).toBe($(7.55));
    expect(depositFee($(100), "card")).toBe($(3.2));
    expect(depositFee($(250), "clear_bank")).toBe(0);
    expect(depositFee($(250), "clear_account")).toBe(0);
  });

  it("lands a bank transfer two business days on, at 9:00 am", () => {
    expect(bankArrival(new Date("2026-09-27T03:42:00Z")).toISOString()).toBe("2026-09-29T16:00:00.000Z"); // Saturday night → Tuesday
    expect(bankArrival(new Date("2026-09-28T18:00:00Z")).toISOString()).toBe("2026-09-30T16:00:00.000Z"); // Monday → Wednesday
    expect(bankArrival(new Date("2026-10-02T18:00:00Z")).toISOString()).toBe("2026-10-06T16:00:00.000Z"); // Friday → Tuesday
  });

  it("turns an amount into airings at the rate", () => {
    expect(roughAirings($(250), { rateKind: "per_thousand", rateMicros: $(8) })).toBe(120);
    expect(roughAirings($(250), { rateKind: "per_airing", rateMicros: $(4) })).toBe(62);
  });
});

describe("getting started", () => {
  it("finds a town the mock knows, with the street when there is one", () => {
    expect(findPlace("204 Orange St, Redlands, CA 92373")).toMatchObject({ streetAddress: "204 Orange St", city: "Redlands" });
    expect(findPlace("Moreno Valley")).toMatchObject({ streetAddress: null, city: "Moreno Valley" });
    expect(findPlace("Springfield")).toBeNull();
  });

  it("counts the stations that carry a category", () => {
    expect(categoryReach("Coffee and food")).toMatchObject({ reached: 8, total: 8, blockedBy: [] });
    expect(categoryReach("Gambling")).toMatchObject({ reached: 5, blockedBy: ["CIVC", "PREP", "HALL"] });
  });
});
