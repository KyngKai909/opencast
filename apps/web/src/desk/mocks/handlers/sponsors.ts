// Catalog sponsors (desk-pages 03): the same rules as the API. A slot is for sale once the rules
// price it; one live sponsorship or offer per slot; a market's lead or an admin offers, assigns and
// ends there; an assignment from this month holds its first month or isn't made; ending one keeps
// its credit to the end of the paid month. The business's side (answering an offer) is a mock-mode
// control, `__mock/desk/catalog-sponsorships/:id/answer`.
import { http, HttpResponse, type HttpHandler } from "msw";
import { catalogSponsorsApi as api } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { MARKETS } from "../fixtures/markets";
import { creditProblem, dollars, editableMarkets, isLive, monthOf, nextSponsorId, priceOf, saveSponsors, sponsorableSeries, sponsorsDb, sponsorshipView, sponsorsView, type MockCatalogSponsorship } from "../sponsorsDb";
import { bodyOf, fail, needsDesk, path, reply } from "../respond";
import { MOCK_BASE } from "./mock";

interface SlotBody {
  seriesId?: string | null;
  marketId?: string;
  businessId?: string;
  creditText?: string;
  startsOn?: string;
  agreed?: boolean;
}

function create(p: Exclude<ReturnType<typeof needsDesk>, Response>, body: SlotBody | null, mode: "offer" | "assign"): Response {
  const d = sponsorsDb();
  const market = MARKETS.find((m) => m.id === body?.marketId);
  if (!body || !market) return fail(404, "not_found", "That market wasn't found.");
  if (!editableMarkets(p).includes(market.id)) return fail(403, "desk_role", "Only this market's lead or an admin can do that.");
  if (mode === "assign" && body.agreed !== true) return fail(400, "bad_request", "Check the form: confirm they've agreed.", { agreed: "Required" });
  const seriesId = body.seriesId ?? null;
  const series = seriesId ? sponsorableSeries().find((s) => s.id === seriesId) : null;
  if (seriesId && !series) return fail(404, "not_found", "That series wasn't found.");
  const business = d.businesses.find((b) => b.id === body.businessId);
  if (!business) return fail(404, "not_found", "That business wasn't found.");
  const text = body.creditText?.trim() ?? "";
  if (!text) return fail(400, "bad_request", "Check the form: write the credit.", { creditText: "Required" });
  const problem = creditProblem(text);
  if (problem) return fail(422, "credit_text", problem);
  const thisMonth = monthOf(now().toISOString());
  if (!body.startsOn || !/^\d{4}-\d{2}-01$/.test(body.startsOn) || body.startsOn < thisMonth) return fail(422, "bad_month", "Choose the 1st of this month or a later one.");
  const price = priceOf(market.id, seriesId);
  if (price === null || price <= 0) return fail(422, "not_for_sale", `This slot isn't for sale yet: ${seriesId ? "a series'" : "every series'"} price in ${market.name} isn't set (Settings, Rules, Catalog sponsorship).`);
  if (d.sponsorships.some((s) => s.marketId === market.id && s.seriesId === seriesId && isLive(s))) {
    return fail(409, "slot_taken", `${series?.title ?? "Every catalog series"} in ${market.name} is taken or offered. End that first.`);
  }
  const startsNow = body.startsOn <= thisMonth;
  if (mode === "assign" && startsNow && (d.available[business.id] ?? 0) < price) {
    return fail(422, "insufficient_balance", `${business.name} doesn't have ${dollars(price)} available to hold for the first month.`);
  }
  const row: MockCatalogSponsorship = {
    id: nextSponsorId(),
    businessId: business.id,
    seriesId,
    marketId: market.id,
    monthlyMicros: price,
    creditText: text,
    status: mode === "assign" ? "approved" : "requested",
    offeredBy: p.id,
    assigned: mode === "assign",
    startsOn: body.startsOn,
    paidMonths: mode === "assign" && startsNow ? [thisMonth] : [],
    createdAt: now().toISOString(),
    creditsThisMonth: 0
  };
  if (mode === "assign" && startsNow) d.available[business.id] -= price;
  d.sponsorships.push(row);
  saveSponsors();
  return reply(api.offerCatalogSponsorship.response, sponsorshipView(row, p));
}

export const sponsorsHandlers: HttpHandler[] = [
  http.get(path(api.getCatalogSponsors), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const marketId = new URL(request.url).searchParams.get("marketId") ?? undefined;
    return reply(api.getCatalogSponsors.response, sponsorsView(p, marketId));
  }),

  http.get(path(api.catalogSponsorBusinesses), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
    return reply(
      api.catalogSponsorBusinesses.response,
      sponsorsDb()
        .businesses.filter((b) => !q || b.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 20)
    );
  }),

  http.post(path(api.offerCatalogSponsorship), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    return create(p, await bodyOf<SlotBody>(request), "offer");
  }),

  http.post(path(api.assignCatalogSponsorship), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    return create(p, await bodyOf<SlotBody>(request), "assign");
  }),

  http.post(path(api.endCatalogSponsorship), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const s = sponsorsDb().sponsorships.find((x) => x.id === String(params.sponsorshipId));
    if (!s) return fail(404, "not_found", "That sponsorship wasn't found.");
    if (!editableMarkets(p).includes(s.marketId)) return fail(403, "desk_role", "Only this market's lead or an admin can do that.");
    if (isLive(s)) s.status = "ended";
    saveSponsors();
    return reply(api.endCatalogSponsorship.response, sponsorshipView(s, p));
  }),

  // Mock mode only: the business answers an offer (in the API, from the business's own side).
  http.post(`${MOCK_BASE}/catalog-sponsorships/:sponsorshipId/answer`, async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const d = sponsorsDb();
    const s = d.sponsorships.find((x) => x.id === String(params.sponsorshipId));
    if (!s) return fail(404, "not_found", "That sponsorship wasn't found.");
    if (s.status !== "requested") return fail(422, "already_answered", "That offer has been answered, or withdrawn.");
    const answer = (await bodyOf<{ decision?: string }>(request))?.decision === "decline" ? "decline" : "accept";
    const thisMonth = monthOf(now().toISOString());
    if (answer === "decline") s.status = "declined";
    else {
      if (s.startsOn <= thisMonth) {
        if ((d.available[s.businessId] ?? 0) < s.monthlyMicros) return fail(422, "insufficient_balance", "Not enough available to hold.");
        d.available[s.businessId] -= s.monthlyMicros;
        s.paidMonths.push(thisMonth);
      }
      s.status = "approved";
    }
    saveSponsors();
    return HttpResponse.json({ ok: true });
  })
];
