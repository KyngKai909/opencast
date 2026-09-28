// A station on air for real: ffmpeg in real time, HLS out, the as-run log written,
// the spot paid for from it. About 45 seconds.
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, itemFixture, market, stationFixture, testClip, type Harness } from "./harness.js";

let h: Harness;
let stationId: string;
let t0: number;
const logs: string[] = [];

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  const [program, spot] = await Promise.all([testClip(8), testClip(15)]);
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const jess = await h.signIn("Jess");
  const station = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  stationId = station.id;
  const a = await itemFixture(h, stationId, { title: "Late Crate", durationMs: 8_000, location: program });
  t0 = Math.ceil((Date.now() + 4_000) / 1000) * 1000;
  // A 30-second slot for an 8-second item: a 22-second break after it. Then a 10-second slot.
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: new Date(t0).toISOString(), endsAt: new Date(t0 + 30_000).toISOString(), itemId: a.id }).expect(201);
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: new Date(t0 + 30_000).toISOString(), endsAt: new Date(t0 + 40_000).toISOString(), itemId: a.id }).expect(201);

  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
  const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: 50_000_000, fundingSourceId: card.body[0].id }).expect(201);
  const s = await jess
    .post(`/v1/businesses/${b.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: 4_000_000 }, budget: { totalMicros: 40_000_000, dailyCapMicros: 8_000_000 }, code: { code: "ORANGE10", offer: "10% off", windowDays: 7 } })
    .expect(201);
  await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, location: spot, durationMs: 15_000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
  await kai.put(`/v1/stations/${stationId}/rotations/main`, { spotIds: [s.body.id] }).expect(200);
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
}, 120_000);

afterAll(() => h.close());

describe("on air", () => {
  it("airs the evening in real time and writes what actually aired", async () => {
    const engine = createEngine({ deps: h.deps, services: h.services }, { log: (l) => logs.push(l) });
    while (Date.now() < t0 + 42_000) {
      await engine.tick();
      await new Promise((r) => setTimeout(r, 1000));
    }
    await engine.stopAll();

    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const fromT0 = rows.filter((r) => r.startedAt.getTime() >= t0 - 500);
    // The station ID slate hold absorbs lateness (spots air in full from the top), so it can shrink to nothing.
    const aired = fromT0.filter((r) => r.code !== "OPEN");
    const shape = aired.map((r) => `${r.code} ${Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000)}`);
    // Program, then the break (spot, station ID), then the next program.
    expect(shape.slice(0, 4).map((s) => s.split(" ")[0])).toEqual(["PGM", "SPT", "SID", "PGM"]);
    const seconds = (i: number) => Number(shape[i].split(" ")[1]);
    expect(seconds(0)).toBeGreaterThanOrEqual(7);
    expect(seconds(1)).toBe(15);
    // Things started on time, to within a couple of seconds.
    expect(Math.abs(aired[0].startedAt.getTime() - t0)).toBeLessThan(2_500);
    expect(Math.abs(aired[3].startedAt.getTime() - (t0 + 30_000))).toBeLessThan(2_500);
    // Before t0 the station was on air with nothing on the log: station ID and bumpers, never nothing.
    expect(rows.filter((r) => r.startedAt.getTime() < t0 - 500).every((r) => r.reason === "station_id_fill")).toBe(true);

    // The spot was paid for from the as-run log, and has its proof frame.
    const spot = aired[1];
    expect(spot.airingId).toBeTruthy();
    expect(spot.proofFrameUrl).toBeTruthy();
    await fs.access(spot.proofFrameUrl!);
    const earnings = await h.services.ledger.stationEarnings(stationId, "month");
    expect(earnings.account.availableMicros).toBe(4_000_000);
  }, 120_000);

  it("wrote one continuous HLS stream, with the break cued", async () => {
    const dir = path.join(h.deps.config.storageRoot, "hls", stationId);
    const playlist = await fs.readFile(path.join(dir, "index.m3u8"), "utf8");
    expect(playlist).toContain("#EXT-X-PROGRAM-DATE-TIME");
    expect(playlist).not.toContain("#EXT-X-DISCONTINUITY");
    const segments = (await fs.readdir(dir)).filter((f) => f.endsWith(".ts"));
    expect(segments.length).toBeGreaterThan(3);
    const [brk] = await h.db.select().from(schema.breaks).where(eq(schema.breaks.stationId, stationId));
    h.clock.set(new Date(brk.startsAt.getTime() + 5_000).toISOString());
    const cued = await h.services.playout.playlistWithCues(stationId);
    expect(cued).toMatch(new RegExp(`#EXT-X-DATERANGE:ID="${brk.id}".*SCTE35-OUT=0xFC`));
  });
});
