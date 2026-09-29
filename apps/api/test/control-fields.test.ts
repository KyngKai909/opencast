// Fields and endpoints master control reads beyond the first contracts (added 2026-09-29): the
// market's offers, requests and agreements (C1 to C9, L1), spots and sponsors (P6, P17, P22 to
// P25, S17, G1 on avails), earnings and statements (E2, E3), the audience (U1, U3), live sources
// (S14, B3), claim attachments (B6) and the creator's claim page (N10).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { SPOT_CATEGORIES } from "@opencast/contracts";
import { DEAD_AIR_NOTE } from "../src/v1/modules/log/service.js";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User; // BEAT's owner (the maker)
let rita: User; // REEL's owner (the carrier)
let jess: User; // Orange Street Coffee's owner
let dee: User; // Opencast
let marketId: string;
let beat: { id: string };
let reel: { id: string };
let programId: string;
let episodeIds: string[];
let businessId: string;

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const NOW = "2026-10-01T19:00:00.000Z"; // Noon in Los Angeles.
const at = (iso: string) => new Date(iso);
const plus = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(NOW);
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  rita = await h.signIn("Rita");
  jess = await h.signIn("Jess Lin");
  dee = await h.signIn("Dee A.", { admin: true });
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  reel = await stationFixture(h, { callSign: "REEL", name: "Reel 24", ownerId: rita.id, marketId, tenths: 241, signedOn: true });
  await h.db.update(schema.stations).set({ studioLatitude: 34.0556, studioLongitude: -117.1825, description: "Films all night" }).where(eq(schema.stations.id, reel.id));

  programId = (await kai.post(`/v1/stations/${beat.id}/programs`, { title: "Late Crate", advisory: "language" }).expect(201)).body.id;
  episodeIds = [
    (await itemFixture(h, beat.id, { title: "Late Crate, ep. 1", programId, episodeNumber: 1 })).id,
    (await itemFixture(h, beat.id, { title: "Late Crate, ep. 2", programId, episodeNumber: 2 })).id
  ];
}, 60_000);
afterAll(() => h.close());

