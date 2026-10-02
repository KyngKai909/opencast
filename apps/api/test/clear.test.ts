// Clear as a Privy global wallet: Clear's Privy app is the provider, Opencast's the requester.
// The person links Clear in the app; the API reads the cross-app account from Privy and records it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { schema } from "@opencast/db";
import { erc20Abi } from "../src/v1/chain/abis.js";
import { usdcTransfers } from "../src/v1/chain/usdc.js";
import { clearAccountFrom, privyClearLookup } from "../src/v1/clearLink.js";
import { clearPayments, fakeClear, fakePayments } from "../src/v1/payments/index.js";
import { anvilAccount, foundryAvailable, startChain, type TestChain } from "./chain.js";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const CLEAR_APP = "clear-provider-app";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

describe("reading Clear's cross-app account from Privy", () => {
  const privyUser = {
    linked_accounts: [
      { type: "email", address: "kai@example.com" },
      { type: "wallet", address: "0x9999999999999999999999999999999999999999", wallet_client_type: "privy" },
      { type: "cross_app", subject: "did:privy:someone-elses-app", provider_app_id: "another-app", embedded_wallets: [{ address: OTHER_WALLET }] },
      { type: "cross_app", subject: "did:privy:clear-user", provider_app_id: CLEAR_APP, embedded_wallets: [{ address: WALLET.toLowerCase() }], smart_wallets: [] }
    ]
  };

  it("takes the embedded wallet of the cross-app account from Clear's provider app only", () => {
    expect(clearAccountFrom(privyUser.linked_accounts, CLEAR_APP)).toEqual({ subject: "did:privy:clear-user", address: WALLET });
    expect(clearAccountFrom(privyUser.linked_accounts, "not-clear")).toBeNull();
    // Opencast's own embedded wallet (type "wallet") is never taken for Clear's.
    expect(clearAccountFrom([privyUser.linked_accounts[1]], CLEAR_APP)).toBeNull();
  });

  it("reads the user with Opencast's own app ID and secret, never Clear's", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const lookup = privyClearLookup({
      privyAppId: "opencast-app",
      privyAppSecret: "opencast-secret",
      providerAppId: CLEAR_APP,
      access: "read_only",
      fetch: (async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        return new Response(JSON.stringify(privyUser), { status: 200 });
      }) as unknown as typeof fetch
    });
    expect(await lookup.find("did:privy:kai")).toEqual({ subject: "did:privy:clear-user", address: WALLET });
    expect(calls[0].url).toBe("https://auth.privy.io/api/v1/users/did%3Aprivy%3Akai");
    expect(calls[0].headers["privy-app-id"]).toBe("opencast-app");
    expect(Buffer.from(calls[0].headers.authorization.replace("Basic ", ""), "base64").toString()).toBe("opencast-app:opencast-secret");
  });

  it("says it isn't set up without Clear's provider app ID or the app secret", async () => {
    await expect(privyClearLookup({ privyAppId: "a", privyAppSecret: "s", providerAppId: null, access: "read_only" }).find("did:privy:x")).rejects.toThrow(/isn't set up/);
    await expect(privyClearLookup({ privyAppId: "a", providerAppId: CLEAR_APP, access: "read_only" }).find("did:privy:x")).rejects.toThrow(/PRIVY_APP_SECRET/);
  });
});

