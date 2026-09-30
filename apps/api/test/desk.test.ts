// Network desk, rights claims, tuned-in counting and notification settings.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let marketId: string;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-22T19:00:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());

describe("Network desk", () => {
  let creatorId: string;
  let token: string;

  it("is for admins only", async () => {
    const someone = await h.signIn();
    await someone.get("/v1/admin/creators").expect(403);
    await anon(h).get("/v1/admin/creators").expect(401);
  });

  it("adds a creator and catalogues their works from titles and lengths", async () => {
    const creator = await dee
      .post("/v1/admin/creators", { marketId, displayName: "Tía Lupe's Kitchen", personName: "Lupe Ortiz", description: "Cooking in Spanish, Fontana", sourcePlatform: "youtube", sourceUrl: "https://youtube.com/@tialupe", contactEmail: "lupe@example.com" })
      .expect(201);
    creatorId = creator.body.id;
    const works = await dee
      .post(`/v1/admin/creators/${creatorId}/works`, [
        { title: "Mole, part 1", durationMs: 12 * 60_000, sourceUrl: "https://youtube.com/v/1" },
        { title: "Pozole", durationMs: 15 * 60_000, sourceUrl: "https://youtube.com/v/2" },
        { title: "A song someone else owns", durationMs: 3 * 60_000, sourceUrl: "https://youtube.com/v/3", leftOutReason: "Likely someone else's rights" }
      ])
      .expect(200);
    expect(works.body.map((w: { covered: string }) => w.covered)).toEqual(["none", "none", "none"]);
  });

  it("asks permission; the creator's page needs no account and shows a schedule from titles only", async () => {
    const asked = await dee.post(`/v1/admin/creators/${creatorId}/permission-requests`, { sentVia: ["email"], note: "We'd love to put you on 33.1." }).expect(201);
    token = asked.body.link.split("/permission/")[1];
    expect(h.sent.at(-1)).toMatchObject({ channel: "email", to: "lupe@example.com" });
    const page = await anon(h).get(`/v1/permission/${token}`).expect(200);
    expect(page.body.works.filter((w: { included: boolean }) => w.included)).toHaveLength(2);
    expect(page.body.schedulePreview.some((s: { title: string }) => s.title === "Mole, part 1")).toBe(true);
    expect(page.body.answer).toBeNull();
  });

  it("records the yes against the link with the exact list of works; only once", async () => {
    const answered = await anon(h).post(`/v1/permission/${token}/answer`).send({ answer: "yes" }).expect(200);
    expect(answered.body.answer).toMatchObject({ answer: "yes", works: 2 });
    await anon(h).post(`/v1/permission/${token}/answer`).send({ answer: "no" }).expect(422);
    const works = await dee.get(`/v1/admin/creators/${creatorId}/works`).expect(200);
    expect(works.body.map((w: { covered: string }) => w.covered)).toEqual(["permission", "permission", "none"]);
  });

  it("sets up a claimable station from a recipe, importing only the covered works", async () => {
    const recipe = await dee
      .post("/v1/admin/recipes", {
        name: "Cooking and food, TV band",
        category: "Food",
        band: "tv",
        blocks: [{ start: "06:00", end: "24:00", source: "creator" }],
        maxAiringsPerWorkPerWeek: 3,
        breakRule: { mode: "every_n_minutes", everyMinutes: 30 }
      })
      .expect(201);
    const setUp = await dee
      .post(`/v1/admin/creators/${creatorId}/station`, { recipeId: recipe.body.id, marketId, band: "tv", channel: "33.1", callSign: "LUPE", name: "Tía Lupe's Kitchen", operatorUserId: dee.id, signOnAt: "2026-09-28T13:00:00.000Z" })
      .expect(201);
    expect(setUp.body).toMatchObject({ station: { callSign: "LUPE", channel: "33.1", kind: "claimable" }, importable: 2 });
    const library = await dee.get(`/v1/stations/${setUp.body.station.id}/library`).expect(200);
    expect(library.body.items.map((i: { title: string; rights: { basis: string } }) => [i.title, i.rights.basis]).sort()).toEqual([
      ["Mole, part 1", "permission_record"],
      ["Pozole", "permission_record"]
    ]);
    const board = await dee.get("/v1/admin/markets/inland-empire/board?band=tv").expect(200);
    expect(board.body.slots.find((s: { major: number }) => s.major === 33)).toMatchObject({ state: "claimable", heldFor: null });
    expect(board.body.slots.find((s: { major: number }) => s.major === 34).state).toBe("open");
  });

  it("held earnings: nothing ever moves to Opencast", async () => {
    const held = await dee.get("/v1/admin/held-earnings").expect(200);
    expect(held.body.stations[0]).toMatchObject({ creator: "Lupe Ortiz", status: "not_on_air_yet", heldMicros: 0 });
    expect(held.body.everMovedToOpencastMicros).toBe(0);
  });

  it("a claim waits for approval, then 72 hours in public", async () => {
    const station = (await dee.get(`/v1/admin/creators?stage=setting_up`).expect(200)).body[0].station;
    const lupe = await h.signIn("Lupe");
    const claim = await lupe.post(`/v1/stations/${station.id}/claim`, { kind: "claim", sourceAccountProof: "youtube-oauth-code" }).expect(201);
    expect(claim.body).toMatchObject({ status: "verifying", payableAfter: null });
    const approved = await dee.post(`/v1/admin/handovers/${claim.body.handoverId}/approve`).expect(200);
    expect(approved.body.payableAfter).toBe("2026-09-25T19:00:00.000Z");
  });

  it("lists a city stream with its own player, synced from its agenda calendar", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:council-1",
      "SUMMARY:City Council\\, regular meeting",
      "DTSTART;TZID=America/Los_Angeles:20261006T180000",
      "DTEND;TZID=America/Los_Angeles:20261006T210000",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const server = await import("node:http").then((http) => http.createServer((_, res) => res.end(ics)));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const listed = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.1", callSign: "RDLS", name: "City of Redlands", streamUrl: "https://redlands.example/live", embedTerms: "allowed", calendarUrl: `http://127.0.0.1:${port}/agenda.ics`, evidence: { termsUrl: "https://redlands.example/terms", termsCheckedOn: "2026-09-21" } })
      .expect(201);
    server.close();
    expect(listed.body).toMatchObject({ calendarSync: "synced", listingState: "listed", upcoming: 1, plays: "embed", onDial: true, schedule: { source: "feed", format: "ical" }, evidence: { basis: "embed_terms" } });
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    const rdls = dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "RDLS");
    expect(rdls).toMatchObject({ playback: { kind: "embed", url: "https://redlands.example/live" }, next: { title: "City Council, regular meeting", startsAt: "2026-10-07T01:00:00.000Z" }, external: { source: "City of Redlands", plays: "embed", schedule: "feed" } });
  });
});

