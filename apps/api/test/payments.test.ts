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
import { clearPayments, fakeClear, fakePayments, ownAccountsCustody, StripeCards } from "../src/v1/payments/index.js";
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
    const payload = event("payment_intent.succeeded", { id: "pi_1", object: "payment_intent", metadata: { depositId: "dep-1" } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    expect(await cards.parse(Buffer.from(payload), header)).toEqual({ kind: "deposit_arrived", depositId: "dep-1" });
  });

  it("refuses anything not signed with our secret, or changed after signing", async () => {
    const payload = event("payment_intent.succeeded", { id: "pi_1", object: "payment_intent", metadata: { depositId: "dep-1" } });
    const forged = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    await expect(cards.parse(Buffer.from(payload), forged)).rejects.toThrow();
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    await expect(cards.parse(Buffer.from(payload.replace("dep-1", "dep-2")), header)).rejects.toThrow();
    await expect(cards.parse(Buffer.from(payload), undefined)).rejects.toThrow(/signature/);
  });

  it("reads a monthly pledge's payment", async () => {
    const payload = event("invoice.paid", { id: "in_1", object: "invoice", amount_paid: 1000, parent: { subscription_details: { metadata: { pledgeId: "pl-1" } } } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    expect(await cards.parse(Buffer.from(payload), header)).toMatchObject({ kind: "pledge_paid", pledgeId: "pl-1", amountMicros: $(10) });
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
    const setup = event({ id: "cs_setup", object: "checkout.session", mode: "setup", setup_intent: "seti_123", metadata: { pledgeId: "pl-1", subscription: "sub_123" } });
    // stripe-mock's setup intents have no payment method: say this one took pm_123 (its fixture card).
    const retrieve = cards.stripe.setupIntents.retrieve;
    cards.stripe.setupIntents.retrieve = (async () => ({ id: "seti_123", payment_method: "pm_123" })) as never;
    try {
      expect(await cards.parse(Buffer.from(setup), sign(setup))).toMatchObject({ kind: "pledge_card", pledgeId: "pl-1", card: { label: "Visa ending 4242" } });
    } finally {
      cards.stripe.setupIntents.retrieve = retrieve;
    }
    const started = event({ id: "cs_sub", object: "checkout.session", mode: "subscription", subscription: "sub_123", metadata: { pledgeId: "pl-2" } });
    expect(await cards.parse(Buffer.from(started), sign(started))).toMatchObject({ kind: "pledge_started", pledgeId: "pl-2", providerRef: "sub_123" });
  });

  it.runIf(available)("opens a Connect Express account for a station, and transfers to it", async () => {
    const station = { type: "station" as const, id: "22222222-2222-4222-8222-222222222222", name: "Inland Beat" };
    const connect = await cards.connectAccount(station, accounts, "https://app.opencast.test/stations/st-1/earnings");
    expect(connect.ref).toMatch(/^acct_/);
    expect(connect.status).toBe("needs_onboarding");
    expect(await cards.transfer({ destination: connect.ref, amountMicros: $(42), idempotencyKey: "payout:1", description: "Opencast earnings" })).toMatch(/^tr_/);
  });
});