describe("the market (C1 to C9, L1)", () => {
  let offerId: string;
  let gapAt: string;

  it("offers cash plus barter at its own price, with the program's format", async () => {
    const res = await kai
      .post(`/v1/programs/${programId}/offer`, {
        termsOffered: ["barter", "cash_plus_barter"],
        cashPriceMicros: null,
        cashPriceUnit: null,
        barterMakerMsPerHour: 120_000,
        airingsPerEpisode: null,
        windowDays: 7,
        liveOnly: false,
        noticeDays: 7,
        approval: "any_station",
        radioBandAllowed: true,
        cashPlusBarter: { priceMicros: $(20), unit: "per_airing", makerMsPerHour: 60_000 },
        barterFill: "credit_only"
      })
      .expect(201);
    offerId = res.body.id;
    expect(res.body).toMatchObject({
      cashPlusBarter: { priceMicros: $(20), unit: "per_airing", makerMsPerHour: 60_000 },
      barterFill: "credit_only",
      defaultTerm: "barter",
      breakMsPerHour: 180_000,
      underwriter: null,
      offeredAt: NOW,
      program: { format: { kind: "series", cadence: null, episodeLengthMs: 1_710_000, bands: ["tv"] }, colour: "#8C3B7A", advisory: "language" }
    });
    // Cash plus barter needs its split.
    await kai.patch(`/v1/catalog/offers/${offerId}`, { cashPlusBarter: { priceMicros: $(20), unit: "per_airing", makerMsPerHour: 0 } }).expect(400);
  });

  it("says where it fits the browsing station's night: a gap, and library repeats", async () => {
    // REEL: on until 9:00 pm, 29 minutes of nothing, then repeats from midnight (filled automatically).
    const filler = await itemFixture(h, reel.id, { title: "Old reel" });
    await rita.post(`/v1/stations/${reel.id}/log`, { kind: "program", startsAt: NOW, endsAt: plus(120), itemId: filler.id }).expect(201);
    await rita.post(`/v1/stations/${reel.id}/log`, { kind: "program", startsAt: plus(149), endsAt: plus(300), itemId: filler.id }).expect(201);
    await h.db.insert(schema.logEntries).values({ stationId: reel.id, startsAt: at(plus(300)), endsAt: at(plus(360)), kind: "program", code: "PGM", assetId: filler.id, localNote: DEAD_AIR_NOTE });
    await rita.post(`/v1/stations/${reel.id}/log`, { kind: "program", startsAt: plus(360), endsAt: plus(24 * 60), itemId: filler.id }).expect(201);
    gapAt = plus(120);

    const res = await rita.get(`/v1/catalog/offers?forStation=${reel.id}`).expect(200);
    const offer = res.body.find((o: { id: string }) => o.id === offerId);
    expect(offer.fit).toEqual([
      { reason: "dead_air", label: "2:00 pm gap", title: "2:00 pm to 2:29 pm", startsAt: gapAt, endsAt: plus(149), exact: true },
      { reason: "library_repeats", label: "5:00 pm repeats", title: "Library repeats from 5:00 pm", startsAt: plus(300), endsAt: plus(360), exact: false }
    ]);
    const inGap = await rita.get(`/v1/catalog/offers?forStation=${reel.id}&gap=${encodeURIComponent(gapAt)}`).expect(200);
    expect(inGap.body.map((o: { id: string }) => o.id)).toEqual([offerId]);
    expect((await rita.get(`/v1/catalog/offers?forStation=${reel.id}&gap=${encodeURIComponent(plus(10))}`).expect(200)).body).toEqual([]);
    expect((await rita.get(`/v1/catalog/offers?makerKind=studio`).expect(200)).body).toEqual([]);
    expect((await rita.get(`/v1/catalog/offers?maker=${beat.id}`).expect(200)).body.map((o: { id: string }) => o.id)).toEqual([offerId]);
  });

  it("carries in one step: the request carries its agreement and the carrier's profile; the agreement its slots", async () => {
    const req = await rita
      .post(`/v1/catalog/offers/${offerId}/requests`, { carrierStationId: reel.id, term: "cash_plus_barter", slots: [{ weekday: 1, time: "23:00" }], startsOn: "2026-10-05" })
      .expect(201);
    expect(req.body).toMatchObject({ status: "approved", agreementId: expect.any(String), carrierProfile: { description: "Films all night", members: 0, carriesPrograms: 1, blockedCategories: [] } });
    const agreements = await rita.get(`/v1/stations/${reel.id}/carriage/agreements`).expect(200);
    expect(agreements.body.carrying[0]).toMatchObject({
      id: req.body.agreementId,
      offerId,
      slots: [{ weekday: 1, time: "23:00" }],
      terms: { cashPriceMicros: $(20), cashPriceUnit: "per_airing", barterMakerMsPerHour: 60_000 }
    });
    // C5, C6: episodes with their first airing and captions; carriers with their slots.
    await h.db.insert(schema.asRun).values({ stationId: beat.id, code: "PGM", startedAt: at("2026-09-20T03:00:00.000Z"), endedAt: at("2026-09-20T03:28:30.000Z"), assetId: episodeIds[0], programId, reason: "planned" });
    const offer = await rita.get(`/v1/catalog/offers/${offerId}`).expect(200);
    expect(offer.body.carriedBy).toEqual([{ station: expect.objectContaining({ callSign: "REEL" }), since: expect.any(String), slots: [{ weekday: 1, time: "23:00" }] }]);
    expect(offer.body.episodes.map((e: { episodeNumber: number; firstAiredAt: string | null; firstAiredOn: { callSign: string } | null; captions: string }) => [e.episodeNumber, e.firstAiredAt, e.firstAiredOn?.callSign ?? null, e.captions])).toEqual([
      [1, "2026-09-20T03:00:00.000Z", "BEAT", "none"],
      [2, null, null, "none"]
    ]);
  });

  it("withdraws a request the maker hasn't answered (C4)", async () => {
    const other = (await kai.post(`/v1/stations/${beat.id}/programs`, { title: "Crate Digging" }).expect(201)).body.id;
    await itemFixture(h, beat.id, { title: "Crate Digging, ep. 1", programId: other });
    const offer = await kai
      .post(`/v1/programs/${other}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 120_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true })
      .expect(201);
    const req = await rita.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: reel.id, term: "barter", slots: [{ weekday: 2, time: "01:00" }], startsOn: "2026-10-06" }).expect(201);
    expect(req.body).toMatchObject({ status: "asked", agreementId: null });
    await kai.post(`/v1/carriage/requests/${req.body.id}/withdraw`).expect(404);
    const withdrawn = await rita.post(`/v1/carriage/requests/${req.body.id}/withdraw`).expect(200);
    expect(withdrawn.body.status).toBe("withdrawn");
    const again = await rita.post(`/v1/carriage/requests/${req.body.id}/withdraw`).expect(409);
    expect(again.body.error.code).toBe("decided");
  });
});

describe("spots and sponsors (P6, P17, P22 to P25, S17, G1)", () => {
  let pausedSpot: string;
  let backSpot: string;

  it("a business's short name (P25)", async () => {
    const res = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [marketId] }).expect(201);
    businessId = res.body.id;
    expect(res.body.shortName).toBe("Orange Street Coffee");
    const updated = await jess.patch(`/v1/businesses/${businessId}`, { shortName: "Orange Street" }).expect(200);
    expect(updated.body.shortName).toBe("Orange Street");
    // Money in, so its spots can be listed.
    const sources = await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "clear_bank", token: "plaid-link-8810" }).expect(201);
    const deposit = await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(500), fundingSourceId: sources.body[0].id }).expect(201);
    await h.services.ledger.completeDeposit(deposit.body.depositId);
  });

  it("the market says why a spot paused and why it's back, with its preview (P6, P23)", async () => {
    const spot = (fields: Partial<typeof schema.spotsTable.$inferInsert>) =>
      h.db
        .insert(schema.spotsTable)
        .values({ advertiserId: businessId, title: "Fall menu", lengthSec: 30, category: "Food", status: "listed", rateKind: "per_airing", rateMicros: $(2), totalBudgetMicros: $(100), listedAt: at("2026-09-25T19:00:00.000Z"), ...fields })
        .returning()
        .then((r) => r[0]);
    const pausedAt = at("2026-10-01T18:00:00.000Z");
    pausedSpot = (await spot({ status: "paused", pauseReason: "balance", pausedAt, lastPauseReason: "balance", lastPausedAt: pausedAt })).id;
    const resumedAt = at("2026-10-01T18:30:00.000Z");
    backSpot = (await spot({ title: "Open late", resumedAt, resumeReason: "added_money", lastPauseReason: "balance", lastPausedAt: pausedAt })).id;
    await h.db.insert(schema.codes).values({ spotId: backSpot, code: "LATE10", offer: "10% off after 9", windowDays: 7 });
    const [rotation] = await h.db.insert(schema.rotations).values({ stationId: beat.id, kind: "main" }).returning();
    await h.db.insert(schema.rotationSpots).values([
      { rotationId: rotation.id, spotId: pausedSpot, position: 0 },
      { rotationId: rotation.id, spotId: backSpot, position: 1, removedAt: resumedAt }
    ]);

    const market = await kai.get(`/v1/stations/${beat.id}/spot-market`).expect(200);
    const paused = market.body.find((m: { spot: { id: string } }) => m.spot.id === pausedSpot);
    expect(paused).toMatchObject({
      state: "paused",
      pause: { reason: "balance", pausedAt: pausedAt.toISOString(), heldTonightMs: 0, filledBy: [] },
      back: null,
      business: { shortName: "Orange Street" },
      spot: { preview: { url: null, colour: expect.stringMatching(/^#[0-9A-F]{6}$/), line: "Fall menu" } }
    });
    const back = market.body.find((m: { spot: { id: string } }) => m.spot.id === backSpot);
    expect(back).toMatchObject({ state: "its_back", pause: null, back: { reason: "added_money", backAt: resumedAt.toISOString() }, spot: { preview: { line: "10% off after 9" } } });
  });

  it("the spot categories, in one list (S17)", async () => {
    const res = await anon(h).get("/v1/spot-categories").expect(200);
    expect(res.body).toEqual(SPOT_CATEGORIES);
    expect(res.body.filter((c: { blockable: boolean }) => c.blockable).map((c: { name: string }) => c.name)).toContain("Payday loans");
  });

  it("what's in each break on the Breaks page (G1)", async () => {
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: plus(60), endsAt: plus(90), itemId: episodeIds[1] }).expect(201);
    const res = await kai.get(`/v1/stations/${beat.id}/avails?hours=4`).expect(200);
    expect(res.body.breaks[0]).toMatchObject({
      breakStartsAt: new Date(Date.parse(plus(60)) + 1_710_000).toISOString(),
      breakId: null,
      origin: "rule",
      contents: [
        { kind: "open", title: "Open", lengthMs: 85_000, spotId: null, rotation: null },
        { kind: "station_id", title: "Station ID", lengthMs: 5_000 }
      ]
    });
  });

  it("the maker asks to be told when its spot is listed (P24)", async () => {
    const [order] = await h.db
      .insert(schema.productionOrders)
      .values({ advertiserId: businessId, makerStationId: beat.id, title: "Fall menu", lengthSec: 30, about: "The fall menu", neededBy: "2026-09-30", status: "approved", spotId: backSpot })
      .returning();
    await jess.post(`/v1/orders/${order.id}/tell-me-when-listed`).expect(404);
    const before = h.sent.length;
    const res = await kai.post(`/v1/orders/${order.id}/tell-me-when-listed`).expect(200);
    expect(res.body).toMatchObject({ makerToldWhenListed: true, listedRate: { kind: "per_airing", micros: $(2) } });
    // It's listed already: told now.
    expect(h.sent.slice(before)).toContainEqual(expect.objectContaining({ channel: "push", to: kai.id, title: "Fall menu is listed" }));
    const orders = await kai.get(`/v1/stations/${beat.id}/orders`).expect(200);
    expect(orders.body[0]).toMatchObject({ makerToldWhenListed: true });
  });

  it("sponsors as the station sees them, and the members' credit (P17, P22, L1)", async () => {
    const sponsorship = (stationId: string, programIdOrNull: string | null) =>
      h.db.insert(schema.sponsorships).values({
        advertiserId: businessId,
        stationId,
        programId: programIdOrNull,
        monthlyMicros: $(100),
        creditText: "Orange Street Coffee, on Orange Street in Redlands",
        creditCheckedAt: at(NOW),
        status: "approved",
        startsOn: "2026-10-01"
      });
    await sponsorship(beat.id, null);
    const reelProgram = (await rita.post(`/v1/stations/${reel.id}/programs`, { title: "Midnight Movie" }).expect(201)).body.id;
    await sponsorship(reel.id, reelProgram);
    const res = await kai.get(`/v1/stations/${beat.id}/sponsorships`).expect(200);
    expect(res.body.sponsorships[0].profile).toEqual({ category: "Coffee and food", city: null, miles: null, elsewhere: ["Midnight Movie on REEL"] });
    expect(res.body.members).toEqual({ creditName: "members of Inland Beat", members: 0, named: 0 });
    expect(res.body.settings.find((s: { programId: string | null }) => s.programId === programId).format).toBe("Series");
    expect(res.body.settings[0].format).toBeNull();
  });
});

describe("earnings and statements (E2, E3)", () => {
  it("names the sponsors, counts tonight's breaks, and says the next payout's amount", async () => {
    const res = await kai.get(`/v1/stations/${beat.id}/earnings?period=month`).expect(200);
    expect(res.body.lines.sponsors.list).toEqual([{ name: "Orange Street Coffee", monthlyMicros: $(100) }]);
    expect(res.body.held.tonightBreaks).toBe(0);
    expect(res.body.nextPayout).toMatchObject({ amountMicros: 0 });
  });

  it("groups statement lines, counts airings, and says when and where it was paid", async () => {
    const accountId = await h.services.ledger.account(h.db, "station_earnings", { stationId: beat.id });
    await h.db.insert(schema.statements).values({
      accountId,
      period: "week",
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
      lines: [
        { label: "Spots", detail: "3 entries", amountMicros: $(6), notSetYet: false },
        { label: "Pledges", detail: "1 entry", amountMicros: $(5), notSetYet: false },
        { label: "Opencast's share", detail: null, amountMicros: 0, notSetYet: true }
      ],
      openingMicros: 0,
      closingMicros: $(11),
      issuedAt: at("2026-09-28T08:00:00.000Z")
    });
    await h.db.insert(schema.payouts).values({ accountId, amountMicros: $(11), destination: "Chase ending 2231", scheduledFor: "2026-09-28", status: "sent" });
    const res = await kai.get(`/v1/stations/${beat.id}/statements`).expect(200);
    expect(res.body[0]).toMatchObject({ paidOn: "2026-09-28", destination: "Chase ending 2231" });
    expect(res.body[0].lines.map((l: { label: string; group: string; airings?: number }) => [l.label, l.group, l.airings ?? null])).toEqual([
      ["Spots", "spots", 3],
      ["Pledges", "sponsors_pledges", null],
      ["Opencast's share", "shared", null]
    ]);
  });
});

describe("the audience (U1, U3)", () => {
  it("by program per airing, last week across the window, and the breaks", async () => {
    // An airing that ended an hour ago, with 10 tuned in at its start and 8 at its end.
    const from = "2026-10-01T17:00:00.000Z";
    await h.db.insert(schema.logEntries).values({ stationId: beat.id, startsAt: at(from), endsAt: at("2026-10-01T17:30:00.000Z"), kind: "program", code: "PGM", assetId: episodeIds[0], programId });
    for (let i = 0; i < 30; i++) {
      await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute: new Date(Date.parse(from) + i * 60_000), tunedIn: i === 29 ? 8 : i === 10 ? 14 : 10, web: 10 });
    }
    // Last week, past now too.
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute: at("2026-09-24T21:00:00.000Z"), tunedIn: 6, web: 6 });
    const res = await kai.get(`/v1/stations/${beat.id}/audience?from=${from}&to=2026-10-01T22:00:00.000Z`).expect(200);
    expect(res.body.byProgram.at(-1)).toEqual({
      key: expect.any(String),
      programId,
      title: "Late Crate",
      airedAt: from,
      airings: 1,
      source: "library",
      carriedFrom: null,
      averageTunedIn: 10,
      peakTunedIn: 14,
      stayedToTheEnd: 80,
      onNow: false
    });
    expect(res.body.comparison).toEqual([{ minute: "2026-10-01T21:00:00.000Z", tunedIn: 6 }]);
    expect(res.body.breaks[0]).toEqual({ startsAt: "2026-10-01T17:28:30.000Z", endsAt: "2026-10-01T17:30:00.000Z" });
  });
});

describe("live sources (S14, B3)", () => {
  it("a Livepeer source's preview, and where a browser source publishes", async () => {
    const encoder = await kai.post(`/v1/stations/${beat.id}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201);
    expect(encoder.body.source).toMatchObject({ quality: null, previewUrl: null, ingest: null });
    const browser = await kai.post(`/v1/stations/${beat.id}/live-sources`, { kind: "browser", name: "Phone" }).expect(201);
    // As when Livepeer is set up: the source has its stream.
    await h.db.update(schema.liveSources).set({ livepeerPlaybackId: "pb123" }).where(eq(schema.liveSources.id, encoder.body.source.id));
    await h.db.update(schema.liveSources).set({ livepeerStreamId: "st456", livepeerPlaybackId: "pb456", streamKey: "abcd-efgh" }).where(eq(schema.liveSources.id, browser.body.source.id));
    const list = await kai.get(`/v1/stations/${beat.id}/live-sources`).expect(200);
    expect(list.body.map((s: { name: string; previewUrl: string | null; ingest: unknown }) => [s.name, s.previewUrl, s.ingest])).toEqual([
      ["Studio A", "https://livepeercdn.studio/hls/pb123/index.m3u8", null],
      ["Phone", "https://livepeercdn.studio/hls/pb456/index.m3u8", { whipUrl: "https://livepeer.studio/webrtc/abcd-efgh", token: "abcd-efgh" }]
    ]);
  });
});

