// A radio station's relay background, and spot codes where the picture leaves Opencast's players.
//
//   - The background is uploaded (an image, a GIF, a short video) and prepared once into a loop at
//     the relay's size; replacing it lets the last one go; TV stations, other files and long
//     videos are refused.
//   - Radio relays air the station's sound over the loop with the bug (or, without a background,
//     over its colour with its call sign and channel), stream-copied, to local RTMP sinks (never
//     a real destination), and draw a spot's code, offer and QR for its last 10 s.
//   - A TV relay draws the code into the segments it shows in.
//
// The relays are the relay service's (the relay runner, pushing to each sink directly), since
// follow-up Phase 3; the worker's engine only airs the channels.
//
// Real FFmpeg and real time, about two minutes.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { PlatformsSeam, RelayDestination } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import type { StationSender } from "../src/v1/modules/playout/engine/sender.js";
import { createRelayRunner, type RelayRunner } from "../src/v1/modules/relays/runner.js";
import { relayFrame } from "../src/v1/modules/stations/relayBackground.js";
import { createHarness, itemFixture, market, prepareQueued, radioTenths, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let engine: Engine;
let runner: RelayRunner;
let kai: User;
let dir: string;
let t0: number;
const ids: Record<"wave" | "nite" | "tube", string> = { wave: "", nite: "", tube: "" };
/** Each station's one destination (the platforms seam, stubbed): its local sink. */
const destinations = new Map<string, RelayDestination[]>();
const platforms: PlatformsSeam = {
  destinationsFor: async (stationId) => destinations.get(stationId) ?? [],
  prepareNextBroadcast: async () => null,
  endBroadcast: async () => undefined,
  setPaidPromotion: async () => ({ applied: false })
};
const sinks: Array<{ name: string; file: string; child: ChildProcess; done: Promise<void> }> = [];
const $ = (d: number) => Math.round(d * 1_000_000);
const at = (s: number) => new Date(t0 + s * 1000).toISOString();

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}

function probe(file: string): { codecs: string[]; width: number; height: number; frames: number; duration: number } {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=codec_name,width,height,nb_read_packets,codec_type:format=duration", "-of", "json", file], { encoding: "utf8" });
  const json = JSON.parse(r.stdout || "{}") as { streams?: Array<{ codec_name: string; codec_type: string; width?: number; height?: number; nb_read_packets?: string }>; format?: { duration?: string } };
  const video = json.streams?.find((s) => s.codec_type === "video");
  return { codecs: (json.streams ?? []).map((s) => s.codec_name).sort(), width: video?.width ?? 0, height: video?.height ?? 0, frames: Number(video?.nb_read_packets ?? 0), duration: Number(json.format?.duration ?? 0) };
}

/** Every frame's colour at one point (x, y) of a video, one a second. */
function pixels(file: string, x: number, y: number): Array<[number, number, number]> {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `fps=2,format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1 << 24 });
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < r.stdout.length; i += 3) out.push([r.stdout[i], r.stdout[i + 1], r.stdout[i + 2]]);
  return out;
}

function sink(name: string, port: number) {
  const file = path.join(dir, `${name}.flv`);
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-i", `rtmp://127.0.0.1:${port}/live/${name}`, "-c", "copy", "-f", "flv", file], { stdio: "ignore" });
  const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
  sinks.push({ name, file, child, done });
}

const upload = (stationId: string, file: string) => request(h.app).put(`/v1/stations/${stationId}/relay-background`).set("authorization", `Bearer ${kai.token}`).attach("file", file);

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-relay-bg-"));
  // The files: a green picture, a short GIF, a short video, one too long, and not a picture at all.
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x00C000:s=640x480", "-frames:v", "1", path.join(dir, "green.png")]);
  ffmpeg(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=0.6", path.join(dir, "spin.gif")]);
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=3", "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "short.mp4")]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=64x48:rate=5:duration=35", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "long.mp4")]);
  await fs.writeFile(path.join(dir, "notes.txt"), "not a picture");
  // What airs: solid colours with a tone, so the pictures can be told apart.
  ffmpeg(["-f", "lavfi", "-i", "color=c=0xC0C0C0:s=320x180:rate=30:duration=12", "-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "show.mp4")]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=0xC0C0C0:s=320x180:rate=30:duration=15", "-f", "lavfi", "-i", "sine=frequency=550:duration=15", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "spot.mp4")]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=0xC0C0C0:s=320x180:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=660:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "ident.mp4")]);

  const m = await market(h);
  kai = await h.signIn("Kai");
  ids.wave = (await stationFixture(h, { callSign: "WAVE", name: "Wave", ownerId: kai.id, marketId: m.id, tenths: await radioTenths(h, 0), band: "radio", signedOn: true, colour: "#1F4E9A" })).id;
  ids.nite = (await stationFixture(h, { callSign: "NITE", name: "Nite", ownerId: kai.id, marketId: m.id, tenths: await radioTenths(h, 1), band: "radio", signedOn: true, colour: "#7A2E8C" })).id;
  ids.tube = (await stationFixture(h, { callSign: "TUBE", name: "Tube", ownerId: kai.id, marketId: m.id, tenths: 141, signedOn: true })).id;
  // TUBE's relay is stream-copied (no bug): the code is drawn into its segments on its own.
  await h.db.update(schema.stations).set({ bugMode: "off" }).where(eq(schema.stations.id, ids.tube));
}, 120_000);

