// Serves the mock stations (generate-streams.mjs) as live HLS: each station's 60-second loop
// plays forever on the wall clock, in a sliding window of segments, so a player joins wherever
// the "broadcast" is, mid-program, exactly as it will with real stations.
//
//   /<slug>/master.m3u8   video (or audio) and a caption rendition
//   /<slug>/live.m3u8     the media playlist, a sliding window
//   /<slug>/subs.m3u8     the caption playlist, the same window
//   /<slug>/seg_NNN.ts, /<slug>/sub_NNN.vtt
//
// Use it as Connect/Vite middleware: server.middlewares.use("/mock-hls", mockLiveHls()).
// Options: `latencyMs` delays every playlist and segment, to feel a slow network.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MOCK_STREAMS_DIR = path.resolve(here, "../.mock-streams");

/**
 * The media playlist for absolute segment number `last` (the newest available one).
 * Segment k plays loop file k mod n; a new loop is a discontinuity, so each loop is its own
 * discontinuity sequence (k div n).
 */
export function slidingWindow({ last, n, window, segmentSeconds, file }) {
  const first = Math.max(0, last - window + 1);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${segmentSeconds}`,
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / n)}`
  ];
  for (let k = first; k <= last; k++) {
    if (k !== first && k % n === 0) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${segmentSeconds.toFixed(3)},`, file(k % n));
  }
  return lines.join("\n") + "\n";
}

export function mockLiveHls({ root = MOCK_STREAMS_DIR, window = 6, latencyMs = 0, now = () => Date.now() } = {}) {
  const manifestPath = path.join(root, "manifest.json");
  const started = now();
  let manifest = null;
  const load = () => {
    if (!manifest && fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest;
  };
  // Each station starts at a different point in its loop, as real stations would be.
  const offsetSeconds = (slug) => ([...slug].reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 60;

  return function mockLiveHlsMiddleware(req, res, next) {
    const m = load();
    if (!m) {
      res.statusCode = 503;
      res.end("No mock streams yet: run `npm run mock:streams -w @opencast/player`.");
      return;
    }
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const match = /^\/([a-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(url);
    const station = match && m.stations.find((s) => s.slug === match[1]);
    if (!match || !station) return next();
    const [, slug, name] = match;
    const seg = m.segmentSeconds;
    const n = m.segments;
    const elapsed = (now() - started) / 1000 + offsetSeconds(slug) + window * seg;
    const last = Math.floor(elapsed / seg) - 1;

    /** A playlist (text) or a file on disk ({ file }). */
    const send = (type, body) => {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", type);
      res.setHeader("cache-control", name.endsWith(".m3u8") ? "no-store" : "public, max-age=3600");
      const finish = () => (typeof body === "string" ? res.end(body) : fs.createReadStream(body.file).pipe(res));
      if (latencyMs) setTimeout(finish, latencyMs);
      else finish();
    };

    if (name === "master.m3u8") {
      const video = station.audioOnly ? 'CODECS="mp4a.40.2"' : 'RESOLUTION=960x540,CODECS="avc1.4d401f,mp4a.40.2"';
      return send(
        "application/vnd.apple.mpegurl",
        [
          "#EXTM3U",
          '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs.m3u8"',
          `#EXT-X-STREAM-INF:BANDWIDTH=${station.audioOnly ? 110000 : 650000},${video},SUBTITLES="subs"`,
          "live.m3u8",
          ""
        ].join("\n")
      );
    }
    if (name === "live.m3u8") {
      return send("application/vnd.apple.mpegurl", slidingWindow({ last, n, window, segmentSeconds: seg, file: (i) => `seg_${String(i).padStart(3, "0")}.ts` }));
    }
    if (name === "subs.m3u8") {
      return send("application/vnd.apple.mpegurl", slidingWindow({ last, n, window, segmentSeconds: seg, file: (i) => `sub_${String(i).padStart(3, "0")}.vtt` }));
    }
    const file = path.join(root, slug, name);
    if (/^(seg_\d{3}\.ts|sub_\d{3}\.vtt)$/.test(name) && fs.existsSync(file)) {
      return send(name.endsWith(".ts") ? "video/mp2t" : "text/vtt", { file });
    }
    return next();
  };
}
