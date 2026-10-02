// Network desk Settings (follow-up Phase 0 item 11): desk roles enforced where they matter, the
// rules registry's value at a moment and its change log, the old tables bridged into it (money and
// trust read as before), each market's numbering, and escrow signer changes that need every other
// admin's approval.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User;
let sam: User;
let lee: User;
let pat: User;
let ie: { id: string; slug: string };
let hd: { id: string; slug: string };

const email = (u: User, address: string) => h.db.update(schema.users).set({ email: address }).where(eq(schema.users.id, u.id));

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  ie = await market(h);
  hd = await market(h, "high-desert", "High Desert");
  dee = await h.signIn("Dee A.", { admin: true });
  sam = await h.signIn("Sam K.");
  lee = await h.signIn("Lee R.");
  pat = await h.signIn("Pat O.");
  await email(dee, "dee@opencast.test");
  await email(sam, "sam@opencast.test");
  await email(lee, "lee@opencast.test");
}, 60_000);
afterAll(() => h.close());

describe("desk roles", () => {
  it("keeps the desk to the team, and lets only admins change the team", async () => {
    expect((await sam.get("/v1/admin/rules")).status).toBe(403);
    expect((await sam.get("/v1/admin/desk/team")).status).toBe(403);
    const me = await sam.get("/v1/me");
    expect(me.body.deskRoles).toEqual([]);

    const added = await dee.post("/v1/admin/desk/team", { email: "sam@opencast.test", roles: [{ role: "rights_reviewer" }] });
    expect(added.status).toBe(200);
    expect(added.body.people.map((p: { name: string; roles: Array<{ role: string }> }) => [p.name, p.roles.map((r) => r.role)])).toEqual([
      ["Dee A.", ["admin"]],
      ["Sam K.", ["rights_reviewer"]]
    ]);
    expect((await sam.get("/v1/me")).body.deskRoles).toEqual([{ role: "rights_reviewer", market: null }]);
    // On the team now: reads the desk, but a reviewer can't change the team or the rules.
    expect((await sam.get("/v1/admin/rules")).status).toBe(200);
    const tryTeam = await sam.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie.id }] });
    expect(tryTeam.status).toBe(403);
    expect(tryTeam.body.error.code).toBe("desk_role");
    expect((await sam.post("/v1/admin/rules/rights.repeat_limit/versions", { value: { upheldIn12Months: 2 }, effectiveFrom: "2026-10-02" })).status).toBe(403);

    // Someone who has never signed in can't be added.
    const nobody = await dee.post("/v1/admin/desk/team", { email: "nobody@opencast.test", roles: [{ role: "rights_reviewer" }] });
    expect(nobody.status).toBe(422);
    expect(nobody.body.error.code).toBe("no_account");
    // A market lead needs a market.
    expect((await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead" }] })).status).toBe(400);
  });

  it("lets a market lead work in their own market only", async () => {
    const made = await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie.id }] });
    expect(made.status).toBe(200);
    expect((await lee.get("/v1/me")).body.deskRoles).toEqual([{ role: "market_lead", market: expect.objectContaining({ id: ie.id, slug: "inland-empire" }) }]);

    expect((await lee.get(`/v1/admin/markets/${ie.slug}/board`)).status).toBe(200);
    expect((await lee.get(`/v1/admin/markets/${hd.slug}/board`)).status).toBe(403);
    expect((await lee.get(`/v1/admin/creators?marketId=${ie.id}`)).status).toBe(200);
    expect((await lee.get(`/v1/admin/creators?marketId=${hd.id}`)).status).toBe(403);
    // No market: the whole list is admins only.
    expect((await lee.get("/v1/admin/creators")).status).toBe(403);
    expect((await lee.get(`/v1/admin/reservations?marketId=${ie.id}`)).status).toBe(200);
    expect((await lee.get(`/v1/admin/reservations?marketId=${hd.id}`)).status).toBe(403);

    const creator = await lee.post("/v1/admin/creators", { marketId: ie.id, displayName: "Banning Rodeo Films", sourcePlatform: "youtube", sourceUrl: "https://www.youtube.com/@banningrodeo" });
    expect(creator.status).toBe(201);
    expect((await lee.post("/v1/admin/creators", { marketId: hd.id, displayName: "Elsewhere", sourcePlatform: "youtube", sourceUrl: "https://www.youtube.com/@elsewhere" })).status).toBe(403);
    expect((await lee.get(`/v1/admin/creators/${creator.body.id}/works`)).status).toBe(200);
    const theirs = await dee.post("/v1/admin/creators", { marketId: hd.id, displayName: "High Desert Films", sourcePlatform: "vimeo", sourceUrl: "https://vimeo.com/hdfilms" });
    expect((await lee.get(`/v1/admin/creators/${theirs.body.id}/works`)).status).toBe(403);

    // Admin-only pages stay admin-only, and someone off the team gets nothing.
    expect((await lee.get("/v1/admin/held-earnings")).status).toBe(403);
    expect((await pat.get(`/v1/admin/markets/${ie.slug}/board`)).status).toBe(403);
    // The admin flag works as before.
    expect((await dee.get(`/v1/admin/markets/${hd.slug}/board`)).status).toBe(200);
    expect((await dee.get("/v1/admin/held-earnings")).status).toBe(200);
  });

  it("changes and takes away roles, never the last admin, and logs each change", async () => {
    const alone = await dee.put(`/v1/admin/desk/team/${dee.id}`, { roles: [] });
    expect(alone.status).toBe(422);
    expect(alone.body.error.code).toBe("last_admin");

    const promoted = await dee.put(`/v1/admin/desk/team/${sam.id}`, { roles: [{ role: "admin" }, { role: "rights_reviewer" }] });
    expect(promoted.status).toBe(200);
    expect((await sam.get("/v1/me")).body.isAdmin).toBe(true);

    const moved = await dee.put(`/v1/admin/desk/team/${lee.id}`, { roles: [{ role: "market_lead", marketId: hd.id }] });
    expect(moved.status).toBe(200);
    expect((await lee.get(`/v1/admin/markets/${ie.slug}/board`)).status).toBe(403);
    expect((await lee.get(`/v1/admin/markets/${hd.slug}/board`)).status).toBe(200);

    const log = await dee.get("/v1/admin/change-log?kind=role");
    expect(log.body.map((e: { summary: string }) => e.summary)).toEqual(
      expect.arrayContaining([
        "Made Sam K. a rights reviewer",
        "Made Lee R. market lead for the Inland Empire",
        "Made Sam K. an admin",
        "Took Lee R. off as market lead for the Inland Empire",
        "Made Lee R. market lead for the High Desert"
      ])
    );
    expect(log.body[0].by).toEqual({ userId: dee.id, name: "Dee A." });

    // Off the team entirely.
    await dee.put(`/v1/admin/desk/team/${lee.id}`, { roles: [] });
    expect((await lee.get("/v1/admin/rules")).status).toBe(403);
    expect((await lee.get("/v1/me")).body.deskRoles).toEqual([]);
  });
});

