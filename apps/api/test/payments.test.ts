// The payments layer: the outbox turns ledger entries into provider moves, and after a busy
// stretch (top-ups, holds, airings, withdrawals, payouts, a pledge) the provider's wallets match
// the ledger exactly, for the fake and for Clear. Stripe's webhooks are verified; the Stripe
// adapter's requests are checked against Stripe's own mock server when it's available.
import net from "node:net";
import { spawnSync } from "node:child_process";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { deriveMoves, type PostingForMoves } from "../src/v1/modules/ledger/moves.js";
import { clearPayments, fakeClear, fakePayments, ownAccountsCustody, paymentsFromEnv, StripeCards, stripeKeyProblem } from "../src/v1/payments/index.js";
import { anon, createHarness, market, stationFixture, type Harness } from "./harness.js";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

const posting = (kind: string, micros: number, owner: Partial<PostingForMoves["account"]> = {}, hold?: { id: string; advertiser: string }): PostingForMoves => ({
  account: { kind, advertiserId: null, stationId: null, userId: null, label: null, ...owner },
  micros,
  holdId: hold?.id ?? null,
  holdAdvertiserId: hold?.advertiser ?? null
});

describe("the outbox's rules", () => {
  const hold = { id: "h1", advertiser: "a1" };
  it("a hold is an encumbrance: nothing leaves the business's account", () => {
    expect(deriveMoves([posting("advertiser_available", -$(4), { advertiserId: "a1" }), posting("holds", $(4), {}, hold)], ownAccountsCustody)).toEqual([
      { kind: "encumber", fromWallet: "advertiser:a1", toWallet: null, holdId: "h1", amountMicros: $(4) }
    ]);
  });

  it("an airing releases the hold, then pays the station, Opencast's share and the pool", () => {
    const moves = deriveMoves(
      [
        posting("holds", -$(4), {}, hold),
        posting("station_earnings", $(3.6), { stationId: "s1" }),
        posting("opencast_share", $(0.2)),
        posting("pool", $(0.2))
      ],
      ownAccountsCustody
    );
    expect(moves).toEqual([
      { kind: "release", fromWallet: "advertiser:a1", toWallet: null, holdId: "h1", amountMicros: $(4) },
      { kind: "transfer", fromWallet: "advertiser:a1", toWallet: "station:s1", holdId: null, amountMicros: $(3.6) },
      { kind: "transfer", fromWallet: "advertiser:a1", toWallet: "opencast:treasury", holdId: null, amountMicros: $(0.4) }
    ]);
  });

  it("card money is credited from the treasury; bank money moves itself; the chain's moves are recorded for it", () => {
    expect(deriveMoves([posting("external", -$(100), { label: "stripe" }), posting("advertiser_available", $(100), { advertiserId: "a1" })], ownAccountsCustody)).toEqual([
      { kind: "transfer", fromWallet: "opencast:treasury", toWallet: "advertiser:a1", holdId: null, amountMicros: $(100) }
    ]);
    expect(deriveMoves([posting("external", -$(50), { label: "clear" }), posting("advertiser_available", $(50), { advertiserId: "a1" })], ownAccountsCustody)).toEqual([]);
    expect(deriveMoves([posting("escrow_owed", -$(9), { stationId: "s1" }), posting("escrow", $(9), { stationId: "s1" })], ownAccountsCustody)).toEqual([
      { kind: "transfer", fromWallet: "opencast:settlement", toWallet: "chain:escrow", holdId: null, amountMicros: $(9) }
    ]);
  });
});

