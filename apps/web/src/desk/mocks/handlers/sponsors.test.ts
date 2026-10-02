// The desk mock's Catalog sponsors answer as the API does: the team reads; a market's lead or an
// admin offers, assigns and ends there; a slot is for sale once the rules price it; one live
// sponsorship or offer per slot; an assignment from this month holds its first month or isn't made;
// the credit is checked; ending keeps the credit to the end of the paid month.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { catalogSponsorsApi, deskApi } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEE = "lee@opencast.example";
const RAE = "rae@opencast.example";
const IE = U(90001);
const LA = U(90002);
const HD = U(90003);
const NIGHTS = U(7101);
const CARTOONS = U(7102);
const LIBRARIES = U(9601);
const COFFEE = U(9602);
const TUMBLEWEED = U(9603);

let handlers: HttpHandler[];
let api: ReturnType<typeof apiFor>;
let settings: typeof import("../settingsDb");
let sponsors: typeof import("../sponsorsDb");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  settings = await import("../settingsDb");
  sponsors = await import("../sponsorsDb");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  settings.resetSettings();
  sponsors.resetSponsors();
});

const page = async (as?: string) => catalogSponsorsApi.getCatalogSponsors.response.parse((await api("GET", "/admin/catalog/sponsors", { as })).json);
const slot = (body: Awaited<ReturnType<typeof page>>, seriesId: string | null, marketId: string) => body.slots.find((s) => (s.series?.id ?? null) === seriesId && s.market.id === marketId)!;
const offer = (body: Record<string, unknown>, as?: string) =>
  api("POST", "/admin/catalog/sponsors/offers", { as, body: { seriesId: CARTOONS, marketId: IE, businessId: COFFEE, creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-10-01", ...body } });

describe("Catalog sponsors on the mocks", () => {
  it("reads as drawn: Clear everywhere but Nights in the Inland Empire", async () => {
    const body = await page();
    expect(body.stats).toEqual({ creditsThisMonth: 2840, monthlyMicros: 150_000_000, marketsWithOpenSlots: 3, fundShareBps: 0, fundShareSet: false });
    expect(body.house).toMatchObject({ name: "Clear", creditsThisMonth: 2412, billedMicros: null });
    expect(body.sponsors).toEqual([expect.objectContaining({ business: { id: LIBRARIES, name: "Inland Empire Libraries" }, state: "credited", since: "2026-08-01", renewsOn: "2026-10-01", airsOn: 6, creditsThisMonth: 428 })]);
    expect(slot(body, NIGHTS, IE)).toMatchObject({ creditedBy: "sponsor", forSale: false, priceMicros: 150_000_000 });
    expect(slot(body, CARTOONS, IE)).toMatchObject({ creditedBy: "house", forSale: true, airsPerDay: 12 });
    expect(slot(body, null, LA)).toMatchObject({ priceMicros: 400_000_000, forSale: true });
    expect((await api("GET", "/admin/catalog/sponsors", { as: "other" })).status).toBe(403);
  });

  it("keeps a market lead to their market, and the rest of the team to reading", async () => {
    expect((await page(LEE)).editableMarketIds).toEqual([HD]);
    expect((await page(RAE)).editableMarketIds).toEqual([]);
    expect((await offer({}, LEE)).status).toBe(403);
    expect((await offer({ marketId: HD }, LEE)).status).toBe(200);
    expect((await api("POST", `/admin/catalog/sponsors/${U(9701)}/end`, { as: LEE })).status).toBe(403);
  });

  it("offers a priced, open slot once, with a credit that passes; the business answers", async () => {
    expect((await offer({ creditText: "Half off lattes, stop by now" })).json.error.code).toBe("credit_text");
    expect((await offer({ seriesId: NIGHTS })).json.error.code).toBe("slot_taken");
    expect((await offer({ startsOn: "2026-08-01" })).json.error.code).toBe("bad_month");
    const made = await offer({});
    expect(made.status).toBe(200);
    const s = catalogSponsorsApi.offerCatalogSponsorship.response.parse(made.json);
    expect(s).toMatchObject({ state: "offered", how: "offered", monthlyMicros: 150_000_000, offeredBy: { name: "Dee A." } });
    expect((await offer({ businessId: TUMBLEWEED })).status).toBe(409);
    expect(slot(await page(), CARTOONS, IE)).toMatchObject({ offerId: s.id, forSale: false });
    expect((await api("POST", `/__mock/desk/catalog-sponsorships/${s.id}/answer`, { body: { decision: "accept" } })).status).toBe(200);
    const after = await page();
    expect(after.sponsors.find((x) => x.id === s.id)).toMatchObject({ state: "starting", renewsOn: "2026-10-01" });
    expect(slot(after, CARTOONS, IE)).toMatchObject({ sponsorshipId: s.id, forSale: false, creditedBy: "house" });
  });

  it("assigns only when the first month can be held, and not before the price is set", async () => {
    const assign = (body: Record<string, unknown>) =>
      api("POST", "/admin/catalog/sponsors/assignments", { body: { seriesId: null, marketId: LA, businessId: TUMBLEWEED, creditText: "Tumbleweed Books, on Main Street.", startsOn: "2026-09-01", agreed: true, ...body } });
    const broke = await assign({});
    expect(broke.json.error).toMatchObject({ code: "insufficient_balance", message: "Tumbleweed Books doesn't have $400.00 available to hold for the first month." });
    const made = catalogSponsorsApi.assignCatalogSponsorship.response.parse((await assign({ businessId: LIBRARIES, creditText: "Cards, films and rooms to think." })).json);
    expect(made).toMatchObject({ state: "credited", how: "assigned", series: null });
    expect(slot(await page(), CARTOONS, LA).creditedBy).toBe("every_series");

    // No price: not for sale.
    await api("POST", "/admin/rules/catalog.sponsor_prices/versions", { body: { value: { seriesMonthlyMicros: null, everySeriesMonthlyMicros: null }, effectiveFrom: "2026-09-27", scope: HD } });
    expect(deskApi.listRules.response.parse((await api("GET", "/admin/rules")).json).rules.some((r) => r.key === "catalog.sponsor_prices" && r.group === "sponsors")).toBe(true);
    expect((await assign({ marketId: HD, businessId: LIBRARIES })).json.error.code).toBe("not_for_sale");
    expect(slot(await page(), NIGHTS, HD)).toMatchObject({ priceMicros: null, forSale: false });
  });

  it("ends a sponsorship to the end of its paid month, and withdraws an offer", async () => {
    const ended = catalogSponsorsApi.endCatalogSponsorship.response.parse((await api("POST", `/admin/catalog/sponsors/${U(9701)}/end`)).json);
    expect(ended).toMatchObject({ state: "ending", endsOn: "2026-09-30", canEnd: false });
    expect(slot(await page(), NIGHTS, IE)).toMatchObject({ creditedBy: "sponsor", forSale: true });
    const made = await offer({});
    expect((await api("POST", `/admin/catalog/sponsors/${made.json.id}/end`)).json.state).toBe("ended");
  });

  it("finds businesses by name", async () => {
    const found = catalogSponsorsApi.catalogSponsorBusinesses.response.parse((await api("GET", "/admin/catalog/sponsors/businesses", { query: { q: "coffee" } })).json);
    expect(found).toEqual([{ id: COFFEE, name: "Orange Street Coffee", category: "Coffee and food", city: "Redlands" }]);
  });
});
