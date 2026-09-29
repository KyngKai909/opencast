// sponsorships (checkCredit, offerSponsorship, listBusinessSponsorships, endSponsorship, and the
// sponsor-targets, P16) and made to order (listMakers, orderSpot, listBusinessOrders,
// getOrder, attachBriefFile, acceptQuote, reviewDelivery, addOrderNote, cancelOrder).
// Master control's side is answered here too, for the mock-only control that stands in for the
// station (decideSponsorship, quoteOrder, deliverOrder, markOwnMistake) and for Opencast's review
// (resolveOrderDispute). The rules live in fixtures/deals.ts.
// The Sponsorships and orders area owns this file.

import { http, type HttpHandler } from "msw";
import { spotsApi } from "@opencast/contracts";
import { roleOn } from "../access";
import { OSC_ID } from "../fixtures/businesses";
import * as deals from "../fixtures/deals";
import { fail, needsUser, path, reply } from "../respond";

type Fail = deals.Fail;
const isFail = (x: unknown): x is Fail => !!x && typeof x === "object" && "status" in x && "code" in x;
const failed = (f: Fail) => fail(f.status, f.code, f.message);

async function json(request: Request): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

function orderFor(id: string) {
  return deals.getDeals().orders.find((o) => o.id === id);
}

function sponsorshipFor(id: string) {
  return deals.getDeals().sponsorships.find((x) => x.id === id);
}

const order = (o: deals.FxOrder, status = 200) => reply(spotsApi.getOrder.response, deals.publicOrder(o), status);
const sponsorship = (x: deals.FxSponsorship, status = 200) => reply(spotsApi.offerSponsorship.response, deals.publicSponsorship(x), status);

export const dealsHandlers: HttpHandler[] = [
  // ---- Sponsorships ----

  http.post(path(spotsApi.checkCredit), async ({ request }) => {
    const body = spotsApi.checkCredit.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "A credit is 200 characters at most.");
    return reply(spotsApi.checkCredit.response, deals.checkCredit(body.data.text));
  }),

  http.get(path(spotsApi.listSponsorTargets), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", "Viewers see results, airings and statements.");
    if (r instanceof Response) return r;
    deals.settle();
    return reply(spotsApi.listSponsorTargets.response, deals.targetsFor(id));
  }),

  http.get(path(spotsApi.listBusinessSponsorships), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", "Viewers see results, airings and statements.");
    if (r instanceof Response) return r;
    deals.settle();
    const list = deals.getDeals().sponsorships.filter((x) => x.business.id === id);
    return reply(spotsApi.listBusinessSponsorships.response, list.map(deals.publicSponsorship));
  }),

  http.post(path(spotsApi.offerSponsorship), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise");
    if (r instanceof Response) return r;
    const body = spotsApi.offerSponsorship.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "Something in the request isn't right.");
    const x = deals.offerSponsorship(id, body.data);
    return isFail(x) ? failed(x) : sponsorship(x, 201);
  }),

  http.post(path(spotsApi.endSponsorship), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const x = sponsorshipFor(String(params.sponsorshipId));
    if (!x) return fail(404, "not_found", "That sponsorship wasn't found.");
    const r = roleOn(x.business.id, p, "advertise");
    if (r instanceof Response) return r;
    const out = deals.endSponsorship(x);
    return isFail(out) ? failed(out) : sponsorship(out);
  }),

  // The station's answer: in the mock, anyone signed in can stand in for master control.
  http.post(path(spotsApi.decideSponsorship), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const x = sponsorshipFor(String(params.sponsorshipId));
    if (!x) return fail(404, "not_found", "That sponsorship wasn't found.");
    const body = spotsApi.decideSponsorship.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "Approve, or decline with a reason.");
    const out = deals.decideSponsorship(x, body.data);
    return isFail(out) ? failed(out) : sponsorship(out);
  }),

  // ---- Production orders ----

  http.get(path(spotsApi.listMakers), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    // P18: each maker's history with the business asked about (Orange Street's Fall menu, by BEAT).
    const businessId = new URL(request.url).searchParams.get("businessId");
    return reply(spotsApi.listMakers.response, deals.MAKERS.map((m) => ({ ...m, history: businessId === OSC_ID ? m.history : null })));
  }),

  http.get(path(spotsApi.listBusinessOrders), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", "Viewers see results, airings and statements.");
    if (r instanceof Response) return r;
    deals.settle();
    return reply(spotsApi.listBusinessOrders.response, deals.getDeals().orders.filter((o) => o.business.id === id).map(deals.publicOrder));
  }),

  http.post(path(spotsApi.orderSpot), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise");
    if (r instanceof Response) return r;
    const body = spotsApi.orderSpot.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "The brief needs a name, a length, what it's about and a date.");
    const o = deals.orderSpot(id, body.data);
    return isFail(o) ? failed(o) : order(o, 201);
  }),

  http.get(path(spotsApi.getOrder), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    deals.settle();
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const r = roleOn(o.business.id, p, "advertise", "Viewers see results, airings and statements.");
    if (r instanceof Response) return r;
    return order(o);
  }),

  http.post(path(spotsApi.attachBriefFile), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const r = roleOn(o.business.id, p, "advertise");
    if (r instanceof Response) return r;
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return fail(400, "no_file", "Choose a file to add.");
    const out = deals.attachBriefFile(o, (file as File).name || null);
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.acceptQuote), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const r = roleOn(o.business.id, p, "spend");
    if (r instanceof Response) return r;
    const out = deals.acceptQuote(o);
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.addOrderNote), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const r = roleOn(o.business.id, p, "advertise");
    if (r instanceof Response) return r;
    const body = spotsApi.addOrderNote.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "Write the note first.");
    const out = deals.addOrderNote(o, p.displayName ?? p.email, body.data);
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.reviewDelivery), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const body = spotsApi.reviewDelivery.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "Approve, ask for changes, or ask Opencast to review.");
    // Approving releases money: "approve orders" is the spend right. Changes and review are order work.
    const r = roleOn(o.business.id, p, body.data.decision === "approve" ? "spend" : "advertise");
    if (r instanceof Response) return r;
    const out = deals.reviewDelivery(o, body.data.decision);
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.cancelOrder), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const r = roleOn(o.business.id, p, "advertise");
    if (r instanceof Response) return r;
    const out = deals.cancelOrder(o);
    return isFail(out) ? failed(out) : order(out);
  }),

  // The maker's side and Opencast's review, for the mock-only control.
  http.post(path(spotsApi.quoteOrder), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const body = spotsApi.quoteOrder.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "Quote a price, a date and the rounds, or pass.");
    const out = deals.quoteOrder(o, body.data);
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.deliverOrder), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const out = deals.deliverOrder(o);
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.markOwnMistake), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const out = deals.markOwnMistake(o, String(params.noteId));
    return isFail(out) ? failed(out) : order(out);
  }),

  http.post(path(spotsApi.resolveOrderDispute), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderFor(String(params.orderId));
    if (!o) return fail(404, "not_found", "That order wasn't found.");
    const body = spotsApi.resolveOrderDispute.body.safeParse(await json(request));
    if (!body.success) return fail(400, "bad_request", "Pay the maker, refund, or split.");
    const out = deals.resolveOrderDispute(o, body.data.outcome, body.data.makerMicros);
    return isFail(out) ? failed(out) : order(out);
  })
];
