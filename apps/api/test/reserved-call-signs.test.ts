// Reserved call signs (Network desk, desk-pages 02; added 2026-09-29): holds that end after the
// registry's 120 days with a reminder before, Extend and Release; two people asking for the same
// name and the desk deciding; names Opencast won't allow, refused on the waitlist and at station
// setup, and Suggest; "Invite the next 10"; and a market lead kept to their own market.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User;
let lee: User;
let pat: User;
let ie: { id: string; slug: string };
let hd: { id: string; slug: string };

const DAY = 86_400_000;
const email = (u: User, address: string) => h.db.update(schema.users).set({ email: address }).where(eq(schema.users.id, u.id));

/** Joins the waitlist as a station, a minute after the last one (their place in line). */
function join(callSign: string, who: string, extra: { zip?: string; name?: string; about?: string } = {}) {
  h.clock.advance(60_000);
  return anon(h)
    .post("/v1/waitlist")
    .send({ role: "station", email: who, zip: extra.zip ?? "92373", callSign, ...(extra.name ? { name: extra.name } : {}), ...(extra.about ? { about: extra.about } : {}) });
}

async function list(as: User = dee, marketId = ie.id) {
  const res = await as.get(`/v1/admin/reservations?marketId=${marketId}`).expect(200);
  return res.body as Array<{ id: string; callSign: string; state: string; email: string | null; name: string | null; about: string | null; heldUntil: string; createdAt: string; sameName: string[]; channel: string | null; invitedAt: string | null; refusal: { rule: string; reason: string } | null }>;
}

const row = async (callSign: string, who?: string) => (await list()).find((r) => r.callSign === callSign && (!who || r.email === who))!;
const emailsTo = (to: string) => h.sent.filter((s) => s.channel === "email" && s.to === to);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-06-01T17:00:00.000Z");
  ie = await market(h);
  hd = await market(h, "high-desert", "High Desert");
  await h.db.insert(schema.zipMarkets).values([
    { zip: "92373", marketId: ie.id },
    { zip: "92392", marketId: hd.id }
  ]);
  dee = await h.signIn("Dee A.", { admin: true });
  lee = await h.signIn("Lee R.");
  pat = await h.signIn("Pat O.");
  await email(lee, "lee@opencast.test");
  await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie.id }] }).expect(200);
}, 60_000);
afterAll(() => h.close());

