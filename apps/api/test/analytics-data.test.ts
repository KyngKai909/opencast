// A251 (2026-10-06): data for the Network desk's analytics, collected ahead of the pages. A player
// keeps one id for its tab, so each station after the first gets a session of its own (before,
// those beats were refused and nobody was counted after a channel change); the sessions of one tab
// share its visit; the device id is kept as a hash; how a station was tuned and how long its
// picture took come with its first beat; searches viewers settled on are kept without them, 90 days.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, type Harness } from "./harness.js";
import { deviceHash, stationSessionId } from "../src/v1/modules/audience/service.js";

let h: Harness;
let beat: string;
let reel: string;
const TAB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T = (hhmmss: string) => `2026-10-01T${hhmmss}.000Z`;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(T("19:00:00"));
  const m = await market(h);
  const owner = await h.signIn("Kai");
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: owner.id, marketId: m.id, tenths: 121, signedOn: true })).id;
  reel = (await stationFixture(h, { callSign: "REEL", name: "Reel", ownerId: owner.id, marketId: m.id, tenths: 241, signedOn: true })).id;
});
afterAll(() => h.close());

const beatFor = (stationId: string, mediaTimeMs: number, extra: Record<string, unknown> = {}) =>
  anon(h).post("/v1/heartbeat").send({ stationId, sessionId: TAB, platform: "web", mediaTimeMs, playing: true, deviceId: DEVICE, ...extra }).expect(200);

describe("sessions across a channel change", () => {
  it("counts the second station too, in a session of its own, with the visit, the device's hash, how it was tuned and its tune time", async () => {
    await beatFor(beat, 0, { via: "guide", tuneMs: 850 });
    h.clock.set(T("19:00:30"));
    await beatFor(beat, 30_000);
    // Channel up to REEL: the same tab's id.
    h.clock.set(T("19:01:00"));
    await beatFor(reel, 0, { via: "channel", tuneMs: 420 });
    h.clock.set(T("19:01:30"));
    await beatFor(reel, 30_000);

    const [first] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, TAB));
    expect(first).toMatchObject({ stationId: beat, visitId: TAB, via: "guide", tuneMs: 850, deviceHash: deviceHash(DEVICE) });
    expect(first.deviceHash).not.toContain(DEVICE.slice(0, 8));
    const second = stationSessionId(TAB, reel);
    const [other] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, second));
    expect(other).toMatchObject({ stationId: reel, visitId: TAB, via: "channel", tuneMs: 420, beats: 2 });
    // REEL was counted (it wasn't before: its beats were refused).
    const reelMinutes = await h.db.select().from(schema.minuteSamples).where(eq(schema.minuteSamples.stationId, reel));
    expect(reelMinutes.reduce((n, r) => n + r.tunedIn, 0)).toBeGreaterThan(0);
    // Back to BEAT: its own session goes on.
    h.clock.set(T("19:02:00"));
    await beatFor(beat, 60_000);
    const [again] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, TAB));
    expect(again.beats).toBe(3);
  });

  it("finds the session on the station a vote is for", async () => {
    expect(await h.services.audience.sessionOn(TAB, reel)).toBe(stationSessionId(TAB, reel));
    expect(await h.services.audience.sessionOn(TAB, beat)).toBe(TAB);
    expect(await h.services.audience.sessionOn("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", beat)).toBeNull();
  });

  it("takes beats from older players without a device or how it was tuned", async () => {
    const old = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await anon(h).post("/v1/heartbeat").send({ stationId: beat, sessionId: old, platform: "tv_app", mediaTimeMs: 0, playing: true }).expect(200);
    const [row] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, old));
    expect(row).toMatchObject({ visitId: old, deviceHash: null, via: null, tuneMs: null });
  });
});

describe("searches viewers settled on", () => {
  it("keeps the words, lower case, and the result count; nothing shorter than two letters; gone after 90 days", async () => {
    await anon(h).post("/v1/search/seen").send({ q: "  Late   CRATE ", results: 3 }).expect(200);
    await anon(h).post("/v1/search/seen").send({ q: "x", results: 0 }).expect(200);
    await anon(h).post("/v1/search/seen").send({ q: "anime", results: -1 }).expect(400);
    const rows = await h.db.select().from(schema.searches);
    expect(rows.map((r) => [r.term, r.results])).toEqual([["late crate", 3]]);
    expect(Object.keys(rows[0]).sort()).toEqual(["at", "id", "results", "term"]);
    h.clock.set("2026-12-31T19:00:00.000Z");
    expect((await h.services.audience.watch.purge()).searches).toBe(1);
    expect(await h.db.select().from(schema.searches)).toHaveLength(0);
  });
});