describe("rights claims", () => {
  it("take an item off air everywhere, and come back when answered", async () => {
    const owner = await h.signIn("Kai");
    const beat = await stationFixture(h, { callSign: "BEAT", ownerId: owner.id, marketId, tenths: 121, signedOn: true });
    const item = await itemFixture(h, beat.id, { title: "Late Crate, ep. 14" });
    await owner.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-09-23T03:00:00.000Z", itemId: item.id }).expect(201);
    const filed = await anon(h)
      .post("/v1/claims")
      .send({ itemId: item.id, claimantName: "Westside Tapes LLC", claimantRole: "Says they own the master recording", claimantContact: "legal@westside.example", claimText: "12:40 to 31:05 is our master.", rangeStartMs: 760_000, rangeEndMs: 1_865_000, swornStatement: true })
      .expect(201);
    expect(filed.body.answerDueAt).toBe("2026-10-06T19:00:00.000Z");
    const log = await owner.get(`/v1/stations/${beat.id}/log?from=2026-09-23T00:00:00.000Z&to=2026-09-24T00:00:00.000Z`).expect(200);
    expect(log.body.entries).toEqual([]);
    const list = await owner.get(`/v1/stations/${beat.id}/claims`).expect(200);
    expect(list.body.claims[0]).toMatchObject({ state: "open", daysToAnswer: 14, takedowns: [expect.objectContaining({ airingsReplaced: 1 })] });
    expect(JSON.stringify(list.body)).not.toContain("legal@westside.example");
    await h.deps.bus.settle();
    expect((await owner.get("/v1/me/notices").expect(200)).body[0]).toMatchObject({ kind: "rights_claim" });

    const noDetails = await owner.post(`/v1/claims/${filed.body.claimId}/answer`, { basis: "made_it", attest: true }).expect(422);
    expect(noDetails.body.error.code).toBe("legal_details");
    await owner.patch(`/v1/stations/${beat.id}/setup`, { legalName: "Inland Beat LLC", legalContact: "kai@inlandbeat.example" }).expect(200);
    const answered = await owner.post(`/v1/claims/${filed.body.claimId}/answer`, { basis: "made_it", attest: true }).expect(200);
    expect(answered.body.state).toBe("answered");
    expect(answered.body.answer.claimantReplyDueAt).toBe("2026-10-06T19:00:00.000Z");
  });

  it("no answer by the deadline removes it: removed, not upheld", async () => {
    const owner = await h.signIn();
    const reel = await stationFixture(h, { callSign: "REEL", ownerId: owner.id, marketId, tenths: 241, signedOn: true });
    const item = await itemFixture(h, reel.id, { title: "Borrowed film" });
    const filed = await anon(h).post("/v1/claims").send({ itemId: item.id, claimantName: "Studio", claimantContact: "x@example.com", claimText: "Ours.", swornStatement: true }).expect(201);
    h.clock.advance(15 * 86_400_000);
    expect(await h.services.trust.expireOverdue()).toBe(1);
    const standing = await owner.get(`/v1/stations/${reel.id}/claims`).expect(200);
    expect(standing.body.claims[0].state).toBe("expired");
    expect(standing.body.standing).toMatchObject({ status: "good", upheldLast12Months: 0 });
    await owner.get(`/v1/library/${item.id}`).expect(404);
    void filed;
    h.clock.advance(-15 * 86_400_000);
  });
});