describe("end dates", () => {
  it("holds a reservation for the registry's 120 days, reminds before the end, and releases it and its channel after", async () => {
    const res = await join("GOLD", "hank@example.com", { name: "Hank V.", about: "Oldies, Upland" }).expect(201);
    expect(res.body).toMatchObject({ message: "GOLD is on hold for you.", heldCallSign: "GOLD" });
    const gold = await row("GOLD");
    expect(Date.parse(gold.heldUntil) - Date.parse(gold.createdAt)).toBe(120 * DAY);
    expect(gold).toMatchObject({ state: "waiting", name: "Hank V.", about: "Oldies, Upland", reason: "waitlist", sameName: [], refusal: null });
    await dee.post(`/v1/admin/reservations/${gold.id}/channel`, { marketId: ie.id, band: "tv", channel: "31.1" }).expect(200);

    // Fifteen days before the end: nothing yet. Fourteen: "Ends …" and one reminder.
    h.clock.set(new Date(Date.parse(gold.heldUntil) - 15 * DAY).toISOString());
    expect(await h.services.waitlist.sweep()).toEqual({ reminded: 0, expired: 0, signedOn: 0 });
    expect((await row("GOLD")).state).toBe("waiting");
    h.clock.advance(DAY);
    expect((await h.services.waitlist.sweep()).reminded).toBe(1);
    expect((await h.services.waitlist.sweep()).reminded).toBe(0);
    expect((await row("GOLD")).state).toBe("ending");
    const reminder = emailsTo("hank@example.com").at(-1)!;
    expect(reminder.title).toBe("GOLD is held until September 29");
    expect(reminder.body).toContain("Your hold on GOLD ends on September 29. Set up your station before then to keep it.");

    // After the end: released, the channel with it, and they're told.
    h.clock.set(new Date(Date.parse(gold.heldUntil) + 60_000).toISOString());
    expect((await h.services.waitlist.sweep()).expired).toBe(1);
    expect((await list()).some((r) => r.callSign === "GOLD")).toBe(false);
    const [released] = await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.id, gold.id));
    expect(released).toMatchObject({ releaseReason: "expired" });
    const holds = await h.db.select().from(schema.channelHolds).where(and(eq(schema.channelHolds.reservationId, gold.id), isNull(schema.channelHolds.releasedAt)));
    expect(holds).toHaveLength(0);
    expect(emailsTo("hank@example.com").at(-1)!.title).toBe("Your hold on GOLD has ended");
    expect((await anon(h).get("/v1/call-signs/GOLD").expect(200)).body).toMatchObject({ available: true, reservable: true });
  });

  it("extends by the hold's days from the end, and releases on request, freeing the channel", async () => {
    await join("DUSK", "marco@example.com", { name: "Marco T.", about: "Late-night film club, Redlands" }).expect(201);
    const dusk = await row("DUSK");
    await dee.post(`/v1/admin/reservations/${dusk.id}/channel`, { marketId: ie.id, band: "tv", channel: "35.1" }).expect(200);
    const extended = await dee.post(`/v1/admin/reservations/${dusk.id}/extend`, { note: "Waiting on a board vote" }).expect(200);
    expect(Date.parse(extended.body.heldUntil)).toBe(Date.parse(dusk.heldUntil) + 120 * DAY);
    expect(extended.body.extendedAt).toBe(h.clock.now().toISOString());

    const released = await dee.post(`/v1/admin/reservations/${dusk.id}/release`).expect(200);
    expect(released.body).toEqual({ ok: true, callSign: "DUSK", channel: "35.1" });
    expect((await list()).some((r) => r.callSign === "DUSK")).toBe(false);
    expect(emailsTo("marco@example.com").at(-1)!.body).toContain("Opencast's team ended your hold on DUSK and channel 35.1.");
    const board = await dee.get(`/v1/admin/markets/${ie.slug}/board`).expect(200);
    expect(JSON.stringify(board.body)).not.toContain("DUSK");
    expect((await dee.post(`/v1/admin/reservations/${dusk.id}/extend`)).status).toBe(404);
  });

  it("releases a hold once its station signs on", async () => {
    await join("HALO", "ruth@example.com", { name: "Ruth O.", about: "Community choir, Riverside" }).expect(201);
    const ruth = await h.signIn("Ruth", { linked: [{ kind: "email", value: "ruth@example.com" }] });
    const station = await ruth.post("/v1/stations", { name: "Halo" }).expect(201);
    await ruth.patch(`/v1/stations/${station.body.station.id}/setup`, { callSign: "HALO" }).expect(200);
    expect((await row("HALO")).state).toBe("signing_on");
    await h.db.update(schema.stations).set({ firstSignedOnAt: h.clock.now() }).where(eq(schema.stations.id, station.body.station.id));
    expect((await h.services.waitlist.sweep()).signedOn).toBe(1);
    expect((await list()).some((r) => r.callSign === "HALO")).toBe(false);
  });
});

