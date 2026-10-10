// A radio station's live block for real, through the worker (never Livepeer): FFmpeg pushes a
// sine tone over RTMP to the worker's own ingest with the live source's key, and the worker
// packages it into the channel's AAC 128k and 64k on 4-second segments. The block stands by until
// the encoder connects, airs it, cues a break (a held spot, settled from the as-run, and the
// station ID), goes back to it, stands by once the encoder stops, and hands back to the log. A
// wrong key is refused. Real time, about two minutes.
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, itemFixture, market, prepareQueued, radioTenths, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let engine: Engine;
let kai: User;
let stationId: string;
let sourceId: string;
let streamKey: string;
let liveEntryId: string;
let t0: number;
const $ = (d: number) => Math.round(d * 1_000_000);
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const logs: string[] = [];

/** FFmpeg sending a sine tone to the worker's ingest, as an encoder would, for `seconds`. */
function push(key: string, seconds: number): { child: ChildProcess; done: Promise<number> } {
  const url = `rtmp://127.0.0.1:${engine.ingest!.port}/live/${key}`;
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(seconds), "-c:a", "aac", "-b:a", "128k", "-f", "flv", url], { stdio: "ignore" });
  const done = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
  return { child, done };
}

async function probe(file: string) {
  return new Promise<{ codecs: string[]; sampleRate: number; duration: number }>((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate:format=duration", "-of", "json", file]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => {
      const json = JSON.parse(out || "{}") as { streams?: Array<{ codec_name: string; sample_rate?: string }>; format?: { duration?: string } };
      resolve({ codecs: (json.streams ?? []).map((s) => s.codec_name), sampleRate: Number(json.streams?.[0]?.sample_rate ?? 0), duration: Number(json.format?.duration ?? 0) });
    });
  });
}

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  // Everything is prepared before it airs: the timeline starts a little way off.
  t0 = Math.ceil((Date.now() + 45_000) / 4_000) * 4_000;
  const [program, ident, spotClip] = await Promise.all([testClip(12, "audio"), testClip(4, "audio"), testClip(15, "audio")]);
  const m = await market(h);
  kai = await h.signIn("Kai");
  const jess = await h.signIn("Jess");
  const station = await stationFixture(h, { callSign: "WAVE", name: "Wave", ownerId: kai.id, marketId: m.id, tenths: await radioTenths(h), band: "radio", signedOn: true });
  stationId = station.id;
  // A cued break is 20 s: the spot, then the station ID.
  await kai.put(`/v1/stations/${stationId}/break-rule`, { mode: "none", everyMinutes: null, lengthMs: 20_000, spotMsPerHour: 600_000, sameSpotPerHour: 6, fillOrder: ["SPT", "SID"], openTimeTo: "spot_market", blockedCategories: [] }).expect(200);
  await itemFixture(h, stationId, { title: "WAVE ident", code: "SID", durationMs: 4_000, location: ident });
  const show = await itemFixture(h, stationId, { title: "Before and after", durationMs: 12_000, location: program });
  // The encoder, with Opencast's own key (radio never goes through Livepeer).
  const added = await kai.post(`/v1/stations/${stationId}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201);
  sourceId = added.body.source.id;
  streamKey = added.body.streamKey;
  const [liveProgram] = await h.db.insert(schema.programs).values({ stationId, title: "Wave Live", isLive: true }).returning();
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: at(0), endsAt: at(12), itemId: show.id }).expect(201);
  const live = await kai.post(`/v1/stations/${stationId}/log`, { kind: "live", startsAt: at(12), endsAt: at(84), liveSourceId: sourceId, programId: liveProgram.id }).expect(201);
  liveEntryId = live.body.id;
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: at(84), endsAt: at(96), itemId: show.id }).expect(201);

  // A spot in the station's rotation, with a code, paid per airing.
  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
  const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
  const s = await jess.post(`/v1/businesses/${b.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(12) }, code: { code: "WAVE10", offer: "10% off a latte", windowDays: 7 } }).expect(201);
  const { cid } = await h.services.library.content.store(spotClip, { storageClass: "standard" });
  await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, contentId: cid, durationMs: 15_000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
  await kai.put(`/v1/stations/${stationId}/rotations/main`, { spotIds: [s.body.id] }).expect(200);

  engine = createEngine({ deps: h.deps, services: h.services }, { ingest: { port: 0 }, log: (line) => logs.push(line) });
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
  await engine.tick();
  await engine.sweep();
  await prepareQueued(h, engine.preparer);
}, 120_000);