describe("linking Clear", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60_000);
  afterAll(() => h.close());

  it("409s until the person has linked Clear in Privy", async () => {
    const kai = await h.signIn("Kai");
    const res = await kai.post("/v1/me/clear").expect(409);
    expect(res.body.error).toMatchObject({ code: "clear_not_linked", message: "Clear isn't linked yet." });
    expect((await kai.get("/v1/me").expect(200)).body.clear).toBeNull();
    await anon(h).post("/v1/me/clear").expect(401);
  });

  it("records the linked wallet with the access Clear grants, and shows it on /me", async () => {
    const kai = await h.signIn("Kai");
    h.clear.accounts.set(kai.did, { subject: "did:privy:clear-kai", address: WALLET });
    const linked = await kai.post("/v1/me/clear").expect(200);
    expect(linked.body).toEqual({ address: WALLET, access: "read_only", linkedAt: h.clock.now().toISOString() });
    const me = await kai.get("/v1/me").expect(200);
    expect(me.body.clear).toEqual(linked.body);

    // Linking the same wallet again keeps when it was linked.
    h.clock.advance(60_000);
    const again = await kai.post("/v1/me/clear").expect(200);
    expect(again.body.linkedAt).toBe(linked.body.linkedAt);
  });

  it("full access only while Clear grants it", async () => {
    const jess = await h.signIn("Jess");
    h.clear.accounts.set(jess.did, { subject: "did:privy:clear-jess", address: OTHER_WALLET });
    h.clear.access = "full";
    try {
      expect((await jess.post("/v1/me/clear").expect(200)).body.access).toBe("full");
      h.clear.access = "read_only";
      expect((await jess.get("/v1/me").expect(200)).body.clear.access).toBe("read_only");
    } finally {
      h.clear.access = "read_only";
    }
  });

  it("a different Clear wallet replaces the old link", async () => {
    const dee = await h.signIn("Dee");
    h.clear.accounts.set(dee.did, { subject: "did:privy:clear-dee", address: WALLET });
    await dee.post("/v1/me/clear").expect(200);
    h.clear.accounts.set(dee.did, { subject: "did:privy:clear-dee-2", address: OTHER_WALLET });
    const replaced = await dee.post("/v1/me/clear").expect(200);
    expect(replaced.body.address).toBe(OTHER_WALLET);
    expect((await h.services.accounts.clearLink(dee.id))?.address).toBe(OTHER_WALLET);
  });

  it("unlinking forgets it", async () => {
    const sam = await h.signIn("Sam");
    h.clear.accounts.set(sam.did, { subject: "did:privy:clear-sam", address: WALLET });
    await sam.post("/v1/me/clear").expect(200);
    await sam.delete("/v1/me/clear").expect(200, { ok: true });
    expect((await sam.get("/v1/me").expect(200)).body.clear).toBeNull();
    // Unlinking twice is fine.
    await sam.delete("/v1/me/clear").expect(200);
  });

  it("409s when Clear isn't set up on this server", async () => {
    const ana = await h.signIn("Ana");
    h.clear.providerAppId = null;
    try {
      const res = await ana.post("/v1/me/clear").expect(409);
      expect(res.body.error.code).toBe("clear_not_configured");
    } finally {
      h.clear.providerAppId = CLEAR_APP;
    }
  });
});

/** A business with an owner, a manager and a viewer, and a station with an owner and an operator. */
async function people(h: Harness) {
  const m = await market(h, `m-${Math.random().toString(36).slice(2, 8)}`);
  const kai = await h.signIn("Kai");
  const op = await h.signIn("Operator");
  const jess = await h.signIn("Jess");
  const mo = await h.signIn("Mo");
  const bookkeeper = await h.signIn("Bookkeeper");
  const station = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  await h.db.insert(schema.stationMemberships).values({ stationId: station.id, userId: op.id, role: "operator" });
  const created = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
  const businessId: string = created.body.id;
  await h.db.insert(schema.advertiserMemberships).values([
    { advertiserId: businessId, userId: mo.id, role: "manager" },
    { advertiserId: businessId, userId: bookkeeper.id, role: "viewer" }
  ]);
  return { kai, op, jess, mo, bookkeeper, station, businessId, marketId: m.id };
}

function linkClear(h: Harness, user: User, address: string) {
  h.clear.accounts.set(user.did, { subject: `did:privy:clear-${user.id}`, address });
  return user.post("/v1/me/clear").expect(200);
}

