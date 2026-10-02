// Pay-as-you-go for stations (follow-up Phase 2): the arithmetic, metering, prices by effective
// date, the free allowance, the order money is taken in at month end, grace and pausing, caps,
// the estimate. The month for three stations is test/billing-month.test.ts; Stripe's side
// (metadata, the statement suffix, ignored events, the key) is in test/payments.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { StationAccount } from "@opencast/contracts";
import { fakeAddress } from "../src/v1/payments/clear.js";
import { fakePayments } from "../src/v1/payments/index.js";
import { dayCharge, monthCharge, monthEstimate, unionHours } from "../src/v1/modules/ledger/usageMath.js";
import { $, airedLive, earn, keepStorage, relayed } from "./billing-month.js";
import { createHarness, market, radioTenths, stationFixture, type Harness, type User } from "./harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);

describe("the arithmetic", () => {
  it("storage is each day's GB averaged over the month, the allowance used first", () => {
    // 10 GB for 15 days, then 30 GB for 16: (150 + 480) / 31 = 20.32 GB-months, 10.32 over the free 10.
    const rows = [...Array(15).fill(10), ...Array(16).fill(30)].map((gb) => ({ quantity: gb, priceMicros: 40_000 }));
    const month = monthCharge({ unit: "gb_month", monthDays: 31, allowance: 10, rows, capMicros: null });
    expect(month.quantity).toBeCloseTo(630 / 31, 9);
    expect(month.freeQuantity).toBe(10);
    expect(month.billableQuantity).toBeCloseTo(630 / 31 - 10, 9);
    expect(month.cappedMicros).toBe(Math.round((630 / 31 - 10) * 40_000));
    // The first days are free until the month's allowance is used (10 GB-months by the 21st).
    expect(month.days.slice(0, 20).every((d) => d.billable === 0)).toBe(true);
    expect(month.days[20].billable).toBeCloseTo(330 / 31 - 10, 9);
  });

  it("each day is charged at that day's price", () => {
    // 10 relay hours a day; $0.20 until the 11th, $0.30 from then.
    const rows = Array.from({ length: 20 }, (_, i) => ({ quantity: 10, priceMicros: i < 10 ? 200_000 : 300_000 }));
    expect(monthCharge({ unit: "hour", monthDays: 31, allowance: 0, rows, capMicros: null }).cappedMicros).toBe(100 * 200_000 + 100 * 300_000);
    // A price that isn't set charges nothing.
    expect(monthCharge({ unit: "hour", monthDays: 31, allowance: 0, rows: [{ quantity: 10, priceMicros: null }], capMicros: null }).cappedMicros).toBe(0);
  });

  it("the free hours come first; a cap is never passed, and a day never takes back what an earlier one charged", () => {
    const rows = [2, 2, 2, 2].map((h) => ({ quantity: h, priceMicros: 750_000 }));
    const month = monthCharge({ unit: "hour", monthDays: 31, allowance: 5, rows, capMicros: null });
    expect(month.days.map((d) => d.billable)).toEqual([0, 0, 1, 2]);
    expect(month.cappedMicros).toBe($(2.25));
    const capped = monthCharge({ unit: "hour", monthDays: 31, allowance: 5, rows, capMicros: $(1) });
    expect(capped).toMatchObject({ cappedMicros: $(1), capReached: true });
    expect(dayCharge(capped, $(2))).toBe(0);
    expect(monthCharge({ unit: "hour", monthDays: 31, allowance: 5, rows: [{ quantity: 1, priceMicros: 750_000 }], capMicros: 0 }).capReached).toBe(false);
  });

  it("relays count once per station, however many platforms at a time", () => {
    const i = (a: number, b: number) => ({ startedAt: new Date(a * HOUR), endedAt: new Date(b * HOUR) });
    expect(unionHours([i(1, 4), i(2, 5), i(8, 9), i(8.5, 8.75)])).toBe(5);
  });

  it("the estimate: storage as it stands, hours at the month's pace, never past the cap", () => {
    const soFar = monthCharge({ unit: "hour", monthDays: 30, allowance: 0, rows: Array(10).fill({ quantity: 6, priceMicros: 200_000 }), capMicros: null });
    expect(monthEstimate({ unit: "hour", monthDays: 30, allowance: 0, soFar, daysMeasured: 10, currentGb: 0, elapsedDays: 10, priceMicros: 200_000, capMicros: null })).toEqual({ quantity: 180, micros: $(36) });
    expect(monthEstimate({ unit: "hour", monthDays: 30, allowance: 0, soFar, daysMeasured: 10, currentGb: 0, elapsedDays: 10, priceMicros: 200_000, capMicros: $(20) }).micros).toBe($(20));
    const storage = monthCharge({ unit: "gb_month", monthDays: 30, allowance: 10, rows: Array(10).fill({ quantity: 60, priceMicros: 40_000 }), capMicros: null });
    expect(monthEstimate({ unit: "gb_month", monthDays: 30, allowance: 10, soFar: storage, daysMeasured: 10, currentGb: 60, elapsedDays: 9.5, priceMicros: 40_000, capMicros: null })).toMatchObject({ quantity: expect.closeTo(60, 9), micros: $(2) });
  });
});