describe("the same name twice", () => {
  it("lets two people ask, keeps it from both until the desk decides, and holds a suggestion for the other", async () => {
    const first = await join("VALE", "crew@example.com", { name: "Skate crew", about: "A skate crew, Fontana" }).expect(201);
    expect(first.body.message).toBe("VALE is on hold for you.");
    const second = await join("VALE", "church@example.com", { name: "Grace Church", about: "A church, Fontana" }).expect(201);
    expect(second.body.message).toBe("VALE is on hold for you. Someone else asked for it too: Opencast's team decides who keeps it, and writes to you either way.");
    expect((await join("VALE", "church@example.com").expect(201)).body.message).toBe("VALE is already on hold for you.");
    expect((await anon(h).get("/v1/call-signs/VALE").expect(200)).body).toMatchObject({ available: false, reservable: true, heldForYou: false });

    const rows = (await list()).filter((r) => r.callSign === "VALE");
    expect(rows.map((r) => [r.email, r.state])).toEqual([
      ["crew@example.com", "same_name"],
      ["church@example.com", "same_name"]
    ]);
    const [crew, church] = rows;
    expect(crew!.sameName).toEqual([church!.id]);
    // Nobody takes it until it's decided, not even the first to ask.
    const crewUser = await h.signIn("Crew", { linked: [{ kind: "email", value: "crew@example.com" }] });
    const theirs = await crewUser.post("/v1/stations", { name: "Vale Skate" }).expect(201);
    const early = await crewUser.patch(`/v1/stations/${theirs.body.station.id}/setup`, { callSign: "VALE" }).expect(409);
    expect(early.body.error.code).toBe("call_sign_undecided");
    // Nor can they be invited yet.
    expect((await dee.post(`/v1/admin/reservations/${crew!.id}/invite`)).body.error.code).toBe("same_name");

    const ideas = await dee.get("/v1/admin/call-signs/VALE/suggestions").expect(200);
    expect(ideas.body.suggestions).toEqual(["VALES", "VALEY", "VALEO"]);
    await dee.post(`/v1/admin/reservations/${church!.id}/channel`, { marketId: ie.id, band: "tv", channel: "37.1" }).expect(200);
    const decided = await dee.post(`/v1/admin/reservations/${crew!.id}/decide`, { suggestions: [{ reservationId: church!.id, callSign: "VALEY" }], note: "Asked first" }).expect(200);
    expect(decided.body.kept).toMatchObject({ callSign: "VALE", state: "waiting", sameName: [] });
    expect(decided.body.kept.decidedAt).toBeTruthy();
    expect(decided.body.told).toEqual([{ reservationId: church!.id, email: "church@example.com", suggestion: "VALEY" }]);

    // The other keeps their place in line and their channel, with VALEY.
    const valey = await row("VALEY");
    expect(valey).toMatchObject({ email: "church@example.com", createdAt: church!.createdAt, heldUntil: church!.heldUntil, channel: "37.1", state: "waiting" });
    const told = emailsTo("church@example.com").at(-1)!;
    expect(told.title).toBe("VALE went to someone else");
    expect(told.body).toContain("We've held VALEY for you instead, in the same place in line.");
    // Now the kept one can take it.
    await crewUser.patch(`/v1/stations/${theirs.body.station.id}/setup`, { callSign: "VALE" }).expect(200);
    // And nobody else can ask for it now.
    expect((await join("VALE", "late@example.com")).status).toBe(409);
  });

  it("won't decide a name only one person holds", async () => {
    await join("MESA", "mesa@example.com").expect(201);
    const mesa = await row("MESA");
    expect((await dee.post(`/v1/admin/reservations/${mesa.id}/decide`)).body.error.code).toBe("not_same_name");
  });
});