describe("claims (B6)", () => {
  it("attaches the file that backs an answer", async () => {
    const item = await itemFixture(h, beat.id, { title: "Borrowed song" });
    const filed = await anon(h)
      .post("/v1/claims")
      .send({ itemId: item.id, claimantName: "Label Co", claimantContact: "legal@label.example", claimText: "That's our recording.", swornStatement: true })
      .expect(201);
    const claimId = filed.body.claimId;
    await jess.post(`/v1/claims/${claimId}/attachments`).attach("file", Buffer.from("%PDF-1.4 permission"), "permission.pdf").expect(404);
    const wrong = await kai.post(`/v1/claims/${claimId}/attachments`).attach("file", Buffer.from("MZ"), "tool.exe").expect(422);
    expect(wrong.body.error.code).toBe("wrong_file_type");
    const res = await kai.post(`/v1/claims/${claimId}/attachments`).attach("file", Buffer.from("%PDF-1.4 permission"), "permission.pdf").expect(201);
    // A storage URL (the local store's is a path).
    expect(res.body).toEqual({ attachmentUrl: expect.any(String), fileName: "permission.pdf" });
    const [row] = await h.db.select().from(schema.claimAttachments).where(eq(schema.claimAttachments.claimId, claimId));
    expect(row).toMatchObject({ fileName: "permission.pdf", contentType: "application/pdf", uploadedBy: kai.id });
    expect(res.body.attachmentUrl).toContain(row.contentId);

    await kai.patch(`/v1/stations/${beat.id}/setup`, { legalName: "Inland Beat LLC", legalContact: "kai@beat.example" }).expect(200);
    await kai.post(`/v1/claims/${claimId}/answer`, { basis: "owner_permission", attachmentUrl: res.body.attachmentUrl, attest: true }).expect(200);
    const claims = await kai.get(`/v1/stations/${beat.id}/claims`).expect(200);
    expect(claims.body.claims[0].answer.attachmentUrl).toContain(row.contentId);
    const closed = await kai.post(`/v1/claims/${claimId}/attachments`).attach("file", Buffer.from("%PDF-1.4"), "more.pdf").expect(409);
    expect(closed.body.error.code).toBe("not_open");
  });
});