describe("tuned in", () => {
  it("counts a session from its second heartbeat, and never one that behaves like a bot", async () => {
    const owner = await h.signIn();
    const civc = await stationFixture(h, { callSign: "CIVC", ownerId: owner.id, marketId, tenths: 71, signedOn: true });
    const beat = (viewer: string, media: number, platform = "web") => anon(h).post("/v1/heartbeat").send({ stationId: civc.id, sessionId: viewer, platform, mediaTimeMs: media, playing: true });
    const real = "11111111-1111-4111-8111-111111111111";
    const bot = "22222222-2222-4222-8222-222222222222";
    // TV mode on an iPhone's second screen.
    const mirror = "33333333-3333-4333-8333-333333333333";
    h.clock.set("2026-09-22T19:00:10.000Z");
    await beat(real, 0).expect(200);
    await beat(bot, 0).expect(200);
    await beat(mirror, 0, "mirror").expect(200);
    h.clock.set("2026-09-22T19:00:40.000Z");
    await beat(real, 30_000).expect(200);
    await beat(bot, 5_000_000).expect(200); // Media time racing ahead of the clock.
    await beat(mirror, 30_000, "mirror").expect(200);
    h.clock.set("2026-09-22T19:01:10.000Z");
    await beat(real, 60_000).expect(200);
    await beat(bot, 5_030_000).expect(200);
    await beat(mirror, 60_000, "mirror").expect(200);
    const samples = await h.db.select().from(schema.minuteSamples).where(eq(schema.minuteSamples.stationId, civc.id));
    expect(samples.map((s) => [s.tunedIn, s.web, s.mirror])).toEqual([
      [2, 1, 1],
      [2, 1, 1]
    ]);
    const [flagged] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, bot));
    expect(flagged).toMatchObject({ flaggedBot: true, flagReason: "media time moving faster than the clock" });
    const report = await owner.get(`/v1/stations/${civc.id}/audience?from=2026-09-22T18:00:00.000Z&to=2026-09-22T20:00:00.000Z`).expect(200);
    expect(report.body).toMatchObject({ tunedInNow: 2, byPlatform: { web: 1, mirror: 1, phone: 0, cast: 0, tv_app: 0 }, peak: { tunedIn: 2 } });
  });
});

describe("notification settings", () => {
  it("dead air coming can't be turned off", async () => {
    const owner = await h.signIn();
    const s = await stationFixture(h, { callSign: "NITE", ownerId: owner.id });
    const res = await owner
      .put("/v1/me/notification-prefs", { scope: "station", scopeId: s.id, prefs: { dead_air_warning: { push: false, email: false }, signal_lost: { push: false, email: false } } })
      .expect(200);
    expect(res.body.prefs.dead_air_warning).toEqual({ push: true, email: true });
    expect(res.body.prefs.signal_lost).toEqual({ push: false, email: false });
    expect(res.body.alwaysOn).toContain("dead_air_warning");
  });
});