afterAll(async () => {
  await runner?.stopAll();
  await engine?.stopAll();
  for (const s of sinks) s.child.kill("SIGKILL");
  await h.close();
});

describe("a radio station's relay background", () => {
  it("is prepared once from an image, a GIF or a short video, into a loop at the relay's size", async () => {
    const size = relayFrame();
    const cases: Array<[string, "image" | "gif" | "video", number]> = [
      ["spin.gif", "gif", 2_400],
      ["short.mp4", "video", 3_000],
      ["green.png", "image", 2_000]
    ];
    const cids: string[] = [];
    for (const [file, kind, ms] of cases) {
      const res = await upload(ids.wave, path.join(dir, file)).expect(200);
      expect(res.body).toMatchObject({ kind, fileName: file, status: "preparing", loopUrl: null });
      await h.services.stations.settleRelayBackgrounds();
      const got = await kai.get(`/v1/stations/${ids.wave}/relay-background`).expect(200);
      expect(got.body.background).toMatchObject({ kind, status: "ready", error: null, width: size.width, height: size.height, durationMs: ms });
      expect(got.body.background.loopUrl).toMatch(/\/relay-backgrounds\/b[a-z2-7]+-\d+x\d+\/loop\.mp4$/);
      expect(got.body.background.stillUrl).toMatch(/still\.jpg$/);
      const [row] = await h.db.select().from(schema.relayBackgrounds).where(eq(schema.relayBackgrounds.stationId, ids.wave));
      cids.push(row.contentId);
      // H.264 at the relay's size, 30 fps, no sound: what the relay lays under the station's sound.
      const loop = path.join(dir, `loop-${kind}.mp4`);
      const chunks: Buffer[] = [];
      for await (const c of await h.deps.storage.objects.open!(`${row.loopKey}/loop.mp4`)) chunks.push(c as Buffer);
      await fs.writeFile(loop, Buffer.concat(chunks));
      const info = probe(loop);
      expect(info).toMatchObject({ codecs: ["h264"], width: size.width, height: size.height, frames: Math.round((ms / 1000) * 30) });
      expect(await h.deps.storage.objects.has(`${row.loopKey}/still.jpg`)).toBe(true);
    }
    // Each replaced upload was let go: only the image is still referenced.
    const refs = await h.db.select().from(schema.contentRefs).where(and(eq(schema.contentRefs.owner, "relay_background"), eq(schema.contentRefs.ownerId, ids.wave)));
    expect(refs.map((r) => r.cid)).toEqual([cids[2]]);
    expect(await h.deps.storage.objects.has(cids[0])).toBe(false);
  }, 120_000);

  it("is for radio stations, and takes pictures and short videos only", async () => {
    await upload(ids.tube, path.join(dir, "green.png")).expect(409);
    const wrong = await upload(ids.nite, path.join(dir, "notes.txt")).expect(422);
    expect(wrong.body.error.code).toBe("wrong_file_type");
    const long = await upload(ids.nite, path.join(dir, "long.mp4")).expect(422);
    expect(long.body.error.code).toBe("too_long");
    // Removing one goes back to the station's colour.
    await upload(ids.nite, path.join(dir, "short.mp4")).expect(200);
    await h.services.stations.settleRelayBackgrounds();
    await kai.delete(`/v1/stations/${ids.nite}/relay-background`).expect(200);
    expect((await kai.get(`/v1/stations/${ids.nite}/relay-background`).expect(200)).body).toEqual({ background: null });
  }, 60_000);
});