afterAll(async () => {
  await engine?.stopAll();
  await h.close();
});

describe("a radio live block through the worker", () => {
  let during = "";
  let during64 = "";
  let refused = -1;
  const standingBy: Array<{ at: number; standingBy: boolean }> = [];

  it("stands by, airs the encoder, cues a break and comes back, stands by again, and hands back to the log", async () => {
    let pushed: ReturnType<typeof push> | null = null;
    let wrong: ReturnType<typeof push> | null = null;
    let cued = false;
    while (Date.now() < t0 + 100_000) {
      const s = (Date.now() - t0) / 1000;
      if (!wrong && s >= 14) {
        // Someone with the wrong key is refused.
        wrong = push("not-a-key", 3);
        void wrong.done.then((code) => (refused = code));
      }
      if (!pushed && s >= 22) pushed = push(streamKey, 48);
      if (!cued && s >= 38) {
        cued = true;
        await kai.post(`/v1/stations/${stationId}/cue-break`).expect(202);
      }
      await engine.tick();
      await prepareQueued(h, engine.preparer);
      // (Inside the block by a second or two: the channel runs a fraction of a second off the log.)
      if (s >= 14 && s < 82) {
        const [state] = await h.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, stationId));
        standingBy.push({ at: s, standingBy: state.standingBy });
      }
      // From 12 s after the push, until the first live segment is listed (a slow machine takes a
      // few seconds more to connect and cut one); the playlist keeps it in its window after that.
      if (s >= 34 && s < 80 && !/\/prepared\/live-[\w-]+\/a64\//.test(during64)) {
        during = (await h.services.playout.playlist(stationId, "a128.m3u8"))?.body ?? "";
        during64 = (await h.services.playout.playlist(stationId, "a64.m3u8"))?.body ?? "";
      }
      await new Promise((r) => setTimeout(r, 1_000 - (Date.now() % 1_000)));
    }
    await pushed?.done;
    await h.deps.bus.settle();

    const all = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const rows = all.filter((r) => r.startedAt.getTime() >= t0 - 1_000);
    const summary = all.map((r) => `${((r.startedAt.getTime() - t0) / 1000).toFixed(1)}s to ${((r.endedAt.getTime() - t0) / 1000).toFixed(1)}s ${r.code} ${r.reason}${r.airingId ? " (held)" : ""}`);
    expect(rows[0], summary.join("\n")).toMatchObject({ code: "PGM", reason: "planned" });
    // Never silent: each thing starts where the last ended.
    for (let i = 1; i < rows.length; i++) expect(rows[i].startedAt.getTime(), summary.join("\n")).toBe(rows[i - 1].endedAt.getTime());
    const liveRows = rows.filter((r) => r.reason === "live");
    expect(liveRows.every((r) => r.liveSourceId === sourceId && r.logEntryId === liveEntryId && r.code === "PGM")).toBe(true);
    // Stand-by until the encoder connected (at 22 s), on air from it within a few seconds.
    const firstLive = liveRows[0];
    expect(rows.slice(1, rows.indexOf(firstLive)).every((r) => r.reason === "slate"), summary.join("\n")).toBe(true);
    expect((firstLive.startedAt.getTime() - t0) / 1000, summary.join("\n")).toBeGreaterThanOrEqual(22);
    expect((firstLive.startedAt.getTime() - t0) / 1000, summary.join("\n")).toBeLessThan(34);
    // The cued break: the held spot, then the station ID, then back to the encoder.
    const spot = rows.find((r) => r.code === "SPT");
    expect(spot, summary.join("\n")).toMatchObject({ reason: "rotation" });
    expect(spot!.airingId).toBeTruthy();
    const afterBreak = liveRows.find((r) => r.startedAt > spot!.startedAt);
    expect(afterBreak, summary.join("\n")).toBeTruthy();
    expect(rows.slice(rows.indexOf(spot!), rows.indexOf(afterBreak!)).map((r) => r.code), summary.join("\n")).toContain("SID");
    expect(spot!.startedAt.getTime()).toBeGreaterThan(firstLive.startedAt.getTime());
    // Once the encoder stopped (at 70 s), stand-by to the block's end, then the log again.
    const lastLive = liveRows[liveRows.length - 1];
    const tail = rows.slice(rows.indexOf(lastLive) + 1);
    expect(tail[0], summary.join("\n")).toMatchObject({ reason: "slate" });
    // (The channel runs a fraction of a second off the log's times: its slates are whole seconds.)
    // (The stand-by stops a second or so short of the block's end, so its last piece is a short slate.)
    const back = tail.find((r) => r.reason !== "slate");
    expect(back, summary.join("\n")).toMatchObject({ code: "PGM", reason: "planned" });
    expect(Math.abs(back!.startedAt.getTime() - (t0 + 84_000)), summary.join("\n")).toBeLessThan(1_000);
    expect(standingBy[0].standingBy).toBe(true);
    expect(standingBy.some((x) => !x.standingBy)).toBe(true);
    expect(standingBy[standingBy.length - 1].standingBy).toBe(true);

    // Held and billed from the as-run, as for a recorded block.
    const [airing] = await h.db.select().from(schema.airings).where(eq(schema.airings.id, spot!.airingId!));
    expect(airing.holdId).toBeTruthy();
    const settled = await h.db.select().from(schema.entries).where(and(eq(schema.entries.kind, "settle"), eq(schema.entries.sourceId, spot!.id)));
    expect(settled).toHaveLength(1);
    // The spot's code rides in the radio channel's playlist too, for its last 10 s.
    const [spotRow] = await h.db.select().from(schema.channelItems).where(eq(schema.channelItems.asRunId, spot!.id));
    const code = parseDateRanges(spotRow.tags.join("\n")).find((r) => r.class === HLS_CLASS.code);
    expect(code?.attributes).toMatchObject({ code: "WAVE10", offer: "10% off a latte" });
    expect(code!.end! - code!.start).toBe(10_000);
    expect(refused).not.toBe(0);
    expect(logs.some((l) => /refused a publisher/.test(l))).toBe(true);
  }, 180_000);

  it("points the channel's playlists at the worker's own segments, AAC 128k and 64k, with a discontinuity and the live tag", async () => {
    const lines = during.split("\n");
    const firstLive = lines.findIndex((l) => /\/prepared\/live-[\w-]+\/a128\/seg_\d{5}\.ts$/.test(l));
    expect(firstLive, during).toBeGreaterThan(-1);
    const before = lines.slice(0, firstLive).reverse();
    expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeGreaterThan(-1);
    expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeLessThan(before.findIndex((l) => l.endsWith(".ts")));
    expect(parseDateRanges(during).find((r) => r.class === HLS_CLASS.live)?.attributes).toMatchObject({ logEntryId: liveEntryId, sourceId });
    expect(during64).toMatch(/\/prepared\/live-[\w-]+\/a64\/seg_\d{5}\.ts/);
    // What's stored is the band's own: AAC at 48 kHz, about four seconds a segment.
    const key = /(prepared\/live-[\w-]+\/a128\/seg_\d{5}\.ts)/.exec(lines[firstLive])![1];
    const file = path.join(os.tmpdir(), `radio-live-${Date.now()}.ts`);
    await fs.writeFile(file, Buffer.concat(await (async () => {
      const chunks: Buffer[] = [];
      for await (const c of await h.deps.storage.objects.open!(key)) chunks.push(c as Buffer);
      return chunks;
    })()));
    const info = await probe(file);
    await fs.rm(file, { force: true });
    expect(info.codecs).toEqual(["aac"]);
    expect(info.sampleRate).toBe(48_000);
    expect(info.duration).toBeGreaterThan(3.5);
    expect(info.duration).toBeLessThan(4.5);
  });

  it("records what packaging the sound cost, per live hour", async () => {
    const { live } = await engine.stats();
    expect(live.sessions).toBeGreaterThanOrEqual(1);
    expect(live.liveSeconds).toBeGreaterThan(30);
    expect(live.cpuSecondsPerLiveHour).not.toBeNull();
    console.log(`[radio live] ${live.liveSeconds} s live, ${live.cpuSeconds} s of CPU: ${live.cpuSecondsPerLiveHour} CPU-seconds per live hour`);
  });
});