describe("the rules registry", () => {
  it("starts from the values in effect before it, so money and trust read the same", async () => {
    expect(await h.services.settings.valueAt("shares.opencast")).toEqual({ spotBps: 0, pledgeBps: 0, productionBps: 0 });
    expect(await h.services.settings.valueAt("rights.claim_dates")).toEqual({ answerDays: 14, counterNoticeBusinessDays: 10 });
    expect(await h.services.settings.valueAt("rights.repeat_limit")).toEqual({ upheldIn12Months: 3 });
    expect(await h.services.ledger.config()).toEqual({
      opencastSpotShareBps: 0,
      opencastPledgeShareBps: 0,
      opencastProductionShareBps: 0,
      poolShareBps: 0,
      poolBaseBps: 0,
      poolWatchTimeBps: 0,
      poolFundBps: 0,
      payoutSchedule: "weekly",
      unclaimedPeriodDays: 1095
    });
    const list = await dee.get("/v1/admin/rules");
    expect(list.status).toBe(200);
    const byKey = Object.fromEntries(list.body.rules.map((r: { key: string; current: { display: string; set: boolean } }) => [r.key, r.current]));
    // The starting price sheet (docs/pricing.md) from October 1, 2026 (migration 0033, pay-as-you-go).
    expect(byKey["prices.storage"]).toMatchObject({ display: "$0.04 a GB a month", set: true });
    expect(byKey["prices.radio_live"]).toMatchObject({ display: "Free", set: true });
    expect(byKey["billing.grace"]).toMatchObject({ display: "14 days, a warning 3 days before" });
    expect(byKey["prices.free_allowance"]).toMatchObject({ display: "10 GB, 5 live hours", set: true });
    expect(byKey["shares.opencast"]).toMatchObject({ display: "0%, not set yet", set: false });
    expect(byKey["rights.public_domain_us"]).toMatchObject({ display: "1930" });
    expect(byKey["rights.claim_dates"]).toMatchObject({ display: "14 days, 10 business days" });
    expect(byKey["escrow.unclaimed_period"]).toMatchObject({ display: "3 years" });
    // Phase 3 added Kick (and when restarts happen) from September 30, 2026 (migration 0034).
    expect(byKey["relays.platform_limits"]).toMatchObject({ display: "4 platforms" });
  });

  it("answers the value at a moment, with past and future versions kept", async () => {
    const set = await dee.post("/v1/admin/rules/shares.opencast/versions", { value: { spotBps: 1000, pledgeBps: 0, productionBps: 500 }, effectiveFrom: "2026-11-01", note: "Decided at the October review" });
    expect(set.status).toBe(200);
    expect(set.body.current.display).toBe("0%, not set yet");
    expect(set.body.next).toMatchObject({ display: "10% of spots, 0% of pledges, 5% of production", effectiveFrom: "2026-11-01T00:00:00.000Z", setBy: { name: "Dee A." }, note: "Decided at the October review" });

    const before = await dee.get("/v1/admin/rules/shares.opencast/value?at=2026-10-31T23:59:59.000Z");
    const after = await dee.get("/v1/admin/rules/shares.opencast/value?at=2026-11-01T00:00:00.000Z");
    expect(before.body.value).toEqual({ spotBps: 0, pledgeBps: 0, productionBps: 0 });
    expect(after.body.value).toEqual({ spotBps: 1000, pledgeBps: 0, productionBps: 500 });
    // The ledger reads the share that applied at each moment.
    expect((await h.services.ledger.config(new Date("2026-10-15T12:00:00Z"))).opencastSpotShareBps).toBe(0);
    expect((await h.services.ledger.config(new Date("2026-11-15T12:00:00Z"))).opencastSpotShareBps).toBe(1000);

    const versions = await dee.get("/v1/admin/rules/shares.opencast/versions");
    expect(versions.body.map((v: { display: string }) => v.display)).toEqual(["10% of spots, 0% of pledges, 5% of production", "0%, not set yet"]);

    // Never retroactively, and only values that fit the rule.
    const back = await dee.post("/v1/admin/rules/shares.opencast/versions", { value: { spotBps: 100, pledgeBps: 0, productionBps: 0 }, effectiveFrom: "2026-09-01" });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe("retroactive");
    expect((await dee.post("/v1/admin/rules/shares.opencast/versions", { value: { spotBps: 20_000 }, effectiveFrom: "2026-11-01" })).status).toBe(400);
    expect((await dee.post("/v1/admin/rules/shares.pool/versions", { value: { shareBps: 500, baseBps: 5000, watchTimeBps: 4000, fundBps: 500 }, effectiveFrom: "2026-11-01" })).status).toBe(400);
    expect((await dee.post("/v1/admin/rules/no.such_rule/versions", { value: 1, effectiveFrom: "2026-11-01" })).status).toBe(404);
    // Signers change only through a proposal.
    expect((await dee.post("/v1/admin/rules/escrow.signers/versions", { value: { signers: [], threshold: 1 }, effectiveFrom: "2026-11-01" })).status).toBe(409);
  });

  it("changes what trust reads from the day it takes effect", async () => {
    const station = await stationFixture(h, { callSign: "TRST", ownerId: dee.id, marketId: ie.id, tenths: 331 });
    expect((await h.services.trust.standing(station.id)).threshold).toBe(3);
    const set = await dee.post("/v1/admin/rules/rights.repeat_limit/versions", { value: { upheldIn12Months: 2 }, effectiveFrom: "2026-10-01" });
    expect(set.body.current.display).toBe("2");
    expect((await h.services.trust.standing(station.id)).threshold).toBe(2);
  });

  it("keeps a write to the old tables in the registry", async () => {
    await h.db.insert(schema.revenueConfig).values({ effectiveFrom: "2026-12-01", opencastSpotShareBps: 1500, poolShareBps: 0 });
    expect((await h.services.ledger.config(new Date("2026-12-02T00:00:00Z"))).opencastSpotShareBps).toBe(1500);
    expect((await h.services.ledger.config(new Date("2026-11-15T00:00:00Z"))).opencastSpotShareBps).toBe(1000);
  });

  it("lists every change in the change log", async () => {
    const log = await dee.get("/v1/admin/change-log?kind=rule");
    const summaries = log.body.map((e: { summary: string }) => e.summary);
    expect(summaries).toContain("Opencast's share of spots and sponsorships: 0%, not set yet to 10% of spots, 0% of pledges, 5% of production");
    expect(summaries).toContain("Repeat limit: 3 to 2");
    expect(summaries).toContain("Written to ledger.revenue_config");
    const share = log.body.find((e: { subject: string; by: unknown }) => e.subject === "shares.opencast" && e.by);
    expect(share).toMatchObject({ before: { spotBps: 0 }, after: { spotBps: 1000 }, effectiveFrom: "2026-11-01T00:00:00.000Z", note: "Decided at the October review" });
    // The registry's first versions are in the log too.
    expect(log.body.filter((e: { summary: string }) => e.summary === "Started the registry with the value in effect").length).toBeGreaterThanOrEqual(15);
  });
});

