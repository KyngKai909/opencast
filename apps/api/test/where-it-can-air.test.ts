// Programming Phase 6: where it can air. Carriage offers name the outlets a carrier may use
// (opencast always; existing agreements keep theirs when the maker narrows them); a carried
// program not cleared for relays gets the log's quiet note ("Not on your YouTube relay") and is
// what the relay (and Phase 5's other apps) swap for the slate; a network licence ending warns on
// the log two weeks before, and once it's ended nothing airs it: not the log, dead-air fill or a
// day template; and the licensor's minutes for a month, by station and outlet, with its CSV.
// Against the local Postgres (no ffmpeg).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

/** With DEMO_DIR set, what the test saw is kept there (the STOP's evidence). */
async function demo(name: string, body: string) {
  if (!process.env.DEMO_DIR) return;
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  await fs.mkdir(process.env.DEMO_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.DEMO_DIR, name), body);
}

let h: Harness;
let kai: User;
let dee: User;
let desk: User;
let marketId: string;
const MIN = 60_000;

// Monday, October 19, 2026, noon in Los Angeles (PDT).
const MONDAY_NOON = "2026-10-19T19:00:00.000Z";

const terms = {
  termsOffered: ["barter"],
  cashPriceMicros: null,
  cashPriceUnit: null,
  barterMakerMsPerHour: 120_000,
  airingsPerEpisode: null,
  windowDays: 7,
  liveOnly: false,
  noticeDays: 7,
  approval: "i_approve",
  radioBandAllowed: true
};

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(MONDAY_NOON);
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  dee = await h.signIn("Dee");
  desk = await h.signIn("Desk", { admin: true });
}, 60_000);
afterAll(() => h.close());

