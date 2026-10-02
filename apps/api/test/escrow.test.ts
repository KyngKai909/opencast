// A claimable station's money, all the way on-chain: it earns (owed), the weekly batch puts it
// in the escrow contract (held), the creator claims, the desk checks them, two verifiers approve
// on-chain, 72 hours pass on the chain, anyone pays it, and the ledger and the station follow.
// Another station goes unclaimed for three years and its balance goes to the creator fund.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { escrowChain } from "../src/v1/chain/index.js";
import { anvilAccount, anvilKey, foundryAvailable, startChain, type TestChain } from "./chain.js";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

describe.runIf(foundryAvailable())("the escrow, on a local chain", () => {
  let chain: TestChain;
  let h: Harness;
  let admin: User;
  let lupe: User;
  let lupeStation: { id: string };
  let quietStation: { id: string };
  const lupeWallet = anvilAccount(7).address;

  beforeAll(async () => {
    chain = await startChain();
    h = await createHarness({
      chain: escrowChain({ rpcUrl: chain.rpcUrl, escrow: chain.escrow, fund: chain.fund, usdc: chain.usdc, settlementKey: anvilKey(0), chainId: 31337, pollingIntervalMs: 100 })
    });
    const m = await market(h);
    admin = await h.signIn("Dee", { admin: true });
    lupe = await h.signIn("Lupe Ortiz", { linked: [{ kind: "wallet", value: lupeWallet }] });
    const viewer = await h.signIn("Viewer");
    lupeStation = await stationFixture(h, { callSign: "LUPE", kind: "claimable", marketId: m.id, tenths: 331, signedOn: true });
    quietStation = await stationFixture(h, { callSign: "QUIE", kind: "claimable", marketId: m.id, tenths: 341, signedOn: true });
    await h.db.insert(schema.creators).values({ marketId: m.id, displayName: "Tía Lupe's Kitchen", personName: "Lupe Ortiz", sourcePlatform: "youtube", sourceUrl: "https://youtube.com/@tialupe", stage: "on_air", stationId: lupeStation.id });
    await h.db.insert(schema.creators).values({ marketId: m.id, displayName: "Quiet Fields", sourcePlatform: "other", sourceUrl: "https://example.com/quiet", stage: "on_air", stationId: quietStation.id });
    // They earn like any station; a pledge is the simplest earning here.
    await h.services.ledger.pledge(viewer.id, lupeStation.id, { cadence: "once", amountMicros: $(100), creditOnAir: false });
    await h.services.ledger.pledge(viewer.id, quietStation.id, { cadence: "once", amountMicros: $(20), creditOnAir: false });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
    chain?.stop();
  });

  const escrowBalances = (id: string) => h.services.ledger.escrowBalances([id]).then((m) => m.get(id)!);
  const escrowIdOf = async (id: string) => (await h.services.stations.profiles([id])).get(id)!.escrowId;

  it("owes what a claimable station earns until the weekly batch puts it in the contract", async () => {
    const owed = (await escrowBalances(lupeStation.id)).owed;
    expect(owed).toBe($(100) - $(3.2)); // less Stripe's fee
    const batch = await h.services.ledger.escrowWeekly();
    expect(batch).toMatchObject({ stations: 2 });
    expect(await escrowBalances(lupeStation.id)).toEqual({ owed: 0, held: owed });
    expect(await h.deps.chain!.balanceOf(await escrowIdOf(lupeStation.id))).toBe(owed);
    const [deposit] = await h.db.select().from(schema.escrowDeposits);
    expect(deposit).toMatchObject({ status: "confirmed", chainId: 31337 });
    // Nothing more is owed, so a second run sends nothing.
    expect(await h.services.ledger.escrowWeekly()).toEqual({ stations: 0, micros: 0, txHash: "" });
  }, 60_000);

  it("pays the creator after the desk's check, two verifiers on-chain and 72 hours, and hands the station over", async () => {
    const claim = await lupe.post(`/v1/stations/${lupeStation.id}/claim`, { kind: "claim", sourceAccountProof: "youtube:@tialupe" }).expect(201);
    const approved = await admin.post(`/v1/admin/handovers/${claim.body.handoverId}/approve`).expect(200);
    const escrowId = await escrowIdOf(lupeStation.id);
    expect(approved.body.onChain).toMatchObject({ contract: chain.escrow, escrowStationId: escrowId, payee: lupeWallet, kind: "claim" });
    expect(approved.body.onChain.calldata).toMatch(/^0x/);

    // Two of the three verifiers approve on-chain, from their own keys.
    await chain.asAccount(1, "approve", [BigInt(escrowId), lupeWallet, 1]);
    await chain.asAccount(2, "approve", [BigInt(escrowId), lupeWallet, 1]);
    await h.services.ledger.syncChain();
    const [waiting] = await h.db.select().from(schema.handovers).where(eq(schema.handovers.id, claim.body.handoverId));
    expect(waiting.payableAfter).toBeTruthy();
    expect(waiting.completedAt).toBeNull();

    await chain.warp(72 * 3600);
    await chain.asAccount(8, "execute", [BigInt(escrowId)]); // anyone can
    const held = (await escrowBalances(lupeStation.id)).held;
    await h.services.ledger.syncChain();

    expect(await chain.usdcBalance(lupeWallet)).toBe(held);
    expect(await escrowBalances(lupeStation.id)).toEqual({ owed: 0, held: 0 });
    const [done] = await h.db.select().from(schema.handovers).where(eq(schema.handovers.id, claim.body.handoverId));
    expect(done.completedAt).toBeTruthy();
    expect(await h.services.stations.kindOf(lupeStation.id)).toBe("station");
    const owners = await h.services.accounts.stationMemberIds(lupeStation.id, ["owner"]);
    expect(owners).toContain(lupe.id);
    // Reading the same events again changes nothing.
    await h.db.update(schema.chainCursor).set({ block: 0n });
    await h.services.ledger.syncChain();
    const claims = await h.db.select().from(schema.entries).where(eq(schema.entries.kind, "escrow_claim"));
    expect(claims).toHaveLength(1);
  }, 60_000);

  it("sends what's never claimed to the creator fund after three years", async () => {
    const held = (await escrowBalances(quietStation.id)).held;
    await chain.warp(1095 * 86_400);
    await chain.asAccount(8, "releaseToFund", [BigInt(await escrowIdOf(quietStation.id))]);
    await h.services.ledger.syncChain();
    expect(await chain.usdcBalance(chain.fund)).toBe(held);
    expect(await escrowBalances(quietStation.id)).toEqual({ owed: 0, held: 0 });
    const [released] = await h.db.select().from(schema.entries).where(eq(schema.entries.kind, "escrow_unclaimed"));
    expect(released.memo).toMatch(/creator fund/);
    // And nothing ever went to Opencast.
    expect(await h.services.ledger.everMovedToOpencast()).toBe(0);
  }, 60_000);
});
