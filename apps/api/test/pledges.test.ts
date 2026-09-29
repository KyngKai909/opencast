// Pledges (E1, added 2026-09-28): the card on file, receipts, changing monthly or once, and a page
// to change the card. On the fake provider (a card is taken at once).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let stationId: string;
let kai: User;
beforeAll(async () => {
  h = await createHarness();
  const { id: marketId } = await market(h);
  stationId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", marketId, tenths: 121, signedOn: true })).id;
  kai = await h.signIn("Kai M.");
}, 60_000);
afterAll(() => h.close());

describe("pledges (E1)", () => {
  let monthly: string;

  it("shows the card and each receipt", async () => {
    const res = await kai.post(`/v1/stations/${stationId}/pledges`, { cadence: "monthly", amountMicros: 10_000_000 }).expect(201);
    monthly = res.body.pledge.id;
    expect(res.body.pledge.card).toEqual({ label: "Visa ending 4242", expired: false, expiresOn: "2029-10-31" });
    expect(res.body.pledge.receipts).toEqual({ count: 1, totalMicros: 10_000_000, items: [{ id: expect.any(String), on: "2026-10-01", amountMicros: 10_000_000, url: null }] });

    // The amount changes; the receipt keeps what was paid.
    const changed = await kai.patch(`/v1/me/pledges/${monthly}`, { amountMicros: 12_000_000 }).expect(200);
    expect(changed.body.receipts.totalMicros).toBe(10_000_000);
  });

  it("monthly to once isn't charged again; back to monthly before the month's out carries on", async () => {
    const once = await kai.patch(`/v1/me/pledges/${monthly}`, { cadence: "once" }).expect(200);
    expect(once.body).toMatchObject({ cadence: "monthly", endsAfter: "2026-10-31", nextChargeOn: null });
    const back = await kai.patch(`/v1/me/pledges/${monthly}`, { cadence: "monthly" }).expect(200);
    expect(back.body).toMatchObject({ endsAfter: null, nextChargeOn: "2026-11-01" });
  });

  it("a one-time pledge can't become monthly, and has no card to change", async () => {
    const res = await kai.post(`/v1/stations/${stationId}/pledges`, { cadence: "once", amountMicros: 5_000_000 }).expect(201);
    const refused = await kai.patch(`/v1/me/pledges/${res.body.pledge.id}`, { cadence: "monthly" }).expect(422);
    expect(refused.body.error.code).toBe("new_pledge_needed");
    const noCard = await kai.post(`/v1/me/pledges/${res.body.pledge.id}/card-session`).expect(422);
    expect(noCard.body.error.code).toBe("no_card_to_change");
  });

  it("changes the card on a monthly pledge through the provider's page", async () => {
    const session = await kai.post(`/v1/me/pledges/${monthly}/card-session`, { returnTo: "/you" }).expect(200);
    expect(session.body.url).toBe("https://app.opencast.test/you?card=updated");
    const [pledge] = (await kai.get("/v1/me/pledges").expect(200)).body.filter((p: { id: string }) => p.id === monthly);
    expect(pledge.card.label).toBe("Mastercard ending 4444");
    // Someone else's pledge isn't theirs to change.
    await (await h.signIn()).post(`/v1/me/pledges/${monthly}/card-session`).expect(404);
  });

  it("an expired card says so", async () => {
    await h.db.update(schema.pledges).set({ cardExpiresOn: "2026-09-30" }).where(eq(schema.pledges.id, monthly));
    const [pledge] = (await kai.get("/v1/me/pledges").expect(200)).body.filter((p: { id: string }) => p.id === monthly);
    expect(pledge.card).toEqual({ label: "Mastercard ending 4444", expired: true, expiresOn: "2026-09-30" });
  });

  it("a card reported by the provider's webhook lands on the pledge", async () => {
    await h.services.ledger.handlePaymentEvent({ kind: "pledge_started", pledgeId: monthly, providerRef: "sub_live_1", card: { label: "Amex ending 0005", expiresOn: "2030-01-31" } });
    const [row] = await h.db.select().from(schema.pledges).where(eq(schema.pledges.id, monthly));
    expect(row).toMatchObject({ stripeRef: "sub_live_1", cardLabel: "Amex ending 0005", cardExpiresOn: "2030-01-31" });
    await h.services.ledger.handlePaymentEvent({ kind: "pledge_card", pledgeId: monthly, card: { label: "Visa ending 1111", expiresOn: null } });
    const [pledge] = (await kai.get("/v1/me/pledges").expect(200)).body.filter((p: { id: string }) => p.id === monthly);
    expect(pledge.card).toEqual({ label: "Visa ending 1111", expired: false, expiresOn: null });
  });
});