/** A busy stretch: card and bank top-ups, a hold settled from an airing, a withdrawal, a payout and a pledge. */
async function busyStretch(h: Harness) {
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const viewer = await h.signIn("Viewer");
  const station = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  const [business] = await h.db.insert(schema.advertisers).values({ name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online" }).returning();
  const ledger = h.services.ledger;
  await ledger.addFundingSource(business.id, { kind: "card", token: "pm_card_4242", makeDefault: true });
  await ledger.addFundingSource(business.id, { kind: "clear_bank", token: "public-sandbox-8810", makeDefault: false });
  const sources = (await ledger.balance(business.id)).fundingSources;
  const card = sources.find((s) => s.kind === "card")!;
  const bank = sources.find((s) => s.kind === "clear_bank")!;

  await ledger.addMoney(business.id, { amountMicros: $(100), fundingSourceId: card.id });
  const bankDeposit = await ledger.addMoney(business.id, { amountMicros: $(50), fundingSourceId: bank.id });
  expect(bankDeposit.status).toBe("pending");
  const [deposit] = await h.db.select().from(schema.deposits).where(eq(schema.deposits.id, bankDeposit.depositId));
  // The bank transfer arrives: the provider says so.
  await anon(h).post("/v1/webhooks/clear").set("content-type", "application/json").send(JSON.stringify({ kind: "deposit_arrived", depositId: deposit.id, transferId: deposit.providerRef })).expect(200);
  expect((await ledger.balance(business.id)).availableMicros).toBe($(150));

  // Holds against a production order (an airing's hold needs a spot row; the money moves the same way).
  const [order] = await h.db
    .insert(schema.productionOrders)
    .values({ advertiserId: business.id, makerStationId: station.id, title: "Fall menu", lengthSec: 30, about: "Coffee", neededBy: "2026-10-30" })
    .returning();
  const held = await h.db.transaction((tx) => ledger.hold(tx, { businessId: business.id, purpose: "production_order", amountMicros: $(10), productionOrderId: order.id }));
  const otherHold = await h.db.transaction((tx) => ledger.hold(tx, { businessId: business.id, purpose: "production_order", amountMicros: $(5), productionOrderId: order.id }));
  await h.db.transaction((tx) =>
    ledger.settle(tx, { holdId: held, stationId: station.id, costMicros: $(8), kind: "production", source: { sourceType: "production_order", sourceId: order.id, idempotencyKey: "t:settle" } })
  );

  await ledger.withdraw(business.id, { amountMicros: $(20), fundingSourceId: bank.id });
  await ledger.moveToBank(station.id, $(3));
  await ledger.pledge(viewer.id, station.id, { cadence: "once", amountMicros: $(25), creditOnAir: false });
  return { business, station, holds: { open: otherHold } };
}

describe("with the fake provider", () => {
  let h: Harness;
  let mirror: ReturnType<typeof fakePayments>["mirror"];
  beforeAll(async () => {
    h = await createHarness({
      payments: (clock) => {
        const p = fakePayments(clock);
        mirror = p.mirror;
        return p;
      }
    });
  }, 60_000);
  afterAll(() => h.close());

  it("sends every move once, and its wallets end up exactly where the ledger says", async () => {
    const { holds } = await busyStretch(h);
    const first = await h.services.ledger.sendMoves();
    expect(first.failed).toBe(0);
    expect(first.sent).toBeGreaterThan(0);
    expect(await h.services.ledger.sendMoves()).toEqual({ sent: 0, failed: 0 });

    const ledgerSays = await h.services.ledger.custodyBalances();
    for (const [wallet, micros] of ledgerSays) expect(mirror.wallets.get(wallet) ?? 0, wallet).toBe(micros);
    for (const [wallet, micros] of mirror.wallets) expect(ledgerSays.get(wallet) ?? 0, wallet).toBe(micros);
    // What's still encumbered is exactly what's still held.
    const open = await h.services.ledger.openAmount([holds.open]);
    expect(mirror.encumbered.get(holds.open)).toBe(open.get(holds.open));
  });
});

describe("with Clear", () => {
  let h: Harness;
  const clear = fakeClear();
  beforeAll(async () => {
    h = await createHarness({ payments: (clock) => clearPayments(clear, null, fakePayments(clock)) });
  }, 60_000);
  afterAll(() => h.close());

  it("opens a Clear account for each business and station, and Clear's balances match the ledger", async () => {
    await busyStretch(h);
    expect((await h.services.ledger.sendMoves()).failed).toBe(0);
    const accounts = await h.db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.provider, "clear"));
    const walletOf = new Map(accounts.map((a) => [a.ref, a.ownerType === "opencast" ? `opencast:${a.ownerLabel}` : `${a.ownerType}:${a.ownerId}`]));
    const ledgerSays = await h.services.ledger.custodyBalances();
    for (const [ref, micros] of clear.balances) expect(micros, walletOf.get(ref)).toBe(ledgerSays.get(walletOf.get(ref)!) ?? 0);
    expect(accounts.map((a) => a.ownerType).sort()).toEqual(["advertiser", "opencast", "station"]);
    // The business's open hold is encumbered at Clear, and nothing more.
    const business = accounts.find((a) => a.ownerType === "advertiser")!;
    expect(clear.encumbered.get(business.ref)).toBe($(5));
  });

  it("retries a move Clear refused, in order, without doing anything twice", async () => {
    const station = (await h.db.select().from(schema.stations))[0];
    const [business] = await h.db.select().from(schema.advertisers);
    const transfer = clear.transfer;
    let refusals = 1;
    clear.transfer = async (input) => {
      if (refusals-- > 0) throw new Error("Clear is busy");
      return transfer(input);
    };
    const [order] = await h.db.select().from(schema.productionOrders);
    const held = await h.db.transaction((tx) => h.services.ledger.hold(tx, { businessId: business.id, purpose: "production_order", amountMicros: $(2), productionOrderId: order.id }));
    await h.db.transaction((tx) =>
      h.services.ledger.settle(tx, { holdId: held, stationId: station.id, costMicros: $(2), kind: "production", source: { sourceType: "production_order", sourceId: order.id, idempotencyKey: "t:settle2" } })
    );
    const before = clear.calls.length;
    const first = await h.services.ledger.sendMoves();
    expect(first.failed).toBe(1);
    const second = await h.services.ledger.sendMoves();
    expect(second.failed).toBe(0);
    expect(await h.services.ledger.sendMoves()).toEqual({ sent: 0, failed: 0 });
    // encumber, release, then the transfer: once each, in that order.
    expect(clear.calls.slice(before)).toEqual([`encumber ${$(2)}`, `release ${$(2)}`, `transfer ${$(2)}`]);
    clear.transfer = transfer;
  });
});