describe("a station paid out to its owner's Clear wallet", () => {
  let h: Harness;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => {
    h = await createHarness();
    p = await people(h);
    const viewer = await h.signIn("Viewer");
    await h.services.ledger.pledge(viewer.id, p.station.id, { cadence: "once", amountMicros: $(50), creditOnAir: false });
  }, 60_000);
  afterAll(() => h.close());

  it("is paid to its own account until the owner chooses their Clear wallet", async () => {
    const account = await p.kai.get(`/v1/stations/${p.station.id}/payout-account`).expect(200);
    expect(account.body).toEqual({ status: "active", url: null, destination: { kind: "clear_account", label: "The station's Clear account", address: null } });
    const res = await p.kai.put(`/v1/stations/${p.station.id}/payout-account`, { kind: "clear_wallet" }).expect(409);
    expect(res.body.error).toMatchObject({ code: "clear_not_linked", message: "Clear isn't linked yet. Connect Clear first." });
  });

  it("only the owner chooses", async () => {
    await linkClear(h, p.op, OTHER_WALLET);
    await p.op.put(`/v1/stations/${p.station.id}/payout-account`, { kind: "clear_wallet" }).expect(403);
  });

  it("read-only access is enough; payouts go to the wallet", async () => {
    await linkClear(h, p.kai, WALLET);
    await p.kai.put(`/v1/stations/${p.station.id}/payout-account`, { kind: "clear_wallet" }).expect(200, { status: "active", url: null });
    const account = await p.kai.get(`/v1/stations/${p.station.id}/payout-account`).expect(200);
    expect(account.body.destination).toEqual({ kind: "clear_wallet", label: "Clear wallet 0x1111…1111", address: WALLET });
    const earnings = await p.kai.get(`/v1/stations/${p.station.id}/earnings?period=month`).expect(200);
    expect(earnings.body.nextPayout.destination).toBe("Clear wallet 0x1111…1111");

    const out = await p.kai.post(`/v1/stations/${p.station.id}/payouts`, { amountMicros: $(10) }).expect(201);
    const [payout] = await h.db.select().from(schema.payouts).where(eq(schema.payouts.id, out.body.payoutId));
    expect(payout).toMatchObject({ destination: "Clear wallet 0x1111…1111", status: "sent" });
  });

  it("stops (and payouts wait) once the wallet is unlinked, or its person no longer owns the station", async () => {
    await p.kai.delete("/v1/me/clear").expect(200);
    const account = await p.kai.get(`/v1/stations/${p.station.id}/payout-account`).expect(200);
    expect(account.body).toMatchObject({ status: "needs_onboarding", destination: { kind: "clear_wallet", label: "Clear wallet (not linked anymore)" } });
    const refused = await p.kai.post(`/v1/stations/${p.station.id}/payouts`, { amountMicros: $(1) }).expect(409);
    expect(refused.body.error.code).toBe("clear_unlinked");
    expect((await h.services.ledger.runPayouts()).waiting).toBe(1);

    await linkClear(h, p.kai, WALLET);
    await p.kai.put(`/v1/stations/${p.station.id}/payout-account`, { kind: "clear_wallet" }).expect(200);
    await h.services.accounts.transferStationOwnership(p.station.id, p.kai.id, p.op.id);
    expect((await h.services.ledger.payoutAccount(p.station.id)).status).toBe("needs_onboarding");
    await h.services.accounts.transferStationOwnership(p.station.id, p.op.id, p.kai.id);
  });

  it("goes back to the station's own account", async () => {
    await p.kai.put(`/v1/stations/${p.station.id}/payout-account`, { kind: "clear_account" }).expect(200, { status: "active", url: null });
    expect((await h.services.ledger.payoutAccount(p.station.id)).destination.kind).toBe("clear_account");
  });
});

