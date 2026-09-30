// Serves the mock DASH stations (generate-dash.mjs) as live DASH (A201): each station's 60-second
// loop plays forever on the wall clock, behind a dynamic MPD, so a player joins wherever the
// "broadcast" is, as it would a public-access channel's DASH stream link.
//
//   /<slug>/manifest.mpd            the live MPD: SegmentTemplate with $Number$, from the server's
//                                   start, a 30-second time-shift window, and UTCTiming (direct),
//                                   so dash.js needs no time server
//   /<slug>/init-<rep>.m4s          each representation's initialization segment
//   /<slug>/chunk-<rep>-<k>.m4s     live segment k: the loop's segment k mod 30, its timestamps
//                                   (tfdt, sidx) moved on by a loop for every time round, so the
//                                   timeline runs on for ever; 404 until it's published
//
// Use it as Connect/Vite middleware: server.middlewares.use("/mock-dash", mockLiveDash()).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MOCK_DASH_DIR = path.resolve(here, "../.mock-streams/dash");

/** The boxes in `b` from `start` to `end`, walking into the containers the patching needs. */
function boxes(b, start = 0, end = b.length, out = []) {
  let s = start;
  while (s + 8 <= end) {
    let size = b.readUInt32BE(s);
    const type = b.toString("latin1", s + 4, s + 8);
    let header = 8;
    if (size === 1) {
      size = Number(b.readBigUInt64BE(s + 8));
      header = 16;
    } else if (size === 0) size = end - s;
    if (size < header) break;
    out.push({ type, at: s });
    if (["moov", "trak", "mdia", "moof", "traf"].includes(type)) boxes(b, s + header, s + size, out);
    s += size;
  }
  return out;
}

/** A track's timescale, from its initialization segment's mdhd. */
export function trackTimescale(init) {
  const mdhd = boxes(init).find((x) => x.type === "mdhd");
  if (!mdhd) throw new Error("No mdhd in the initialization segment.");
  const v = init[mdhd.at + 8];
  return init.readUInt32BE(mdhd.at + (v === 1 ? 28 : 20));
}

/** A copy of a media segment with its decode time (tfdt) and sidx earliest presentation time moved on by `ticks`. */
export function shiftSegment(seg, ticks) {
  if (!ticks) return seg;
  const b = Buffer.from(seg);
  const add = (at, v1) => {
    if (v1) b.writeBigUInt64BE(b.readBigUInt64BE(at) + BigInt(ticks), at);
    else b.writeUInt32BE((b.readUInt32BE(at) + ticks) >>> 0, at);
  };
  for (const x of boxes(b)) {
    const v1 = b[x.at + 8] === 1;
    if (x.type === "tfdt") add(x.at + 12, v1);
    if (x.type === "sidx") add(x.at + 20, v1);
  }
  return b;
}

