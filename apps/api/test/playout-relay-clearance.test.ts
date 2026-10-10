// Programming Phase 6, for real: a carried program the maker didn't clear for relays (its offer's
// outlets: Opencast only) airs on the station's relay as the station's "Airing on Opencast, channel
// 12.1" slate, for the program's length, between the station's own programs, which go as aired. The
// relay sender reads the channel the engine assembles (FFmpeg, the ladder shrunk tenfold, real time,
// about 45 s) and sends to a local output that keeps what it's sent; the swap is read from the
// sender's counts and log, and the picture from a frame of what it sent.
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import type { ChannelLook } from "../src/v1/modules/playout/engine/assemble.js";
import type { RelayOutput } from "../src/v1/modules/playout/engine/fanout.js";
import { StationSender } from "../src/v1/modules/playout/engine/sender.js";
import { Slates } from "../src/v1/modules/playout/engine/slates.js";
import { createHarness, itemFixture, market, prepareQueued, stationFixture, testClip, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let dir: string;
let t0: number;
let carry: { id: string };
const lines: string[] = [];
const sent: Buffer[] = [];
const output: RelayOutput = {
  write: (chunk) => void sent.push(chunk),
  bytes: () => sent.reduce((t, b) => t + b.length, 0),
  destinations: 1
};

/** The mean of a frame's pixels, red, green and blue, 0 to 255. */
function meanColour(png: string) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", png, "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1 << 20 });
  const [red, green, blue] = [...r.stdout];
  return { red, green, blue };
}

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  dir = process.env.DEMO_DIR ?? (await fs.mkdtemp(path.join(os.tmpdir(), "opencast-relay-clearance-")));
  await fs.mkdir(dir, { recursive: true });
  const [own, film] = await Promise.all([testClip(12), testClip(12)]);
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const dee = await h.signIn("Dee");
  const reel = await stationFixture(h, { callSign: "REEL", ownerId: dee.id, marketId: m.id, tenths: 241, signedOn: true });
  carry = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  // No breaks: each program fills its slot.
  await kai.put(`/v1/stations/${carry.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] }).expect(200);
  const programId = (await dee.post(`/v1/stations/${reel.id}/programs`, { title: "Night Reel" }).expect(201)).body.id;
  const episode = await itemFixture(h, reel.id, { title: "Night Reel 1", programId, episodeNumber: 1, durationMs: 12_000, location: film });
  const show = await itemFixture(h, carry.id, { title: "Beat Tape", durationMs: 12_000, location: own });
  // The maker clears it for Opencast only.
  const offer = await dee
    .post(`/v1/programs/${programId}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 120_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true, outlets: ["opencast"] })
    .expect(201);
  // From yesterday, wherever the market's day is now.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const asked = await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: carry.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: yesterday }).expect(201);
  const agreementId = asked.body.agreementId as string;
  expect(agreementId).toBeTruthy();

  t0 = Math.ceil((Date.now() + 20_000) / 4_000) * 4_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  // Its own program, the carried one, its own again: 12 s each.
  await kai.post(`/v1/stations/${carry.id}/log`, { kind: "program", startsAt: at(0), endsAt: at(12), itemId: show.id }).expect(201);
  await kai.post(`/v1/stations/${carry.id}/log`, { kind: "program", startsAt: at(12), endsAt: at(24), itemId: episode.id, carriageAgreementId: agreementId }).expect(201);
  await kai.post(`/v1/stations/${carry.id}/log`, { kind: "program", startsAt: at(24), endsAt: at(36), itemId: show.id }).expect(201);
  // Then planned off air, so nothing fills dead air (and re-plans the channel) while it relays.
  await kai.post(`/v1/stations/${carry.id}/log`, { kind: "off_air", startsAt: at(36), endsAt: at(4 * 3600) }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId: carry.id, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { ladderScale: 0.1, preset: "ultrafast", log: () => undefined });
  await engine.sweep();
  await prepareQueued(h, engine.preparer);
}, 150_000);

afterAll(async () => {
  await engine?.stopAll();
  await h.close();
});

describe("a relay", () => {
  it("shows the Airing on Opencast slate for a carried program not cleared for relays, and the station's own as aired", async () => {
    const look = (await h.services.stations.look(carry.id)) as unknown as ChannelLook;
    const slates = new Slates(path.join(h.deps.config.storageRoot, "slates"));
    const sender = new StationSender({ deps: h.deps, services: h.services }, carry.id, { relayMode: "everything", breakHandling: "air_spots", bugOnRelays: false, partnerAds: false }, output, {
      look,
      preparer: engine.preparer,
      slates,
      log: (line) => void lines.push(line),
      scratchDir: dir
    });
    // The slate prepared before air, as the sender would the first time.
    await engine.preparer.slate(await slates.airingOnOpencast(look), 4, "tv");
    let started = false;
    while (Date.now() < t0 + 44_000) {
      await engine.tick();
      if (!started && Date.now() >= t0 - 1_000) {
        sender.start();
        started = true;
      }
      await new Promise((r) => setTimeout(r, 1_000 - (Date.now() % 1_000)));
    }
    await sender.stop();

    // The carried program's 12 s went as three segments of the slate; nothing else did.
    expect(sender.elsewhereSegments).toBe(3);
    expect(sender.slateSegments).toBe(0);
    expect(lines.filter((l) => l.includes("isn't cleared for relays"))).toEqual([`[relay BEAT] Night Reel isn't cleared for relays (not in carriage): the "Airing on Opencast" slate in its place for 12 s`]);

    // What the platform received, a frame a second: the station's own program (the test pattern),
    // then the slate in the station's colour (#8C3B7A, with white words) where the carried one aired.
    const file = path.join(dir, "relay-sent.ts");
    await fs.writeFile(file, Buffer.concat(sent));
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    const duration = Number(probe.stdout.trim());
    expect(duration).toBeGreaterThan(24);
    const frame = (seconds: number, name = "frame.png") => {
      const png = path.join(dir, name);
      spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(seconds), "-i", file, "-frames:v", "1", png]);
      return png;
    };
    const looks: Array<{ at: number; slate: boolean }> = [];
    for (let s = 1; s < duration; s += 2) {
      const c = meanColour(frame(s));
      looks.push({ at: s, slate: c.red > c.green + 40 && c.blue > c.green + 20 });
    }
    const program = looks.findIndex((l) => !l.slate);
    const slateAfter = looks.findIndex((l, i) => i > program && l.slate);
    expect(program).toBeGreaterThanOrEqual(0);
    expect(slateAfter).toBeGreaterThan(program);
    // About 12 s of it (a frame every 2 s).
    expect(looks.slice(slateAfter).filter((l) => l.slate).length).toBeGreaterThanOrEqual(4);
    await fs.rm(path.join(dir, "frame.png"), { force: true });
    frame(looks[program].at, "relay-own-frame.png");
    frame(looks[slateAfter].at + 2, "relay-slate-frame.png");
    await fs.copyFile(await slates.airingOnOpencast(look), path.join(dir, "airing-on-opencast-slate.png"));
    await fs.writeFile(path.join(dir, "relay-log.txt"), [...lines, "", `frames (every 2 s, slate = the station's colour): ${looks.map((l) => `${l.at}s ${l.slate ? "slate" : "program"}`).join(", ")}`, `segments sent as the Airing on Opencast slate: ${sender.elsewhereSegments}`].join("\n") + "\n");
  }, 120_000);
});