describe("a business and its owner's Clear wallet", () => {
  let h: Harness;
  let p: Awaited<ReturnType<typeof people>>;
  const quote = (u: User, businessId: string, amountMicros = $(100)) => u.post(`/v1/businesses/${businessId}/deposits/clear-transfer/quote`, { amountMicros });
  const confirm = (u: User, businessId: string, txHash: string, amountMicros = $(100)) => u.post(`/v1/businesses/${businessId}/deposits/clear-transfer`, { amountMicros, txHash });
  beforeAll(async () => {
    h = await createHarness();
    p = await people(h);
  }, 60_000);
  afterAll(() => {
    h.clear.access = "read_only";
    return h.close();
  });

  it("adds the owner's linked wallet as a funding source (owner only)", async () => {
    await p.mo.post(`/v1/businesses/${p.businessId}/funding-sources`, { kind: "clear_account", token: "linked" }).expect(403);
    const missing = await p.jess.post(`/v1/businesses/${p.businessId}/funding-sources`, { kind: "clear_account", token: "linked" }).expect(409);
    expect(missing.body.error.code).toBe("clear_not_linked");
    await linkClear(h, p.jess, WALLET);
    const sources = await p.jess.post(`/v1/businesses/${p.businessId}/funding-sources`, { kind: "clear_account", token: "linked" }).expect(201);
    expect(sources.body).toEqual([expect.objectContaining({ kind: "clear_account", label: "Clear wallet 0x1111…1111", isDefault: true })]);
    // Adding it again doesn't add another.
    const again = await p.jess.post(`/v1/businesses/${p.businessId}/funding-sources`, { kind: "clear_account", token: "linked" }).expect(201);
    expect(again.body).toHaveLength(1);
  });

  it("withdrawals can go to it; money comes in only by a transfer confirmed in Clear", async () => {
    const card = (await p.jess.post(`/v1/businesses/${p.businessId}/funding-sources`, { kind: "card", token: "tok_visa_4242" }).expect(201)).body.find((s: { kind: string }) => s.kind === "card");
    await p.jess.post(`/v1/businesses/${p.businessId}/deposits`, { amountMicros: $(40), fundingSourceId: card.id }).expect(201);
    const wallet = (await p.jess.get(`/v1/businesses/${p.businessId}/balance`).expect(200)).body.fundingSources.find((s: { kind: string }) => s.kind === "clear_account");
    const out = await p.jess.post(`/v1/businesses/${p.businessId}/withdrawals`, { amountMicros: $(15), fundingSourceId: wallet.id }).expect(201);
    expect(out.body.balance.availableMicros).toBe($(25));
    const [payout] = await h.db.select().from(schema.payouts).where(eq(schema.payouts.id, out.body.payoutId));
    expect(payout.destination).toBe("Clear wallet 0x1111…1111");
    const direct = await p.jess.post(`/v1/businesses/${p.businessId}/deposits`, { amountMicros: $(10), fundingSourceId: wallet.id }).expect(409);
    expect(direct.body.error.code).toBe("clear_transfer_needed");
  });

  it("a quote needs full access: 409 when read-only or not linked; viewers can't", async () => {
    const readOnly = await quote(p.jess, p.businessId).expect(409);
    expect(readOnly.body.error).toMatchObject({ code: "clear_read_only", message: "Clear lets Opencast only read your Clear wallet, so add money from inside Clear." });
    const notLinked = await quote(p.mo, p.businessId).expect(409);
    expect(notLinked.body.error.code).toBe("clear_not_linked");
    await quote(p.bookkeeper, p.businessId).expect(403);
  });

  it("with full access, says where to send it", async () => {
    h.clear.access = "full";
    await linkClear(h, p.mo, OTHER_WALLET);
    const res = await quote(p.mo, p.businessId, $(120.5)).expect(200);
    expect(res.body).toEqual({
      to: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      token: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", decimals: 6 },
      chainId: 84532,
      amountUnits: "120500000",
      from: OTHER_WALLET
    });
  });

  it("confirming credits the balance once per transaction", async () => {
    const before = (await p.mo.get(`/v1/businesses/${p.businessId}/balance`).expect(200)).body.availableMicros;
    const first = await confirm(p.mo, p.businessId, tx(1)).expect(201);
    expect(first.body).toMatchObject({ status: "arrived", balance: { availableMicros: before + $(100) } });
    const again = await confirm(p.mo, p.businessId, tx(1).toUpperCase().replace("0X", "0x")).expect(201);
    expect(again.body).toMatchObject({ depositId: first.body.depositId, status: "arrived", balance: { availableMicros: before + $(100) } });
    const movements = await p.mo.get(`/v1/businesses/${p.businessId}/movements?filter=money`).expect(200);
    expect(movements.body.filter((m: { label: string }) => m.label === "Added from Clear")).toHaveLength(1);
  });

  it("a transaction can't be used twice", async () => {
    const differentAmount = await confirm(p.mo, p.businessId, tx(1), $(5)).expect(409);
    expect(differentAmount.body.error.code).toBe("transfer_already_used");
    const other = await p.mo.post("/v1/businesses", { name: "Mo's Other Shop", category: "Retail", customersWhere: "online", marketIds: [p.marketId] }).expect(201);
    const elsewhere = await confirm(p.mo, other.body.id, tx(1)).expect(409);
    expect(elsewhere.body.error.code).toBe("transfer_already_used");
  });

  // Builds a second test server, which takes more than the default 5 s under the full suite.
  it("the Stripe-only server has no Clear", async () => {
    const stripeOnly = await createHarness({
      payments: (clock) => {
        const fake = fakePayments(clock);
        const { clearWallet: _none, ...rest } = fake;
        return { ...rest, name: "stripe_only" } as typeof fake;
      }
    });
    try {
      const q = await stripeOnly.signIn("Q");
      const m = await market(stripeOnly);
      const created = await q.post("/v1/businesses", { name: "Q", category: "Retail", customersWhere: "online", marketIds: [m.id] }).expect(201);
      stripeOnly.clear.accounts.set(q.did, { subject: "did:privy:clear-q", address: WALLET });
      await q.post("/v1/me/clear").expect(200);
      const res = await q.post(`/v1/businesses/${created.body.id}/funding-sources`, { kind: "clear_account", token: "linked" }).expect(409);
      expect(res.body.error.code).toBe("clear_unavailable");
    } finally {
      await stripeOnly.close();
    }
  }, 30_000);
});

