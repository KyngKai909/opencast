// ledger for a business: the balance, movements, funding, adding and taking out money, deposits.
// And starting a business (spots.createBusiness), where getting started begins. The Money area
// owns this file. Every money move goes through db.ts's move().

import { http, HttpResponse, type HttpHandler } from "msw";
import { ledgerApi, spotsApi, stationsApi, type Balance, type Business, type FundingSource, type Movement } from "@opencast/contracts";
import { BalanceX, DepositQuoteX, getCategoryReach, lookupPlace } from "../../api/ext/money";
import { now } from "../../lib/clock";
import { roleOn } from "../access";
import { balanceOf, dbBusiness, getDb, move, saveDb } from "../db";
import { MARKET } from "../fixtures/stations";
import {
  bankArrival,
  categoryReach,
  depositAddressOf,
  depositFee,
  depositMovement,
  estimateBasis,
  findPlace,
  moneyState,
  REFERENCE_STATION,
  roughAirings,
  saveMoneyState,
  shortHex,
  sourceLabel,
  USDC
} from "../fixtures/money";
import { fail, needsUser, path, reply } from "../respond";
import { pauseForBalance, resumeAfterTopUp } from "../fixtures/spots";

/** A fresh id: unique across reloads, in the contracts' uuid shape. */
let n = 0;
export function newId(): string {
  const tail = `${Date.now() % 1e10}`.padStart(10, "0") + String(++n % 100).padStart(2, "0");
  return `00000000-0000-4000-a000-${tail}`;
}

/** Movements the filter keeps: money in and out, or airings (held, aired, returned). */
export const MOVEMENT_FILTER: Record<"money" | "airings", ReadonlyArray<Movement["kind"]>> = {
  money: ["added", "withdrawn", "fee", "refund", "order", "sponsorship"],
  airings: ["aired", "held", "returned"]
};

export function filterMovements(list: Movement[], filter: "all" | "money" | "airings", before?: string, limit = 50): Movement[] {
  const kept = list.filter((m) => filter === "all" || MOVEMENT_FILTER[filter].includes(m.kind)).filter((m) => !before || m.at < before);
  return [...kept].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/**
 * Deposits whose time has come arrive (bank transfers on the mock clock), then auto top-up adds
 * money when what's available drops below its days, if it's on and nothing is already on its way.
 */
export function settle(businessId: string) {
  const b = balanceOf(businessId);
  const s = moneyState();
  const t = now();
  const due = b.pendingDeposits.filter((d) => d.expectedAt && Date.parse(d.expectedAt) <= t.getTime());
  for (const d of due) {
    b.pendingDeposits = b.pendingDeposits.filter((x) => x.id !== d.id);
    const meta = s.deposits[d.id];
    const source = b.fundingSources.find((f) => f.id === meta?.sourceId) ?? b.fundingSources.find((f) => f.kind === d.method);
    const words = source ? depositMovement(source) : { label: "Added by bank transfer", detail: null };
    move(businessId, { kind: "added", label: words.label, detail: words.detail, amountMicros: d.amountMicros, at: d.expectedAt! });
    if (meta) meta.status = "arrived";
    // Money arrived: spots paused for the balance come back by themselves (A49).
    resumeAfterTopUp(businessId);
  }
  const biz = dbBusiness(businessId);
  const auto = biz?.autoTopUp;
  if (auto?.on && auto.amountMicros && b.pacePerDayMicros > 0 && b.pendingDeposits.length === 0 && b.availableMicros < auto.belowDays * b.pacePerDayMicros) {
    const source = b.fundingSources.find((f) => f.isDefault) ?? b.fundingSources[0];
    if (source) deposit(businessId, source, auto.amountMicros);
  }
  if (due.length) {
    saveDb();
    saveMoneyState();
  }
}

/** Adds money from a source: pending for a bank transfer, at once (with any card fee) otherwise. */
export function deposit(businessId: string, source: FundingSource, amountMicros: number): { depositId: string; status: "pending" | "arrived" } {
  const b = balanceOf(businessId);
  const id = newId();
  const s = moneyState();
  if (source.kind === "clear_bank") {
    b.pendingDeposits.push({ id, amountMicros, expectedAt: bankArrival(now()).toISOString(), method: source.kind });
    s.deposits[id] = { businessId, sourceId: source.id, amountMicros, status: "pending" };
    saveDb();
  } else {
    const words = depositMovement(source);
    move(businessId, { kind: "added", label: words.label, detail: words.detail, amountMicros });
    const fee = depositFee(amountMicros, source.kind);
    if (fee > 0) move(businessId, { kind: "fee", label: "Card fee", detail: "Stripe's fee, at cost", amountMicros: -fee });
    s.deposits[id] = { businessId, sourceId: source.id, amountMicros, status: "arrived" };
    resumeAfterTopUp(businessId);
  }
  saveMoneyState();
  return { depositId: id, status: source.kind === "clear_bank" ? "pending" : "arrived" };
}

function bodyOf<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, raw: unknown): T | Response {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields = Object.fromEntries(r.error.issues.map((i) => [i.path.map(String).join("."), i.message]));
  return HttpResponse.json({ error: { code: "invalid", message: "Check the highlighted fields.", fields } }, { status: 400 });
}

