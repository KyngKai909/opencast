// A waitlist invite's link (added 2026-09-29): the desk's invite links to
// `/control/new?reservation=<id>`; the link's preview says what's held and whether it can still be
// used; a station started from it takes the call sign and channel held, only for the person it's
// for (the team invites' email check); choosing another channel lets the held one go; the hold ends
// at sign-on, and the signup is done.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User;
let ie: { id: string; slug: string };

const APP = "https://app.opencast.test";

function join(callSign: string, who: string) {
  h.clock.advance(60_000);
  return anon(h).post("/v1/waitlist").send({ role: "station", email: who, zip: "92373", callSign, name: "Dani R.", about: "A skate crew, Fontana" });
}

async function reservation(callSign: string) {
  const rows = (await dee.get(`/v1/admin/reservations?marketId=${ie.id}`).expect(200)).body as Array<{ id: string; callSign: string; state: string; stationId: string | null; heldUntil: string }>;
  return rows.find((r) => r.callSign === callSign)!;
}

/** Joins, holds a channel, and invites: the reservation's id. */
async function invited(callSign: string, who: string, channel?: string) {
  await join(callSign, who).expect(201);
  const r = await reservation(callSign);
  if (channel) await dee.post(`/v1/admin/reservations/${r.id}/channel`, { marketId: ie.id, band: "tv", channel }).expect(200);
  await dee.post(`/v1/admin/reservations/${r.id}/invite`).expect(200);
  return r.id;
}

const activeHolds = (reservationId: string) =>
  h.db
    .select()
    .from(schema.channelHolds)
    .where(and(eq(schema.channelHolds.reservationId, reservationId), isNull(schema.channelHolds.releasedAt)));

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-06-01T17:00:00.000Z");
  ie = await market(h);
  await h.db.insert(schema.zipMarkets).values({ zip: "92373", marketId: ie.id });
  dee = await h.signIn("Dee A.", { admin: true });
}, 60_000);
afterAll(() => h.close());

describe("the invite's link and its preview", () => {
  it("links the email to setup with the reservation, and the preview says what's held", async () => {
    const id = await invited("SKAT", "skat@example.com", "38.1");
    const email = h.sent.filter((s) => s.channel === "email" && s.to === "skat@example.com").at(-1)!;
    expect(email.link).toBe(`${APP}/control/new?reservation=${id}`);
    expect(email.body).toContain("Sign in with skat@example.com to set up your station. It starts with SKAT as its call sign and 38.1 as its channel: nobody else can have them.");

    const held = await reservation("SKAT");
    const signedOut = await anon(h).get(`/v1/waitlist/reservations/${id}`).expect(200);
    expect(signedOut.body).toEqual({
      id,
      callSign: "SKAT",
      market: expect.objectContaining({ id: ie.id, slug: ie.slug }),
      band: "tv",
      channel: "38.1",
      heldUntil: held.heldUntil,
      state: "open",
      emailHint: "s…@example.com",
      signedInAs: null,
      emailMatches: null,
      stationId: null
    });
    const them = await h.signIn("Dani", { linked: [{ kind: "email", value: "skat@example.com" }] });
    expect((await them.get(`/v1/waitlist/reservations/${id}`).expect(200)).body).toMatchObject({ signedInAs: "skat@example.com", emailMatches: true });
    const other = await h.signIn("Sam", { linked: [{ kind: "email", value: "sam@example.com" }] });
    expect((await other.get(`/v1/waitlist/reservations/${id}`).expect(200)).body).toMatchObject({ signedInAs: "sam@example.com", emailMatches: false });
    expect((await anon(h).get("/v1/waitlist/reservations/00000000-0000-4000-8000-000000000001")).status).toBe(404);
  });
});

describe("only the person it's for", () => {
  it("refuses someone signed in with another email, and makes nothing", async () => {
    const id = await invited("RAMP", "ramp@example.com", "39.1");
    const other = await h.signIn("Sam", { linked: [{ kind: "email", value: "someone@example.com" }] });
    const res = await other.post("/v1/stations", { name: "Not Mine", reservationId: id }).expect(403);
    expect(res.body.error).toMatchObject({
      code: "reservation_email_mismatch",
      message: "This invite is for r…@example.com; you're signed in as someone@example.com. Sign in with r…@example.com to use it."
    });
    expect(await h.db.select().from(schema.stations).where(eq(schema.stations.name, "Not Mine"))).toHaveLength(0);
    expect((await reservation("RAMP")).stationId).toBeNull();
  });

  it("lets anyone with the link use it when the check is off", async () => {
    const id = await invited("LOOP", "loop@example.com");
    h.deps.config.inviteEmailMatch = false;
    try {
      const other = await h.signIn("Else", { linked: [{ kind: "email", value: "else@example.com" }] });
      expect((await other.get(`/v1/waitlist/reservations/${id}`).expect(200)).body.emailMatches).toBeNull();
      const made = await other.post("/v1/stations", { name: "Loop", reservationId: id }).expect(201);
      expect(made.body.station.callSign).toBe("LOOP");
    } finally {
      h.deps.config.inviteEmailMatch = true;
    }
  });
});

