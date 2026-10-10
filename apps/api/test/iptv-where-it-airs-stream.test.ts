// Programming Phase 6 in other apps, for real: a carried program the maker cleared for Opencast only
// plays in another app (here FFmpeg, as VLC and the IPTV apps read HLS) as the station's "Airing on
// Opencast, channel 12.1" slate, for the program's length, between the station's own programs. The
// engine prepares the slate ahead (its log has a program not cleared for other apps) and assembles
// the channel (FFmpeg, the ladder shrunk tenfold, real time, about 45 s); a local server answers
// `/hls/…` as the API does, and FFmpeg reads the `via=iptv` playlist from it, straight through.
import { execFile, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { elsewhereSlateKey } from "../src/v1/modules/playout/engine/stationId.js";
import { createHarness, itemFixture, market, prepareQueued, stationFixture, testClip, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let dir: string;
let t0: number;
let beat: { id: string };
let server: http.Server;
let base: string;

/** The mean of a frame's pixels, red, green and blue, 0 to 255. */
function meanColour(png: string) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", png, "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1 << 20 });
  const [red, green, blue] = [...r.stdout];
  return { red, green, blue };
}

/** An FFmpeg tool run beside the test (never blocking it: the server here answers what it reads). */
function run(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 60_000, maxBuffer: 1 << 24 }, (error, stdout) => resolve({ code: error ? Number((error as { code?: number }).code ?? 1) || 1 : 0, stdout: String(stdout) }));
  });
}

/** `/hls/…` as the API's server.ts answers it: playlists, the slate's re-timed segments, and stored objects. */
function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://local");
  const send = (body: Buffer | string | null, type: string) => (body === null ? res.writeHead(404).end() : res.writeHead(200, { "content-type": type }).end(body));
  const playlist = /^\/hls\/([0-9a-f-]{36})\/([a-z0-9]+\.m3u8)$/.exec(url.pathname);
  const elsewhere = /^\/hls\/elsewhere\/([\w-]+)\/([a-z0-9]+)\/(\d+)-(\d+)\.ts$/.exec(url.pathname);
  const object = /^\/objects\/(prepared\/[\w/.-]+)$/.exec(url.pathname);
  const via = url.searchParams.get("via");
  const work = playlist
    ? h.services.playout.playlist(playlist[1], playlist[2], via ? { via, ip: "127.0.0.1", userAgent: "Lavf" } : undefined).then((p) => send(p?.body ?? null, "application/vnd.apple.mpegurl"))
    : elsewhere
      ? h.services.playout.elsewhereSegment(elsewhere[1], elsewhere[2], Number(elsewhere[3]), Number(elsewhere[4])).then((b) => send(b, "video/mp2t"))
      : object
        ? fs.readFile(path.join(h.deps.config.storageRoot, "objects", object[1])).then((b) => send(b, "video/mp2t"))
        : Promise.resolve(send(null, ""));
  work.catch(() => res.writeHead(500).end());
}

beforeAll(async () => {
  server = http.createServer(serve);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h = await createHarness({ realTime: true, publicBase: base });
  dir = process.env.DEMO_DIR ?? (await fs.mkdtemp(path.join(os.tmpdir(), "opencast-iptv-clearance-")));
  await fs.mkdir(dir, { recursive: true });
  const [own, film, more] = await Promise.all([testClip(12), testClip(12), testClip(12)]);
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const dee = await h.signIn("Dee");
  const reel = await stationFixture(h, { callSign: "REEL", ownerId: dee.id, marketId: m.id, tenths: 241, signedOn: true });
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  await kai.put(`/v1/stations/${beat.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] }).expect(200);
  const programId = (await dee.post(`/v1/stations/${reel.id}/programs`, { title: "Night Reel" }).expect(201)).body.id;
  const episode = await itemFixture(h, reel.id, { title: "Night Reel 1", programId, episodeNumber: 1, durationMs: 12_000, location: film });
  const show = await itemFixture(h, beat.id, { title: "Beat Tape", durationMs: 12_000, location: own });
  const after = await itemFixture(h, beat.id, { title: "Beat Tape 2", durationMs: 12_000, location: more });
  // The maker clears it for Opencast only.
  const offer = await dee
    .post(`/v1/programs/${programId}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 120_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true, outlets: ["opencast"] })
    .expect(201);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const asked = await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: yesterday }).expect(201);
  const agreementId = asked.body.agreementId as string;

  // Far enough ahead for everything to be prepared first.
  t0 = Math.ceil((Date.now() + 60_000) / 4_000) * 4_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: at(0), endsAt: at(12), itemId: show.id }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: at(12), endsAt: at(24), itemId: episode.id, carriageAgreementId: agreementId }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: at(24), endsAt: at(36), itemId: after.id }).expect(201);
  // Then planned off air: the playlist ends, and FFmpeg reads it to the end.
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "off_air", startsAt: at(36), endsAt: at(4 * 3600) }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { ladderScale: 0.1, preset: "ultrafast", log: () => undefined });
  // The readiness check queues the programs and, for the carried one, the other apps' slates.
  await engine.sweep();
  // (The other station's generated station ID is queued by the engine's first tick and becomes
  // ready while the channel airs: this one's run sheet never went without it, so it isn't planned
  // again.)
  await prepareQueued(h, engine.preparer);
}, 150_000);

