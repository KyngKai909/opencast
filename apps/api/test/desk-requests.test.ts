// The desk's and the permission page's requests (added 2026-09-28): proposed options (N1), the one
// reminder (N2), pipeline dates and claim invites (N3), the permission page's fields (N4), the
// setup read back (N5), recipe details (N6), board stats and slot sign-on (N7), held earnings'
// fields (N9, A125), the pronoun (N12), ticked works (B7), and stop and claim from the link (B8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let marketId: string;
let recipeId: string;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-22T19:00:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());

const tokenOf = (link: string) => link.split("/permission/")[1];

async function creator(displayName: string, extra: object = {}) {
  const res = await dee
    .post("/v1/admin/creators", { marketId, displayName, sourcePlatform: "vimeo", sourceUrl: `https://vimeo.com/${displayName.replace(/\W/g, "").toLowerCase()}`, contactEmail: "them@example.com", ...extra })
    .expect(201);
  return res.body as { id: string };
}

async function works(creatorId: string) {
  const res = await dee
    .post(`/v1/admin/creators/${creatorId}/works`, [
      { title: "Joshua Tree, full film", durationMs: 70 * 60_000, sourceUrl: "https://vimeo.com/1", groupLabel: "Full-length skate films", noun: "film" },
      { title: "Salton Sea Bowls", durationMs: 38 * 60_000, sourceUrl: "https://vimeo.com/2", groupLabel: "Full-length skate films", noun: "film" },
      { title: "Park sessions: Indio", durationMs: 7 * 60_000, sourceUrl: "https://vimeo.com/3", groupLabel: "Park session edits", noun: "short" },
      { title: "Sponsor edit for a shoe brand", durationMs: 4 * 60_000, sourceUrl: "https://vimeo.com/4", leftOutReason: "Likely someone else's rights", noun: "edit" }
    ])
    .expect(200);
  return res.body as Array<{ id: string; title: string; noun: string | null }>;
}

describe("recipes (N6)", () => {
  it("keep block labels, listings, colours and carried programs, and a typed break rule", async () => {
    const saved = await dee
      .post("/v1/admin/recipes", {
        name: "Films, TV band",
        category: "Film",
        band: "tv",
        blocks: [
          { start: "06:00", end: "19:00", source: "catalog", label: "Catalog films", listing: "Classic films from the catalog", colour: "#33507A" },
          { start: "19:00", end: "24:00", source: "creator", label: "{creator}'s films" }
        ],
        maxAiringsPerWorkPerWeek: 3,
        breakRule: { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, fillFrom: "market" },
        when: "at night",
        catalogAbout: "Classic films and overnight programming"
      })
      .expect(201);
    recipeId = saved.body.id;
    const [recipe] = (await dee.get("/v1/admin/recipes").expect(200)).body;
    expect(recipe).toMatchObject({
      when: "at night",
      catalogAbout: "Classic films and overnight programming",
      breakRule: { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, fillFrom: "market" },
      blocks: [{ label: "Catalog films", listing: "Classic films from the catalog", colour: "#33507A" }, { label: "{creator}'s films" }]
    });
    const bad = await dee.post("/v1/admin/recipes", { name: "x", category: "x", band: "tv", blocks: [], maxAiringsPerWorkPerWeek: 1, breakRule: { everyMinutes: "thirty" } }).expect(400);
    expect(bad.body.error.code).toBe("bad_request");
  });
});

