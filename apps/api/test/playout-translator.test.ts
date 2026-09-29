// Translators for real: the worker reads the channel's own segments and pushes them over RTMP to
// local sinks (FFmpeg listening; never a real destination). Stream-copied where nothing is drawn,
// the station ID slate in place of breaks where the station chose it, re-encoded with the bug
// composited where the station shows one; egress recorded per translator. Real time, about 40 s.
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, itemFixture, market, prepareQueued, stationFixture, testClip, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let dir: string;
let t0: number;
const sinks: Array<{ name: string; port: number; file: string; child: ChildProcess; done: Promise<void> }> = [];
const translators: Record<string, string> = {};

function sink(name: string, port: number) {
  const file = path.join(dir, `${name}.flv`);
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-i", `rtmp://127.0.0.1:${port}/live/${name}`, "-c", "copy", "-f", "flv", file], { stdio: "ignore" });
  const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
  sinks.push({ name, port, file, child, done });
}

async function probe(file: string) {
  return new Promise<{ duration: number; codecs: string[] }>((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "json", file]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => {
      try {
        const json = JSON.parse(out) as { format?: { duration?: string }; streams?: Array<{ codec_name: string }> };
        resolve({ duration: Number(json.format?.duration ?? 0), codecs: (json.streams ?? []).map((s) => s.codec_name).sort() });
      } catch {
        resolve({ duration: 0, codecs: [] });
      }
    });
  });
}

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-relay-"));
  const [program, ident, bumper] = await Promise.all([testClip(12), testClip(4), testClip(8)]);
  const m = await market(h);
  const kai = await h.signIn("Kai");
  // Bug off (stream-copied) and bug on (composited).
  const plain = await stationFixture(h, { callSign: "COPY", name: "Copy", ownerId: kai.id, marketId: m.id, tenths: 151, signedOn: true });
  const bugged = await stationFixture(h, { callSign: "BUGS", name: "Bugs", ownerId: kai.id, marketId: m.id, tenths: 161, signedOn: true });
  await h.db.update(schema.stations).set({ bugMode: "off" }).where(eq(schema.stations.id, plain.id));
  t0 = Math.ceil((Date.now() + 10_000) / 4_000) * 4_000;
  for (const station of [plain, bugged]) {
    await kai.put(`/v1/stations/${station.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] }).expect(200);
    await itemFixture(h, station.id, { title: "Ident", code: "SID", durationMs: 4_000, location: ident });
    await itemFixture(h, station.id, { title: "Bumper", code: "BMP", durationMs: 8_000, location: bumper });
    const show = await itemFixture(h, station.id, { title: "Show", durationMs: 12_000, location: program });
    // 12 s of program in a 24-second slot: a 12-second break after it.
    await kai.post(`/v1/stations/${station.id}/log`, { kind: "program", startsAt: new Date(t0).toISOString(), endsAt: new Date(t0 + 24_000).toISOString(), itemId: show.id }).expect(201);
    await kai.post(`/v1/stations/${station.id}/log`, { kind: "program", startsAt: new Date(t0 + 24_000).toISOString(), endsAt: new Date(t0 + 48_000).toISOString(), itemId: show.id }).expect(201);
    await h.db.insert(schema.playoutState).values({ stationId: station.id, onAir: true });
  }
  const add = async (stationId: string, name: string, port: number, breakHandling: "air_spots" | "station_id_slate") => {
    sink(name, port);
    const [t] = await h.db.insert(schema.translators).values({ stationId, service: "rtmp", name, rtmpUrl: `rtmp://127.0.0.1:${port}/live`, streamKey: name, breakHandling }).returning();
    translators[name] = t.id;
  };
  await add(plain.id, "copy", 19361, "air_spots");
  await add(plain.id, "swap", 19362, "station_id_slate");
  await add(bugged.id, "bug", 19363, "air_spots");
  engine = createEngine({ deps: h.deps, services: h.services }, { ladderScale: 0.1, preset: "ultrafast", log: () => undefined });
  // Everything prepared before the stations go on air.
  await engine.sweep();
  await prepareQueued(h, engine.preparer);
}, 120_000);

afterAll(async () => {
  await engine?.stopAll();
  for (const s of sinks) s.child.kill("SIGKILL");
  await h.close();
});

describe("translators", () => {
  it("relay the channel over RTMP while they're on, and record what they sent", async () => {
    while (Date.now() < t0 + 30_000) {
      await engine.tick();
      await new Promise((r) => setTimeout(r, 1_000));
    }
    await engine.stopAll();
    await Promise.race([Promise.all(sinks.map((s) => s.done)), new Promise((r) => setTimeout(r, 10_000))]);

    const sessions = await h.db.select().from(schema.translatorSessions);
    const by = (name: string) => sessions.filter((s) => s.translatorId === translators[name]);
    expect(by("copy")[0]).toMatchObject({ mode: "copy", swapsBreaks: false });
    expect(by("swap")[0]).toMatchObject({ mode: "copy", swapsBreaks: true });
    expect(by("bug")[0]).toMatchObject({ mode: "composite", swapsBreaks: false });
    for (const name of ["copy", "swap", "bug"]) {
      // Egress, per translator.
      expect(by(name).reduce((a, s) => a + s.bytesSent, 0)).toBeGreaterThan(10_000);
      expect(by(name).every((s) => s.endedAt !== null)).toBe(true);
      // What arrived plays, picture and sound, for most of the time it ran.
      const { duration, codecs } = await probe(sinks.find((s) => s.name === name)!.file);
      expect(codecs).toEqual(["aac", "h264"]);
      expect(duration).toBeGreaterThan(20);
    }
  }, 120_000);
});