describe("numbering, per market", () => {
  it("narrows one market's channels and leaves the others on the whole band", async () => {
    const station = await stationFixture(h, { name: "New station", ownerId: dee.id });
    const set = await dee.post("/v1/admin/rules/numbering.channels/versions", {
      scope: ie.id,
      value: { tv: { firstMajor: 2, lastMajor: 36 }, radio: { firstTenths: 882, lastTenths: 1000 } },
      effectiveFrom: "2026-10-01"
    });
    expect(set.status).toBe(200);
    expect(set.body.scope).toBe(ie.id);
    const channels = await h.services.stations.availableChannels(ie.id, "tv");
    expect(channels.at(0)?.channel).toBe("2.1");
    expect(channels.at(-1)?.channel).toBe("36.1");
    expect((await h.services.stations.availableChannels(ie.id, "radio")).at(-1)?.channel).toBe("100.0");
    expect((await h.services.stations.availableChannels(hd.id, "tv")).at(-1)?.channel).toBe("69.1");
    await expect(h.services.stations.chooseChannel(station.id, { marketId: ie.id, band: "tv", channel: "40.1" })).rejects.toMatchObject({ code: "outside_numbering" });
    // Odd tenths are refused: the radio band is even tenths, 88.2 to 107.8.
    const odd = await dee.post("/v1/admin/rules/numbering.channels/versions", { scope: ie.id, value: { tv: { firstMajor: 2, lastMajor: 69 }, radio: { firstTenths: 881, lastTenths: 1079 } }, effectiveFrom: "2026-10-02" });
    expect(odd.status).toBe(400);

    const list = await dee.get("/v1/admin/numbering");
    const mine = list.body.find((m: { market: { id: string } }) => m.market.id === ie.id);
    const theirs = list.body.find((m: { market: { id: string } }) => m.market.id === hd.id);
    expect(mine).toMatchObject({ own: true, tvLine: "TV 2 to 36, with subchannels", radioLine: "Radio 88.2 to 100.0, even tenths" });
    expect(theirs).toMatchObject({ own: false, tvLine: "TV 2 to 69, with subchannels", radioLine: "Radio 88.2 to 107.8, even tenths" });
  });
});