describe("pay-as-you-go on the services", () => {
  let h: Harness;
  let fake: ReturnType<typeof fakePayments>;
  let m: { id: string };
  let dee: User;

  beforeAll(async () => {
    h = await createHarness({
      payments: (clock) => {
        fake = fakePayments(clock);
        return fake;
      }
    });
    h.clock.set("2026-10-01T00:00:00.000Z");
    m = await market(h);
    dee = await h.signIn("Dee", { admin: true });
  }, 60_000);
  afterAll(() => h.close());

  let tv = 401;
  let radio = 5;
  async function station(name: string, fields: { band?: "tv" | "radio"; kind?: "station" | "claimable" } = {}) {
    const owner = await h.signIn(`${name} owner`);
    const callSign = name.toUpperCase().slice(0, 5);
    const tenths = fields.band === "radio" ? await radioTenths(h, radio++) : (tv += 10);
    const s = await stationFixture(h, { callSign, name, ownerId: fields.kind === "claimable" ? undefined : owner.id, marketId: m.id, tenths, band: fields.band, kind: fields.kind, signedOn: true });
    return { id: s.id, owner };
  }
  const rows = (stationId: string) => h.db.select().from(schema.usageDays).where(eq(schema.usageDays.stationId, stationId)).orderBy(asc(schema.usageDays.day), asc(schema.usageDays.usageType));
  const account = async (s: { id: string; owner: User }) => (await s.owner.get(`/v1/stations/${s.id}/account`).expect(200)).body as StationAccount;
  async function days(from: string, count: number) {
    for (let i = 0; i < count; i++) {
      const d = new Date(at(`${from}T00:00:00.000Z`).getTime() + i * DAY).toISOString().slice(0, 10);
      await h.services.billing.meterDay(d, new Date(at(`${d}T00:00:00.000Z`).getTime() + DAY));
      await h.services.billing.closeDay(d);
    }
  }

  it("measures storage (originals and prepared together), relays per station, and live hours: Livepeer's for TV, the worker's own for radio", async () => {
    const tv = await station("Metr");
    const radio = await station("Radi", { band: "radio" });
    const claimable = await station("Clam", { kind: "claimable" });
    await keepStorage(h, tv.id, 2, 6);
    await relayed(h, tv.id, "00000000-0000-4000-8000-000000000001", at("2026-10-01T01:00:00Z"), at("2026-10-01T04:00:00Z"));
    await relayed(h, tv.id, "00000000-0000-4000-8000-000000000002", at("2026-10-01T02:00:00Z"), at("2026-10-01T05:00:00Z"));
    await relayed(h, tv.id, "00000000-0000-4000-8000-000000000001", at("2026-10-01T08:00:00Z"), at("2026-10-01T09:00:00Z"));
    await relayed(h, claimable.id, "00000000-0000-4000-8000-000000000003", at("2026-10-01T01:00:00Z"), at("2026-10-01T04:00:00Z"));
    await airedLive(h, tv.id, at("2026-10-01T20:00:00Z"), at("2026-10-01T21:30:00Z"));
    await airedLive(h, radio.id, at("2026-10-01T22:00:00Z"), at("2026-10-02T00:00:00Z"));
    // Mid-day: what's happened so far.
    h.clock.set("2026-10-01T12:00:00.000Z");
    await h.services.billing.meterDay("2026-10-01", h.clock.now());
    expect((await rows(tv.id)).map((r) => [r.usageType, r.quantity])).toEqual([
      ["relay_everything", 5],
      ["storage", 8]
    ]);
    expect((await rows(tv.id)).find((r) => r.usageType === "storage")?.detail).toEqual({ originalBytes: 2e9, preparedBytes: 6e9 });
    // The day's end: the live hours too; radio's is its own type. Claimable stations aren't billed.
    await h.services.billing.meterDay("2026-10-01", at("2026-10-02T00:00:00Z"));
    expect((await rows(tv.id)).find((r) => r.usageType === "live_hours")?.quantity).toBe(1.5);
    expect((await rows(radio.id)).map((r) => [r.usageType, r.quantity])).toEqual([["radio_live", 2]]);
    expect(await rows(claimable.id)).toEqual([]);
  });

  it("charges each day at that day's price after the free allowance, accrued in the ledger as the month goes", async () => {
    h.clock.set("2026-10-01T00:00:00.000Z");
    const s = await station("Pric");
    for (let d = 1; d <= 10; d++) await airedLive(h, s.id, at(`2026-10-${String(d).padStart(2, "0")}T02:00:00Z`), at(`2026-10-${String(d).padStart(2, "0")}T04:00:00Z`));
    // Live hours go from $0.75 to $1.00 on October 6.
    await dee.post("/v1/admin/rules/prices.live_hours/versions", { value: { perHourMicros: $(1) }, effectiveFrom: "2026-10-06", note: "Test" }).expect(200);
    h.clock.set("2026-10-11T00:10:00.000Z");
    await days("2026-10-01", 10);
    const r = (await rows(s.id)).filter((x) => x.usageType === "live_hours");
    // 5 hours free (days 1, 2 and half of 3), then $0.75 to the 5th, $1.00 from the 6th.
    expect(r.map((x) => x.chargeMicros)).toEqual([0, 0, $(0.75), $(1.5), $(1.5), $(2), $(2), $(2), $(2), $(2)]);
    const [bill] = await h.db.select().from(schema.usageBills).where(eq(schema.usageBills.stationId, s.id));
    const entries = await h.db.select().from(schema.entries).where(and(eq(schema.entries.sourceId, bill.id), eq(schema.entries.kind, "usage")));
    expect(entries).toHaveLength(8);
    expect(await h.services.billing.owedMicros(s.id)).toBe($(13.75));
    const a = await account(s);
    expect(a.usage.find((u) => u.type === "live_hours")).toMatchObject({ quantity: 20, allowance: { quantity: 5, left: 0 }, soFarMicros: $(13.75), priceMicros: $(1) });
  });

  it("at month end takes earnings first, then an owner's Clear wallet with full access (the owner approves), else the card", async () => {
    h.clock.set("2026-10-01T00:00:00.000Z");
    const clearStation = await station("Clea");
    const cardStation = await station("Card");
    for (const s of [clearStation, cardStation]) {
      for (let d = 0; d < 31; d++) await relayed(h, s.id, "00000000-0000-4000-8000-000000000009", new Date(at("2026-10-01T00:00:00Z").getTime() + d * DAY), new Date(at("2026-10-01T10:00:00Z").getTime() + d * DAY));
      await earn(h, s.id, $(10));
    }
    // Both have a card; one owner also links Clear with full access, which comes first.
    for (const s of [clearStation, cardStation]) await s.owner.post(`/v1/stations/${s.id}/account/card`, { setupIntentId: `seti_fake_${s.id}` }).expect(200);
    h.clear.access = "full";
    h.clear.accounts.set(clearStation.owner.did, { subject: "did:privy:clear-clea", address: "0x0000000000000000000000000000000000000101" });
    await clearStation.owner.post("/v1/me/clear").expect(200);
    expect((await account(clearStation)).funding).toMatchObject({ source: "clear", chosen: null, clear: { available: true, access: "full" }, card: { label: "Visa ending 4242" } });
    expect((await account(cardStation)).funding).toMatchObject({ source: "card", chosen: null });

    h.clock.set("2026-11-01T00:05:00.000Z");
    await days("2026-10-01", 31);
    await h.services.billing.closeMonth(at("2026-10-01T00:00:00Z"));
    // 310 relay hours at $0.20 = $62; $10 from earnings; $52 left.
    const card = await account(cardStation);
    expect(card.bills[0]).toMatchObject({ month: "2026-10", status: "paid", amountMicros: $(62), fromEarningsMicros: $(10), fromCardMicros: $(52), dueMicros: 0 });
    expect(fake.cards.charges.filter((c) => c.stationId === cardStation.id)).toEqual([expect.objectContaining({ amountMicros: $(52), ok: true })]);

    const clear = await account(clearStation);
    expect(clear.bills[0]).toMatchObject({ status: "due", fromEarningsMicros: $(10), dueMicros: $(52), lastAttempt: { method: "clear", result: "waiting_for_approval" } });
    expect(clear).toMatchObject({ standing: "grace", grace: { pausesOn: "2026-11-15", dueMicros: $(52) } });
    expect(fake.cards.charges.filter((c) => c.stationId === clearStation.id)).toEqual([]);
    await h.deps.bus.settle();
    expect((await clearStation.owner.get("/v1/me/notices").expect(200)).body.map((n: { title: string }) => n.title)).toContain("Approve October's usage in Clear");

    // The owner approves the transfer in Clear: to Opencast's account, what's due.
    const quote = (await clearStation.owner.post(`/v1/stations/${clearStation.id}/account/clear-payment/quote`).expect(200)).body;
    expect(quote).toMatchObject({ to: fakeAddress("opencast:treasury"), amountMicros: $(52), amountUnits: String($(52)), from: "0x0000000000000000000000000000000000000101" });
    const txHash = `0x${"ab".repeat(32)}`;
    const paid = (await clearStation.owner.post(`/v1/stations/${clearStation.id}/account/clear-payment`, { amountMicros: $(52), txHash }).expect(200)).body as StationAccount;
    expect(paid).toMatchObject({ standing: "ok", dueMicros: 0 });
    expect(paid.bills[0]).toMatchObject({ status: "paid", fromClearMicros: $(52) });
    // Once only.
    await clearStation.owner.post(`/v1/stations/${clearStation.id}/account/clear-payment`, { amountMicros: $(52), txHash }).expect(200);
    expect((await account(clearStation)).bills[0].fromClearMicros).toBe($(52));
    await h.services.ledger.sendMoves();
    const custody = await h.services.ledger.custodyBalances();
    for (const [wallet, micros] of custody) expect(fake.mirror.wallets.get(wallet) ?? 0, wallet).toBe(micros);
  });

  it("a charge Stripe reports failed later starts grace; paying brings back what paused, never touching the channel", async () => {
    h.clock.set("2026-10-01T00:00:00.000Z");
    const s = await station("Late");
    for (let d = 0; d < 31; d++) await relayed(h, s.id, "00000000-0000-4000-8000-000000000010", new Date(at("2026-10-01T00:00:00Z").getTime() + d * DAY), new Date(at("2026-10-01T05:00:00Z").getTime() + d * DAY));
    await h.db.insert(schema.translators).values({ stationId: s.id, service: "youtube", name: "YouTube", rtmpUrl: "rtmp://youtube.test/live", streamKey: "key-late" });
    h.clock.set("2026-11-01T00:05:00.000Z");
    await days("2026-10-01", 31);
    await h.services.billing.closeMonth(at("2026-10-01T00:00:00Z"));
    // No card, no Clear: grace from today.
    expect(await account(s)).toMatchObject({ standing: "grace", dueMicros: $(31) });
    const [bill] = await h.db.select().from(schema.usageBills).where(eq(schema.usageBills.stationId, s.id));

    // Past the grace period: relays and live hours pause; the channel doesn't.
    h.clock.set("2026-11-15T00:06:00.000Z");
    expect((await h.services.billing.graceSteps()).paused).toBeGreaterThanOrEqual(1);
    expect((await account(s)).standing).toBe("paused");
    expect(await h.services.billing.paused(s.id)).toEqual({ relays: true, liveHours: true, radioLive: false, storage: false });
    expect(await h.services.stations.relays(s.id)).toEqual([]);

    // A card is added (charged at once, through the fake), then Stripe says a retry failed and another succeeded.
    await s.owner.post(`/v1/stations/${s.id}/account/card`, { setupIntentId: "seti_fake_late" }).expect(200);
    expect(await account(s)).toMatchObject({ standing: "ok", dueMicros: 0 });
    expect(await h.services.stations.relays(s.id)).toHaveLength(1);
    // Stripe's own report of the same charge is taken once.
    const [charge] = fake.cards.charges.filter((c) => c.billId === bill.id);
    await h.services.ledger.handlePaymentEvent({ kind: "usage_paid", billId: bill.id, providerRef: charge.providerRef, amountMicros: charge.amountMicros, feeMicros: 0 });
    expect((await account(s)).bills.find((b) => b.id === bill.id)).toMatchObject({ status: "paid", fromCardMicros: $(31), dueMicros: 0 });
    await h.deps.bus.settle();
    const titles = (await s.owner.get("/v1/me/notices").expect(200)).body.map((n: { title: string }) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["October's usage is due", "Relays and live shows are paused", "Relays and live shows are back"]));
  });

  it("a cap pauses that usage (never the channel) and tells the owner; raising it resumes; a $0 storage cap stops new uploads", async () => {
    h.clock.set("2026-12-01T00:00:00.000Z");
    const s = await station("Caps");
    await h.db.insert(schema.translators).values({ stationId: s.id, service: "twitch", name: "Twitch", rtmpUrl: "rtmp://twitch.test/live", streamKey: "key-caps" });
    await relayed(h, s.id, "00000000-0000-4000-8000-000000000011", at("2026-12-01T00:00:00Z"), at("2026-12-02T00:00:00Z"));
    await s.owner.put(`/v1/stations/${s.id}/account/caps`, { caps: { relay_everything: $(2) } }).expect(200);
    await s.owner.put(`/v1/stations/${s.id}/account/caps`, { caps: { relay_live_only: $(1) } }).expect(422);
    // 12 hours in: $2.40 at $0.20, over the $2 cap.
    h.clock.set("2026-12-01T12:00:00.000Z");
    await h.services.billing.meterDay("2026-12-01", h.clock.now());
    expect(await h.services.billing.checkCaps()).toBe(1);
    expect(await h.services.stations.relays(s.id)).toEqual([]);
    const capped = await account(s);
    expect(capped.usage.find((u) => u.type === "relay_everything")).toMatchObject({ soFarMicros: $(2), cap: { micros: $(2), reached: true }, paused: "cap" });
    expect(capped.standing).toBe("ok");
    await h.deps.bus.settle();
    expect((await s.owner.get("/v1/me/notices").expect(200)).body[0]).toMatchObject({ kind: "station_account", title: "Relays, everything you air reached $2.00 for December" });
    // The day closes at the cap, not past it.
    h.clock.set("2026-12-02T00:05:00.000Z");
    await h.services.billing.meterDay("2026-12-01", at("2026-12-02T00:00:00Z"));
    await h.services.billing.closeDay("2026-12-01");
    expect((await rows(s.id)).find((r) => r.usageType === "relay_everything")?.chargeMicros).toBe($(2));
    // Raised: back.
    const raised = (await s.owner.put(`/v1/stations/${s.id}/account/caps`, { caps: { relay_everything: $(50) } }).expect(200)).body as StationAccount;
    expect(raised.usage.find((u) => u.type === "relay_everything")).toMatchObject({ cap: { micros: $(50), reached: false }, paused: null });
    expect(await h.services.stations.relays(s.id)).toHaveLength(1);
    // Storage capped at $0 with more than the allowance kept: new uploads and imports wait.
    await keepStorage(h, s.id, 100, 300);
    await s.owner.put(`/v1/stations/${s.id}/account/caps`, { caps: { storage: 0 } }).expect(200);
    await h.services.billing.meterDay("2026-12-02", h.clock.now());
    await h.services.billing.checkCaps();
    await expect(h.services.library.importLinks(s.id, { urls: ["https://example.com/v"], expandPlaylists: false, code: "PGM" })).rejects.toMatchObject({ status: 409, code: "storage_paused" });
  });

  it("the Station account is the owner's to change; operators see it; others don't", async () => {
    const s = await station("Perm");
    const op = await h.signIn("Operator");
    await h.db.insert(schema.stationMemberships).values({ stationId: s.id, userId: op.id, role: "operator" });
    const seen = (await op.get(`/v1/stations/${s.id}/account`).expect(200)).body as StationAccount;
    expect(seen.canManage).toBe(false);
    expect((await account(s)).canManage).toBe(true);
    await op.put(`/v1/stations/${s.id}/account/caps`, { caps: { relay_everything: $(5) } }).expect(403);
    await op.post(`/v1/stations/${s.id}/account/card-setup`).expect(403);
    await op.post(`/v1/stations/${s.id}/account/pay`).expect(403);
    await (await h.signIn("Stranger")).get(`/v1/stations/${s.id}/account`).expect(404);
    const setup = (await s.owner.post(`/v1/stations/${s.id}/account/card-setup`).expect(201)).body;
    expect(setup).toMatchObject({ setupIntentId: expect.stringMatching(/^seti_/), clientSecret: expect.any(String), publishableKey: null });
    await s.owner.post(`/v1/stations/${s.id}/account/pay`).expect(409);
    await s.owner.put(`/v1/stations/${s.id}/account/funding`, { source: "card" }).expect(409);
  });
});
