// Planned off air in the assembled channel (a radio-band station, so the ladder is AAC 128k and
// 64k): the sign-off slate, then the playlist ends with #EXT-X-ENDLIST and nothing is written or
// logged as aired while the station is dark; at the back time a new playlist starts from the
// station ID. No FFmpeg: items are "prepared" by a fake transcoder, on a frozen clock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let stationId: string;

async function runUntil(iso: string, stepMs = 2_000) {
  const end = Date.parse(iso);
  while (h.clock.now().getTime() < end) {
    h.clock.advance(Math.min(stepMs, end - h.clock.now().getTime()));
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }
}
const playlist = async (file = "a128.m3u8") => (await h.services.playout.playlist(stationId, file))?.body ?? null;
const rows = () => h.db.select().from(schema.channelItems).where(eq(schema.channelItems.stationId, stationId)).orderBy(asc(schema.channelItems.seq));

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T05:59:52.000Z");
  const m = await market(h);
  const owner = await h.signIn("Nite");
  stationId = (await stationFixture(h, { callSign: "NITE", name: "Night Radio", ownerId: owner.id, marketId: m.id, tenths: 882, band: "radio", signedOn: true })).id;
  await owner
    .put(`/v1/stations/${stationId}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] })
    .expect(200);
  await itemFixture(h, stationId, { title: "NITE ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const show = await itemFixture(h, stationId, { title: "Night Desk", durationMs: 56_000, location: await dummyFile() });
  await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-02T06:00:00.000Z", endsAt: "2026-10-02T06:01:00.000Z", itemId: show.id }).expect(201);
  await owner.post(`/v1/stations/${stationId}/log`, { kind: "off_air", startsAt: "2026-10-02T06:01:00.000Z", endsAt: "2026-10-02T06:10:00.000Z" }).expect(201);
  await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-02T06:10:00.000Z", endsAt: "2026-10-02T06:11:00.000Z", itemId: show.id }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), translators: false });
  await engine.tick();
  await prepareQueued(h, engine.preparer);
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  await h.close();
});

describe("off air in the assembled channel", () => {
  it("airs the radio band's renditions only", async () => {
    await runUntil("2026-10-02T06:00:30.000Z");
    const master = (await playlist("master.m3u8"))!;
    expect(master.split("\n").filter((l) => l.endsWith(".m3u8"))).toEqual(["a128.m3u8", "a64.m3u8"]);
    expect(await h.services.playout.playlist(stationId, "v720.m3u8")).toBeNull();
    // No picture on the radio band: no bug, no codes.
    expect(parseDateRanges((await playlist())!).some((r) => r.class === HLS_CLASS.bug)).toBe(false);
  }, 30_000);

  it("ends the playlist after the sign-off slate, with when it's back", async () => {
    await runUntil("2026-10-02T06:02:10.000Z");
    const ended = (await playlist())!;
    expect(ended.trimEnd().endsWith("#EXT-X-ENDLIST")).toBe(true);
    const signOff = parseDateRanges(ended).find((r) => r.class === HLS_CLASS.signOff)!;
    expect(new Date(signOff.start).toISOString()).toBe("2026-10-02T06:01:00.000Z");
    expect(signOff.attributes.backAt).toBe("2026-10-02T06:10:00.000Z");
    expect(ended).toContain("#EXT-X-PROGRAM-DATE-TIME:2026-10-02T06:01:00.000Z");

    // Dark: the same ended playlist, nothing new written or logged as aired.
    await runUntil("2026-10-02T06:08:00.000Z", 30_000);
    expect(await playlist()).toBe(ended);
    const all = await rows();
    expect(all.filter((r) => r.startsAt > new Date("2026-10-02T06:02:00Z") && r.startsAt < new Date("2026-10-02T06:09:56Z"))).toEqual([]);
    expect(all.find((r) => r.kind === "end")!.startsAt.toISOString()).toBe("2026-10-02T06:02:00.000Z");
  }, 30_000);

  it("starts a new playlist from the station ID at the back time", async () => {
    await runUntil("2026-10-02T06:09:40.000Z", 10_000);
    await runUntil("2026-10-02T06:10:10.000Z");
    const back = (await playlist())!;
    expect(back).not.toContain("#EXT-X-ENDLIST");
    const items = parseDateRanges(back).filter((r) => r.class === HLS_CLASS.item);
    expect(items.map((r) => `${new Date(r.start).toISOString().slice(11, 19)} ${r.attributes.code}`)).toEqual(["06:09:56 SID", "06:10:00 PGM"]);
    // Numbering carries on from the last playlist.
    const all = await rows();
    const end = all.find((r) => r.kind === "end")!;
    const sequence = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(back)![1]);
    expect(sequence).toBe(end.seq);
    expect(Number(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/.exec(back)![1])).toBeGreaterThan(end.disc);

    // What aired: the program, its break, the slate; nothing while dark; then the station ID.
    const aired = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const fromSix = aired.filter((r) => r.startedAt >= new Date("2026-10-02T06:00:00Z"));
    expect(fromSix.map((r) => `${r.startedAt.toISOString().slice(11, 19)} ${r.code} ${r.reason}`)).toEqual(["06:00:00 PGM planned", "06:00:56 SID planned", "06:01:00 OPEN slate", "06:09:56 SID planned"]);
  }, 30_000);
});