describe("with Clear and no chain to check against", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ payments: (clock) => clearPayments(fakeClear(), null, fakePayments(clock)) });
    h.clear.access = "full";
  }, 60_000);
  afterAll(() => h.close());

  it("the deposit stays pending until the transfer can be checked, and can't be undone", async () => {
    const p = await people(h);
    await linkClear(h, p.jess, WALLET);
    const confirmed = await p.jess.post(`/v1/businesses/${p.businessId}/deposits/clear-transfer`, { amountMicros: $(30), txHash: tx(7) }).expect(201);
    expect(confirmed.body.status).toBe("pending");
    expect(confirmed.body.balance.pendingDeposits).toEqual([expect.objectContaining({ amountMicros: $(30), method: "clear_account" })]);
    expect(await h.services.ledger.recheckClearTransfers()).toEqual({ arrived: 0, failed: 0 });
    await p.jess.post(`/v1/businesses/${p.businessId}/deposits/${confirmed.body.depositId}/cancel`).expect(422);
    const again = await p.jess.post(`/v1/businesses/${p.businessId}/deposits/clear-transfer`, { amountMicros: $(30), txHash: tx(7) }).expect(201);
    expect(again.body).toMatchObject({ depositId: confirmed.body.depositId, status: "pending" });
  });
});

describe.runIf(foundryAvailable())("checking a USDC transfer on a local chain", () => {
  let chain: TestChain;
  const business = "0x3333333333333333333333333333333333333333" as Address;
  const clearWallet = anvilAccount(0).address;
  let sent: Hex;
  beforeAll(async () => {
    chain = await startChain();
    const chainConfig = { ...foundry, rpcUrls: { default: { http: [chain.rpcUrl] } } };
    const wallet = createWalletClient({ account: anvilAccount(0), chain: chainConfig, transport: http(chain.rpcUrl) });
    sent = await wallet.writeContract({ address: chain.usdc, abi: erc20Abi, functionName: "transfer", args: [business, 25_000_000n] });
    await createPublicClient({ chain: chainConfig, transport: http(chain.rpcUrl) }).waitForTransactionReceipt({ hash: sent });
  }, 120_000);
  afterAll(() => chain?.stop());

  it("confirms a transfer from the wallet to the account of at least the amount", async () => {
    const usdc = usdcTransfers({ rpcUrl: chain.rpcUrl, usdc: chain.usdc, chainId: 31337 });
    expect(await usdc.check({ txHash: sent, from: clearWallet, to: business, minUnits: 25_000_000n })).toEqual({ status: "confirmed" });
    expect((await usdc.check({ txHash: sent, from: clearWallet, to: business, minUnits: 30_000_000n })).status).toBe("failed");
    expect((await usdc.check({ txHash: sent, from: anvilAccount(1).address, to: business, minUnits: 1n })).status).toBe("failed");
    expect(await usdc.check({ txHash: tx(99) as Hex, from: clearWallet, to: business, minUnits: 1n })).toEqual({ status: "pending" });
  });
});