describe("relays of radio and TV stations", () => {
  it("air the sound over the background (or the station's colour) with the bug, and a spot's code for its last 10 s", async () => {
    t0 = Math.ceil((Date.now() + 40_000) / 4_000) * 4_000;
    const jess = await h.signIn("Jess");
    const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [(await h.db.select().from(schema.markets))[0].id] }).expect(201);
    const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
    await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
    const s = await jess.post(`/v1/businesses/${b.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(20) }, code: { code: "WAVE10", offer: "10% off a latte", windowDays: 7 } }).expect(201);
    const { cid } = await h.services.library.content.store(path.join(dir, "spot.mp4"), { storageClass: "standard" });
    await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, contentId: cid, durationMs: 15_000 });
    await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
    const ports: Record<string, number> = { wave: 19371, nite: 19372, tube: 19373 };
    for (const name of ["wave", "nite", "tube"] as const) {
      const stationId = ids[name];
      await kai.put(`/v1/stations/${stationId}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 20_000, spotMsPerHour: 600_000, sameSpotPerHour: 6, fillOrder: ["SPT", "SID"], openTimeTo: "spot_market", blockedCategories: [] }).expect(200);
      await kai.put(`/v1/stations/${stationId}/rotations/main`, { spotIds: [s.body.id] }).expect(200);
      await itemFixture(h, stationId, { title: "Ident", code: "SID", durationMs: 4_000, location: path.join(dir, "ident.mp4") });
      const show = await itemFixture(h, stationId, { title: "Show", durationMs: 12_000, location: path.join(dir, "show.mp4") });
      // 12 s of program in a 32-second slot: a 20-second break after it (the spot, then the station ID).
      await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: at(0), endsAt: at(32), itemId: show.id }).expect(201);
      await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: at(32), endsAt: at(56), itemId: show.id }).expect(201);
      sink(name, ports[name]);
      destinations.set(stationId, [{ platformId: name, kind: "custom", rtmpUrl: `rtmp://127.0.0.1:${ports[name]}/live`, streamKey: name, connected: false }]);
      await kai.patch(`/v1/stations/${stationId}/relay`, { mode: "everything" }).expect(200);
      await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
    }
    engine = createEngine({ deps: h.deps, services: h.services }, { ladderScale: 0.25, preset: "ultrafast", log: () => undefined });
    runner = createRelayRunner({ deps: h.deps, services: h.services }, { platforms, livepeer: null, fanOut: "direct", ladderScale: 0.25, preset: "ultrafast", log: () => undefined });
    await engine.tick();
    await engine.sweep();
    await prepareQueued(h, engine.preparer);

    while (Date.now() < t0 + 50_000) {
      await engine.tick();
      await runner.tick();
      await prepareQueued(h, engine.preparer);
      await new Promise((r) => setTimeout(r, 1_000 - (Date.now() % 1_000)));
    }
    const sender = (id: string) => runner.sender(id) as StationSender | null;
    const drew = {
      wave: new Map(sender(ids.wave)?.pictureFrames ?? []),
      nite: new Map(sender(ids.nite)?.pictureFrames ?? []),
      tube: sender(ids.tube)?.codeSegments ?? 0
    };
    await runner.stopAll();
    await engine.stopAll();
    await Promise.race([Promise.all(sinks.map((x) => x.done)), new Promise((r) => setTimeout(r, 10_000))]);

    const sessions = await h.db.select().from(schema.translatorSessions);
    // One sender per station: its sessions carry the station's ID.
    const by = (name: string) => sessions.filter((x) => x.translatorId === ids[name as keyof typeof ids]);
    // Radio relays: nothing encoded while relaying (the picture is prepared), so stream-copied.
    expect(by("wave")[0]).toMatchObject({ mode: "copy" });
    expect(by("nite")[0]).toMatchObject({ mode: "copy" });
    expect(by("tube")[0]).toMatchObject({ mode: "copy" });
    const { width, height } = engine.preparer.ladder.v720;
    for (const name of ["wave", "nite", "tube"]) {
      expect(by(name).reduce((a, x) => a + x.bytesSent, 0)).toBeGreaterThan(10_000);
      const info = probe(sinks.find((x) => x.name === name)!.file);
      expect(info.codecs).toEqual(["aac", "h264"]);
      expect(info.width).toBe(width);
      expect(info.duration).toBeGreaterThan(30);
    }

    // WAVE: its green background; NITE: its colour (the station ID picture), each with the code for about 10 s.
    const middle = (name: string) => pixels(sinks.find((x) => x.name === name)!.file, Math.round(width * 0.25), Math.round(height * 0.2));
    const green = middle("wave").filter(([r, g, bl]) => g > 150 && r < 80 && bl < 80).length;
    expect(green / middle("wave").length).toBeGreaterThan(0.6);
    const purple = middle("nite").filter(([r, g, bl]) => r > 80 && r < 160 && g < 80 && bl > 100).length;
    expect(purple / middle("nite").length).toBeGreaterThan(0.6);
    // The code's loop, from the keyframe nearest its start to the one nearest its end.
    for (const loops of [drew.wave, drew.nite]) {
      const code = [...loops].find(([k]) => k.startsWith("code:WAVE10"))?.[1] ?? 0;
      expect(code).toBeGreaterThanOrEqual(240);
      expect(code).toBeLessThanOrEqual(360);
    }
    // In the picture: the code's panel (the screen colour, a dark blue, at 85%) where the player
    // puts it, bottom left, for its 10 s (two samples a second).
    const u = width / 1920;
    const panel = { x: Math.round(width * 0.06 + 20 * u), y: Math.round(height * 0.93 - 98 * u) };
    const dark = (name: string) => pixels(sinks.find((x) => x.name === name)!.file, panel.x, panel.y).filter(([r, g, bl]) => bl > r + 10 && bl > 20 && r + g + bl < 200).length / 2;
    for (const name of ["wave", "nite", "tube"]) {
      expect(dark(name), name).toBeGreaterThanOrEqual(7);
      expect(dark(name), name).toBeLessThanOrEqual(13);
    }
    // TV: drawn into the three segments the spot's last 10 s are in.
    expect(drew.tube).toBe(3);
  }, 240_000);
});
