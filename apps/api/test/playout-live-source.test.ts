// Reading a live source's HLS as Livepeer serves it, found running the Phase 5 evening against a
// real Livepeer stream (docs/phase-5-demo.md): the playback address redirects to a regional node
// with relative URIs; before the encoder connects it answers a playlist with no media
// ("#EXT-X-ERROR: Stream open failed"); its master lists the source first and the transcoded
// renditions once they're made; and a source that reconnects comes back as a new session.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { livepeerProfiles } from "../src/livepeer.js";
import { BAND_RENDITIONS, FPS, LADDER } from "../src/v1/modules/playout/engine/ladder.js";
import { LiveHlsSource } from "../src/v1/modules/playout/engine/live.js";

let server: http.Server;
let origin: string;
let clock = 0;
const state = { live: false, renditions: false, session: "a", firstSeq: 0, segmentMs: 2_000, frozenAt: null as number | null };

function media(prefix: string) {
  const newest = state.firstSeq + Math.floor((state.frozenAt ?? clock) / state.segmentMs);
  const seconds = (state.segmentMs / 1000).toFixed(6);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${state.segmentMs / 1000}`, `#EXT-X-MEDIA-SEQUENCE:${newest - 2}`];
  for (let i = newest - 2; i <= newest; i++) lines.push(`#EXTINF:${seconds},`, `${prefix}-${i}.ts?tkn=${state.session}`);
  return lines.join("\r\n") + "\r\n";
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    // The playback address sends players to a regional node.
    if (url === "/hls/pb/index.m3u8") return void res.writeHead(307, { location: "/node/video+pb/index.m3u8" }).end();
    if (url === "/node/video+pb/index.m3u8") {
      if (!state.live) return void res.end("#EXTM3U\r\n#EXT-X-ERROR: Stream open failed\r\n#EXT-X-ENDLIST\r\n");
      const lines = ["#EXTM3U", '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3200000,RESOLUTION=1920x1080,FRAME-RATE=30,CODECS="avc1.42c028,mp4a.40.2"', `0_1/index.m3u8?tkn=${state.session}`];
      if (state.renditions) {
        for (const [i, [w, h, b]] of [[1920, 1080, 5500000], [1280, 720, 3100000], [854, 480, 1500000], [640, 360, 900000]].entries()) {
          lines.push(`#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=${b},RESOLUTION=${w}x${h},FRAME-RATE=30,CODECS="avc1.64001f,mp4a.40.2"`, `1_${i}/index.m3u8?tkn=${state.session}`);
        }
      }
      return void res.end(lines.join("\r\n") + "\r\n");
    }
    const m = /^\/node\/video\+pb\/(\d_\d)\/index\.m3u8\?tkn=(\w+)$/.exec(url);
    if (m && state.live && m[2] === state.session) return void res.end(media(m[1]));
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function pollAt(source: LiveHlsSource, ms: number) {
  clock = ms;
  await source.poll();
}

describe("a live source through Livepeer", () => {
  it("is created at the TV ladder's video renditions", () => {
    expect(livepeerProfiles().map((p) => [p.name, p.width, p.height, p.bitrate, p.fps, p.gop])).toEqual([
      ["1080p", 1920, 1080, 5_000_000, FPS, "4.0"],
      ["720p", 1280, 720, 2_800_000, FPS, "4.0"],
      ["480p", 854, 480, 1_400_000, FPS, "4.0"],
      ["360p", 640, 360, 800_000, FPS, "4.0"]
    ]);
    expect(livepeerProfiles().map((p) => `${p.width}x${p.height}`)).toEqual(BAND_RENDITIONS.tv.filter((r) => LADDER[r].kind === "video").map((r) => `${LADDER[r].width}x${LADDER[r].height}`));
  });

  it("connects once the encoder does, though it answered 'Stream open failed' first", async () => {
    Object.assign(state, { live: false, renditions: false, session: "a", firstSeq: 0, segmentMs: 2_000, frozenAt: null });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, BAND_RENDITIONS.tv, LADDER, () => clock);
    await pollAt(source, 1_000);
    await pollAt(source, 2_000);
    expect(source.connected()).toBe(false);
    state.live = true;
    await pollAt(source, 4_000);
    expect(source.connected()).toBe(true);
    // Relative to the node it was sent to, not the playback address.
    expect(source.after(null)[0].uris.v720).toBe(`${origin}/node/video+pb/0_1/0_1-2.ts?tkn=a`);
  });

  it("reads each rendition from Livepeer's of the same size once they're listed", async () => {
    Object.assign(state, { live: true, renditions: false, session: "b", firstSeq: 0, segmentMs: 2_000, frozenAt: null });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, BAND_RENDITIONS.tv, LADDER, () => clock);
    await pollAt(source, 10_000);
    // The source only, for now: every rendition reads it.
    expect(source.after(null)[0].uris.v360).toContain("/0_1/");
    state.renditions = true;
    await pollAt(source, 16_000);
    const edge = source.after(null)[0].uris;
    expect(edge.v1080).toContain("/1_0/");
    expect(edge.v720).toContain("/1_1/");
    expect(edge.v480).toContain("/1_2/");
    expect(edge.v360).toContain("/1_3/");
  });

  it("follows the source into a new session when it reconnects", async () => {
    Object.assign(state, { live: true, renditions: false, session: "c", firstSeq: 100, segmentMs: 2_000, frozenAt: null });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, BAND_RENDITIONS.tv, LADDER, () => clock);
    await pollAt(source, 20_000);
    expect(source.after(null)[0].seq).toBe(110);
    // The encoder drops, and comes back: new addresses, and the media sequence from 0.
    state.live = false;
    await pollAt(source, 30_000);
    await pollAt(source, 40_000);
    expect(source.connected()).toBe(false);
    Object.assign(state, { live: true, session: "d", firstSeq: -20 });
    await pollAt(source, 44_000);
    await pollAt(source, 46_000);
    expect(source.connected()).toBe(true);
    expect(source.after(null)[0].uris.v720).toContain("tkn=d");
  });

  it("waits three of the source's segments before calling it lost (Livepeer's 4-second ones arrive unevenly)", async () => {
    Object.assign(state, { live: true, renditions: false, session: "e", firstSeq: 0, segmentMs: 4_000, frozenAt: null });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, BAND_RENDITIONS.tv, LADDER, () => clock);
    await pollAt(source, 40_000);
    expect(source.connected()).toBe(true);
    // Nothing new for 10 s: late, not lost.
    state.frozenAt = 40_000;
    await pollAt(source, 45_000);
    await pollAt(source, 50_000);
    expect(source.connected()).toBe(true);
    await pollAt(source, 53_000);
    expect(source.connected()).toBe(false);
  });
});