describe("names Opencast won't allow", () => {
  it("refuses them on the waitlist with a suggestion, and says why when checking", async () => {
    const kfro = await join("KFRO", "jpark@example.com").expect(422);
    expect(kfro.body.error).toMatchObject({ code: "call_sign_refused", message: "Four letters starting with K or W look like a real broadcast call sign. Try FRO or FROS." });
    const check = await anon(h).get("/v1/call-signs/KFRO").expect(200);
    expect(check.body).toEqual({
      callSign: "KFRO",
      valid: true,
      available: false,
      reservable: false,
      heldForYou: false,
      refusal: { rule: "kw_four_letters", reason: "Four letters starting with K or W look like a real broadcast call sign.", match: null },
      suggestions: ["FRO", "FROS", "FROY"]
    });
    expect((await join("ESPNX", "fan@example.com").expect(422)).body.error.message).toContain("ESPNX looks like ESPN, which belongs to someone else.");
    expect((await join("FOX", "fan@example.com").expect(422)).body.error.message).toContain("FOX belongs to someone else.");
    // Three letters must match exactly, so FOXY is fine.
    await join("FOXY", "foxy@example.com").expect(201);
    expect((await join("SOS", "sos@example.com").expect(422)).body.error.message).toContain("Opencast doesn't allow that name.");
    // Five letters starting with K are fine.
    await join("KAROO", "karoo@example.com").expect(201);
  });

  it("refuses them at station setup, and flags stations already on the dial without changing them", async () => {
    const kiln = await stationFixture(h, { callSign: "KILN", name: "Kiln", marketId: ie.id, tenths: 441, signedOn: true });
    const owner = await h.signIn("Owner");
    const station = await owner.post("/v1/stations", { name: "Wave Makers" }).expect(201);
    const refusedSetup = await owner.patch(`/v1/stations/${station.body.station.id}/setup`, { callSign: "WAVY" }).expect(422);
    expect(refusedSetup.body.error.code).toBe("call_sign_refused");
    const overview = await dee.get(`/v1/admin/reservations/overview?marketId=${ie.id}`).expect(200);
    expect(overview.body.flaggedStations).toEqual([{ stationId: kiln.id, callSign: "KILN", name: "Kiln", channel: "44.1", refusal: expect.objectContaining({ rule: "kw_four_letters" }) }]);
    expect(overview.body).toMatchObject({ holdDays: 120, reminderDays: 14 });
    const [still] = await h.db.select().from(schema.stations).where(eq(schema.stations.id, kiln.id));
    expect(still!.callSign).toBe("KILN");
  });

  it("flags a reservation a new rule refuses, and Suggest holds another name in its place", async () => {
    await join("GRIT", "grit@example.com", { name: "J. Park", about: "Wanted a gritty name" }).expect(201);
    const grit = await row("GRIT");
    await dee.post(`/v1/admin/reservations/${grit.id}/channel`, { marketId: ie.id, band: "tv", channel: "39.1" }).expect(200);
    const today = h.clock.now().toISOString().slice(0, 10);
    const current = (await dee.get("/v1/admin/rules/call_signs.refused/value").expect(200)).body.value;
    await dee.post("/v1/admin/rules/call_signs.refused/versions", { value: { ...current, denylist: [...current.denylist, "GRIT"] }, effectiveFrom: today, note: "Test" }).expect(200);
    const flagged = await row("GRIT");
    expect(flagged).toMatchObject({ state: "not_allowed", refusal: { rule: "denylist" } });
    expect((await dee.post(`/v1/admin/reservations/${grit.id}/invite`)).body.error.code).toBe("not_allowed");

    // A suggestion that's taken or refused is refused.
    expect((await dee.post(`/v1/admin/reservations/${grit.id}/suggest`, { callSign: "VALE" })).status).toBe(409);
    expect((await dee.post(`/v1/admin/reservations/${grit.id}/suggest`, { callSign: "WREN" })).body.error.code).toBe("call_sign_refused");
    const held = await dee.post(`/v1/admin/reservations/${grit.id}/suggest`, { callSign: "GRITS", alternatives: ["GRAY", "WREN"] });
    expect(held.body.error?.code).toBe("call_sign_refused"); // GRITS contains GRIT, on the denylist now
    const ok = await dee.post(`/v1/admin/reservations/${grit.id}/suggest`, { callSign: "GRAN", alternatives: ["GRAY", "WREN"] }).expect(200);
    expect(ok.body).toMatchObject({ callSign: "GRAN", email: "grit@example.com", createdAt: grit.createdAt, channel: "39.1", state: "waiting" });
    const told = emailsTo("grit@example.com").at(-1)!;
    expect(told.title).toBe("GRIT isn't allowed");
    expect(told.body).toContain("Opencast doesn't allow that name. We've held GRAN for you instead, in the same place in line. GRAY is free too, if you'd rather.");
    const [old] = await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.id, grit.id));
    expect(old).toMatchObject({ releaseReason: "refused", suggested: ["GRAN", "GRAY"] });
  });
});

