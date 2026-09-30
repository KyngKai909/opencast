// Watch data (follow-up Phase 1): per airing of each program, from the tuned-in heartbeats after bot
// filtering: watch time, audience at start, peak and end, stayed to the end, tune-aways by minute
// and "Not for me" votes; the minimum audience; the station's and the maker's views; the flag; and
// the 30-day purge leaving only numbers that identify nobody.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { AudienceReport, MakerWatchData, type AiringWatch } from "@opencast/contracts";
import { anon, createHarness, itemFixture, market, radioTenths, stationFixture, type Harness, type User } from "./harness.js";
import { crowd, simulate, type SimViewer } from "./watch-sim.js";
import { airingNumbers, airingWatch } from "../src/v1/modules/audience/watch.js";

let h: Harness;
let kai: User; // BEAT's owner
let maya: User; // MAKR's owner (the maker)
let hal: User; // HALL's owner (a carrier)
let dee: User; // an admin
let beat: string;
let makr: string;
let hall: string;
let krad: string;
let lateCrate: string; // BEAT's own program
let nightSignal: string; // MAKR's program, carried
const entries: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };
const viewers: Record<string, SimViewer[]> = {};
const at = (iso: string) => new Date(iso);
const T = (hhmmss: string) => `2026-10-01T${hhmmss}.000Z`;

async function asRun(stationId: string, programId: string, start: string, end: string, extra: { logEntryId?: string; assetId?: string } = {}) {
  const [row] = await h.db
    .insert(schema.asRun)
    .values({ stationId, code: "PGM", startedAt: at(start), endedAt: at(end), programId, logEntryId: extra.logEntryId ?? null, assetId: extra.assetId ?? null, reason: "planned" })
    .returning();
  return row;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(T("17:00:00"));
  const m = await market(h);
  kai = await h.signIn("Kai");
  maya = await h.signIn("Maya");
  hal = await h.signIn("Hal");
  dee = await h.signIn("Dee", { admin: true });
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true })).id;
  makr = (await stationFixture(h, { callSign: "MAKR", name: "Maker TV", ownerId: maya.id, marketId: m.id, tenths: 131, signedOn: true })).id;
  hall = (await stationFixture(h, { callSign: "HALL", name: "Hall", ownerId: hal.id, marketId: m.id, tenths: 141, signedOn: true })).id;
  krad = (await stationFixture(h, { callSign: "KRAD", name: "Radio", ownerId: hal.id, marketId: m.id, tenths: await radioTenths(h, 3), band: "radio", signedOn: true })).id;

  lateCrate = (await kai.post(`/v1/stations/${beat}/programs`, { title: "Late Crate" }).expect(201)).body.id;
  nightSignal = (await maya.post(`/v1/stations/${makr}/programs`, { title: "Night Signal" }).expect(201)).body.id;
  // BEAT's evening: three half-hour episodes of its own program, 7:00, 7:30 and 8:00 pm UTC.
  for (const [key, start, n] of [["A", "19:00:00", 1], ["B", "19:30:00", 2], ["C", "20:00:00", 3]] as const) {
    const item = await itemFixture(h, beat, { title: `Late Crate, ep. ${n}`, programId: lateCrate, episodeNumber: n, durationMs: 30 * 60_000 });
    entries[key] = (await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: T(start), itemId: item.id }).expect(201)).body.id;
    // What the playout engine writes as each part airs: A has a two-minute break in the middle.
    if (key === "A") {
      await asRun(beat, lateCrate, T("19:00:00"), T("19:14:00"), { logEntryId: entries.A, assetId: item.id });
      await asRun(beat, lateCrate, T("19:16:00"), T("19:30:00"), { logEntryId: entries.A, assetId: item.id });
    } else {
      await asRun(beat, lateCrate, T(start), new Date(Date.parse(T(start)) + 30 * 60_000).toISOString(), { logEntryId: entries[key], assetId: item.id });
    }
  }
  // Night Signal at 9:00 pm on MAKR (its own), carried by BEAT and HALL, and on KRAD's radio band.
  for (const s of [makr, beat, hall, krad]) await asRun(s, nightSignal, T("21:00:00"), T("21:30:00"));

  viewers.stay20 = crowd(20, { stationId: beat, from: T("19:00:10"), to: T("19:40:00") });
  viewers.leave5 = crowd(5, { stationId: beat, from: T("19:00:10"), to: T("19:10:05") });
  viewers.late3 = crowd(3, { stationId: beat, from: T("19:15:10"), to: T("19:40:00") });
  viewers.brief = [{ stationId: beat, from: T("19:20:10"), to: T("19:20:50") }];
  viewers.jumpBot = [{ stationId: beat, from: T("19:00:10"), to: T("19:30:00"), bot: "jump", jumpAt: T("19:05:30") }];
  viewers.fastBot = [{ stationId: beat, from: T("19:02:00"), to: T("19:02:20"), bot: "fast" }];
  viewers.c8 = crowd(8, { stationId: beat, from: T("20:00:10"), to: T("20:30:00") });
  viewers.makr30 = crowd(30, { stationId: makr, from: T("21:00:10"), to: T("21:30:00") });
  viewers.beat40 = crowd(40, { stationId: beat, from: T("21:00:10"), to: T("21:30:00") });
  viewers.hall4 = crowd(4, { stationId: hall, from: T("21:00:10"), to: T("21:30:00") });
  viewers.krad25 = crowd(25, { stationId: krad, from: T("21:00:10"), to: T("21:30:00") });
}, 60_000);
afterAll(() => h.close());