describe("the pipeline (N1, N2, N3, N12, B7)", () => {
  let skate: { id: string };
  let skateWorks: Array<{ id: string; title: string }>;
  let token: string;

  it("keeps several proposed channels, or a band only, and the pronoun", async () => {
    skate = await creator("Desert Skate Films", { pronoun: "they", proposedOptions: { band: "tv", channels: ["38.1", "45.1"] } });
    const [row] = (await dee.get(`/v1/admin/creators`).expect(200)).body.filter((c: { id: string }) => c.id === skate.id);
    expect(row).toMatchObject({ proposed: { band: "tv", channel: "38.1" }, proposedOptions: { band: "tv", channels: ["38.1", "45.1"] }, pronoun: "they", askedAt: null, remindedAt: null, setup: null });

    const bandOnly = await dee.patch(`/v1/admin/creators/${skate.id}`, { proposedOptions: { band: "radio", channels: [] }, pronoun: "she" }).expect(200);
    expect(bandOnly.body).toMatchObject({ proposed: null, proposedOptions: { band: "radio", channels: [] }, pronoun: "she" });
    const single = await dee.patch(`/v1/admin/creators/${skate.id}`, { proposed: { band: "tv", channel: "38.1" } }).expect(200);
    expect(single.body.proposedOptions).toEqual({ band: "tv", channels: ["38.1"] });
    await dee.patch(`/v1/admin/creators/${skate.id}`, { proposedOptions: { band: "tv", channels: ["38.3", "99.1"] } }).expect(400);
  });

  it("asks about the ticked works only; the rest are left out with their reason (B7)", async () => {
    skateWorks = await works(skate.id);
    const named = (start: string) => skateWorks.find((w) => w.title.startsWith(start))!;
    const [film, bowls, sponsor] = [named("Joshua"), named("Salton"), named("Sponsor")];
    await dee.post(`/v1/admin/creators/${skate.id}/permission-requests`, { sentVia: ["email"], workIds: ["00000000-0000-4000-8000-000000000999"] }).expect(400);

    // Ticked: the two films and the sponsor edit (brought back in); Indio left out.
    const asked = await dee.post(`/v1/admin/creators/${skate.id}/permission-requests`, { sentVia: ["email"], workIds: [film.id, bowls.id, sponsor.id] }).expect(201);
    token = tokenOf(asked.body.link);
    const page = await anon(h).get(`/v1/permission/${token}`).expect(200);
    // (Works added together have no order between them: compared by title.)
    expect(page.body.works.map((w: { title: string; included: boolean; leftOutReason: string | null }) => [w.title, w.included, w.leftOutReason]).sort()).toEqual([
      ["Joshua Tree, full film", true, null],
      ["Park sessions: Indio", false, "Left out when asking"],
      ["Salton Sea Bowls", true, null],
      ["Sponsor edit for a shoe brand", true, null]
    ]);
    // N4: where their work is, each work's group and noun, the market's name.
    expect(page.body).toMatchObject({ creator: { sourcePlatform: "vimeo" }, marketName: "Inland Empire", summary: null, stoppedAt: null, claim: null });
    expect(page.body.works.find((w: { title: string }) => w.title === "Park sessions: Indio")).toMatchObject({ groupLabel: "Park session edits", noun: "short" });
    expect(page.body.schedulePreview.some((s: { title: string }) => s.title === "Park sessions: Indio")).toBe(false);
    const [row] = (await dee.get(`/v1/admin/creators`).expect(200)).body.filter((c: { id: string }) => c.id === skate.id);
    expect(row).toMatchObject({ stage: "asked", askedAt: "2026-09-22T19:00:00.000Z", works: 3 });
    expect((await dee.get(`/v1/admin/creators/${skate.id}/works`).expect(200)).body.find((w: { title: string }) => w.title.startsWith("Sponsor")).noun).toBe("edit");
  });

  it("sends the one reminder, then No answer is next (N2)", async () => {
    const fresh = await creator("Poetry Hour");
    const notAsked = await dee.post(`/v1/admin/creators/${fresh.id}/reminders`).expect(422);
    expect(notAsked.body.error.code).toBe("not_asked");

    h.clock.advance(7 * 86_400_000);
    const reminded = await dee.post(`/v1/admin/creators/${skate.id}/reminders`).expect(201);
    expect(reminded.body).toMatchObject({ remindedAt: "2026-09-29T19:00:00.000Z", nextAction: "No answer", nextActionDue: "2026-10-06" });
    expect(h.sent.at(-1)).toMatchObject({ channel: "email", to: "them@example.com", title: "Still thinking about a station for Desert Skate Films?" });
    const again = await dee.post(`/v1/admin/creators/${skate.id}/reminders`).expect(422);
    expect(again.body.error.code).toBe("reminded");
  });

  it("records the yes with the exact ticked works and the wording version (N3, N4)", async () => {
    const answered = await anon(h).post(`/v1/permission/${token}/answer`).send({ answer: "yes", wordingVersion: "2026-09-v1" }).expect(200);
    expect(answered.body.answer).toMatchObject({ answer: "yes", works: 3 });
    const [record] = await h.db.select().from(schema.permissionRecords);
    expect(record.wordingVersion).toBe("2026-09-v1");
    const covered = (await dee.get(`/v1/admin/creators/${skate.id}/works`).expect(200)).body.map((w: { title: string; covered: string }) => [w.title, w.covered]).sort();
    expect(covered).toEqual([
      ["Joshua Tree, full film", "permission"],
      ["Park sessions: Indio", "none"],
      ["Salton Sea Bowls", "permission"],
      ["Sponsor edit for a shoe brand", "permission"]
    ]);
    const [row] = (await dee.get(`/v1/admin/creators`).expect(200)).body.filter((c: { id: string }) => c.id === skate.id);
    expect(row).toMatchObject({ stage: "said_yes", answeredAt: "2026-09-29T19:00:00.000Z" });
  });

  it("claims from the link before there's a station; it joins the station when it's set up (B8, N5)", async () => {
    await anon(h).post(`/v1/permission/${token}/claim`).expect(401);
    const creatorPerson = await h.signIn("Rita");
    const claimed = await creatorPerson.post(`/v1/permission/${token}/claim`).expect(200);
    expect(claimed.body.claim).toMatchObject({ status: "verifying", startedAt: "2026-09-29T19:00:00.000Z" });
    const twice = await creatorPerson.post(`/v1/permission/${token}/claim`).expect(422);
    expect(twice.body.error.code).toBe("in_progress");

    const setUp = await dee
      .post(`/v1/admin/creators/${skate.id}/station`, { recipeId, marketId, band: "tv", channel: "38.1", callSign: "SKTE", name: "Desert Skate", operatorUserId: dee.id, signOnAt: "2026-10-05T13:00:00.000Z" })
      .expect(201);
    const [handover] = await h.db.select().from(schema.handovers).where(eq(schema.handovers.creatorId, skate.id));
    expect(handover.stationId).toBe(setUp.body.station.id);

    const [row] = (await dee.get(`/v1/admin/creators`).expect(200)).body.filter((c: { id: string }) => c.id === skate.id);
    expect(row.setup).toEqual({
      recipeId,
      band: "tv",
      channel: "38.1",
      callSign: "SKTE",
      name: "Desert Skate",
      colour: null,
      operator: { id: dee.id, name: "Dee A." },
      signOnAt: "2026-10-05T13:00:00.000Z",
      importDone: 0,
      importTotal: 3,
      escrowStationId: expect.any(Number)
    });

    // N7: the slot's sign-on and its creator; the market's stats for both bands.
    const board = await dee.get("/v1/admin/markets/inland-empire/board?band=tv").expect(200);
    expect(board.body.slots.find((s: { major: number }) => s.major === 38)).toMatchObject({ state: "claimable", signOnAt: "2026-10-05T13:00:00.000Z", creatorId: skate.id });
    expect(board.body.stats.market).toEqual({ localShareOfTonightPercent: null, claimableOnAir: 0, deadAirComing: [] });

    // The desk approves it once it's checked.
    await dee.post(`/v1/admin/handovers/${handover.id}/approve`).expect(200);
    const page = await anon(h).get(`/v1/permission/${token}`).expect(200);
    expect(page.body.claim.status).toBe("waiting_period");
  });

  it("a claim from the link can't be approved before the station exists", async () => {
    const early = await creator("Early Bird");
    await works(early.id);
    const asked = await dee.post(`/v1/admin/creators/${early.id}/permission-requests`, { sentVia: ["email"] }).expect(201);
    await anon(h).post(`/v1/permission/${tokenOf(asked.body.link)}/answer`).send({ answer: "yes" }).expect(200);
    await (await h.signIn()).post(`/v1/permission/${tokenOf(asked.body.link)}/claim`).expect(200);
    const [handover] = await h.db.select().from(schema.handovers).where(eq(schema.handovers.creatorId, early.id));
    const refused = await dee.post(`/v1/admin/handovers/${handover.id}/approve`).expect(422);
    expect(refused.body.error.code).toBe("no_station");
  });
});