describe("a carried program's outlets", () => {
  let beat: { id: string };
  let reel: { id: string };
  let episode: { id: string };
  let own: { id: string };
  let offerId: string;
  let agreementId: string;

  it("are the maker's choice, opencast always on, and copied onto the agreement", async () => {
    reel = await stationFixture(h, { callSign: "REEL", ownerId: dee.id, marketId, tenths: 241, signedOn: true });
    beat = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId, tenths: 121, signedOn: true });
    const programId = (await dee.post(`/v1/stations/${reel.id}/programs`, { title: "Night Reel" }).expect(201)).body.id;
    episode = await itemFixture(h, reel.id, { programId, episodeNumber: 1, title: "Night Reel 1" });
    own = await itemFixture(h, beat.id, { title: "Beat's own" });

    // Only Opencast: no relays for carriers. Opencast is put back if left out.
    const offered = await dee.post(`/v1/programs/${programId}/offer`, { ...terms, outlets: [] }).expect(201);
    offerId = offered.body.id;
    expect(offered.body.outlets).toEqual(["opencast"]);
    const req = await kai.post(`/v1/catalog/offers/${offerId}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: "2026-10-19" }).expect(201);
    await dee.post(`/v1/carriage/requests/${req.body.id}/decision`, { decision: "approve" }).expect(200);
    const agreements = await kai.get(`/v1/stations/${beat.id}/carriage/agreements`).expect(200);
    agreementId = agreements.body.carrying[0].id;
    expect(agreements.body.carrying[0].terms.outlets).toEqual(["opencast"]);

    // The maker widens it: new carriers only. The agreement keeps what it had.
    const widened = await dee.patch(`/v1/catalog/offers/${offerId}`, { outlets: ["relays", "other_apps"] }).expect(200);
    expect(widened.body.outlets).toEqual(["opencast", "other_apps", "relays"]);
    const again = await kai.get(`/v1/stations/${beat.id}/carriage/agreements`).expect(200);
    expect(again.body.carrying[0].terms.outlets).toEqual(["opencast"]);
  });

  it("an agreement made before outlets keeps opencast and relays", async () => {
    const [made] = await h.db.select({ outlets: schema.agreements.outlets }).from(schema.agreements).where(eq(schema.agreements.id, agreementId));
    expect(made.outlets).toEqual(["opencast"]);
    // The column default is what rows from before migration 0065 have.
    const result = (await h.db.execute(sql`select column_default as d from information_schema.columns where table_schema = 'catalog' and table_name = 'agreements' and column_name = 'outlets'`)) as unknown as { rows?: Array<{ d: string }> } | Array<{ d: string }>;
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    expect(rows[0].d).toContain("{opencast,relays}");
  });

  it("isn't cleared for relays; the station's own program is", async () => {
    const at = new Date("2026-10-25T03:00:00.000Z");
    const answers = await h.services.licences.clearance([{ assetId: episode.id, agreementId }, { assetId: own.id }], "relays", null, { at, timeZone: "America/Los_Angeles" });
    expect(answers).toEqual([{ cleared: false, reason: "not_in_carriage" }, { cleared: true, reason: "cleared" }]);
    expect((await h.services.licences.clearance([{ assetId: episode.id, agreementId }], "opencast", "US", { at }))[0].cleared).toBe(true);
  });

  it("gets a quiet note on the log while the station relays everything to a platform", async () => {
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-25T03:00:00.000Z", itemId: episode.id, carriageAgreementId: agreementId }).expect(201);
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-25T04:00:00.000Z", itemId: own.id }).expect(201);
    const window = "from=2026-10-25T00:00:00.000Z&to=2026-10-26T00:00:00.000Z";
    // Not relaying yet: no notes.
    let log = (await kai.get(`/v1/stations/${beat.id}/log?${window}`).expect(200)).body;
    expect(log.entries.every((e: { notes?: unknown }) => e.notes === undefined)).toBe(true);

    await kai.patch(`/v1/stations/${beat.id}/relay`, { mode: "everything" }).expect(200);
    await h.db.insert(schema.platformConnections).values({ id: crypto.randomUUID(), stationId: beat.id, kind: "youtube", method: "manual", name: "Beat on YouTube", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKeyEnc: "sealed" });
    log = (await kai.get(`/v1/stations/${beat.id}/log?${window}`).expect(200)).body;
    const carried = log.entries.find((e: { itemId: string }) => e.itemId === episode.id);
    const mine = log.entries.find((e: { itemId: string }) => e.itemId === own.id);
    expect(carried.notes).toEqual([{ code: "not_cleared", outlet: "relays", message: "Not on your YouTube relay" }]);
    expect(mine.notes).toBeUndefined();
    // A note, not a warning.
    expect(log.licenceWarnings).toBeUndefined();
  });

  it("is a row the relay and other apps swap for the slate", async () => {
    const row = (code: string, assetId: string | null, agreement: string | null, startsAt: string, seq: number, inBreak = false) => ({
      stationId: beat.id,
      run: 1,
      seq,
      disc: 0,
      startsAt: new Date(startsAt),
      endsAt: new Date(Date.parse(startsAt) + 8_000),
      kind: "prepared" as const,
      preparedKey: "k",
      segments: 2,
      segmentMs: [4_000, 4_000],
      code,
      label: code,
      reason: "planned",
      inBreak,
      assetId,
      agreementId: agreement
    });
    await h.db.insert(schema.channelItems).values([
      row("PGM", own.id, null, "2026-10-25T02:59:52.000Z", 10),
      row("PGM", episode.id, agreementId, "2026-10-25T03:00:00.000Z", 12),
      row("SID", own.id, agreementId, "2026-10-25T03:00:08.000Z", 14, true)
    ]);
    const swapped = await h.services.playout.notCleared(beat.id, { from: new Date("2026-10-25T02:50:00.000Z"), to: new Date("2026-10-25T03:10:00.000Z"), outlet: "relays", country: null });
    expect(swapped).toEqual([expect.objectContaining({ firstSeq: 12, segments: 2, assetId: episode.id, agreementId, reason: "not_in_carriage" })]);
    // Phase 5's other apps: cleared for no one but opencast either.
    expect(await h.services.playout.notCleared(beat.id, { from: new Date("2026-10-25T02:50:00.000Z"), to: new Date("2026-10-25T03:10:00.000Z"), outlet: "other_apps", country: "US" })).toHaveLength(1);
  });

  it("follows the owner's permission, opencast and relays when not said", async () => {
    const item = await itemFixture(h, beat.id, { title: "Lent to us", rights: false });
    const confirmed = await kai.post(`/v1/library/${item.id}/rights`, { basis: "owner_permission" }).expect(200);
    expect(confirmed.body.rights.outlets).toEqual(["opencast", "relays"]);
    const narrowed = await kai.post(`/v1/library/${item.id}/rights`, { basis: "owner_permission", outlets: ["other_apps"] }).expect(200);
    expect(narrowed.body.rights.outlets).toEqual(["opencast", "other_apps"]);
    const at = new Date(MONDAY_NOON);
    expect((await h.services.licences.clearance([{ assetId: item.id }], "relays", null, { at }))[0]).toEqual({ cleared: false, reason: "not_in_rights" });
    expect((await kai.get(`/v1/library/${own.id}`).expect(200)).body.rights.outlets).toEqual(["opencast", "other_apps", "relays", "fast", "recording"]);
  });
});

describe("a network licence ending", () => {
  let krat: { id: string };
  let programId: string;
  let episodes: Array<{ id: string }>;
  let licenceId: string;
  // Saturday 8:00 pm in Los Angeles.
  const SAT = { oct24: "2026-10-25T03:00:00.000Z", oct31: "2026-11-01T03:00:00.000Z", nov7: "2026-11-08T04:00:00.000Z" };

  it("is kept on the Network desk, with what it covers and its deal", async () => {
    krat = await stationFixture(h, { callSign: "KRAT", name: "Crate TV", ownerId: kai.id, marketId, tenths: 331, signedOn: true });
    programId = (await kai.post(`/v1/stations/${krat.id}/programs`, { title: "Prairie Westerns" }).expect(201)).body.id;
    episodes = [];
    for (let n = 1; n <= 3; n++) episodes.push(await itemFixture(h, krat.id, { title: `Western ${n}`, programId, episodeNumber: n, createdAt: new Date(Date.UTC(2026, 8, n)) }));
    // On the log before the licence is recorded: Saturday the 24th, and the 7th, after it ends.
    await kai.post(`/v1/stations/${krat.id}/log`, { kind: "program", startsAt: SAT.oct24, itemId: episodes[0].id }).expect(201);
    await kai.post(`/v1/stations/${krat.id}/log`, { kind: "program", startsAt: SAT.nov7, itemId: episodes[1].id }).expect(201);

    await kai.post("/v1/admin/licences", { licensor: "Prairie Films", outlets: ["opencast"], worldwide: true, countries: [], startsOn: "2026-10-01", endsOn: "2026-10-31", deal: { kind: "none" }, programIds: [], itemIds: [] }).expect(403);
    await desk.post("/v1/admin/licences", { licensor: "Prairie Films", outlets: ["relays"], worldwide: false, countries: [], startsOn: "2026-10-01", endsOn: "2026-10-31", deal: { kind: "none" }, programIds: [programId], itemIds: [] }).expect(400);
    await desk.post("/v1/admin/licences", { licensor: "Prairie Films", outlets: ["relays"], worldwide: true, countries: [], startsOn: "2026-10-31", endsOn: "2026-10-01", deal: { kind: "none" }, programIds: [programId], itemIds: [] }).expect(400);
    const made = await desk
      .post("/v1/admin/licences", { licensor: "Prairie Films", name: "Westerns package", outlets: ["relays", "other_apps"], worldwide: false, countries: ["US", "CA"], startsOn: "2026-10-01", endsOn: "2026-10-31", deal: { kind: "rev_share", percent: 12.5 }, programIds: [programId], itemIds: [] })
      .expect(201);
    licenceId = made.body.id;
    expect(made.body).toMatchObject({
      licensor: "Prairie Films",
      name: "Westerns package",
      outlets: ["opencast", "other_apps", "relays"],
      countries: ["US", "CA"],
      deal: { kind: "rev_share", percent: 12.5 },
      covers: [{ kind: "program", id: programId, title: "Prairie Westerns", station: { callSign: "KRAT" } }],
      state: "ending",
      daysLeft: 12
    });
    const list = (await desk.get("/v1/admin/licences").expect(200)).body;
    expect(list.map((l: { id: string }) => l.id)).toEqual([licenceId]);
    // Relays have no viewer country: a licence for some countries doesn't clear them.
    expect((await h.services.licences.clearance([{ assetId: episodes[0].id }], "relays", null, { at: new Date(SAT.oct24) }))[0]).toMatchObject({ cleared: false, reason: "territory_unknown" });
    expect((await h.services.licences.clearance([{ assetId: episodes[0].id }], "other_apps", "CA", { at: new Date(SAT.oct24) }))[0]).toMatchObject({ cleared: true });
  });

  it("warns on the log two weeks before, and says an entry after the end won't air", async () => {
    const week1 = (await kai.get(`/v1/stations/${krat.id}/log?from=2026-10-24T13:00:00.000Z&to=2026-10-31T13:00:00.000Z`).expect(200)).body;
    expect(week1.licenceWarnings).toEqual([
      expect.objectContaining({ code: "licence_ending", licenceId, licensor: "Prairie Films", endsOn: "2026-10-31", startsAt: SAT.oct24, message: "The licence for Prairie Westerns from Prairie Films ends Sat Oct 31. It's off the air after that." })
    ]);
    const week2 = (await kai.get(`/v1/stations/${krat.id}/log?from=2026-11-01T13:00:00.000Z&to=2026-11-08T13:00:00.000Z`).expect(200)).body;
    expect(week2.licenceWarnings).toEqual([expect.objectContaining({ code: "licence_ended", startsAt: SAT.nov7, message: "Prairie Westerns won't air: its licence from Prairie Films ended Sat Oct 31." })]);
    await demo("licence-warnings.json", JSON.stringify({ now: MONDAY_NOON, licence: (await desk.get(`/v1/admin/licences/${licenceId}`).expect(200)).body, week1: week1.licenceWarnings, week2: week2.licenceWarnings }, null, 2));
    // Three weeks out, no warning yet.
    h.clock.set("2026-10-09T19:00:00.000Z");
    const early = (await kai.get(`/v1/stations/${krat.id}/log?from=2026-10-24T13:00:00.000Z&to=2026-10-31T13:00:00.000Z`).expect(200)).body;
    expect(early.licenceWarnings).toBeUndefined();
    h.clock.set(MONDAY_NOON);
  });

  it("can't be put on the log after the end", async () => {
    // 11:30 pm on its last day (Los Angeles) is still in.
    await kai.post(`/v1/stations/${krat.id}/log`, { kind: "program", startsAt: "2026-11-01T06:30:00.000Z", itemId: episodes[2].id }).expect(201);
    const after = await kai.post(`/v1/stations/${krat.id}/log`, { kind: "program", startsAt: "2026-11-02T03:00:00.000Z", itemId: episodes[2].id }).expect(422);
    expect(after.body.error).toMatchObject({ code: "licence_ended", message: "Its licence from Prairie Films ended Sat Oct 31." });
  });

  it("is never picked by dead-air fill once it's ended", async () => {
    const before = await h.services.log.fillDeadAir(krat.id, { startsAt: "2026-10-27T04:00:00.000Z", endsAt: "2026-10-27T05:00:00.000Z" });
    expect(before).toBe(2);
    // A gap running past its last day: none of it.
    expect(await h.services.log.fillDeadAir(krat.id, { startsAt: "2026-11-01T06:00:00.000Z", endsAt: "2026-11-01T08:00:00.000Z" })).toBe(0);
    expect(await h.services.log.fillDeadAir(krat.id, { startsAt: "2026-11-03T04:00:00.000Z", endsAt: "2026-11-03T05:00:00.000Z" })).toBe(0);
    // Something else of the station's still fills it.
    await itemFixture(h, krat.id, { title: "Station's own", createdAt: new Date(Date.UTC(2026, 8, 20)) });
    expect(await h.services.log.fillDeadAir(krat.id, { startsAt: "2026-11-04T04:00:00.000Z", endsAt: "2026-11-04T05:00:00.000Z" })).toBe(2);
    const filled = await h.db.select({ assetId: schema.logEntries.assetId, startsAt: schema.logEntries.startsAt }).from(schema.logEntries).where(eq(schema.logEntries.stationId, krat.id));
    const after = filled.filter((r) => r.startsAt >= new Date("2026-11-03T00:00:00.000Z") && r.startsAt < new Date("2026-11-05T00:00:00.000Z"));
    expect(after.every((r) => !episodes.some((e) => e.id === r.assetId))).toBe(true);
  });

  it("is skipped by a day template's dates after the end", async () => {
    const templateId = (await kai.post(`/v1/stations/${krat.id}/log/templates`, { fromDay: "2026-10-24", pattern: "weekly" }).expect(201)).body.template.id;
    const day = (from: string) => kai.get(`/v1/stations/${krat.id}/log?from=${from}&to=${new Date(Date.parse(from) + 24 * 60 * MIN).toISOString()}`).expect(200);
    const western = (log: { entries: Array<{ itemId: string; repeatGroupId: string | null }> }) => log.entries.filter((e) => e.repeatGroupId === templateId && episodes.some((x) => x.id === e.itemId));
    // Saturday the 31st: its last day, still in.
    expect(western((await day("2026-10-31T13:00:00.000Z")).body)).toHaveLength(1);
    // The 14th: the template's This episode slot is skipped.
    expect(western((await day("2026-11-14T14:00:00.000Z")).body)).toHaveLength(0);
    // A Next episode slot passes over the program's episodes too.
    const tpl = (await kai.get(`/v1/stations/${krat.id}/log/templates/${templateId}`).expect(200)).body;
    const slot = tpl.entries.find((e: { startTime: string }) => e.startTime === "20:00");
    await kai.patch(`/v1/stations/${krat.id}/log/templates/${templateId}`, { entries: [{ startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [programId], slotId: slot.slotId }] }).expect(200);
    expect(western((await day("2026-10-31T13:00:00.000Z")).body)).toHaveLength(1);
    expect(western((await day("2026-11-14T14:00:00.000Z")).body)).toHaveLength(0);
  });
});

describe("the licensor's minutes", () => {
  it("adds up a month from the as-run log, by station and outlet, with viewer hours where counted", async () => {
    const one = await stationFixture(h, { callSign: "WEST", ownerId: kai.id, marketId, tenths: 441, signedOn: true });
    const two = await stationFixture(h, { callSign: "DUST", ownerId: dee.id, marketId, tenths: 451, signedOn: true });
    const programId = (await kai.post(`/v1/stations/${one.id}/programs`, { title: "Trail Dust" }).expect(201)).body.id;
    const ep = await itemFixture(h, one.id, { title: "Trail Dust 1", programId, episodeNumber: 1 });
    const single = await itemFixture(h, two.id, { title: "High Noon Again" });
    const other = await itemFixture(h, two.id, { title: "Not covered" });
    const licence = (
      await desk
        .post("/v1/admin/licences", { licensor: "Dusty Reels, Inc.", outlets: ["relays"], worldwide: true, countries: [], startsOn: "2026-09-15", endsOn: "2026-12-31", deal: { kind: "flat_fee", feeMicros: 500_000_000, per: "month" }, programIds: [programId], itemIds: [single.id] })
        .expect(201)
    ).body;
    const air = (stationId: string, assetId: string, startsAt: string, minutes: number, more: Partial<typeof schema.asRun.$inferInsert> = {}) =>
      h.db.insert(schema.asRun).values({ stationId, code: "PGM", startedAt: new Date(startsAt), endedAt: new Date(Date.parse(startsAt) + minutes * MIN), assetId, programId: assetId === ep.id ? programId : null, reason: "planned", ...more });
    // WEST: two airings of 28 minutes in October (one split around a break: two rows of the as-run
    // log, each counted as an airing), one in September (not counted).
    await air(one.id, ep.id, "2026-10-03T03:00:00.000Z", 14);
    await air(one.id, ep.id, "2026-10-03T03:16:00.000Z", 14);
    await air(one.id, ep.id, "2026-10-10T03:00:00.000Z", 28);
    await air(one.id, ep.id, "2026-09-26T03:00:00.000Z", 28);
    // DUST: the single item, 90 minutes; something else not covered.
    await air(two.id, single.id, "2026-10-05T04:00:00.000Z", 90);
    await air(two.id, other.id, "2026-10-05T06:00:00.000Z", 60);
    // A break inside it, and a slate: never counted.
    await air(one.id, ep.id, "2026-10-03T03:14:00.000Z", 2, { reason: "slate" });
    // Opencast viewers: 10 tuned in each minute of WEST's first airing (28 of the 30 minutes are its program: 4.7 hours).
    for (let m = 0; m < 30; m++) await h.db.insert(schema.minuteSamples).values({ stationId: one.id, minute: new Date(Date.parse("2026-10-03T03:00:00.000Z") + m * MIN), tunedIn: 10, web: 10 });
    // DUST relayed everything for its airing's first hour; YouTube reported 6 viewers a minute.
    await h.db.insert(schema.translatorSessions).values({ translatorId: two.id, stationId: two.id, mode: "copy", relayMode: "everything", startedAt: new Date("2026-10-05T04:00:00.000Z"), endedAt: new Date("2026-10-05T05:00:00.000Z"), updatedAt: new Date("2026-10-05T05:00:00.000Z") });
    const platformId = crypto.randomUUID();
    await h.db.insert(schema.platformConnections).values({ id: platformId, stationId: two.id, kind: "youtube", method: "manual", name: "Dust on YouTube", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKeyEnc: "sealed" });
    for (let m = 0; m < 60; m++) await h.db.insert(schema.platformViewerSamples).values({ platformId, stationId: two.id, kind: "youtube", minute: new Date(Date.parse("2026-10-05T04:00:00.000Z") + m * MIN), viewers: 6 });

    const report = (await desk.get(`/v1/admin/licences/${licence.id}/minutes?month=2026-10`).expect(200)).body;
    expect(report).toMatchObject({ licensor: "Dusty Reels, Inc.", month: "2026-10", from: "2026-10-01", to: "2026-10-31", minutesAired: 146, airings: 4 });
    expect(report.stations).toEqual([
      { station: expect.objectContaining({ callSign: "DUST" }), airings: 1, minutesAired: 90, viewerHours: 6 },
      { station: expect.objectContaining({ callSign: "WEST" }), airings: 3, minutesAired: 56, viewerHours: 4.7 }
    ]);
    expect(report.outlets).toEqual([
      { outlet: "opencast", minutesAired: 146, viewerHours: 4.7 },
      { outlet: "relays", minutesAired: 60, viewerHours: 6 }
    ]);
    expect(report.rows).toEqual([
      { station: expect.objectContaining({ callSign: "WEST" }), outlet: "opencast", airings: 3, minutesAired: 56, viewerHours: 4.7 },
      { station: expect.objectContaining({ callSign: "DUST" }), outlet: "opencast", airings: 1, minutesAired: 90, viewerHours: null },
      { station: expect.objectContaining({ callSign: "DUST" }), outlet: "relays", airings: 1, minutesAired: 60, viewerHours: 6 }
    ]);
    // September: only the one airing.
    const september = (await desk.get(`/v1/admin/licences/${licence.id}/minutes?month=2026-09`).expect(200)).body;
    expect(september).toMatchObject({ from: "2026-09-15", to: "2026-09-30", minutesAired: 28, airings: 1 });

    const csv = (await desk.get(`/v1/admin/licences/${licence.id}/minutes/csv?month=2026-10`).expect(200)).body;
    await demo("minutes-report.json", JSON.stringify(report, null, 2));
    await demo(csv.filename, csv.csv);
    expect(csv.filename).toBe("minutes-dusty-reels-inc-2026-10.csv");
    expect(csv.csv.split("\n")).toEqual([
      "Month,Licensor,Licence,Station,Outlet,Airings,Minutes aired,Viewer hours",
      `2026-10,"Dusty Reels, Inc.",,WEST 44.1,opencast,3,56,4.7`,
      `2026-10,"Dusty Reels, Inc.",,DUST 45.1,opencast,1,90,`,
      `2026-10,"Dusty Reels, Inc.",,DUST 45.1,relays,1,60,6`,
      `2026-10,"Dusty Reels, Inc.",,All stations,all,4,146,10.7`,
      ""
    ]);
  });
});
