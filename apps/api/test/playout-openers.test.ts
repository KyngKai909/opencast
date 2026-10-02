// A242: openers, closers and a station's own off-air card. The run sheet (no FFmpeg) for sign-off
// and sign-on with the station's own and with the automatic ones, the station ID after the opener,
// short off air time, the daily opener, the radio band and the turns several openers take; then an
// assembled channel (a fake transcoder, a frozen clock) for the as-run log, the playlist's end and
// billing; and the library and the log's rules for the new types.
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { generatedIdentKey } from "../src/v1/modules/playout/engine/stationId.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, radioTenths, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let planner: ReturnType<typeof createPlanner>;
let marketId: string;
let kai: User;

const hms = (d: Date) => d.toISOString().slice(11, 19);
const shape = (segments: Segment[]) => segments.map((s) => `${hms(s.startsAt)} ${s.code} ${Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000)}s${s.source.kind === "off" ? " dark" : ""}`);
const between = (segments: Segment[], from: string, to: string) => segments.filter((s) => s.startsAt >= new Date(from) && s.startsAt < new Date(to));

async function picture(colour = "#203040"): Promise<string> {
  const dir = path.join(os.tmpdir(), "opencast-test-cards");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.png`);
  await sharp({ create: { width: 800, height: 600, channels: 3, background: colour } }).png().toFile(file);
  return file;
}

const RULE = { mode: "none", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] };

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T20:00:00.000Z");
  planner = createPlanner({ deps: h.deps, services: h.services });
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("sign-off and sign-on with the station's own", () => {
  let beat: { id: string };
  let closer: { id: string };
  let card: { id: string };
  let openers: string[];

  beforeAll(async () => {
    beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 121, signedOn: true, colour: "#8C3B7A" });
    await kai.put(`/v1/stations/${beat.id}/break-rule`, RULE).expect(200);
    await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 5_000 });
    closer = await itemFixture(h, beat.id, { title: "BEAT goodnight", code: "CLS", durationMs: 6_000 });
    card = await itemFixture(h, beat.id, { title: "BEAT test card", code: "OFF", durationMs: null, location: await picture() });
    openers = [(await itemFixture(h, beat.id, { title: "Morning open A", code: "OPN", durationMs: 4_000 })).id, (await itemFixture(h, beat.id, { title: "Morning open B", code: "OPN", durationMs: 4_000 })).id];
    const show = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 30 * 60_000 });
    // 11:00 pm to 6:00 am, two nights running; a minute and forty seconds, and sixteen seconds, the night after.
    for (const day of ["03", "04"]) {
      await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: `2026-10-${day}T05:30:00.000Z`, endsAt: `2026-10-${day}T06:00:00.000Z`, itemId: show.id }).expect(201);
      await kai.post(`/v1/stations/${beat.id}/log`, { kind: "off_air", startsAt: `2026-10-${day}T06:00:00.000Z`, endsAt: `2026-10-${day}T13:00:00.000Z` }).expect(201);
      await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: `2026-10-${day}T13:00:00.000Z`, endsAt: `2026-10-${day}T13:30:00.000Z`, itemId: show.id }).expect(201);
    }
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "off_air", startsAt: "2026-10-05T06:00:00.000Z", endsAt: "2026-10-05T06:01:40.000Z" }).expect(201);
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "off_air", startsAt: "2026-10-05T07:00:00.000Z", endsAt: "2026-10-05T07:00:16.000Z" }).expect(201);
  }, 60_000);

  it("signs off with its closer, then its own off-air card, then the channel ends", async () => {
    const segments = await planner.plan(beat.id, new Date("2026-10-03T05:59:00Z"), new Date("2026-10-03T06:03:00Z"));
    const off = between(segments, "2026-10-03T06:00:00Z", "2026-10-03T07:00:00Z");
    expect(shape(off)).toEqual(["06:00:00 CLS 6s", "06:00:06 OPEN 60s", "06:01:06 OPEN 25130s dark"]);
    expect(off[0]).toMatchObject({ itemId: closer.id, label: "BEAT goodnight", reason: "planned", source: { kind: "file" } });
    // Its own card, a picture: held as the sign-off slate, with when the station is back.
    expect(off[1]).toMatchObject({ itemId: card.id, slate: "off_air", reason: "slate", backAt: new Date("2026-10-03T13:00:00Z"), source: { kind: "image" } });
    const png = await sharp((off[1].source as { path: string }).path).metadata();
    expect([png.width, png.height]).toEqual([1280, 720]);
  });

  it("signs on with an opener that ends as the first program starts, in place of the station ID", async () => {
    const segments = await planner.plan(beat.id, new Date("2026-10-03T12:58:00Z"), new Date("2026-10-03T13:01:00Z"));
    expect(shape(between(segments, "2026-10-03T12:59:00Z", "2026-10-03T13:01:00Z"))).toEqual(["12:59:56 OPN 4s", "13:00:00 PGM 1800s"]);
    expect(segments.some((s) => s.code === "SID")).toBe(false);
  });

  it("takes turns, a broadcast day each, among several openers", async () => {
    const first = (await planner.plan(beat.id, new Date("2026-10-03T12:59:00Z"), new Date("2026-10-03T13:01:00Z"))).find((s) => s.code === "OPN")!;
    const second = (await planner.plan(beat.id, new Date("2026-10-04T12:59:00Z"), new Date("2026-10-04T13:01:00Z"))).find((s) => s.code === "OPN")!;
    expect(new Set([first.itemId, second.itemId])).toEqual(new Set(openers));
    // The same day planned again airs the same one.
    const again = (await planner.plan(beat.id, new Date("2026-10-03T12:59:30Z"), new Date("2026-10-03T13:02:00Z"))).find((s) => s.code === "OPN")!;
    expect(again.itemId).toBe(first.itemId);
  });

  it("airs the station ID after the opener when the station says so", async () => {
    const rule = await kai.put(`/v1/stations/${beat.id}/break-rule`, { ...RULE, stationIdAfterOpener: true }).expect(200);
    expect(rule.body).toMatchObject({ stationIdAfterOpener: true, dailyOpener: false });
    // An app from before leaves it as set.
    expect((await kai.put(`/v1/stations/${beat.id}/break-rule`, RULE).expect(200)).body.stationIdAfterOpener).toBe(true);
    const segments = await planner.plan(beat.id, new Date("2026-10-03T12:58:00Z"), new Date("2026-10-03T13:01:00Z"));
    expect(shape(between(segments, "2026-10-03T12:59:00Z", "2026-10-03T13:01:00Z"))).toEqual(["12:59:51 OPN 4s", "12:59:55 SID 5s", "13:00:00 PGM 1800s"]);
    await kai.put(`/v1/stations/${beat.id}/break-rule`, { ...RULE, stationIdAfterOpener: false }).expect(200);
  });

  it("keeps the channel on through off air time too short to go dark, and holds the card alone through shorter", async () => {
    const segments = await planner.plan(beat.id, new Date("2026-10-05T05:59:00Z"), new Date("2026-10-05T07:01:00Z"));
    // A minute and forty: closer, the card for what's left, opener. Nothing dark.
    expect(shape(between(segments, "2026-10-05T06:00:00Z", "2026-10-05T06:01:40Z"))).toEqual(["06:00:00 CLS 6s", "06:00:06 OPEN 90s", "06:01:36 OPN 4s"]);
    // Sixteen seconds: the card, nothing else (as before A242).
    expect(shape(between(segments, "2026-10-05T07:00:00Z", "2026-10-05T07:00:16Z"))).toEqual(["07:00:00 OPEN 16s"]);
    expect(segments.some((s) => s.source.kind === "off")).toBe(false);
  });
});

describe("without uploads", () => {
  it("airs the automatic closer and opener in the station's look, and the generated off-air card", async () => {
    const owner = await h.signIn("Tala");
    const talk = await stationFixture(h, { callSign: "TALK", name: "Talk 12", ownerId: owner.id, marketId, tenths: 123, signedOn: true, colour: "#2F5D8C" });
    await owner.put(`/v1/stations/${talk.id}/break-rule`, RULE).expect(200);
    await owner.post(`/v1/stations/${talk.id}/log`, { kind: "off_air", startsAt: "2026-10-03T06:00:00.000Z", endsAt: "2026-10-03T13:00:00.000Z" }).expect(201);
    const segments = await planner.plan(talk.id, new Date("2026-10-03T06:00:00Z"), new Date("2026-10-03T06:02:00Z"));
    expect(shape(segments)).toEqual(["06:00:00 CLS 5s", "06:00:05 OPEN 60s", "06:01:05 OPEN 25130s dark"]);
    const look = (await h.services.stations.look(talk.id))!;
    expect(segments[0]).toMatchObject({ label: "12.3 TALK · Signing off · Back at 6:00 am", itemId: undefined, source: { kind: "file", contentId: generatedIdentKey(look, "tv", "closer", "6:00 am") } });
    expect(segments[1]).toMatchObject({ label: "Off air", slate: "off_air", source: { kind: "image" } });
    expect(segments[1].itemId).toBeUndefined();
    const on = await planner.plan(talk.id, new Date("2026-10-03T12:59:00Z"), new Date("2026-10-03T13:00:00Z"));
    expect(on.find((s) => s.code === "OPN")).toMatchObject({ label: "12.3 TALK · Signing on", startsAt: new Date("2026-10-03T12:59:55Z"), source: { contentId: generatedIdentKey(look, "tv", "opener", null) } });

    // Not prepared yet: its picture, held (silent), and it's asked for.
    const asked: Array<{ key: string; png: string | null; seconds: number }> = [];
    const waiting = createPlanner({ deps: h.deps, services: h.services }, { isReady: () => false, wantGenerated: async (spec) => void asked.push(spec) });
    const early = await waiting.plan(talk.id, new Date("2026-10-03T06:00:00Z"), new Date("2026-10-03T06:02:00Z"));
    expect(early[0]).toMatchObject({ code: "CLS", source: { kind: "image" } });
    expect(asked).toContainEqual(expect.objectContaining({ key: generatedIdentKey(look, "tv", "closer", "6:00 am"), seconds: 5 }));
    expect(asked.find((a) => a.key.startsWith("cls-"))!.png).toBeTruthy();
  });
});

describe("the radio band", () => {
  it("airs audio openers and closers, and a picture card as its slate", async () => {
    const owner = await h.signIn("Wren");
    const wave = await stationFixture(h, { callSign: "WAVE", name: "Wave Radio", ownerId: owner.id, marketId, tenths: await radioTenths(h, 3), band: "radio", signedOn: true });
    await owner.put(`/v1/stations/${wave.id}/break-rule`, RULE).expect(200);
    await itemFixture(h, wave.id, { title: "Wave sign-off", code: "CLS", durationMs: 8_000, mediaKind: "audio" });
    await itemFixture(h, wave.id, { title: "Wave sign-on", code: "OPN", durationMs: 4_000, mediaKind: "audio" });
    await itemFixture(h, wave.id, { title: "Wave card", code: "OFF", durationMs: null, location: await picture("#335577") });
    await owner.post(`/v1/stations/${wave.id}/log`, { kind: "off_air", startsAt: "2026-10-03T06:00:00.000Z", endsAt: "2026-10-03T13:00:00.000Z" }).expect(201);
    const off = await planner.plan(wave.id, new Date("2026-10-03T06:00:00Z"), new Date("2026-10-03T06:02:00Z"));
    expect(shape(off)).toEqual(["06:00:00 CLS 8s", "06:00:08 OPEN 60s", "06:01:08 OPEN 25128s dark"]);
    expect(off[0].source).toMatchObject({ kind: "file", mediaKind: "audio" });
    expect(off[1].source.kind).toBe("image");
    const on = await planner.plan(wave.id, new Date("2026-10-03T12:59:00Z"), new Date("2026-10-03T13:00:00Z"));
    expect(on.find((s) => s.code === "OPN")!.source).toMatchObject({ kind: "file", mediaKind: "audio" });

    // The automatic ones on the radio band: the bed alone, so one closer whenever it's back, and no picture asked for.
    const look = { callSign: "WAVE", channel: "88.8", name: "Wave Radio", homeCity: null, colour: null };
    expect(generatedIdentKey(look, "radio", "closer", "6:00 am")).toBe(generatedIdentKey(look, "radio", "closer", "7:00 am"));
    expect(generatedIdentKey(look, "tv", "closer", "6:00 am")).not.toBe(generatedIdentKey(look, "tv", "closer", "7:00 am"));
    const bare = await stationFixture(h, { callSign: "HUSH", name: "Hush Radio", ownerId: owner.id, marketId, tenths: await radioTenths(h, 4), band: "radio", signedOn: true });
    await owner.post(`/v1/stations/${bare.id}/log`, { kind: "off_air", startsAt: "2026-10-03T06:00:00.000Z", endsAt: "2026-10-03T13:00:00.000Z" }).expect(201);
    const asked: Array<{ key: string; png: string | null }> = [];
    await createPlanner({ deps: h.deps, services: h.services }, { isReady: () => false, wantGenerated: async (spec) => void asked.push(spec) }).plan(bare.id, new Date("2026-10-03T06:00:00Z"), new Date("2026-10-03T06:01:00Z"));
    expect(asked.find((a) => a.key.startsWith("cls-"))).toMatchObject({ png: null });
  });
});

describe("the daily opener", () => {
  let dawn: { id: string };
  let owner: User;
  const window = async (from: string, to: string) => planner.plan(dawn.id, new Date(from), new Date(to));

  beforeAll(async () => {
    owner = await h.signIn("Dee");
    dawn = await stationFixture(h, { callSign: "DAWN", name: "Dawn TV", ownerId: owner.id, marketId, tenths: 125, signedOn: true, colour: "#7A4B21" });
    await owner.put(`/v1/stations/${dawn.id}/break-rule`, RULE).expect(200);
    await itemFixture(h, dawn.id, { title: "DAWN ident", code: "SID", durationMs: 5_000 });
    const full = await itemFixture(h, dawn.id, { title: "Night Owls", durationMs: 30 * 60_000 });
    const short = await itemFixture(h, dawn.id, { title: "First Light", durationMs: 28 * 60_000 });
    // 5:30 am runs right up to 6:00 (no fill before it); 6:00 leaves two minutes before 6:30.
    await owner.post(`/v1/stations/${dawn.id}/log`, { kind: "program", startsAt: "2026-10-03T12:30:00.000Z", endsAt: "2026-10-03T13:00:00.000Z", itemId: full.id }).expect(201);
    await owner.post(`/v1/stations/${dawn.id}/log`, { kind: "program", startsAt: "2026-10-03T13:00:00.000Z", endsAt: "2026-10-03T13:30:00.000Z", itemId: short.id }).expect(201);
    await owner.post(`/v1/stations/${dawn.id}/log`, { kind: "program", startsAt: "2026-10-03T13:30:00.000Z", endsAt: "2026-10-03T14:00:00.000Z", itemId: full.id }).expect(201);
  }, 60_000);

  it("doesn't air unless the station switches it on", async () => {
    expect((await window("2026-10-03T12:55:00Z", "2026-10-03T13:35:00Z")).some((s) => s.code === "OPN")).toBe(false);
  });

  it("airs at the first program boundary at or after 6:00 am with room before it, in place of the station ID", async () => {
    expect((await owner.put(`/v1/stations/${dawn.id}/break-rule`, { ...RULE, dailyOpener: true }).expect(200)).body.dailyOpener).toBe(true);
    const segments = await window("2026-10-03T12:55:00Z", "2026-10-03T13:35:00Z");
    // 6:00 has a program right up to it: never cut into. 6:30 has open time before it.
    expect(shape(between(segments, "2026-10-03T13:28:00Z", "2026-10-03T13:31:00Z"))).toEqual(["13:28:00 OPEN 115s", "13:29:55 OPN 5s", "13:30:00 PGM 1800s"]);
    expect(segments.filter((s) => s.code === "OPN")).toHaveLength(1);
    // In the break that closes 6:00's slot, where its station ID was.
    expect(segments.find((s) => s.code === "OPN")).toMatchObject({ label: "12.5 DAWN · Signing on", reason: "planned", inBreak: true });
    // The same wherever the window starts.
    for (const [from, to] of [["2026-10-03T13:20:00Z", "2026-10-03T13:35:00Z"], ["2026-10-03T13:29:00Z", "2026-10-03T13:31:00Z"], ["2026-10-03T13:29:56Z", "2026-10-03T13:31:00Z"]]) {
      const again = (await window(from, to)).find((s) => s.code === "OPN");
      expect(again && hms(again.startsAt)).toBe("13:29:55");
    }
    // Once a broadcast day: nothing later that day.
    expect((await window("2026-10-03T13:35:00Z", "2026-10-03T13:59:00Z")).some((s) => s.code === "OPN")).toBe(false);
  });
});

describe("the library and the log", () => {
  it("takes a picture as an off-air card, keeps old codes beside identCode, and keeps openers off the log", async () => {
    const owner = await h.signIn("Lib");
    const st = await stationFixture(h, { callSign: "LIBR", name: "Library TV", ownerId: owner.id, marketId, tenths: 127, signedOn: true });
    const card = await owner.post(`/v1/stations/${st.id}/library/uploads`).attach("file", await picture()).field("title", "Test card").field("code", "OFF").expect(201);
    expect(card.body).toMatchObject({ code: "OPEN", identCode: "OFF", still: true, durationMs: null });
    await h.services.library.settle();
    expect((await owner.get(`/v1/library/${card.body.id}`).expect(200)).body).toMatchObject({ status: "ready", picture: { width: 800, height: 600 } });
    // A picture as anything else isn't a file the library can air.
    await owner.patch(`/v1/library/${card.body.id}`, { code: "BMP" }).expect(422);

    const opener = await itemFixture(h, st.id, { title: "Sign-on", code: "OPN", durationMs: 4_000 });
    expect((await owner.get(`/v1/library/${opener.id}`).expect(200)).body).toMatchObject({ code: "SID", identCode: "OPN" });
    const listed = await owner.get(`/v1/stations/${st.id}/library?code=OPN`).expect(200);
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([opener.id]);
    const refused = await owner.post(`/v1/stations/${st.id}/log`, { kind: "program", startsAt: "2026-10-03T03:00:00.000Z", endsAt: "2026-10-03T03:01:00.000Z", itemId: opener.id }).expect(422);
    expect(refused.body.error.code).toBe("not_for_the_log");
    // An item on the log can't become one.
    const show = await itemFixture(h, st.id, { title: "Show", durationMs: 50_000 });
    await owner.post(`/v1/stations/${st.id}/log`, { kind: "program", startsAt: "2026-10-03T03:00:00.000Z", endsAt: "2026-10-03T03:01:00.000Z", itemId: show.id }).expect(201);
    expect((await owner.patch(`/v1/library/${show.id}`, { code: "CLS" }).expect(409)).body.error.code).toBe("on_the_log");
    expect((await owner.patch(`/v1/library/${opener.id}`, { code: "CLS" }).expect(200)).body).toMatchObject({ code: "SID", identCode: "CLS" });
  }, 60_000);
});

describe("an assembled sign-off and sign-on", () => {
  let engine: Engine;
  let stationId: string;
  let owner: User;
  let card: { id: string };

  async function runUntil(iso: string, stepMs = 2_000, each?: () => Promise<void>) {
    const end = Date.parse(iso);
    while (h.clock.now().getTime() < end) {
      h.clock.advance(Math.min(stepMs, end - h.clock.now().getTime()));
      await engine.tick();
      await prepareQueued(h, engine.preparer);
      await each?.();
    }
  }
  const playlist = async () => (await h.services.playout.playlist(stationId, "v720.m3u8"))?.body ?? null;

  beforeAll(async () => {
    h.clock.set("2026-10-06T05:59:52.000Z");
    owner = await h.signIn("Opal");
    stationId = (await stationFixture(h, { callSign: "OPAL", name: "Opal TV", ownerId: owner.id, marketId, tenths: 129, signedOn: true, colour: "#5B3A8C" })).id;
    await owner.put(`/v1/stations/${stationId}/break-rule`, { ...RULE, mode: "after_every_program" }).expect(200);
    await itemFixture(h, stationId, { title: "OPAL ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
    await itemFixture(h, stationId, { title: "OPAL goodnight", code: "CLS", durationMs: 6_000, location: await dummyFile() });
    card = await itemFixture(h, stationId, { title: "OPAL card", code: "OFF", durationMs: null, location: await picture("#5B3A8C") });
    const show = await itemFixture(h, stationId, { title: "Night Desk", durationMs: 56_000, location: await dummyFile() });
    await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-06T06:00:00.000Z", endsAt: "2026-10-06T06:01:00.000Z", itemId: show.id }).expect(201);
    await owner.post(`/v1/stations/${stationId}/log`, { kind: "off_air", startsAt: "2026-10-06T06:01:00.000Z", endsAt: "2026-10-06T06:10:00.000Z" }).expect(201);
    await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-06T06:10:00.000Z", endsAt: "2026-10-06T06:11:00.000Z", itemId: show.id }).expect(201);
    await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
    engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder() });
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }, 60_000);
  afterAll(async () => {
    await engine?.stopAll();
  });

  it("airs the closer and the card, ends the playlist, then opens with the automatic opener on time", async () => {
    let signing: string | null | undefined;
    await runUntil("2026-10-06T06:01:04.000Z", 2_000);
    signing = (await h.services.playout.status(stationId)).signing;
    expect(signing).toBe("off");
    await runUntil("2026-10-06T06:02:30.000Z");
    const ended = (await playlist())!;
    expect(ended.trimEnd().endsWith("#EXT-X-ENDLIST")).toBe(true);
    const ranges = parseDateRanges(ended);
    const closerTag = ranges.find((r) => r.class === HLS_CLASS.item && r.attributes.identCode === "CLS")!;
    // Players built before A242 read a station ID.
    expect(closerTag.attributes.code).toBe("SID");
    expect(new Date(ranges.find((r) => r.class === HLS_CLASS.signOff)!.start).toISOString()).toBe("2026-10-06T06:01:06.000Z");

    await runUntil("2026-10-06T06:09:40.000Z", 10_000);
    await runUntil("2026-10-06T06:09:57.000Z", 2_000);
    expect((await h.services.playout.status(stationId)).signing).toBe("on");
    await runUntil("2026-10-06T06:10:10.000Z", 2_000);
    const back = (await playlist())!;
    expect(back).not.toContain("#EXT-X-ENDLIST");
    const items = parseDateRanges(back).filter((r) => r.class === HLS_CLASS.item);
    expect(items.map((r) => `${new Date(r.start).toISOString().slice(11, 19)} ${r.attributes.code} ${r.attributes.identCode ?? ""}`.trim())).toEqual(["06:09:55 SID OPN", "06:10:00 PGM"]);

    const aired = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const fromOff = aired.filter((r) => r.startedAt >= new Date("2026-10-06T06:01:00Z"));
    expect(fromOff.map((r) => `${hms(r.startedAt)} ${r.code} ${r.reason}`)).toEqual(["06:01:00 CLS planned", "06:01:06 OPEN slate", "06:09:55 OPN planned"]);
    expect(fromOff[1].assetId).toBe(card.id);

    // The as-run log through the API: OPN and CLS as identCode, beside SID for apps built before.
    const asRun = await owner.get(`/v1/stations/${stationId}/as-run?from=2026-10-06T06:00:00.000Z&to=2026-10-06T06:11:00.000Z`).expect(200);
    const rows = asRun.body as Array<{ code: string; identCode?: string | null; title: string; startedAt: string }>;
    expect(rows.filter((r) => r.identCode).map((r) => `${r.startedAt.slice(11, 19)} ${r.code} ${r.identCode} ${r.title}`)).toEqual(["06:01:00 SID CLS OPAL goodnight", "06:09:55 SID OPN Automatic opener"]);
  }, 60_000);

  it("leaves billing alone: no spots settled, no live hours, nothing charged", async () => {
    const live = await h.services.playout.liveAired(new Date("2026-10-06T00:00:00Z"), new Date("2026-10-07T00:00:00Z"));
    expect(live.filter((l) => l.stationId === stationId)).toEqual([]);
    const idents = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId));
    expect(idents.filter((r) => r.code === "OPN" || r.code === "CLS").every((r) => r.airingId === null && r.carriageAgreementId === null)).toBe(true);
    expect((await h.services.ledger.stationEarnings(stationId, "month")).account.availableMicros).toBe(0);
    const rows = await h.services.playout.programRows({ endedFrom: new Date("2026-10-06T00:00:00Z"), endedTo: new Date("2026-10-07T00:00:00Z"), stationIds: [stationId] });
    expect(rows.every((r) => r.startedAt.toISOString() !== "2026-10-06T06:01:00.000Z" && r.startedAt.toISOString() !== "2026-10-06T06:09:55.000Z")).toBe(true);
  });
});