const vote = (stationId: string, sessionId: string, as?: User) => (as ? as.post(`/v1/stations/${stationId}/not-for-me`, { sessionId }) : anon(h).post(`/v1/stations/${stationId}/not-for-me`).send({ sessionId }));
const statOf = async (key: string) => (await h.db.select().from(schema.airingStats).where(eq(schema.airingStats.airingKey, key)))[0];
const report = async (from: string, to: string) => AudienceReport.parse((await kai.get(`/v1/stations/${beat}/audience?from=${from}&to=${to}`).expect(200)).body);
const watchOf = (r: AudienceReport, entryId: string) => r.byProgram?.find((p) => p.key === entryId)?.watch as AiringWatch | undefined;

describe("the numbers, one function", () => {
  it("counts minutes on air, the audience, stayed to the end, tune-aways and votes from 2 minutes", () => {
    const m = (i: number) => Date.parse(T("19:00:00")) + i * 60_000;
    const presence = new Map([
      ["a", new Set([m(0), m(1), m(2), m(3)])],
      ["b", new Set([m(0), m(1)])],
      ["c", new Set([m(2)])]
    ]);
    // A break from 1:30 to 2:30 into it: those minutes count half.
    const n = airingNumbers([{ start: m(0), end: m(1) + 30_000 }, { start: m(2) + 30_000, end: m(4) }], presence, ["a", "b", "c", "a"]);
    expect(n).toEqual({ minutes: 4, watchSeconds: 2 * 60 + 2 * 30 + 2 * 30 + 60, audienceAtStart: 2, peakAudience: 2, audienceAtEnd: 1, stayedToEnd: 1, tuneAways: [0, 0, 1, 1], notForMe: 2 });
  });

  it("radio is listening time; under the minimum it's 'Not enough viewers yet' and no numbers", () => {
    const stat = { band: "radio", watchSeconds: 600, audienceAtStart: 30, peakAudience: 30, audienceAtEnd: 15, stayedToEnd: 15, tuneAways: [0, 15], notForMe: 1 } as never;
    expect(airingWatch(stat, "radio", 20)).toMatchObject({ status: "shown", timeLabel: "listening_time", watchMinutes: 10, stayedToTheEnd: 50 });
    expect(airingWatch(stat, "radio", 31)).toEqual({ status: "not_enough_viewers", note: "Not enough viewers yet", timeLabel: "listening_time", watchMinutes: null, audienceAtStart: null, peakAudience: null, audienceAtEnd: null, stayedToTheEnd: null, tuneAways: null, notForMe: null });
  });
});

