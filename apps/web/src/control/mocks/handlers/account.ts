// Pay-as-you-go (follow-up Phase 2): the Station account in Station settings (billingApi). Fixtures
// in ../fixtures/account.ts: Inland Sound Lab inside the free allowance, BEAT paid from its
// earnings, HALL in its grace period (any station can be put in any state with `setAccountState`).
//
// Who sees what (station-settings 03.1, the contract's summaries): owners and operators see the
// account ("Earnings, payouts and the station account: operators see only"); only owners change
// caps and the funding source, add or remove a card, or pay. Hosts and strangers see none of it.

import { http } from "msw";
import { billingApi, USAGE_TYPES, type UsageType } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { dbStation, getDb, membership } from "../db";
import { mockAccount, payDue, saveAccounts, stationAccount } from "../fixtures/account";
import { availableMicros } from "../fixtures/earnings";
import type { MockPerson } from "../fixtures/people";
import { bodyOf, fail, needsUser, path, reply } from "../respond";

type Need = "see" | "own";

function guard(person: MockPerson, stationId: string, need: Need): Response | null {
  if (!dbStation(stationId)) return fail(404, "not_found", "That station wasn't found.");
  const m = membership(stationId, person.id);
  if (!m) return fail(404, "not_found", "That station wasn't found.");
  if (m.role === "host") return fail(403, "forbidden", "Hosts can go live on their own blocks only.");
  if (need === "own" && m.role !== "owner") return fail(403, "forbidden", "Only the station's owner can do that.");
  return null;
}

function view(stationId: string, person: MockPerson) {
  const owner = membership(stationId, person.id)?.role === "owner";
  const link = getDb().clearLinks[person.id];
  const clear = owner && link ? { address: link.address, access: link.access } : null;
  return stationAccount(stationId, { owner, clear, earningsAvailableMicros: availableMicros(stationId) });
}

export const accountHandlers = [
  http.get(path(billingApi.getStationAccount), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "see");
    if (no) return no;
    return reply(billingApi.getStationAccount.response, view(id, p));
  }),

  http.put(path(billingApi.setUsageCaps), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const body = await bodyOf<{ caps?: Partial<Record<UsageType, number | null>> }>(request);
    const a = mockAccount(id);
    for (const [type, micros] of Object.entries(body?.caps ?? {})) {
      const def = USAGE_TYPES[type as UsageType];
      if (!def) return fail(400, "bad_request", "That usage type doesn't exist.", { caps: "Unknown type" });
      if (!def.cappable && micros !== null) return fail(422, "not_cappable", `${def.label} is free, so it has no cap.`);
      if (micros === null || micros === undefined) delete a.caps[type as UsageType];
      else if (typeof micros !== "number" || micros < 0) return fail(400, "bad_request", "A cap is a dollar amount.", { caps: "Invalid" });
      else a.caps[type as UsageType] = micros;
    }
    saveAccounts();
    return reply(billingApi.setUsageCaps.response, view(id, p));
  }),

  http.post(path(billingApi.startCardSetup), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const setupIntentId = `seti_mock_${Math.random().toString(36).slice(2, 10)}`;
    return reply(billingApi.startCardSetup.response, { setupIntentId, clientSecret: `${setupIntentId}_secret_mock`, publishableKey: null }, 201);
  }),

  // The mock's cards are named like Stripe's test cards: a SetupIntent with "declined" in it saves one that's always declined.
  http.post(path(billingApi.saveCard), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const body = await bodyOf<{ setupIntentId?: string }>(request);
    if (!body?.setupIntentId?.startsWith("seti_")) return fail(422, "card_not_saved", "That card wasn't saved: that card setup isn't this station's.");
    const a = mockAccount(id);
    const declines = body.setupIntentId.includes("declined");
    a.card = declines ? { ref: "pm_mock_0002", label: "Visa ending 0002", expiresOn: "2027-03-31", declines } : { ref: `pm_mock_${Date.now()}`, label: "Visa ending 4242", expiresOn: "2029-08-31", declines };
    saveAccounts();
    // A card added while something's due pays it at once (when the card is what pays).
    const source = view(id, p).funding.source;
    if (a.lastMonth.dueMicros > 0 && source === "card") payDue(id, "card");
    return reply(billingApi.saveCard.response, view(id, p));
  }),

  http.delete(path(billingApi.removeCard), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const a = mockAccount(id);
    a.card = null;
    if (a.chosen === "card") a.chosen = null;
    saveAccounts();
    return reply(billingApi.removeCard.response, view(id, p));
  }),

  http.put(path(billingApi.setFundingSource), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const body = await bodyOf<{ source?: "clear" | "card" }>(request);
    const a = mockAccount(id);
    if (body?.source === "card") {
      if (!a.card) return fail(409, "no_card", "Add a card first.");
    } else if (body?.source === "clear") {
      const link = getDb().clearLinks[p.id];
      if (!link) return fail(409, "clear_not_linked", "Clear isn't linked yet. Connect Clear first.");
      if (link.access !== "full") return fail(409, "clear_read_only", "Clear lets Opencast only read your Clear wallet, so it can't pay from it. Add a card instead.");
    } else return fail(400, "bad_request", "Choose Clear or a card.", { source: "Required" });
    a.chosen = body.source;
    saveAccounts();
    return reply(billingApi.setFundingSource.response, view(id, p));
  }),

  http.post(path(billingApi.payUsageNow), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const a = mockAccount(id);
    if (a.lastMonth.dueMicros <= 0) return fail(409, "nothing_due", "Nothing is due.");
    const source = view(id, p).funding.source;
    if (source === "clear") return fail(409, "pay_from_clear", "The station pays from Clear: approve the payment from your Clear wallet.");
    if (!a.card) return fail(409, "no_card", "Add a card first.");
    const paid = payDue(id, "card");
    if (!paid.ok) return fail(422, "card_declined", paid.reason);
    return reply(billingApi.payUsageNow.response, view(id, p));
  }),

  http.post(path(billingApi.quoteClearUsagePayment), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const link = getDb().clearLinks[p.id];
    if (!link) return fail(409, "clear_not_linked", "Clear isn't linked yet. Connect Clear first.");
    if (link.access !== "full") return fail(409, "clear_read_only", "Clear lets Opencast only read your Clear wallet, so it can't pay from it. Add a card instead.");
    const due = mockAccount(id).lastMonth.dueMicros;
    if (due <= 0) return fail(409, "nothing_due", "Nothing is due.");
    return reply(billingApi.quoteClearUsagePayment.response, {
      to: "0x5eC0000000000000000000000000000000000Ca5",
      token: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", decimals: 6 },
      chainId: 84532,
      amountMicros: due,
      amountUnits: String(due),
      from: link.address
    });
  }),

  http.post(path(billingApi.confirmClearUsagePayment), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const body = await bodyOf<{ amountMicros?: number; txHash?: string }>(request);
    if (!body?.txHash || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) return fail(400, "bad_request", "That isn't a transaction hash.", { txHash: "Invalid" });
    const due = mockAccount(id).lastMonth.dueMicros;
    if (due <= 0) return reply(billingApi.confirmClearUsagePayment.response, view(id, p));
    if ((body.amountMicros ?? 0) < due) return fail(409, "amount_changed", `${money(due)} is due now. Send that instead.`);
    payDue(id, "clear");
    return reply(billingApi.confirmClearUsagePayment.response, view(id, p));
  })
];
