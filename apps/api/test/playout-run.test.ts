// A station's evening, prepared with FFmpeg (the ladder shrunk tenfold) and assembled on a frozen
// clock: a program and its break (a spot with its code, bumpers, station ID), a carried program
// with a barter break (the producer's spot in its share), dead air filled from the library, a
// planned sign-off and the station back on. Checks the as-run log it produced, the money it moved,
// the spots' proof frames (from the published segments, with the bug), and that FFmpeg can play
// the playlist it wrote straight through its discontinuities.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, itemFixture, market, prepareQueued, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let engine: Engine;
let kai: User;
let beat: { id: string };
let reel: { id: string };
let agreementId: string;
let snapshot = "";
const $ = (d: number) => Math.round(d * 1_000_000);

async function runUntil(iso: string, stepMs = 2_000, each?: () => Promise<void>) {
  const end = Date.parse(iso);
  while (h.clock.now().getTime() < end) {
    h.clock.advance(Math.min(stepMs, end - h.clock.now().getTime()));
    await engine.tick();
    await prepareQueued(h, engine.preparer);
    await each?.();
  }
  await h.deps.bus.settle();
}

async function spot(owner: User, businessId: string, title: string, file: string, code?: string) {
  const s = await owner
    .post(`/v1/businesses/${businessId}/spots`, { title, lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(12) }, ...(code ? { code: { code, offer: "10% off", windowDays: 7 } } : {}) })
    .expect(201);
  const { cid } = await h.services.library.content.store(file, { storageClass: "standard" });
  await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, contentId: cid, durationMs: 15_000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
  return s.body.id as string;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:50.000Z");
  const [program, spotClip, bumper, ident, film] = await Promise.all([testClip(20), testClip(15), testClip(8), testClip(4), testClip(21)]);
  const m = await market(h);
  kai = await h.signIn("Kai");
  const jess = await h.signIn("Jess");
  const reelOwner = await h.signIn("Reel");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  reel = await stationFixture(h, { callSign: "REEL", name: "Reel", ownerId: reelOwner.id, marketId: m.id, tenths: 141, signedOn: true });
  const rule = { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 600_000, sameSpotPerHour: 4, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] };
  await kai.put(`/v1/stations/${beat.id}/break-rule`, rule).expect(200);
  await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 4_000, location: ident });
  await itemFixture(h, beat.id, { title: "Back to the reel", code: "BMP", durationMs: 8_000, location: bumper });
  const crate = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 20_000, location: program });

  // REEL's program, carried by BEAT under barter: half of each hour's break time is REEL's.
  const reelProgram = await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title: "Saturday Reel", description: "Films." }).expect(201);
  const episode = await itemFixture(h, reel.id, { programId: reelProgram.body.id, title: "Reel 1", durationMs: 21_000, location: film });
  const offer = await reelOwner
    .post(`/v1/programs/${reelProgram.body.id}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 1_800_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true })
    .expect(201);
  await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 4, time: "20:01" }], startsOn: "2026-10-01" }).expect(201);
  agreementId = (await kai.get(`/v1/stations/${beat.id}/carriage/agreements`).expect(200)).body.carrying[0].id;

  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
  const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
  await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [await spot(jess, b.body.id, "Fall menu", spotClip, "ORANGE10")] }).expect(200);
  const reelSpot = await spot(jess, b.body.id, "Reel sponsor", spotClip);
  await h.db.insert(schema.rotations).values({ stationId: reel.id, kind: "main" }).onConflictDoNothing();
  const [rotation] = await h.db.select().from(schema.rotations).where(eq(schema.rotations.stationId, reel.id));
  await h.db.insert(schema.rotationSpots).values({ rotationId: rotation.id, spotId: reelSpot, position: 0 });

  // 3:00 Late Crate and its break; 3:01 Saturday Reel (carried); 3:02 nothing (dead air); 3:03 to 3:06 off air; 3:06 back.
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", endsAt: "2026-10-02T03:01:00.000Z", itemId: crate.id }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:01:00.000Z", endsAt: "2026-10-02T03:02:00.000Z", itemId: episode.id, carriageAgreementId: agreementId }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "off_air", startsAt: "2026-10-02T03:03:00.000Z", endsAt: "2026-10-02T03:06:00.000Z" }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:06:00.000Z", endsAt: "2026-10-02T03:07:00.000Z", itemId: crate.id }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });

  engine = createEngine({ deps: h.deps, services: h.services }, { ladderScale: 0.1, preset: "ultrafast", translators: false, log: () => undefined });
  await engine.tick();
  await prepareQueued(h, engine.preparer);
}, 120_000);

afterAll(async () => {
  await engine?.stopAll();
  await h.close();
});

describe("an evening, prepared once and assembled", () => {
  it("airs the log and writes what aired", async () => {
    await runUntil("2026-10-02T03:02:50.000Z", 2_000, async () => {
      if (h.clock.now().getTime() === Date.parse("2026-10-02T03:02:50.000Z")) snapshot = (await h.services.playout.playlist(beat.id, "v360.m3u8"))!.body;
    });
    await runUntil("2026-10-02T03:05:40.000Z", 10_000);
    await runUntil("2026-10-02T03:06:30.000Z", 2_000);
    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, beat.id)).orderBy(asc(schema.asRun.startedAt));
    const evening = rows.filter((r) => r.startedAt >= new Date("2026-10-02T03:00:00Z"));
    const at = (iso: string) => evening.find((r) => r.startedAt.toISOString() === iso);
    expect(at("2026-10-02T03:00:00.000Z")).toMatchObject({ code: "PGM", reason: "planned", endedAt: new Date("2026-10-02T03:00:20.000Z") });
    // The break: a bumper into it (since 2026-09-29), then the spot.
    expect(at("2026-10-02T03:00:20.000Z")).toMatchObject({ code: "BMP", endedAt: new Date("2026-10-02T03:00:28.000Z") });
    expect(at("2026-10-02T03:00:28.000Z")).toMatchObject({ code: "SPT", endedAt: new Date("2026-10-02T03:00:43.000Z") });
    expect(at("2026-10-02T03:01:00.000Z")).toMatchObject({ code: "PGM", carriageAgreementId: agreementId });
    // The carried episode's barter break: the producer's spot first.
    const reelSpot = evening.find((r) => r.code === "SPT" && r.startedAt > new Date("2026-10-02T03:01:00Z"))!;
    expect(reelSpot.startedAt.getTime()).toBeLessThan(Date.parse("2026-10-02T03:02:00Z"));
    // Dead air, filled from the library.
    expect(at("2026-10-02T03:02:00.000Z")).toMatchObject({ code: "PGM", reason: "dead_air_fill" });
    // Off air: the slate, nothing while dark, the station ID, then the program.
    expect(evening.filter((r) => r.startedAt >= new Date("2026-10-02T03:03:00Z")).map((r) => `${r.startedAt.toISOString().slice(11, 19)} ${r.code} ${r.reason}`)).toEqual([
      "03:03:00 OPEN slate",
      "03:05:56 SID planned",
      "03:06:00 PGM planned",
      // Its break opens with a bumper (since 2026-09-29), published by 3:06:30.
      "03:06:20 BMP planned"
    ]);
    // Never silent otherwise.
    const before = evening.filter((r) => r.startedAt < new Date("2026-10-02T03:03:00Z"));
    for (let i = 1; i < before.length; i++) expect(before[i].startedAt.getTime()).toBe(before[i - 1].endedAt.getTime());

    // Billing read it: each station earned its spots ($4 an airing), the producer its barter share.
    const aired = evening.filter((r) => r.code === "SPT");
    const producer = aired.filter((r) => r.startedAt > new Date("2026-10-02T03:01:00Z") && r.startedAt < new Date("2026-10-02T03:02:00Z"));
    expect(producer).toHaveLength(1);
    expect((await h.services.ledger.stationEarnings(reel.id, "month")).account.availableMicros).toBe($(4));
    expect((await h.services.ledger.stationEarnings(beat.id, "month")).account.availableMicros).toBe($(4) * (aired.length - 1));
  }, 120_000);

  it("took each spot's proof frame from its published segment, with the bug", async () => {
    const spots = await h.db.select().from(schema.asRun).where(eq(schema.asRun.code, "SPT"));
    expect(spots.length).toBeGreaterThanOrEqual(2);
    for (const s of spots) {
      expect(s.proofFrameUrl).toMatch(new RegExp(`/objects/proof/${beat.id}/${s.airingId}\\.jpg$`));
      const file = path.join(h.deps.config.storageRoot, "objects", "proof", beat.id, `${s.airingId}.jpg`);
      const probe = await new Promise<string>((resolve) => {
        const child = spawn("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", file]);
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("close", () => resolve(out.trim()));
      });
      expect(probe).toBe("mjpeg,128,72");
    }
  });

  it("wrote a playlist FFmpeg plays straight through, discontinuities and all", async () => {
    expect(snapshot).toContain("#EXT-X-DISCONTINUITY");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-play-"));
    const local = snapshot.replace(/^\/objects\//gm, `${path.join(h.deps.config.storageRoot, "objects")}/`) + "#EXT-X-ENDLIST\n";
    await fs.writeFile(path.join(dir, "v360.m3u8"), local);
    const expected = [...snapshot.matchAll(/#EXTINF:([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-v", "error", "-stats_period", "0.5", "-progress", "pipe:1", "-protocol_whitelist", "file,crypto,data", "-i", path.join(dir, "v360.m3u8"), "-f", "null", "-"]);
      let stderr = "";
      let progress = "";
      child.stdout.on("data", (d) => (progress += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code: code ?? 1, stderr: stderr + progress }));
    });
    expect(result.code).toBe(0);
    const frames = Number([...result.stderr.matchAll(/^frame=(\d+)/gm)].pop()![1]);
    // Every published second decoded (30 frames a second), give or take a frame per item.
    expect(Math.abs(frames / 30 - expected)).toBeLessThan(3);
    await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);
});