describe("Invite the next 10", () => {
  it("invites the ones waiting, in reservation order, skipping any that need a decision", async () => {
    const signs = ["AAAB", "AAAC", "AAAD", "AAAE", "AAAF", "AAAG", "AAAH", "AAAI", "AAAJ", "AAAL", "AAAM", "AAAN"];
    for (const cs of signs) await join(cs, `${cs.toLowerCase()}@example.com`).expect(201);
    const before = (await dee.get(`/v1/admin/reservations/overview?marketId=${ie.id}`).expect(200)).body;
    const res = await dee.post("/v1/admin/reservations/invite-next", { marketId: ie.id }).expect(200);
    expect(res.body.invited).toHaveLength(10);
    expect(res.body.left).toBe(before.toInvite - 10);
    const order = (await list()).filter((r) => r.state === "waiting" || r.state === "invited" || r.state === "ending").map((r) => r.callSign);
    // The earliest waiting ones went first.
    expect(res.body.invited.map((r: { callSign: string }) => r.callSign)).toEqual(order.filter((cs) => res.body.invited.some((r: { callSign: string }) => r.callSign === cs)));
    expect(res.body.invited.every((r: { state: string; invitedAt: string | null }) => r.invitedAt && (r.state === "invited" || r.state === "ending"))).toBe(true);
    const invite = h.sent.filter((s) => s.title.startsWith("Sign on as ")).at(-1)!;
    expect(invite.link).toMatch(/\/control\/new$/);
    expect(invite.body).toContain("The Inland Empire is opening on Opencast");
    // Nobody who needs a decision was invited.
    const invitedIds = new Set(res.body.invited.map((r: { id: string }) => r.id));
    expect((await list()).filter((r) => r.state === "not_allowed" || r.state === "same_name").some((r) => invitedIds.has(r.id))).toBe(false);
  });
});

describe("market leads", () => {
  it("act only on their own market's reservations", async () => {
    await join("DUNE", "dune@example.com", { zip: "92392" }).expect(201);
    const dune = (await list(dee, hd.id)).find((r) => r.callSign === "DUNE")!;
    const mine = (await list(lee, ie.id)).find((r) => r.state === "waiting")!;
    await lee.post(`/v1/admin/reservations/${mine.id}/extend`).expect(200);
    expect((await lee.get(`/v1/admin/reservations?marketId=${hd.id}`)).status).toBe(403);
    for (const action of ["extend", "release", "invite"]) {
      const res = await lee.post(`/v1/admin/reservations/${dune.id}/${action}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("desk_role");
    }
    expect((await lee.get(`/v1/admin/reservations/overview?marketId=${hd.id}`)).status).toBe(403);
    expect((await lee.post("/v1/admin/reservations/invite-next", { marketId: hd.id })).status).toBe(403);
    // Not on the team at all.
    expect((await pat.get(`/v1/admin/reservations/overview?marketId=${ie.id}`)).status).toBe(403);
    expect((await pat.post(`/v1/admin/reservations/${mine.id}/release`)).status).toBe(403);
  });

  it("a signed-in person sees a name held for them as available", async () => {
    await join("NOPL", "nopal@example.com").expect(201);
    const nopal = await h.signIn("Nopal", { linked: [{ kind: "email", value: "nopal@example.com" }] });
    expect((await nopal.get("/v1/call-signs/NOPL").expect(200)).body).toMatchObject({ available: true, heldForYou: true });
    expect((await anon(h).get("/v1/call-signs/NOPL").expect(200)).body).toMatchObject({ available: false, heldForYou: false, reservable: true });
  });
});
