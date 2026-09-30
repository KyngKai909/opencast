// A wallet for creators before a claim is approved (catch-up report, section 5). Privy makes no
// wallet at sign-in, so a creator who signs in by email has none; the claim page makes their
// embedded wallet in Privy, and the claim reads it back and records it where approving finds it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import type { EscrowChain } from "../src/v1/chain/index.js";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

const ESCROW = "0x00000000000000000000000000000000000e5c20" as const;

/** Enough of a chain for approving: it only encodes what the verifiers sign. */
const fakeChain: EscrowChain = {
  chainId: 31337,
  escrow: ESCROW,
  fund: null,
  settlement: "0x0000000000000000000000000000000000000005",
  depositBatch: async () => {
    throw new Error("not in this test");
  },
  contribute: async () => {
    throw new Error("not in this test");
  },
  events: async (fromBlock) => ({ toBlock: fromBlock, events: [] }),
  approveCalldata: () => "0x01",
  balanceOf: async () => 0
};

describe("a creator's wallet, made at the claim", () => {
  let h: Harness;
  let admin: User;
  let marketId: string;

  beforeAll(async () => {
    h = await createHarness({ chain: fakeChain });
    marketId = (await market(h)).id;
    admin = await h.signIn("Dee", { admin: true });
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  async function claimable(callSign: string, tenths: number) {
    const station = await stationFixture(h, { callSign, kind: "claimable", marketId, tenths, signedOn: true });
    await h.db.insert(schema.creators).values({ marketId, displayName: `${callSign} films`, sourcePlatform: "vimeo", sourceUrl: `https://vimeo.com/${callSign.toLowerCase()}`, stage: "on_air", stationId: station.id });
    return station;
  }

  it("records the embedded wallet the claim page made, and approving pays it", async () => {
    const station = await claimable("LUPE", 331);
    // Signed in by email: no wallet yet, as with createOnLogin off.
    const lupe = await h.signIn("Lupe Ortiz", { linked: [{ kind: "email", value: "lupe@example.com" }] });
    expect(await h.services.accounts.walletOf(lupe.id)).toBeNull();

    // The claim page's createWallet: Privy now lists the embedded wallet on their user.
    const embedded = "0x00000000000000000000000000000000000c1a1e";
    h.linked.set(lupe.did, [{ kind: "email", value: "lupe@example.com" }, { kind: "wallet", value: embedded }]);
    const claim = await lupe.post(`/v1/stations/${station.id}/claim`, { kind: "claim", sourceAccountProof: "vimeo:connected" }).expect(201);
    expect(await h.services.accounts.walletOf(lupe.id)).toBe(embedded);

    const approved = await admin.post(`/v1/admin/handovers/${claim.body.handoverId}/approve`).expect(200);
    expect(approved.body.onChain).toMatchObject({ contract: ESCROW, payee: embedded, kind: "claim" });
  });

  it("reads Privy again when approving, if the wallet wasn't recorded at the claim", async () => {
    const station = await claimable("CRAT", 341);
    const crate = await h.signIn("Crate Diggers");
    const claim = await crate.post(`/v1/stations/${station.id}/claim`, { kind: "claim", sourceAccountProof: "vimeo:connected" }).expect(201);
    expect(await h.services.accounts.walletOf(crate.id)).toBeNull();

    const later = "0x0000000000000000000000000000000000000c8a";
    h.linked.set(crate.did, [{ kind: "wallet", value: later }]);
    const approved = await admin.post(`/v1/admin/handovers/${claim.body.handoverId}/approve`).expect(200);
    expect(approved.body.onChain).toMatchObject({ payee: later });
  });

  it("refuses to approve a creator who still has no wallet", async () => {
    const station = await claimable("FLDR", 351);
    const fldr = await h.signIn("Field Recordings");
    const claim = await fldr.post(`/v1/stations/${station.id}/claim`, { kind: "claim", sourceAccountProof: "vimeo:connected" }).expect(201);
    const refused = await admin.post(`/v1/admin/handovers/${claim.body.handoverId}/approve`).expect(422);
    expect(refused.body.error.code).toBe("no_wallet");
  });
});