/** The live MPD for a station at `now` (ms): availability from `ast` (ms), segments of `seg` seconds. */
export function liveMpd(station, { ast, now, seg, timeShiftSeconds = 30 }) {
  const iso = (ms) => new Date(ms).toISOString();
  const sets = station.adaptationSets
    .map((set, i) => {
      const reps = set.reps
        .map((r) => {
          const picture = r.width ? ` width="${r.width}" height="${r.height}" frameRate="25" sar="1:1"` : "";
          const sound = r.audioSamplingRate ? ` audioSamplingRate="${r.audioSamplingRate}"` : "";
          const channels = set.contentType === "audio" ? `\n        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>\n      ` : "";
          return `      <Representation id="${r.id}" codecs="${r.codecs}" bandwidth="${r.bandwidth}"${picture}${sound}>${channels}</Representation>`;
        })
        .join("\n");
      const lang = set.contentType === "audio" ? ` lang="en"` : "";
      return `    <AdaptationSet id="${i}" contentType="${set.contentType}" mimeType="${set.reps[0].mimeType}" segmentAlignment="true" startWithSAP="1"${lang}>
      <SegmentTemplate timescale="1000" duration="${seg * 1000}" startNumber="0" initialization="init-$RepresentationID$.m4s" media="chunk-$RepresentationID$-$Number$.m4s"/>
${reps}
    </AdaptationSet>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Mock stream for development (packages/player/mock/live-dash.mjs): ${station.callSign} ${station.channel}, ${station.name}. -->
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="dynamic"
  availabilityStartTime="${iso(ast)}" publishTime="${iso(ast)}" minimumUpdatePeriod="PT60S"
  timeShiftBufferDepth="PT${timeShiftSeconds}S" maxSegmentDuration="PT${seg}S" minBufferTime="PT${seg}S" suggestedPresentationDelay="PT${seg * 3}S">
  <Period id="0" start="PT0S">
${sets}
  </Period>
  <UTCTiming schemeIdUri="urn:mpeg:dash:utc:direct:2014" value="${iso(now)}"/>
</MPD>
`;
}

export function mockLiveDash({ root = MOCK_DASH_DIR, latencyMs = 0, now = () => Date.now() } = {}) {
  const manifestPath = path.join(root, "dash.json");
  const started = now();
  let manifest = null;
  const load = () => {
    if (!manifest && fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest;
  };
  const timescales = new Map();
  const timescaleOf = (slug, rep) => {
    const key = `${slug}/${rep}`;
    if (!timescales.has(key)) timescales.set(key, trackTimescale(fs.readFileSync(path.join(root, slug, `init-${rep}.m4s`))));
    return timescales.get(key);
  };
  // Each station starts at a different point in its loop (as live-hls.mjs's do), 40 s or so in.
  const offsetSeconds = (slug) => 40 + (([...slug].reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 60);
  const astOf = (slug) => started - offsetSeconds(slug) * 1000;

  return function mockLiveDashMiddleware(req, res, next) {
    const m = load();
    if (!m) {
      res.statusCode = 503;
      res.end("No mock DASH streams yet: run `npm run mock:streams -w @opencast/player`.");
      return;
    }
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const match = /^\/([a-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(url);
    const station = match && m.stations.find((s) => s.slug === match[1]);
    if (!match || !station) return next();
    const [, slug, name] = match;
    const seg = m.segmentSeconds;

    const send = (type, body, cache) => {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", type);
      res.setHeader("cache-control", cache);
      const finish = () => res.end(body);
      if (latencyMs) setTimeout(finish, latencyMs);
      else finish();
    };

    if (name === "manifest.mpd") return send("application/dash+xml", liveMpd(station, { ast: astOf(slug), now: now(), seg }), "no-store");
    const init = /^init-(\d+)\.m4s$/.exec(name);
    if (init) {
      const file = path.join(root, slug, name);
      if (!fs.existsSync(file)) return next();
      return send("video/mp4", fs.readFileSync(file), "public, max-age=3600");
    }
    const chunk = /^chunk-(\d+)-(\d+)\.m4s$/.exec(name);
    if (chunk) {
      const [, rep, kText] = chunk;
      const k = Number(kText);
      // Published once it has aired: segment k covers [k·seg, (k+1)·seg) from the start.
      const published = Math.floor((now() - astOf(slug)) / 1000 / seg) - 1;
      if (k > published || k < 0) {
        res.statusCode = 404;
        res.setHeader("access-control-allow-origin", "*");
        return res.end("Not yet.");
      }
      const loop = Math.floor(k / m.segments);
      const file = path.join(root, slug, `chunk-${rep}-${String((k % m.segments) + 1).padStart(5, "0")}.m4s`);
      if (!fs.existsSync(file)) return next();
      const body = shiftSegment(fs.readFileSync(file), loop * m.loopSeconds * timescaleOf(slug, rep));
      return send("video/mp4", body, "public, max-age=3600");
    }
    return next();
  };
}