describe("an evening on BEAT", () => {
  it("records every counted minute and takes votes while it airs (the flag is off)", async () => {
    expect((await anon(h).get("/v1/config").expect(200)).body).toEqual({ features: { notForMe: false } });
    const stay = viewers.stay20;
    let duplicate: unknown;
    let signedIn: unknown;
    let countingOnNow: AiringWatch | undefined;
    await simulate(h, Object.values(viewers).flat(), [
      { at: T("19:03:00"), run: () => vote(beat, viewers.jumpBot[0].sessionId!).expect(200) },
      { at: T("19:05:00"), run: () => vote(beat, viewers.leave5[0].sessionId!).expect(200) },
      { at: T("19:20:45"), run: () => vote(beat, viewers.brief[0].sessionId!).expect(200) },
      {
        at: T("19:25:00"),
        run: async () => {
          for (const v of stay.slice(0, 3)) expect((await vote(beat, v.sessionId!).expect(200)).body).toEqual({ ok: true, status: "recorded" });
          duplicate = (await vote(beat, stay[0].sessionId!).expect(200)).body;
          // Signed in: still tied to the session only.
          signedIn = (await vote(beat, stay[3].sessionId!, kai).expect(200)).body;
          // No such session.
          await vote(beat, "00000000-0000-4000-8000-00000000abcd").expect(400);
        }
      },
      {
        at: T("20:10:00"),
        run: async () => {
          countingOnNow = watchOf(await report(T("19:00:00"), T("21:00:00")), entries.C);
        }
      },
      // Nothing on BEAT's log at 8:45 pm.
      { at: T("20:45:00"), run: () => vote(beat, viewers.c8[0].sessionId!).expect(409) },
      // A session is one station's.
      { at: T("21:15:00"), run: () => vote(beat, viewers.makr30[0].sessionId!).expect(400) }
    ]);
    expect(duplicate).toEqual({ ok: true, status: "already_recorded" });
    expect(signedIn).toEqual({ ok: true, status: "recorded" });
    expect(countingOnNow).toMatchObject({ status: "counting", timeLabel: "watch_time", watchMinutes: null });
    const votes = await h.db.select().from(schema.notForMeVotes);
    expect(votes).toHaveLength(7);
    expect(Object.keys(votes[0]).sort()).toEqual(["logEntryId", "sessionId", "stationId", "votedAt"]);

    // The jump bot counted in the station's tuned-in number before it was caught (26 at 7:02 pm).
    const [sample] = await h.db.select().from(schema.minuteSamples).where(and(eq(schema.minuteSamples.stationId, beat), eq(schema.minuteSamples.minute, at(T("19:02:00")))));
    expect(sample.tunedIn).toBe(26);
  }, 120_000);

  it("works out each airing once it's over, and finally an hour after (its votes go then)", async () => {
    h.clock.set(T("20:40:00"));
    // A ended 70 minutes ago (final), B 40 (not yet), C 10 (not yet); Night Signal is still to air.
    expect(await h.services.audience.watch.aggregate()).toEqual({ computed: 3, finalized: 1, votesDeleted: 7 });
    expect((await statOf(`entry:${entries.C}`)).final).toBe(false);
    h.clock.set(T("22:40:00"));
    const second = await h.services.audience.watch.aggregate();
    expect(second).toMatchObject({ computed: 6, finalized: 6, votesDeleted: 0 });
    expect(await h.db.select().from(schema.notForMeVotes)).toEqual([]);
  });

  it("watch time, audience at start, peak and end, stayed to the end and tune-aways, bots left out", async () => {
    const a = await statOf(`entry:${entries.A}`);
    // 25 at the start (20 who stay, 5 who leave at 7:10); 3 join at 7:15, one drops by at 7:20.
    // The jump bot (counted by the station's tuned-in number until it was caught) and the fast bot aren't in it.
    expect(a).toMatchObject({ minutes: 30, audienceAtStart: 25, peakAudience: 25, audienceAtEnd: 23, stayedToEnd: 20, band: "tv", external: false, carried: false, programId: lateCrate, makerStationId: beat, final: true });
    const tuneAways = Array(30).fill(0);
    tuneAways[10] = 5;
    tuneAways[21] = 1;
    expect(a.tuneAways).toEqual(tuneAways);
    // Minutes on air (the break from 7:14 to 7:16 isn't the program's): 25×10 + 20×4 + 23×4 + 24 + 23×9.
    expect(a.watchSeconds).toBe((250 + 80 + 92 + 24 + 207) * 60);
    const b = await statOf(`entry:${entries.B}`);
    expect(b).toMatchObject({ audienceAtStart: 23, peakAudience: 23, audienceAtEnd: 0, stayedToEnd: 0, watchSeconds: 230 * 60 });
    expect(b.tuneAways[10]).toBe(23);
  });

  it("a vote counts once per viewer, from 2 minutes watched, never a bot's", async () => {
    // Counted: three who stay, the signed-in one, one who left at 7:10. Not: the duplicate, the
    // one who dropped by for a minute, the bot.
    expect((await statOf(`entry:${entries.A}`)).notForMe).toBe(5);
  });

  it("the station's Audience page: each airing's watch time and tune-away line, or not enough viewers", async () => {
    const r = await report(T("19:00:00"), T("21:00:00"));
    expect(watchOf(r, entries.A)).toEqual({
      status: "shown",
      note: null,
      timeLabel: "watch_time",
      watchMinutes: 653,
      audienceAtStart: 25,
      peakAudience: 25,
      audienceAtEnd: 23,
      stayedToTheEnd: 80,
      tuneAways: (await statOf(`entry:${entries.A}`)).tuneAways,
      notForMe: 5
    });
    expect(watchOf(r, entries.B)).toMatchObject({ status: "shown", watchMinutes: 230, stayedToTheEnd: 0 });
    // Eight viewers: stored, never shown.
    expect(watchOf(r, entries.C)).toMatchObject({ status: "not_enough_viewers", note: "Not enough viewers yet", watchMinutes: null, tuneAways: null, notForMe: null });
    expect(await statOf(`entry:${entries.C}`)).toMatchObject({ peakAudience: 8, watchSeconds: 240 * 60 });
  });

  it("the minimum audience is a rule", async () => {
    await dee.post("/v1/admin/rules/watch_data.minimum_audience/versions", { value: { viewers: 5, carriedAirings: 2 }, effectiveFrom: "2026-10-01" }).expect(200);
    expect(watchOf(await report(T("19:00:00"), T("21:00:00")), entries.C)).toMatchObject({ status: "shown", peakAudience: 8 });
    await dee.post("/v1/admin/rules/watch_data.minimum_audience/versions", { value: { viewers: 20, carriedAirings: 2 }, effectiveFrom: T("22:40:00") }).expect(200);
    expect(watchOf(await report(T("19:00:00"), T("21:00:00")), entries.C)).toMatchObject({ status: "not_enough_viewers" });
  });

  it("a station sees only its own airings", async () => {
    // Not on the station: it isn't even said to exist.
    await hal.get(`/v1/stations/${beat}/audience?from=${T("19:00:00")}&to=${T("21:00:00")}`).expect(404);
    await maya.get(`/v1/stations/${beat}/audience?from=${T("19:00:00")}&to=${T("21:00:00")}`).expect(404);
    const r = await report(T("19:00:00"), T("22:00:00"));
    const keys = (r.byProgram ?? []).filter((p) => p.watch).map((p) => p.key);
    expect(keys.sort()).toEqual([entries.A, entries.B, entries.C].sort());
  });
});