describe("Stripe webhooks", () => {
  const cards = new StripeCards({ secretKey: "sk_test_offline", webhookSecret: "whsec_test_secret" });
  const stripe = new Stripe("sk_test_offline");
  const event = (type: string, object: object) => JSON.stringify({ id: "evt_1", object: "event", type, data: { object }, api_version: "2025-01-01", created: 1, livemode: false });

  it("reads a card top-up's success, signed by Stripe", async () => {
    const payload = event("payment_intent.succeeded", { id: "pi_1", object: "payment_intent", metadata: { app: "opencast", depositId: "dep-1" } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    expect(await cards.parse(Buffer.from(payload), header)).toEqual({ kind: "deposit_arrived", depositId: "dep-1" });
  });

  it("refuses anything not signed with our secret, or changed after signing", async () => {
    const payload = event("payment_intent.succeeded", { id: "pi_1", object: "payment_intent", metadata: { app: "opencast", depositId: "dep-1" } });
    const forged = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    await expect(cards.parse(Buffer.from(payload), forged)).rejects.toThrow();
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    await expect(cards.parse(Buffer.from(payload.replace("dep-1", "dep-2")), header)).rejects.toThrow();
    await expect(cards.parse(Buffer.from(payload), undefined)).rejects.toThrow(/signature/);
  });

  it("reads a monthly pledge's payment", async () => {
    const payload = event("invoice.paid", { id: "in_1", object: "invoice", amount_paid: 1000, parent: { subscription_details: { metadata: { app: "opencast", pledgeId: "pl-1" } } } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    expect(await cards.parse(Buffer.from(payload), header)).toMatchObject({ kind: "pledge_paid", pledgeId: "pl-1", amountMicros: $(10) });
  });

  // Follow-up Phase 2 (2026-09-29): the account is ClearLabs Inc's, shared with Clear.
  it("ignores every event whose object isn't Opencast's (no `app: opencast` in its metadata)", async () => {
    const sign = (payload: string) => stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    const theirs = [
      event("payment_intent.succeeded", { id: "pi_2", object: "payment_intent", metadata: { depositId: "dep-1" } }),
      event("payment_intent.succeeded", { id: "pi_3", object: "payment_intent", metadata: { app: "clear", depositId: "dep-1" } }),
      event("payment_intent.payment_failed", { id: "pi_4", object: "payment_intent", metadata: { usageBillId: "bill-1" } }),
      event("invoice.paid", { id: "in_2", object: "invoice", amount_paid: 1000, parent: { subscription_details: { metadata: { pledgeId: "pl-1" } } } }),
      event("setup_intent.succeeded", { id: "seti_1", object: "setup_intent", metadata: { stationId: "st-1" } }),
      event("account.updated", { id: "acct_1", object: "account", payouts_enabled: true, metadata: { stationId: "st-1" } }),
      event("checkout.session.completed", { id: "cs_1", object: "checkout.session", mode: "payment", payment_status: "paid", amount_total: 1000, metadata: { pledgeId: "pl-1" } })
    ];
    for (const payload of theirs) expect(await cards.parse(Buffer.from(payload), sign(payload))).toBeNull();
  });

  it("reads a station's usage charge and a card it saved", async () => {
    const sign = (payload: string) => stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    const paid = event("payment_intent.succeeded", { id: "pi_9", object: "payment_intent", amount: 14940, amount_received: 14940, metadata: { app: "opencast", usageBillId: "bill-1", stationId: "st-1" } });
    expect(await cards.parse(Buffer.from(paid), sign(paid))).toEqual({ kind: "usage_paid", billId: "bill-1", providerRef: "pi_9", amountMicros: $(149.4), feeMicros: Math.round($(149.4) * 0.029) + 300_000 });
    const failed = event("payment_intent.payment_failed", { id: "pi_10", object: "payment_intent", last_payment_error: { message: "Your card was declined." }, metadata: { app: "opencast", usageBillId: "bill-1" } });
    expect(await cards.parse(Buffer.from(failed), sign(failed))).toEqual({ kind: "usage_failed", billId: "bill-1", providerRef: "pi_10", reason: "Your card was declined." });
    const saved = event("setup_intent.succeeded", { id: "seti_2", object: "setup_intent", metadata: { app: "opencast", stationId: "st-1" } });
    expect(await cards.parse(Buffer.from(saved), sign(saved))).toEqual({ kind: "station_card_saved", stationId: "st-1", setupIntentId: "seti_2" });
  });
});

describe("Opencast's own Stripe key", () => {
  it("is a restricted key (rk_), never the account's secret key (sk_), and live only in production", () => {
    expect(stripeKeyProblem("rk_test_123", false)).toBeNull();
    expect(stripeKeyProblem("rk_live_123", true)).toBeNull();
    expect(stripeKeyProblem("sk_test_123", false)).toMatch(/restricted key/);
    expect(stripeKeyProblem("sk_live_123", true)).toMatch(/restricted key/);
    expect(stripeKeyProblem("rk_live_123", false)).toMatch(/live Stripe key outside production/);
    expect(stripeKeyProblem("pk_test_123", false)).toMatch(/isn't a Stripe restricted key/);
    const clock = { now: () => new Date() };
    expect(() => paymentsFromEnv({ PAYMENTS_PROVIDER: "stripe_only", STRIPE_SECRET_KEY: "sk_test_123" } as NodeJS.ProcessEnv, clock, "https://app.opencast.test")).toThrow(/restricted key/);
    expect(() => paymentsFromEnv({ PAYMENTS_PROVIDER: "stripe_only", STRIPE_SECRET_KEY: "rk_live_123", NODE_ENV: "development" } as NodeJS.ProcessEnv, clock, "https://app.opencast.test")).toThrow(/outside production/);
    const ok = paymentsFromEnv({ PAYMENTS_PROVIDER: "stripe_only", STRIPE_SECRET_KEY: "rk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_x" } as NodeJS.ProcessEnv, clock, "https://app.opencast.test");
    expect(ok.name).toBe("stripe_only");
    expect(ok.stationCards).toBeTruthy();
  });
});

/**
 * Stripe's requests as they'd go out (form-encoded), answered from canned objects: nothing leaves
 * the machine. Every object Opencast creates must say it's Opencast's, and every card charge must
 * carry the statement suffix.
 */
function recordingStripe(options: { appTag?: string; suffix?: string } = {}) {
  const sent: Array<{ method: string; path: string; body: URLSearchParams }> = [];
  const pm = { id: "pm_card_visa", object: "payment_method", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 }, metadata: {} };
  const answer = (method: string, path: string): object => {
    if (path === "/v1/customers") return { id: "cus_1", object: "customer" };
    if (path.startsWith("/v1/payment_methods")) return pm;
    if (method === "GET" && path.startsWith("/v1/payment_intents"))
      return { object: "list", has_more: false, data: [{ id: "pi_old", object: "payment_intent", status: "succeeded", metadata: { app: "opencast", depositId: "dep-1", feeMicros: "0" }, latest_charge: { id: "ch_1", object: "charge", amount: 25_000, amount_refunded: 0 } }] };
    if (path === "/v1/payment_intents") return { id: "pi_1", object: "payment_intent", status: "succeeded", client_secret: "pi_1_secret", amount: 14940 };
    if (path === "/v1/checkout/sessions") return { id: "cs_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_1" };
    if (path.startsWith("/v1/subscriptions")) return { id: "sub_123", object: "subscription", customer: "cus_1" };
    if (path === "/v1/accounts") return { id: "acct_1", object: "account" };
    if (path === "/v1/account_links") return { object: "account_link", url: "https://connect.stripe.com/setup/e/acct_1" };
    if (path === "/v1/transfers") return { id: "tr_1", object: "transfer" };
    if (path === "/v1/refunds") return { id: "re_1", object: "refund" };
    if (path === "/v1/setup_intents") return { id: "seti_1", object: "setup_intent", client_secret: "seti_1_secret_x", status: "requires_payment_method" };
    if (path.startsWith("/v1/setup_intents/")) return { id: "seti_1", object: "setup_intent", status: "succeeded", payment_method: "pm_card_visa", metadata: { app: "opencast", stationId: "st-1" } };
    if (path.startsWith("/v1/invoices/")) return { id: "in_1", object: "invoice" };
    throw new Error(`Unexpected Stripe request ${method} ${path}`);
  };
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = new URLSearchParams(method === "GET" ? u.search : String(init?.body ?? ""));
    sent.push({ method, path: u.pathname, body });
    return new Response(JSON.stringify(answer(method, u.pathname)), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }) as typeof fetch;
  const cards = new StripeCards({ secretKey: "rk_test_offline", webhookSecret: "whsec_test_secret", appTag: options.appTag, statementDescriptorSuffix: options.suffix, httpClient: Stripe.createFetchHttpClient(fetchFn) });
  return { cards, sent };
}

describe("everything Opencast creates in Stripe says so", () => {
  const saved = new Map<string, { ref: string; status: "active" | "needs_onboarding" | "closed"; onboardingUrl: string | null }>();
  const accounts = {
    async get(owner: { type: string; id?: string }, provider: string) {
      return saved.get(`${owner.type}:${owner.id}:${provider}`) ?? null;
    },
    async save(owner: { type: string; id?: string }, provider: string, account: { ref: string; status: "active" | "needs_onboarding"; onboardingUrl?: string | null }) {
      saved.set(`${owner.type}:${owner.id}:${provider}`, { ref: account.ref, status: account.status, onboardingUrl: account.onboardingUrl ?? null });
    }
  };

  it("metadata `app: opencast` on every object, and the statement suffix on every card charge", async () => {
    const { cards, sent } = recordingStripe();
    const business = { type: "advertiser" as const, id: "11111111-1111-4111-8111-111111111111", name: "Orange Street Coffee" };
    const station = { type: "station" as const, id: "22222222-2222-4222-8222-222222222222", name: "Inland Beat" };
    // Top-ups (card and bank), pledges (monthly and once), a pledge's new card, Connect, a payout, a refund.
    await cards.link(business, "pm_card_visa", accounts);
    await cards.charge({ depositId: "dep-1", owner: business, paymentMethodId: "pm_card_visa", amountMicros: $(250), feeMicros: $(7.55), bank: false }, accounts);
    await cards.charge({ depositId: "dep-2", owner: business, paymentMethodId: "pm_bank", amountMicros: $(250), feeMicros: $(2), bank: true }, accounts);
    await cards.pledge({ pledgeId: "pl-1", stationId: station.id, stationName: "Inland Beat", amountMicros: $(10), cadence: "monthly", returnUrl: "https://app.opencast.test/stations/st" });
    await cards.pledge({ pledgeId: "pl-2", stationId: station.id, stationName: "Inland Beat", amountMicros: $(25), cadence: "once", returnUrl: "https://app.opencast.test/stations/st" });
    await cards.cardSession({ pledgeId: "pl-1", providerRef: "sub_123", returnUrl: "https://app.opencast.test/you" });
    await cards.connectAccount(station, accounts, "https://app.opencast.test/stations/st/earnings");
    await cards.transfer({ destination: "acct_1", amountMicros: $(42), idempotencyKey: "payout:1", description: "Opencast earnings" });
    await cards.refund({ customer: "cus_1", amountMicros: $(100), idempotencyKey: "payout:2" });
    // Pay-as-you-go: a station's card, saved and charged.
    const rail = cards.stationCards();
    await rail.setupCard({ stationId: "st-1", stationName: "Inland Beat" }, accounts);
    expect(await rail.savedCard({ stationId: "st-1", setupIntentId: "seti_1" })).toMatchObject({ paymentMethodId: "pm_card_visa", label: "Visa ending 4242" });
    expect(await rail.chargeUsage({ billId: "bill-1", attempt: 1, stationId: "st-1", stationName: "Inland Beat", paymentMethodId: "pm_card_visa", amountMicros: $(149.4), description: "Opencast usage" }, accounts)).toMatchObject({ status: "succeeded", providerRef: "pi_1" });
    // A monthly pledge's renewal, still a draft, gets the suffix too.
    const stripe = new Stripe("sk_test_offline");
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.created", data: { object: { id: "in_1", object: "invoice", status: "draft", parent: { subscription_details: { metadata: { app: "opencast", pledgeId: "pl-1" } } } } }, api_version: "2025-01-01", created: 1, livemode: false });
    expect(await cards.parse(Buffer.from(payload), stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" }))).toBeNull();

    const creates = sent.filter((r) => r.method === "POST" && ["/v1/customers", "/v1/payment_intents", "/v1/checkout/sessions", "/v1/accounts", "/v1/transfers", "/v1/refunds", "/v1/setup_intents"].includes(r.path));
    expect(creates.length).toBe(12);
    for (const r of creates) expect(r.body.get("metadata[app]"), `${r.path} ${r.body}`).toBe("opencast");
    // Payment methods Opencast attaches are tagged too.
    expect(sent.filter((r) => r.method === "POST" && /^\/v1\/payment_methods\/pm_[a-z_]+$/.test(r.path)).every((r) => r.body.get("metadata[app]") === "opencast")).toBe(true);
    // Checkout: the charge, the subscription and the setup it makes are Opencast's as well.
    const sessions = sent.filter((r) => r.path === "/v1/checkout/sessions");
    expect(sessions.map((r) => r.body.get("subscription_data[metadata][app]") ?? r.body.get("payment_intent_data[metadata][app]") ?? r.body.get("setup_intent_data[metadata][app]"))).toEqual(["opencast", "opencast", "opencast"]);
    // Every card charge carries OPENCAST; the bank debit doesn't (it isn't a card charge).
    const intents = sent.filter((r) => r.method === "POST" && r.path === "/v1/payment_intents");
    expect(intents.map((r) => r.body.get("statement_descriptor_suffix"))).toEqual(["OPENCAST", null, "OPENCAST"]);
    expect(sessions[1].body.get("payment_intent_data[statement_descriptor_suffix]")).toBe("OPENCAST");
    expect(intents[2].body.get("off_session")).toBe("true");
    expect(sent.find((r) => r.path === "/v1/invoices/in_1")?.body.get("statement_descriptor")).toBe("OPENCAST");
  });

  it("reads the tag and the suffix from configuration", async () => {
    const { cards, sent } = recordingStripe({ appTag: "opencast-staging", suffix: "OPENCAST TV" });
    await cards.pledge({ pledgeId: "pl-3", stationId: "st", stationName: "Inland Beat", amountMicros: $(25), cadence: "once", returnUrl: "https://app.opencast.test/stations/st" });
    expect(sent[0].body.get("metadata[app]")).toBe("opencast-staging");
    expect(sent[0].body.get("payment_intent_data[statement_descriptor_suffix]")).toBe("OPENCAST TV");
  });
});

/** Stripe's official mock (validates every request against Stripe's API spec). Started with Docker if it isn't running. */
let startedMock = false;
async function stripeMock(): Promise<boolean> {
  const up = () =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect(12111, "127.0.0.1", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
  if (await up()) return true;
  const run = spawnSync("docker", ["run", "-d", "--rm", "--name", "opencast-stripe-mock", "-p", "12111:12111", "stripe/stripe-mock:latest"], { encoding: "utf8" });
  if (run.status !== 0) return false;
  startedMock = true;
  for (let i = 0; i < 20; i++) {
    if (await up()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

describe("the Stripe adapter against stripe-mock", async () => {
  const available = await stripeMock();
  afterAll(() => {
    if (startedMock) spawnSync("docker", ["stop", "opencast-stripe-mock"]);
  });
  const cards = new StripeCards({ secretKey: "sk_test_123", webhookSecret: "whsec_x", host: "127.0.0.1", port: 12111, protocol: "http" });
  const saved = new Map<string, { ref: string; status: "active" | "needs_onboarding" | "closed"; onboardingUrl: string | null }>();
  const accounts = {
    async get(owner: { type: string; id?: string }, provider: string) {
      return saved.get(`${owner.type}:${owner.id}:${provider}`) ?? null;
    },
    async save(owner: { type: string; id?: string }, provider: string, account: { ref: string; status: "active" | "needs_onboarding"; onboardingUrl?: string | null }) {
      saved.set(`${owner.type}:${owner.id}:${provider}`, { ref: account.ref, status: account.status, onboardingUrl: account.onboardingUrl ?? null });
    }
  };
  const owner = { type: "advertiser" as const, id: "11111111-1111-4111-8111-111111111111", name: "Orange Street Coffee" };

  it.runIf(available)("links a card, charges a top-up with the fee on top, and cancels one", async () => {
    const linked = await cards.link(owner, "pm_card_visa", accounts);
    expect(linked.providerRef).toMatch(/^pm_/);
    const charged = await cards.charge({ depositId: "dep-1", owner, paymentMethodId: linked.providerRef, amountMicros: $(250), feeMicros: $(7.55), bank: false }, accounts);
    expect(charged.providerRef).toMatch(/^pi_/);
    await cards.cancel(charged.providerRef);
  });

  it.runIf(available)("starts a monthly pledge and a one-off one in Checkout", async () => {
    for (const cadence of ["monthly", "once"] as const) {
      const started = await cards.pledge({ pledgeId: `pl-${cadence}`, stationId: "st-1", stationName: "Inland Beat", amountMicros: $(10), cadence, returnUrl: "https://app.opencast.test/stations/st-1" });
      expect(started.providerRef).toMatch(/^cs_/);
      expect(started.paidNow).toBe(false);
    }
  });

  it.runIf(available)("E1: a card page for a monthly pledge, and the new card read back from its webhook", async () => {
    const session = await cards.cardSession({ pledgeId: "pl-1", providerRef: "sub_123", returnUrl: "https://app.opencast.test/you/pledges/pl-1" });
    expect(session.url).toMatch(/^https:\/\//);
    await expect(cards.cardSession({ pledgeId: "pl-1", providerRef: "cs_123", returnUrl: "https://app.opencast.test/" })).rejects.toThrow(/hasn't started/);
    await cards.resumeSubscription("sub_123");

    const stripe = new Stripe("sk_test_123");
    const event = (object: object) => JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object }, api_version: "2025-01-01", created: 1, livemode: false });
    const sign = (payload: string) => stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_x" });
    const setup = event({ id: "cs_setup", object: "checkout.session", mode: "setup", setup_intent: "seti_123", metadata: { app: "opencast", pledgeId: "pl-1", subscription: "sub_123" } });
    // stripe-mock's setup intents have no payment method: say this one took pm_123 (its fixture card).
    const retrieve = cards.stripe.setupIntents.retrieve;
    cards.stripe.setupIntents.retrieve = (async () => ({ id: "seti_123", payment_method: "pm_123" })) as never;
    try {
      expect(await cards.parse(Buffer.from(setup), sign(setup))).toMatchObject({ kind: "pledge_card", pledgeId: "pl-1", card: { label: "Visa ending 4242" } });
    } finally {
      cards.stripe.setupIntents.retrieve = retrieve;
    }
    const started = event({ id: "cs_sub", object: "checkout.session", mode: "subscription", subscription: "sub_123", metadata: { app: "opencast", pledgeId: "pl-2" } });
    expect(await cards.parse(Buffer.from(started), sign(started))).toMatchObject({ kind: "pledge_started", pledgeId: "pl-2", providerRef: "sub_123" });
  });

  it.runIf(available)("pay-as-you-go: saves a station's card with a SetupIntent and charges it off-session (Stripe's spec accepts both)", async () => {
    const rail = cards.stationCards();
    const setup = await rail.setupCard({ stationId: "33333333-3333-4333-8333-333333333333", stationName: "Saturday Reel" }, accounts);
    expect(setup.setupIntentId).toMatch(/^seti_/);
    expect(setup.clientSecret).toBeTruthy();
    const charged = await rail.chargeUsage({ billId: "44444444-4444-4444-8444-444444444444", attempt: 1, stationId: "33333333-3333-4333-8333-333333333333", stationName: "Saturday Reel", paymentMethodId: "pm_card_visa", amountMicros: $(149.4), description: "Opencast usage for REEL 24.1, October 2026" }, accounts);
    expect(charged.providerRef).toMatch(/^pi_/);
    await rail.detachCard("pm_card_visa");
  });

  it.runIf(available)("opens a Connect Express account for a station, and transfers to it", async () => {
    const station = { type: "station" as const, id: "22222222-2222-4222-8222-222222222222", name: "Inland Beat" };
    const connect = await cards.connectAccount(station, accounts, "https://app.opencast.test/stations/st-1/earnings");
    expect(connect.ref).toMatch(/^acct_/);
    expect(connect.status).toBe("needs_onboarding");
    expect(await cards.transfer({ destination: connect.ref, amountMicros: $(42), idempotencyKey: "payout:1", description: "Opencast earnings" })).toMatch(/^tr_/);
  });
});
