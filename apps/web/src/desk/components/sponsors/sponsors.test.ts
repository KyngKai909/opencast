// Catalog sponsors' words (desk-pages 03): the figures over the list, a sponsor's line, a slot's cell.
import { describe, expect, it } from "vitest";
import type { CatalogSlot, CatalogSponsors, CatalogSponsorship } from "@opencast/contracts";
import { airsLine, parseSelection, possessive, selectionKey, slotCell, sponsorLine, sponsorStats, startMonths } from "./sponsors";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = { id: U(1), slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: true };
const NIGHTS = { id: U(2), title: "Nights at the observatory", colour: "#1F3A5F" };

const sponsor = (over: Partial<CatalogSponsorship> = {}): CatalogSponsorship => ({
  id: U(10),
  business: { id: U(11), name: "Inland Empire Libraries" },
  series: NIGHTS,
  market: IE,
  monthlyMicros: 150_000_000,
  creditText: "Cards, films and rooms to think.",
  state: "credited",
  how: "offered",
  startsOn: "2026-08-01",
  renewsOn: "2026-10-01",
  endsOn: null,
  since: "2026-08-01",
  offeredBy: null,
  createdAt: "2026-07-28T17:00:00.000Z",
  creditsThisMonth: 428,
  airsOn: 6,
  canEnd: true,
  ...over
});

const slot = (over: Partial<CatalogSlot> = {}): CatalogSlot => ({
  series: NIGHTS,
  market: IE,
  creditedBy: "house",
  sponsorshipId: null,
  offerId: null,
  priceMicros: 150_000_000,
  forSale: true,
  airsPerDay: 12,
  stations: 5,
  creditsThisMonth: 610,
  canEdit: true,
  ...over
});

describe("the figures", () => {
  it("reads as drawn, with the fund's share not set", () => {
    const body = { month: "2026-09-01", stats: { creditsThisMonth: 2840, monthlyMicros: 150_000_000, marketsWithOpenSlots: 3, fundShareBps: 0, fundShareSet: false } } as CatalogSponsors;
    expect(sponsorStats(body)).toEqual([
      { value: "2,840", caption: "Catalog credits aired in September" },
      { value: "$150.00", caption: "Sponsorship a month, all markets" },
      { value: "3", caption: "Markets with a local sponsor slot open" },
      { value: "0%", caption: "Share to the creator fund. Not set yet" }
    ]);
    expect(sponsorStats({ ...body, stats: { ...body.stats, marketsWithOpenSlots: 1, fundShareBps: 1250, fundShareSet: true } }).slice(2)).toEqual([
      { value: "1", caption: "Market with a local sponsor slot open" },
      { value: "12.5%", caption: "Share to the creator fund" }
    ]);
  });
});

describe("a sponsor's line", () => {
  it("says since when, when it starts or ends, or that it's waiting", () => {
    expect(sponsorLine(sponsor())).toBe("Since August");
    expect(sponsorLine(sponsor({ state: "starting", startsOn: "2026-10-01" }))).toBe("Starts October 1");
    expect(sponsorLine(sponsor({ state: "ending", endsOn: "2026-09-30" }))).toBe("Ends September 30");
    expect(sponsorLine(sponsor({ state: "offered" }))).toBe("Offered, waiting for their answer");
    expect(possessive("Inland Empire Libraries")).toBe("Inland Empire Libraries'");
    expect(possessive("Clear")).toBe("Clear's");
  });
});

describe("a slot's cell", () => {
  it("names who the credit thanks, then the price or why it can't be bought", () => {
    expect(slotCell(slot(), [])).toEqual({ who: "Clear", line: "Open slot, $150.00 a month", open: true });
    expect(slotCell(slot({ priceMicros: null, forSale: false }), [])).toEqual({ who: "Clear", line: "Not for sale: no price set", open: false });
    const s = sponsor();
    expect(slotCell(slot({ creditedBy: "sponsor", sponsorshipId: s.id, forSale: false }), [s])).toEqual({ who: "Inland Empire Libraries", line: "$150.00 a month", open: false });
    const offered = sponsor({ id: U(12), state: "offered", business: { id: U(13), name: "Orange Street Coffee" } });
    expect(slotCell(slot({ offerId: offered.id, forSale: false }), [offered])).toEqual({ who: "Clear", line: "Offered to Orange Street Coffee", open: false });
    const starting = sponsor({ state: "starting", startsOn: "2026-10-01" });
    expect(slotCell(slot({ sponsorshipId: starting.id, forSale: false }), [starting]).line).toBe("Starts October 1. Clear until then");
    const every = sponsor({ id: U(14), series: null });
    expect(slotCell(slot({ creditedBy: "every_series" }), [every])).toMatchObject({ who: "Inland Empire Libraries", line: "Its every-series sponsor" });
  });

  it("says how often it airs there", () => {
    expect(airsLine(slot())).toBe("Airs 12 times a day here, on 5 stations");
    expect(airsLine(slot({ airsPerDay: 1, stations: 1 }))).toBe("Airs once a day here, on 1 station");
    expect(airsLine(slot({ airsPerDay: 0, stations: 1 }))).toBe("Airs less than once a day here, on 1 station");
    expect(airsLine(slot({ stations: 0 }))).toBe("Not airing here this week");
  });
});

describe("the form and the URL", () => {
  it("starts this month or one of the next three", () => {
    expect(startMonths("2026-11-01").map((m) => m.label)).toEqual(["November 1, this month", "December 1", "January 1", "February 1"]);
    expect(startMonths("2026-11-01")[2]!.value).toBe("2027-01-01");
  });

  it("keeps the selection in the URL", () => {
    for (const s of [{ kind: "house" }, { kind: "sponsor", id: U(10) }, { kind: "slot", seriesId: null, marketId: IE.id }, { kind: "slot", seriesId: NIGHTS.id, marketId: IE.id }] as const) {
      expect(parseSelection(selectionKey(s))).toEqual(s);
    }
    expect(parseSelection("nonsense")).toBeNull();
  });
});
