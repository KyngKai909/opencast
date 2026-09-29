// Radio live blocks never go through Livepeer, even with Livepeer set up: a radio station's
// encoder is given Opencast's own ingest (the worker's) and its own key, no Livepeer stream is
// created, and playout never reads Livepeer for it. A TV station's still goes to Livepeer (faked
// here: nothing paid is called). A radio live block whose encoder isn't connected airs the
// stand-by slate for as long as it isn't. Frozen clock, no FFmpeg.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LIVEPEER_API_KEY = "test-livepeer-key";
  process.env.WORKER_INGEST_SERVER = "rtmp://ingest.opencast.test/live";
});

import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, radioTenths, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let engine: Engine;
let kai: User;
let radioId: string;
let tvId: string;
const calls: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  // Every request anyone makes is seen; Livepeer's stream creation answers as Livepeer would.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (/livepeer/.test(url) && url.endsWith("/stream") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "lp-stream", streamKey: "lp-key-0001", playbackId: "lp-playback" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (/livepeer/.test(url)) return new Response("not faked", { status: 500 });
    return realFetch(input, init);
  });
  h = await createHarness();
  h.clock.set("2026-10-01T19:59:40.000Z");
  const m = await market(h);
  kai = await h.signIn("Kai");
  radioId = (await stationFixture(h, { callSign: "WAVE", name: "Wave", ownerId: kai.id, marketId: m.id, tenths: await radioTenths(h), band: "radio", signedOn: true })).id;
  tvId = (await stationFixture(h, { callSign: "TUBE", name: "Tube", ownerId: kai.id, marketId: m.id, tenths: 141, signedOn: true })).id;
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  vi.restoreAllMocks();
  await h.close();
});

describe("a radio station's encoder", () => {
  it("is given Opencast's own ingest and key, and no Livepeer stream is made", async () => {
    const res = await kai.post(`/v1/stations/${radioId}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201);
    expect(res.body.source).toMatchObject({ kind: "encoder", server: "rtmp://ingest.opencast.test/live", route: "opencast", previewUrl: null });
    expect(res.body.streamKey).toMatch(/^wave-studio-a-[0-9a-f]{24}$/);
    expect(res.body.source.streamKeyPreview).toBe(`${res.body.streamKey.slice(0, 8)}…`);
    expect(calls.filter((u) => /livepeer/.test(u))).toEqual([]);
    const [row] = await h.db.select().from(schema.liveSources).where(eq(schema.liveSources.id, res.body.source.id));
    expect(row).toMatchObject({ livepeerStreamId: null, livepeerPlaybackId: null, streamKey: res.body.streamKey });
    // Listed the same way, and a browser source on radio has no Livepeer WHIP ingest.
    const browser = await kai.post(`/v1/stations/${radioId}/live-sources`, { kind: "browser", name: "Browser" }).expect(201);
    expect(browser.body.source).toMatchObject({ server: null, route: "opencast", ingest: null });
    const list = await kai.get(`/v1/stations/${radioId}/live-sources`).expect(200);
    expect(list.body.find((s: { id: string }) => s.id === res.body.source.id)).toMatchObject({ server: "rtmp://ingest.opencast.test/live", route: "opencast" });
    expect(calls.filter((u) => /livepeer/.test(u))).toEqual([]);

    // The worker's ingest takes the key for the radio station only.
    expect(await h.services.stations.liveSourceByKey(res.body.streamKey)).toMatchObject({ id: res.body.source.id, stationId: radioId, band: "radio" });
    expect(await h.services.stations.liveSourceByKey("nope")).toBeNull();
  });

  it("while a TV station's goes to Livepeer, as before", async () => {
    const res = await kai.post(`/v1/stations/${tvId}/live-sources`, { kind: "encoder", name: "Studio B" }).expect(201);
    expect(res.body.source).toMatchObject({ route: "livepeer" });
    expect(res.body.streamKey).toBe("lp-key-0001");
    expect(calls.filter((u) => /livepeer/.test(u) && u.endsWith("/stream"))).toHaveLength(1);
    // Its key isn't the radio ingest's to take.
    expect(await h.services.stations.liveSourceByKey("lp-key-0001")).toMatchObject({ band: "tv" });
  });
});

describe("a radio live block with no encoder connected", () => {
  it("airs the stand-by slate, and playout never reads Livepeer for it", async () => {
    const [source] = await h.db.select().from(schema.liveSources).where(eq(schema.liveSources.stationId, radioId)).limit(1);
    // A Livepeer playback ID left from before radio stopped using Livepeer: never read.
    await h.db.update(schema.liveSources).set({ livepeerPlaybackId: "old-playback" }).where(eq(schema.liveSources.id, source.id));
    await itemFixture(h, radioId, { title: "WAVE ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
    const show = await itemFixture(h, radioId, { title: "Before", durationMs: 20_000, location: await dummyFile() });
    const [program] = await h.db.insert(schema.programs).values({ stationId: radioId, title: "Call-in", isLive: true }).returning();
    await kai.post(`/v1/stations/${radioId}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:00:20.000Z", itemId: show.id }).expect(201);
    const live = await kai.post(`/v1/stations/${radioId}/log`, { kind: "live", startsAt: "2026-10-01T20:00:20.000Z", endsAt: "2026-10-01T20:01:00.000Z", liveSourceId: source.id, programId: program.id }).expect(201);
    await kai.post(`/v1/stations/${radioId}/log`, { kind: "program", startsAt: "2026-10-01T20:01:00.000Z", endsAt: "2026-10-01T20:01:20.000Z", itemId: show.id }).expect(201);
    await h.db.insert(schema.playoutState).values({ stationId: radioId, onAir: true });
    calls.length = 0;
    // The worker's ingest is listening (on a free port); nobody pushes to it.
    engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), translators: false, ingest: { port: 0 }, log: () => undefined });
    let during = "";
    const end = Date.parse("2026-10-01T20:01:30.000Z");
    while (h.clock.now().getTime() < end) {
      h.clock.advance(1_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
      if (h.clock.now().getTime() === Date.parse("2026-10-01T20:00:40.000Z")) during = (await h.services.playout.playlist(radioId, "a128.m3u8"))!.body;
    }
    await h.deps.bus.settle();
    expect(engine.ingest?.port).toBeGreaterThan(0);
    expect(calls.filter((u) => /livepeer/.test(u))).toEqual([]);

    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, radioId)).orderBy(asc(schema.asRun.startedAt));
    const block = rows.filter((r) => r.startedAt >= new Date("2026-10-01T20:00:20Z") && r.startedAt < new Date("2026-10-01T20:01:00Z"));
    expect(block.length).toBeGreaterThan(0);
    expect(block.every((r) => r.reason === "slate")).toBe(true);
    expect(rows.find((r) => r.startedAt.getTime() === Date.parse("2026-10-01T20:01:00Z"))).toMatchObject({ code: "PGM", reason: "planned" });
    // The stand-by slate carries the live block's tag, so the apps know it's the block, waiting.
    expect(parseDateRanges(during).find((r) => r.class === HLS_CLASS.live)?.attributes).toMatchObject({ logEntryId: live.body.id, sourceId: source.id });
    const notices = await h.db.select().from(schema.notices);
    expect(notices.some((n) => n.kind === "signal_lost")).toBe(true);
  }, 60_000);
});