describe("escrow signers", () => {
  const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const C = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const D = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

  it("lists the keys from configuration, read-only", async () => {
    process.env.ESCROW_VERIFIERS = [A, B, C].join(",");
    process.env.ESCROW_THRESHOLD = "2";
    const signers = await dee.get("/v1/admin/escrow/signers");
    expect(signers.body).toMatchObject({ source: "config", signers: [A, B, C], threshold: 2, approved: null, canPropose: true });
  });

  it("needs every other admin's approval before a change takes effect", async () => {
    // Sam is an admin (above): Dee proposes, Sam decides.
    const proposed = await dee.post("/v1/admin/escrow/signer-proposals", { kind: "replace", oldAddress: C, newAddress: D, note: "C's key was on a lost laptop" });
    expect(proposed.status).toBe(200);
    expect(proposed.body).toMatchObject({ status: "open", signersAfter: [A, B, D], thresholdAfter: 2, canDecide: false, canWithdraw: true });
    expect(proposed.body.approvals).toEqual([{ admin: { userId: sam.id, name: "Sam K." }, decision: null, at: null, note: null }]);
    // Nothing changes until it's approved.
    expect((await h.services.settings.valueAt("escrow.signers")).signers).toBeNull();
    // The proposer can't approve their own change; a second proposal waits.
    const own = await dee.post(`/v1/admin/escrow/signer-proposals/${proposed.body.id}/decision`, { decision: "approve" });
    expect(own.status).toBe(403);
    expect((await dee.post("/v1/admin/escrow/signer-proposals", { kind: "add", newAddress: D })).status).toBe(409);

    const approved = await sam.post(`/v1/admin/escrow/signer-proposals/${proposed.body.id}/decision`, { decision: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(await h.services.settings.valueAt("escrow.signers")).toEqual({ signers: [A, B, D], threshold: 2 });
    const signers = await sam.get("/v1/admin/escrow/signers");
    expect(signers.body.approved).toMatchObject({ id: proposed.body.id, status: "approved" });
    // Still read from configuration: on-chain, keys change only through the timelock.
    expect(signers.body.signers).toEqual([A, B, C]);

    const log = await dee.get("/v1/admin/change-log?kind=signer");
    expect(log.body.map((e: { summary: string }) => e.summary)).toEqual([
      "Signer change approved: 2 of 3. Next, the timelock",
      "Sam K. approved the signer change",
      expect.stringMatching(/^Proposed replacing 0x90F7…b906 with 0x15d3…6A65: 2 of 3$/)
    ]);
  });

  it("is refused by any one of them", async () => {
    const proposed = await sam.post("/v1/admin/escrow/signer-proposals", { kind: "threshold", threshold: 3 });
    expect(proposed.body).toMatchObject({ signersAfter: [A, B, D], thresholdAfter: 3 });
    const refused = await dee.post(`/v1/admin/escrow/signer-proposals/${proposed.body.id}/decision`, { decision: "refuse", note: "Three of three can't survive one lost key" });
    expect(refused.body.status).toBe("refused");
    expect(await h.services.settings.valueAt("escrow.signers")).toEqual({ signers: [A, B, D], threshold: 2 });
    // A threshold above the number of keys isn't a proposal.
    expect((await sam.post("/v1/admin/escrow/signer-proposals", { kind: "threshold", threshold: 4 })).status).toBe(422);
  });

  it("needs another admin to exist at all", async () => {
    await dee.put(`/v1/admin/desk/team/${sam.id}`, { roles: [{ role: "rights_reviewer" }] });
    const alone = await dee.post("/v1/admin/escrow/signer-proposals", { kind: "add", newAddress: C });
    expect(alone.status).toBe(422);
    expect(alone.body.error.code).toBe("needs_another_admin");
    delete process.env.ESCROW_VERIFIERS;
    delete process.env.ESCROW_THRESHOLD;
  });
});