/** The balance, with the account USDC from Clear is sent to (E7). */
const balanceReply = (id: string) => reply(BalanceX, { ...(balanceOf(id) satisfies Balance), depositAddress: depositAddressOf(id) });

export const moneyHandlers: HttpHandler[] = [
  http.get(path(ledgerApi.getBalance), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    settle(id);
    return balanceReply(id);
  }),

  http.get(path(ledgerApi.listMovements), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    settle(id);
    const q = ledgerApi.listMovements.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) return fail(400, "invalid", "That filter isn't one of All, Money in and out or Airings.");
    return reply(ledgerApi.listMovements.response, filterMovements(getDb().movements[id] ?? [], q.data.filter, q.data.before, q.data.limit));
  }),

  http.post(path(ledgerApi.addFundingSource), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "manage", "Only the owner can change where money comes from.");
    if (r instanceof Response) return r;
    const body = bodyOf(ledgerApi.addFundingSource.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    const b = balanceOf(id);
    // A Clear account by its link ("linked"): the caller's linked Clear wallet becomes a source.
    const link = body.kind === "clear_account" && body.token === "linked" ? getDb().clearLinks[p.id] : null;
    if (body.kind === "clear_account" && body.token === "linked" && !link) return fail(409, "clear_not_linked", "Connect Clear first.");
    const label = sourceLabel(body.kind, link?.address);
    let source = b.fundingSources.find((f) => f.kind === body.kind && f.label === label);
    if (!source) {
      source = { id: newId(), kind: body.kind, label, isDefault: false };
      b.fundingSources.push(source);
    }
    if (body.makeDefault || b.fundingSources.length === 1) for (const f of b.fundingSources) f.isDefault = f.id === source.id;
    saveDb();
    return reply(ledgerApi.addFundingSource.response, b.fundingSources, 201);
  }),

  http.post(path(ledgerApi.quoteDeposit), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "spend", "Only the owner and managers can add money.");
    if (r instanceof Response) return r;
    const body = bodyOf(ledgerApi.quoteDeposit.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    const basis = estimateBasis(getDb().spots.filter((s) => s.businessId === id));
    return reply(DepositQuoteX, {
      amountMicros: body.amountMicros,
      feeMicros: depositFee(body.amountMicros, body.method),
      arrives: body.method === "clear_bank" ? "In 1 to 2 business days" : "Right away",
      roughAirings: roughAirings(body.amountMicros, basis),
      basis: { ...basis, station: basis.rateKind === "per_thousand" ? REFERENCE_STATION : null }
    });
  }),

  http.post(path(ledgerApi.addMoney), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "spend", "Only the owner and managers can add money.");
    if (r instanceof Response) return r;
    const body = bodyOf(ledgerApi.addMoney.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    settle(id);
    const source = balanceOf(id).fundingSources.find((f) => f.id === body.fundingSourceId);
    if (!source) return fail(404, "not_found", "That funding source wasn't found.");
    const d = deposit(id, source, body.amountMicros);
    return reply(ledgerApi.addMoney.response, { ...d, balance: balanceOf(id) }, 201);
  }),

  http.post(path(ledgerApi.cancelDeposit), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "spend", "Only the owner and managers can add money.");
    if (r instanceof Response) return r;
    const depositId = String(params.depositId);
    const b = balanceOf(id);
    const meta = moneyState().deposits[depositId];
    if (!b.pendingDeposits.some((d) => d.id === depositId)) {
      return meta?.status === "arrived" ? fail(409, "arrived", "That money has already arrived, so it can't be undone.") : fail(404, "not_found", "That deposit wasn't found.");
    }
    b.pendingDeposits = b.pendingDeposits.filter((d) => d.id !== depositId);
    if (meta) meta.status = "cancelled";
    saveDb();
    saveMoneyState();
    return balanceReply(id);
  }),

  http.post(path(ledgerApi.quoteClearTransfer), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "spend", "Only the owner and managers can add money.");
    if (r instanceof Response) return r;
    const body = bodyOf(ledgerApi.quoteClearTransfer.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    const link = getDb().clearLinks[p.id];
    if (!link) return fail(409, "clear_not_linked", "Connect Clear first.");
    if (link.access !== "full") return fail(409, "clear_read_only", "Clear shares this account read-only, so money is added inside Clear.");
    return reply(ledgerApi.quoteClearTransfer.response, {
      to: depositAddressOf(id),
      token: { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals },
      chainId: USDC.chainId,
      amountUnits: String(body.amountMicros),
      from: link.address
    });
  }),

  http.post(path(ledgerApi.confirmClearTransfer), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "spend", "Only the owner and managers can add money.");
    if (r instanceof Response) return r;
    const body = bodyOf(ledgerApi.confirmClearTransfer.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    const s = moneyState();
    const tx = body.txHash.toLowerCase();
    const seen = s.clearTransfers[tx];
    if (seen) {
      if (seen.businessId !== id || seen.amountMicros !== body.amountMicros) return fail(409, "tx_used", "That transfer was already counted.");
      return reply(ledgerApi.confirmClearTransfer.response, { depositId: seen.depositId, status: "arrived", balance: balanceOf(id) }, 201);
    }
    const link = getDb().clearLinks[p.id];
    if (!link) return fail(409, "clear_not_linked", "Connect Clear first.");
    const depositId = newId();
    move(id, { kind: "added", label: "Added from Clear", detail: `From ${shortHex(link.address)}`, amountMicros: body.amountMicros });
    resumeAfterTopUp(id);
    s.clearTransfers[tx] = { businessId: id, depositId, amountMicros: body.amountMicros };
    saveMoneyState();
    return reply(ledgerApi.confirmClearTransfer.response, { depositId, status: "arrived", balance: balanceOf(id) }, 201);
  }),

  http.post(path(ledgerApi.withdraw), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "manage", "Only the owner can take money out.");
    if (r instanceof Response) return r;
    const body = bodyOf(ledgerApi.withdraw.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    settle(id);
    const b = balanceOf(id);
    const source = b.fundingSources.find((f) => f.id === body.fundingSourceId);
    if (!source) return fail(404, "not_found", "That funding source wasn't found.");
    if (body.amountMicros > b.availableMicros) return fail(422, "over_available", "That's more than is available.");
    move(id, { kind: "withdrawn", label: "Taken out", detail: `To ${source.label}`, amountMicros: -body.amountMicros });
    // Less than a day of airings left: the spots pause and stations are told (A49).
    pauseForBalance(id);
    return reply(ledgerApi.withdraw.response, { payoutId: newId(), balance: b }, 201);
  }),

  http.post(path(spotsApi.createBusiness), async ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const body = bodyOf(spotsApi.createBusiness.body, await request.json().catch(() => null));
    if (body instanceof Response) return body;
    if (body.customersWhere !== "online" && body.locations.length === 0) return fail(400, "invalid", "Say where your customers are.");
    if (body.customersWhere === "online" && body.marketIds.length === 0) return fail(400, "invalid", "Choose at least one market.");
    const db = getDb();
    const business: Business = {
      id: newId(),
      name: body.name,
      category: body.category,
      about: body.about ?? null,
      website: body.website ?? null,
      logoUrl: null,
      customersWhere: body.customersWhere,
      locations: body.locations.map((l) => ({
        id: newId(),
        kind: l.kind,
        label: l.label ?? null,
        streetAddress: l.streetAddress ?? null,
        city: l.city,
        latitude: l.latitude,
        longitude: l.longitude,
        radiusMiles: l.radiusMiles ?? null
      })),
      marketIds: body.customersWhere === "online" ? body.marketIds : [MARKET.id],
      warnDays: [3, 1],
      autoTopUp: { on: false, amountMicros: null, belowDays: 3 },
      receiptsEmail: null,
      legalName: null,
      einLast4: null,
      createdAt: now().toISOString()
    };
    db.businesses.push(business);
    db.members.push({ businessId: business.id, personId: p.id, role: "owner", note: null, lastInAt: now().toISOString() });
    balanceOf(business.id);
    db.movements[business.id] = [];
    saveDb();
    return reply(spotsApi.createBusiness.response, business, 201);
  }),

  http.get(path(stationsApi.listMarkets), () => reply(stationsApi.listMarkets.response, [{ ...MARKET, open: true }])),

  http.get(path(getCategoryReach), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    if (String(params.marketId) !== MARKET.id) return fail(404, "not_found", "That market wasn't found.");
    const category = new URL(request.url).searchParams.get("category") ?? "";
    if (!category) return fail(400, "invalid", "Choose a category.");
    return reply(getCategoryReach.response, categoryReach(category));
  }),

  http.get(path(lookupPlace), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const place = findPlace(q);
    if (!place) return fail(404, "not_found", "That place isn't in a market Opencast is in yet. Check the town.");
    return reply(lookupPlace.response, place);
  })
];