describe("claim invites, stopping from the link, held earnings (N3, N9, B8, A125)", () => {
  let crate: { id: string };
  let token: string;
  let stationId: string;

  it("invites the creator, then sends the claim link; held earnings follow", async () => {
    crate = await creator("Crate", { personName: "Andre Vega" });
    await works(crate.id);
    const asked = await dee.post(`/v1/admin/creators/${crate.id}/permission-requests`, { sentVia: ["email"] }).expect(201);
    token = tokenOf(asked.body.link);
    const noYes = await anon(h).post(`/v1/permission/${token}/stop`).expect(422);
    expect(noYes.body.error.code).toBe("nothing_to_stop");
    await anon(h).post(`/v1/permission/${token}/answer`).send({ answer: "yes" }).expect(200);
    const before = await dee.post(`/v1/admin/creators/${crate.id}/claim-invites`, { kind: "invite" }).expect(422);
    expect(before.body.error.code).toBe("no_station");

    const setUp = await dee
      .post(`/v1/admin/creators/${crate.id}/station`, { recipeId, marketId, band: "radio", channel: "101.9", callSign: "CRAT", name: "Crate", operatorUserId: dee.id })
      .expect(201);
    stationId = setUp.body.station.id;
    await h.db.update(schema.stations).set({ status: "on_air", firstSignedOnAt: h.clock.now() }).where(eq(schema.stations.id, stationId));

    const invited = await dee.post(`/v1/admin/creators/${crate.id}/claim-invites`, { kind: "invite" }).expect(201);
    expect(invited.body.claimInviteSentAt).toBe(h.clock.now().toISOString());
    expect(h.sent.at(-1)).toMatchObject({ channel: "email", to: "them@example.com", title: "Crate is on the air" });
    let held = await dee.get("/v1/admin/held-earnings").expect(200);
    let row = held.body.stations.find((s: { station: { callSign: string } }) => s.station.callSign === "CRAT");
    // A125: `creator` as drawn (the person's name when known), and the creator's own name beside it.
    expect(row).toMatchObject({ creator: "Andre Vega", creatorName: "Crate", creatorId: crate.id, status: "invited", invitedAt: h.clock.now().toISOString(), licenceName: null, signOnAt: null });
    expect(held.body).toMatchObject({ unclaimedPeriodDays: 1095, chain: null, stationsHoldingMoney: 0 });

    await dee.post(`/v1/admin/creators/${crate.id}/claim-invites`, { kind: "link" }).expect(201);
    held = await dee.get("/v1/admin/held-earnings").expect(200);
    row = held.body.stations.find((s: { station: { callSign: string } }) => s.station.callSign === "CRAT");
    expect(row).toMatchObject({ status: "claim_link_sent", claimLinkSentAt: h.clock.now().toISOString() });
  });

  it("stops from the link: the station signs off, nothing is covered, and the stop waits for the desk", async () => {
    const stopped = await anon(h).post(`/v1/permission/${token}/stop`).expect(200);
    expect(stopped.body).toMatchObject({ stoppedAt: h.clock.now().toISOString(), claimable: false });
    // Twice is the same page.
    await anon(h).post(`/v1/permission/${token}/stop`).expect(200);

    const [station] = await h.db.select().from(schema.stations).where(eq(schema.stations.id, stationId));
    expect(station.status).toBe("signed_off");
    const covered = (await dee.get(`/v1/admin/creators/${crate.id}/works`).expect(200)).body.map((w: { covered: string }) => w.covered);
    expect(covered.every((c: string) => c === "none")).toBe(true);
    const [c] = (await dee.get(`/v1/admin/creators`).expect(200)).body.filter((x: { id: string }) => x.id === crate.id);
    expect(c).toMatchObject({ stage: "declined", doNotAsk: true });
    const [handover] = await h.db.select().from(schema.handovers).where(eq(schema.handovers.stationId, stationId));
    expect(handover).toMatchObject({ kind: "stop", claimantUserId: null });
    const held = await dee.get("/v1/admin/held-earnings").expect(200);
    expect(held.body.stations.find((s: { station: { callSign: string } }) => s.station.callSign === "CRAT").status).toBe("claim_pending");

    const late = await (await h.signIn()).post(`/v1/permission/${token}/claim`).expect(422);
    expect(late.body.error.code).toBe("nothing_to_claim");
  });

  it("names the licence an already-licensed creator's works carry (N9)", async () => {
    const field = await creator("Mojave Field Recordings");
    const [work] = await works(field.id);
    await dee.post(`/v1/admin/works/${work.id}/licence`, { licence: "cc_by", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", attribution: "Mojave Field Recordings" }).expect(200);
    const [row] = (await dee.get(`/v1/admin/creators`).expect(200)).body.filter((c: { id: string }) => c.id === field.id);
    expect(row).toMatchObject({ stage: "already_licensed", licenceName: "CC BY 4.0" });
  });
});