describe("Offering your programs: the maker across its carriers", () => {
  it("adds up every station that aired it; other stations only together, never per airing", async () => {
    const res = await maya.get(`/v1/stations/${makr}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(200);
    const data = MakerWatchData.parse(res.body);
    const tv = data.programs.find((p) => p.band === "tv")!;
    // MAKR's own 30, BEAT's 40 and HALL's 4: the two carriers count together (44).
    expect(tv).toMatchObject({ programId: nightSignal, title: "Night Signal", timeLabel: "watch_time", status: "shown", stations: 3, airings: 3, notCounted: { airings: 0 } });
    expect(tv.totals).toMatchObject({ audienceAtStart: 74, combinedPeak: 74, audienceAtEnd: 74, stayedToTheEnd: 100, watchMinutes: 74 * 30, notForMe: 0 });
    // Nothing that names a station or an airing.
    expect(Object.keys(tv).sort()).toEqual(["airings", "band", "notCounted", "note", "programId", "stations", "status", "timeLabel", "title", "totals"]);
    for (const id of [beat, hall, krad]) expect(JSON.stringify(res.body)).not.toContain(id);
    // KRAD's radio airing is one other station's airing on its own: never shown alone.
    const radio = data.programs.find((p) => p.band === "radio")!;
    expect(radio).toEqual({ programId: nightSignal, title: "Night Signal", band: "radio", timeLabel: "listening_time", status: "not_enough_viewers", note: "Not enough viewers yet", stations: 0, airings: 0, notCounted: { airings: 1 }, totals: null });
  });

  it("other stations' airings stay out until they reach the minimum together", async () => {
    // HALL again at 10:00 pm with 5: HALL's two airings and BEAT's make three others, 49 together.
    const extra = await h.db.insert(schema.airingStats).values({ airingKey: "test:hall-2", stationId: hall, programId: nightSignal, makerStationId: makr, band: "tv", startedAt: at(T("22:00:00")), endedAt: at(T("22:30:00")), minutes: 30, watchSeconds: 5 * 1800, audienceAtStart: 5, peakAudience: 5, audienceAtEnd: 5, stayedToEnd: 5, tuneAways: Array(30).fill(0), final: true }).returning();
    let data = MakerWatchData.parse((await maya.get(`/v1/stations/${makr}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(200)).body);
    expect(data.programs.find((p) => p.band === "tv")).toMatchObject({ stations: 3, airings: 4, totals: { combinedPeak: 79 } });
    await h.db.delete(schema.airingStats).where(eq(schema.airingStats.id, extra[0].id));

    // Morning Signal: two carriers with 12 and 6 (18 together) stay out; nothing is shown.
    const morning = (await maya.post(`/v1/stations/${makr}/programs`, { title: "Morning Signal" }).expect(201)).body.id as string;
    const stat = (stationId: string, key: string, peak: number) => ({ airingKey: key, stationId, programId: morning, makerStationId: makr, band: "tv" as const, startedAt: at(T("08:00:00")), endedAt: at(T("08:30:00")), minutes: 30, watchSeconds: peak * 1800, audienceAtStart: peak, peakAudience: peak, audienceAtEnd: peak, stayedToEnd: peak, tuneAways: Array(30).fill(0), final: true });
    await h.db.insert(schema.airingStats).values([stat(hall, "test:m-hall", 12), stat(beat, "test:m-beat", 6)]);
    const morningRow = async () => MakerWatchData.parse((await maya.get(`/v1/stations/${makr}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(200)).body).programs.find((p) => p.programId === morning);
    expect(await morningRow()).toMatchObject({ status: "not_enough_viewers", note: "Not enough viewers yet", stations: 0, airings: 0, notCounted: { airings: 2 }, totals: null });
    // The maker's own airing with 25 shows, the carriers' still left out.
    await h.db.insert(schema.airingStats).values(stat(makr, "test:m-own", 25));
    expect(await morningRow()).toMatchObject({ status: "shown", stations: 1, airings: 1, notCounted: { airings: 2 }, totals: { combinedPeak: 25 } });
    // A third carrier airing (5) brings them to 23 together: all in.
    await h.db.insert(schema.airingStats).values(stat(hall, "test:m-hall-2", 5));
    expect(await morningRow()).toMatchObject({ status: "shown", stations: 3, airings: 4, notCounted: { airings: 0 }, totals: { combinedPeak: 48 } });
    await h.db.delete(schema.airingStats).where(eq(schema.airingStats.programId, morning));
  });

  it("an external station's time is labelled and kept out", async () => {
    const [row] = await h.db.insert(schema.airingStats).values({ airingKey: "test:external", stationId: hall, programId: nightSignal, makerStationId: makr, band: "tv", external: true, startedAt: at(T("21:00:00")), endedAt: at(T("21:30:00")), minutes: 30, watchSeconds: 999 * 60, audienceAtStart: 99, peakAudience: 99, audienceAtEnd: 99, stayedToEnd: 99, tuneAways: Array(30).fill(0), final: true }).returning();
    const data = MakerWatchData.parse((await maya.get(`/v1/stations/${makr}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(200)).body);
    expect(data.programs.find((p) => p.band === "tv")?.totals?.combinedPeak).toBe(74);
    await h.db.delete(schema.airingStats).where(eq(schema.airingStats.id, row.id));
  });

  it("only the maker's owners and operators, for up to a year", async () => {
    // Carriers aren't on the maker's station (404: not said to exist).
    await hal.get(`/v1/stations/${makr}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(404);
    await kai.get(`/v1/stations/${makr}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(404);
    await maya.get(`/v1/stations/${makr}/programs/watch-data?from=2025-01-01T00:00:00.000Z&to=2026-10-02T00:00:00.000Z`).expect(400);
    // BEAT is a maker too: its own airings of Late Crate, added up (25 + 23 + 8 at their busiest).
    const own = MakerWatchData.parse((await kai.get(`/v1/stations/${beat}/programs/watch-data?from=${T("00:00:00")}&to=2026-10-02T00:00:00.000Z`).expect(200)).body);
    expect(own.programs).toHaveLength(1);
    expect(own.programs[0]).toMatchObject({ title: "Late Crate", stations: 1, airings: 3, totals: { combinedPeak: 56, notForMe: 5 } });
  });

  it("radio's own airings read as listening time on its Audience page", async () => {
    const [row] = await h.db.insert(schema.airingStats).values({ airingKey: "test:radio", stationId: krad, logEntryId: "00000000-0000-4000-8000-0000000000aa", band: "radio", startedAt: at(T("21:00:00")), endedAt: at(T("21:30:00")), minutes: 30, watchSeconds: 25 * 1800, audienceAtStart: 25, peakAudience: 25, audienceAtEnd: 25, stayedToEnd: 25, tuneAways: Array(30).fill(0), final: true }).returning();
    const w = await h.services.audience.watch.forStation(krad, [{ logEntryId: row.logEntryId, endsAt: T("21:30:00"), onNow: false }]);
    expect(w.get(row.logEntryId!)).toMatchObject({ status: "shown", timeLabel: "listening_time", watchMinutes: 750 });
    await h.db.delete(schema.airingStats).where(eq(schema.airingStats.id, row.id));
  });
});

describe("the feature flag", () => {
  it("is off by default, read from the public config, and switched on in the registry without a deploy", async () => {
    await dee.post("/v1/admin/rules/features.not_for_me/versions", { value: { enabled: "yes" }, effectiveFrom: "2026-10-01" }).expect(400);
    await dee.post("/v1/admin/rules/features.not_for_me/versions", { value: { enabled: true }, effectiveFrom: "2026-10-01" }).expect(200);
    expect((await anon(h).get("/v1/config").expect(200)).body).toEqual({ features: { notForMe: true } });
    await kai.post("/v1/admin/rules/features.not_for_me/versions", { value: { enabled: false }, effectiveFrom: "2026-10-01" }).expect(403);
  });
});

describe("after 30 days, only the numbers", () => {
  it("purges every session, minute and vote, and keeps each airing's numbers, which identify nobody", async () => {
    const before = await h.db.select().from(schema.airingStats);
    const sessionIds = new Set((await h.db.select({ id: schema.sessions.id }).from(schema.sessions)).map((s) => s.id));
    expect(sessionIds.size).toBeGreaterThan(100);
    const userIds = new Set([kai.id, maya.id, hal.id, dee.id]);

    // 30 days on, someone new tunes in (kept) as the daily job runs.
    h.clock.set("2026-10-31T23:00:00.000Z");
    const fresh = { stationId: beat, sessionId: "00000000-0000-4000-8000-00000000f00d", platform: "web" as const, playing: true };
    await h.services.audience.heartbeat({ ...fresh, mediaTimeMs: 0 });
    h.clock.set("2026-10-31T23:00:30.000Z");
    await h.services.audience.heartbeat({ ...fresh, mediaTimeMs: 30_000 });
    // A day earlier than the retention: nothing goes yet.
    h.clock.set("2026-10-30T23:00:00.000Z");
    expect(await h.services.audience.watch.purge()).toMatchObject({ sessions: 0, minutes: 0 });
    h.clock.set("2026-11-01T00:00:00.000Z");
    const purged = await h.services.audience.watch.purge();
    expect(purged.sessions).toBe(sessionIds.size);
    expect(purged.minutes).toBeGreaterThan(1000);

    expect((await h.db.select().from(schema.sessions)).map((s) => s.id)).toEqual([fresh.sessionId]);
    expect((await h.db.select().from(schema.sessionMinutes)).map((m) => m.sessionId)).toEqual([fresh.sessionId]);
    expect(await h.db.select().from(schema.notForMeVotes)).toEqual([]);
    // Every airing's numbers are still there, unchanged.
    const after = await h.db.select().from(schema.airingStats);
    expect(after).toEqual(before);

    // What's kept names nobody: exactly the columns docs/schema.md lists, none of them a session,
    // person, device or address, and no value in them is a session's or a person's id.
    const columns = async (table: string) =>
      ((await h.db.execute(sql`select column_name from information_schema.columns where table_schema = 'audience' and table_name = ${table} order by ordinal_position`)) as unknown as { rows: Array<{ column_name: string }> }).rows.map((r) => r.column_name);
    expect(await columns("airing_stats")).toEqual([
      "id",
      "airing_key",
      "station_id",
      "log_entry_id",
      "as_run_id",
      "program_id",
      "maker_station_id",
      "carried",
      "band",
      "external",
      "started_at",
      "ended_at",
      "minutes",
      "watch_seconds",
      "audience_at_start",
      "peak_audience",
      "audience_at_end",
      "stayed_to_end",
      "tune_aways",
      "not_for_me",
      "final",
      "computed_at",
      "created_at"
    ]);
    for (const table of ["airing_stats", "minute_samples", "translator_samples"]) {
      for (const column of await columns(table)) expect(column, `${table}.${column}`).not.toMatch(/session|user|voter|device|person|email|ip_|address/);
    }
    const values = JSON.stringify(after);
    for (const id of [...sessionIds, ...userIds]) expect(values).not.toContain(id);
    // The tables that held sessions are the only ones with a session in them, and they're empty of the evening.
    const tables = ((await h.db.execute(sql`select table_name from information_schema.tables where table_schema = 'audience' order by table_name`)) as unknown as { rows: Array<{ table_name: string }> }).rows.map((r) => r.table_name);
    expect(tables).toEqual(["airing_stats", "minute_samples", "not_for_me_votes", "session_minutes", "sessions", "translator_samples"]);
  });
});