describe("a hold that has ended", () => {
  it("says so on the preview, and can't start a station", async () => {
    const id = await invited("DUSK", "dusk@example.com", "35.1");
    const dusk = await h.signIn("Marco", { linked: [{ kind: "email", value: "dusk@example.com" }] });
    const before = h.clock.now().toISOString();
    h.clock.set(new Date(Date.parse((await reservation("DUSK")).heldUntil) + 60_000).toISOString());
    try {
      // Past its end, before the hourly job has released it.
      expect((await anon(h).get(`/v1/waitlist/reservations/${id}`).expect(200)).body.state).toBe("ended");
      const res = await dusk.post("/v1/stations", { name: "Dusk", reservationId: id }).expect(422);
      expect(res.body.error).toMatchObject({ code: "reservation_ended", message: "This invite has ended: DUSK isn't held for you any more. If it's still free, you can reserve it again on the waitlist." });
      await h.services.waitlist.sweep();
      expect((await anon(h).get(`/v1/waitlist/reservations/${id}`).expect(200)).body).toMatchObject({ state: "ended", channel: null });
    } finally {
      h.clock.set(before);
    }
  });

  it("says so when the desk released it", async () => {
    const id = await invited("MESA", "mesa@example.com");
    await dee.post(`/v1/admin/reservations/${id}/release`).expect(200);
    expect((await anon(h).get(`/v1/waitlist/reservations/${id}`).expect(200)).body.state).toBe("ended");
  });
});

describe("a station from the invite", () => {
  it("takes the call sign and channel held, is signing on, and ends the hold at sign-on with the signup done", async () => {
    const id = await invited("HALO", "ruth@example.com", "36.1");
    const ruth = await h.signIn("Ruth", { linked: [{ kind: "email", value: "ruth@example.com" }] });
    const made = await ruth.post("/v1/stations", { name: "Halo", reservationId: id }).expect(201);
    expect(made.body.station).toMatchObject({ callSign: "HALO", band: "tv", channel: "36.1", marketSlug: ie.slug });
    const stationId = made.body.station.id as string;

    expect(await reservation("HALO")).toMatchObject({ state: "signing_on", stationId });
    expect((await ruth.get(`/v1/waitlist/reservations/${id}`).expect(200)).body).toMatchObject({ state: "setting_up", stationId });
    // Someone else with the link doesn't learn the station.
    expect((await anon(h).get(`/v1/waitlist/reservations/${id}`).expect(200)).body).toMatchObject({ state: "setting_up", stationId: null });
    // Once only.
    expect((await ruth.post("/v1/stations", { name: "Halo again", reservationId: id }).expect(409)).body.error.code).toBe("reservation_used");

    const signups = (await dee.get(`/v1/admin/waitlist?marketId=${ie.id}`).expect(200)).body as Array<{ email: string; done: boolean; stationId: string | null }>;
    expect(signups.find((s) => s.email === "ruth@example.com")).toMatchObject({ done: true, stationId });
    expect(signups.find((s) => s.email === "mesa@example.com")).toMatchObject({ done: false, stationId: null });

    await h.db.update(schema.stations).set({ firstSignedOnAt: h.clock.now() }).where(eq(schema.stations.id, stationId));
    expect((await h.services.waitlist.sweep()).signedOn).toBe(1);
    const [row] = await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.id, id));
    expect(row).toMatchObject({ releaseReason: "signed_on", stationId });
    expect((await ruth.get(`/v1/waitlist/reservations/${id}`).expect(200)).body).toMatchObject({ state: "signed_on", stationId });
  });

  it("lets the held channel go when another is chosen", async () => {
    const id = await invited("GRIN", "grin@example.com", "33.1");
    const grin = await h.signIn("Grin", { linked: [{ kind: "email", value: "grin@example.com" }] });
    const made = await grin.post("/v1/stations", { name: "Grin", reservationId: id }).expect(201);
    const stationId = made.body.station.id as string;
    // Saving the held one again keeps it held.
    await grin.put(`/v1/stations/${stationId}/channel`, { marketId: ie.id, band: "tv", channel: "33.1" }).expect(200);
    expect(await activeHolds(id)).toHaveLength(1);

    const moved = await grin.put(`/v1/stations/${stationId}/channel`, { marketId: ie.id, band: "tv", channel: "34.1" }).expect(200);
    expect(moved.body.station.channel).toBe("34.1");
    expect(await activeHolds(id)).toHaveLength(0);
    const channels = (await grin.get(`/v1/markets/${ie.slug}/channels?band=tv`).expect(200)).body.channels as Array<{ channel: string; state: string }>;
    expect(channels.find((c) => c.channel === "33.1")!.state).toBe("open");
    expect(channels.find((c) => c.channel === "34.1")!.state).toBe("taken");
    // The call sign stays theirs.
    expect((await reservation("GRIN")).state).toBe("signing_on");
  });

  it("starts without a channel when none is held", async () => {
    const id = await invited("NOPL", "nopal@example.com");
    const nopal = await h.signIn("Nopal", { linked: [{ kind: "email", value: "nopal@example.com" }] });
    const made = await nopal.post("/v1/stations", { name: "Nopal", reservationId: id }).expect(201);
    expect(made.body.station).toMatchObject({ callSign: "NOPL", channel: null });
  });
});