describe("the creator's claim page (N10)", () => {
  it("shows their station and what it holds, and the claim once started", async () => {
    const recipe = await dee
      .post("/v1/admin/recipes", { name: "Films", category: "Film", band: "tv", blocks: [{ start: "19:00", end: "24:00", source: "creator" }], maxAiringsPerWorkPerWeek: 3, breakRule: { mode: "after_every_program" } })
      .expect(201);
    const creator = await dee
      .post("/v1/admin/creators", { marketId, displayName: "Desert Skate Films", personName: "Marcus Reyes", sourcePlatform: "vimeo", sourceUrl: "https://vimeo.com/desertskate", contactEmail: "marcus@example.com" })
      .expect(201);
    await dee
      .post(`/v1/admin/creators/${creator.body.id}/works`, [
        { title: "Joshua Tree", durationMs: 70 * 60_000, sourceUrl: "https://vimeo.com/1", groupLabel: "Skate films", noun: "film" },
        { title: "Park sessions: Indio", durationMs: 7 * 60_000, sourceUrl: "https://vimeo.com/3", groupLabel: "Park session edits", noun: "edit" }
      ])
      .expect(200);
    const asked = await dee.post(`/v1/admin/creators/${creator.body.id}/permission-requests`, { sentVia: ["email"] }).expect(201);
    const token = asked.body.link.split("/permission/")[1];
    // No station yet: nothing to claim.
    await anon(h).get(`/v1/claim/${token}`).expect(404);
    await anon(h).post(`/v1/permission/${token}/answer`).send({ answer: "yes" }).expect(200);
    await dee
      .post(`/v1/admin/creators/${creator.body.id}/station`, { recipeId: recipe.body.id, marketId, band: "tv", channel: "38.1", callSign: "SKTE", name: "Desert Skate", operatorUserId: dee.id })
      .expect(201);

    const page = await anon(h).get(`/v1/claim/${token}`).expect(200);
    expect(page.body).toEqual({
      station: expect.objectContaining({ callSign: "SKTE", name: "Desert Skate" }),
      personName: "Marcus Reyes",
      saidYesAt: NOW,
      works: "a station of your skate films and park session edits",
      worksShort: "your skate films",
      sourcePlatform: "vimeo",
      onAirSince: null,
      presetCount: 0,
      heldMicros: 0,
      escrowContract: null,
      escrowStationId: expect.any(Number),
      handover: null
    });
    await (await h.signIn("Marcus")).post(`/v1/permission/${token}/claim`).expect(200);
    const claimed = await anon(h).get(`/v1/claim/${token}`).expect(200);
    expect(claimed.body.handover).toEqual({ handoverId: expect.any(String), kind: "claim", status: "verifying", payableAfter: null });
    await anon(h).get("/v1/claim/not-a-real-token").expect(404);
  });
});