afterAll(async () => {
  await engine?.stopAll();
  await h?.close();
  server?.close();
});

describe("another app tuned to the station", () => {
  it("plays the Airing on Opencast slate for a carried program not cleared for other apps, and the station's own as aired", async () => {
    // Prepared ahead of air, from the log alone.
    const ident = (await h.services.stations.idents([beat.id])).get(beat.id)!;
    const look = { callSign: ident.callSign, channel: ident.channel, name: ident.name, homeCity: ident.homeCity ?? null, colour: ident.colour ?? null };
    for (const seconds of [1, 2, 3, 4]) expect(engine.preparer.isReady(elsewhereSlateKey(look, "tv", seconds), "tv")).toBe(true);

    // On air just before the first program: the slates for open time before it are short ones,
    // made as it goes (a long run-up of them, prepared one by one, would put the channel behind).
    while (Date.now() < t0 - 3_000) await new Promise((r) => setTimeout(r, 250));
    // Until the closer after the third program is on.
    while (Date.now() < t0 + 42_000) {
      await engine.tick();
      await new Promise((r) => setTimeout(r, 1_000 - (Date.now() % 1_000)));
    }
    const iptv = await (await fetch(`${base}/hls/${beat.id}/v720.m3u8?via=iptv`)).text();
    const plain = await (await fetch(`${base}/hls/${beat.id}/v720.m3u8`)).text();
    await fs.writeFile(path.join(dir, "stream-v720-plain.m3u8"), plain);
    await fs.writeFile(path.join(dir, "stream-v720-iptv.m3u8"), iptv);
    const swapped = iptv.split("\n").filter((l) => l.includes("/hls/elsewhere/"));
    expect(swapped).toHaveLength(3);
    expect(plain).not.toContain("/hls/elsewhere/");
    // The same sequences and discontinuities as the plain playlist.
    const head = (p: string) => p.split("\n").filter((l) => /^#EXT-X-(MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|DISCONTINUITY$)/.test(l) || l.startsWith("#EXT-X-PROGRAM-DATE-TIME"));
    expect(head(iptv)).toEqual(head(plain));

    // FFmpeg reads the iptv playlist from the server, as an app would (run beside this process, so
    // the server can answer it).
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", `${base}/hls/${beat.id}/v720.m3u8?via=iptv`]);
    expect(probe.code).toBe(0);
    const probed = JSON.parse(probe.stdout) as { streams: Array<{ codec_type: string }> };
    expect(probed.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
    // And copies it through from its first segment, everything published, as a recording app would.
    const published = iptv.split("\n").filter((l) => l.startsWith("#EXTINF:")).reduce((t, l) => t + Number(l.slice(8, -1)), 0);
    const file = path.join(dir, "stream-iptv.ts");
    const copy = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-live_start_index", "0", "-i", `${base}/hls/${beat.id}/v720.m3u8?via=iptv`, "-t", String(Math.floor(published - 2)), "-c", "copy", file]);
    expect(copy.code).toBe(0);
    expect((await fs.stat(file)).size).toBeGreaterThan(0);
    // A slate segment, re-timed: its timestamps carry on from the one before.
    const starts: number[] = [];
    for (const uri of swapped) {
      const pts = (await run("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "packet=pts_time", "-of", "csv=p=0", uri])).stdout.split("\n").map(parseFloat).filter(Number.isFinite);
      starts.push(Math.min(...pts));
    }
    expect(starts[1] - starts[0]).toBeCloseTo(4, 1);
    expect(starts[2] - starts[1]).toBeCloseTo(4, 1);

    // A frame from each segment around it: the station's own program (the test pattern), then the
    // slate in the station's colour (#8C3B7A, white words) for the carried one's 12 s, then its own again.
    const uris = iptv.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => new URL(l, `${base}/hls/${beat.id}/`).toString());
    const first = uris.findIndex((u) => u.includes("/hls/elsewhere/"));
    const frame = async (uri: string, name = "frame.png") => {
      const png = path.join(dir, name);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", uri, "-frames:v", "1", png]);
      return png;
    };
    const around = uris.slice(first - 3, first + 6);
    const looks: Array<{ uri: string; slate: boolean }> = [];
    for (const uri of around) {
      const c = meanColour(await frame(uri));
      looks.push({ uri, slate: c.red > c.green + 40 && c.blue > c.green + 20 });
    }
    await fs.rm(path.join(dir, "frame.png"), { force: true });
    expect(looks.map((l) => l.slate)).toEqual([false, false, false, true, true, true, false, false, false]);
    await frame(around[1], "stream-iptv-own-frame.png");
    await frame(around[4], "stream-iptv-slate-frame.png");
    await fs.writeFile(path.join(dir, "stream-iptv-frames.txt"), `a frame from each segment around the carried program (slate = the station's colour):\n${looks.map((l) => `${l.slate ? "slate  " : "program"} ${l.uri.replace(base, "")}`).join("\n")}\nthe slate segments' first picture timestamps: ${starts.map((s) => s.toFixed(3)).join(", ")}\nffprobe of the iptv playlist: ${probe.stdout.replace(/\s+/g, " ")}\n`);
  }, 180_000);
});
