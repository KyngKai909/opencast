// Clear as a Privy global wallet: Clear's Privy app is the provider, Opencast's the requester.
// The person links Clear in the app; the API reads the cross-app account from Privy and records it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearAccountFrom, privyClearLookup } from "../src/v1/clearLink.js";
import { anon, createHarness, type Harness } from "./harness.js";

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
