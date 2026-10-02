// Serves the mock stations (generate-streams.mjs) as live HLS: each station's 60-second loop
// plays forever on the wall clock, in a sliding window of segments, so a player joins wherever
// the "broadcast" is, mid-program, exactly as it will with real stations.
//
//   /<slug>/master.m3u8   the rendition ladder and a caption rendition (index.m3u8 answers it too)
//   /<slug>/<r>.m3u8      a rendition's media playlist, a sliding window: TV v360 (listed first,
//                         as the worker lists its reference rendition), v540, v216 and the
//                         audio-only a64; radio a128 and a64
//   /<slug>/subs.m3u8     the caption playlist, the same window
//   /<slug>/<r>_seg_NNN.ts, /<slug>/<r>_off_NNN.ts, /<slug>/sub_NNN.vtt, /<slug>/suboff_NNN.vtt
//   /<slug>/logo.svg      a station logo, for the logo bug (SAZN's)
//
// The playlist is written the way the worker assembles a channel (platform prompt, Phase 5, and
// packages/contracts/src/hls.ts, whose dateRangeTag writes every tag):
//   - `#EXT-X-DISCONTINUITY` between items (each is its own encode), `#EXT-X-PROGRAM-DATE-TIME`
//     on the first segment of every item (and of the window);
//   - `#EXT-X-DATERANGE` per item (org.useopencast.item; CIVC's program is a live block instead,
//     org.useopencast.live), the break with SCTE35-OUT and SCTE35-IN, the station's bug over the
//     program (call sign and channel, bottom right, 78%; SAZN's is a logo, top right), lower
//     thirds over CIVC's live Town Hall, and the spot's code and QR for its last 10 seconds.
//
// A planned sign-off, switched on with a query parameter: `?signoff=prep` (or `signoff=1`, which
// means PREP; several slugs with commas) on the app's address or on any /mock-hls request. The
// station finishes its loop (it signs off after a station ID, within about a minute), airs the
// sign-off slate (6 s) with its org.useopencast.sign-off tag (backAt), then `#EXT-X-ENDLIST`; it's
// off air for 30 seconds, then a new playlist starts from its station ID. While the page's address
// keeps the parameter, it signs off again a minute or so after each return. `/_signoff?station=prep`
// switches it on once and answers with the times, as JSON.
//
// Up next (A243), switched on the same way: `?upnext=beat` (or `upnext=1`, BEAT) on a /mock-hls
// request or its page's address (when the page sends its whole address), or once for all
// requests from then on with `/_upnext?station=beat`. The mock's loop has no bumper of its own, so the station's
// org.useopencast.up-next tag (the next program's title, drawn by the player) is put over the last
// twelve seconds of its program; on a channel it's over an up-next bumper.
//
// Use it as Connect/Vite middleware: server.middlewares.use("/mock-hls", mockLiveHls()).
// Options: `latencyMs` delays every playlist and segment, to feel a slow network.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MOCK_STREAMS_DIR = path.resolve(here, "../.mock-streams");

// The tags' format lives in the contracts package (built: npm run build -w @opencast/contracts).
// Without it the streams still play, without their tags.
let contracts = null;
try {
  contracts = await import("@opencast/contracts");
} catch (e) {
  console.warn(`[mock-hls] No DATERANGE tags: @opencast/contracts isn't built (npm run build -w @opencast/contracts). ${e?.message ?? e}`);
}

/** How long a signed-off station stays off before its new playlist starts, in segments (30 s). */
const OFF_SEGMENTS = 15;
/** Which station `signoff=1` means. */
const DEFAULT_SIGNOFF = "prep";

/** The stations' graphics, as their settings would give them. */
const GRAPHICS = {
  civc: { live: { logEntryId: "mock-civc-town-hall", sourceId: "mock-studio-a" }, lowerThirds: [{ at: 1, count: 8, name: "Dana Whitfield", title: "Chair, Planning Commission" }, { at: 11, count: 7, name: "Luis Ortega", title: "Resident, Ward 2" }] },
  beat: { carriedFrom: "REEL" },
  sazn: { logo: true }
};
/**
 * Mock call-sign families (A229, added 2026-09-30): streams that play another station's loop under
 * their own slug. `external`: a source's own stream (no Opencast tags); otherwise the tags carry the
 * family member's own call sign and channel (its bug says BEAT 12.2).
 */
const ALIASES = {
  rivc: { of: "colt", external: true, callSign: "RIVC", channel: "15.1", name: "Riverside County, Board of Supervisors" },
  rvpw: { of: "civc", external: true, callSign: "RIVC", channel: "15.2", name: "Riverside County, Public Works" },
  rvlb: { of: "reel", external: true, callSign: "RIVC", channel: "15.3", name: "Riverside County Library Live" },
  tape: { of: "sazn", callSign: "BEAT", channel: "12.2", name: "Beat Tapes", colour: "#8C3B7A" }
};

/** A station in the manifest by its slug, or a family member's alias of one (`files`: whose segments it plays). */
function stationBySlug(m, slug) {
  const own = m.stations.find((s) => s.slug === slug);
  if (own) return { ...own, files: own.slug };
  const alias = ALIASES[slug];
  const base = alias && m.stations.find((s) => s.slug === alias.of);
  if (!base) return null;
  const { of, ...rest } = alias;
  return { ...base, ...rest, slug, files: of };
}

const SCTE35_OUT = "0xFC302000000000000000FFF00F05000000017FEFFE00A4CB80C0000000000000";
const SCTE35_IN = "0xFC302000000000000000FFF00F05000000017F4FFE00000000C0000000000000";

/**
 * One station's timeline in absolute segments k (k = 0, 1, 2… on the wall clock): what each
 * segment is, where items start, and the sign-offs switched on so far.
 */
export function stationTimeline({ n, items, slateSegments }) {
  /** Sign-offs: slate from S, off from S + slate, back (a new playlist) at B. */
  const signOffs = [];
  const latest = (k) => {
    for (let i = signOffs.length - 1; i >= 0; i--) if (signOffs[i].S <= k) return signOffs[i];
    return null;
  };
  /** The segment k: loop file, slate file, or nothing (off air). */
  const at = (k) => {
    const so = latest(k);
    if (!so) return { kind: "seg", file: ((k % n) + n) % n };
    if (k < so.S + slateSegments) return { kind: "off", file: k - so.S };
    if (k < so.B) return { kind: "none" };
    // The new playlist starts from the station ID (the loop's last item).
    const sid = items[items.length - 1].from;
    return { kind: "seg", file: (k - so.B + sid) % n };
  };
  const itemOf = (file) => items.find((it) => file >= it.from && file < it.from + it.count);
  /** The item (or slate) a segment belongs to, its first segment, and its length. */
  const item = (k) => {
    const a = at(k);
    if (a.kind === "none") return null;
    if (a.kind === "off") return { code: "OFF", start: k - a.file, count: slateSegments };
    const it = itemOf(a.file);
    return { code: it.code, start: k - (a.file - it.from), count: it.count };
  };
  const startsItem = (k) => {
    const a = at(k);
    if (a.kind === "none") return false;
    const i = item(k);
    return i.start === k;
  };
  /** The newest segment the playlist may show at `last`: the slate's end while off air. */
  const shown = (last) => {
    const so = latest(last);
    if (!so) return { last, ended: false, from: 0 };
    // Back on: a new playlist, from the station ID.
    if (last >= so.B) return { last, ended: false, from: so.B };
    // The slate's last segment is out: the playlist ends there until the station is back.
    if (last >= so.S + slateSegments - 1) return { last: so.S + slateSegments - 1, ended: true, from: so.prevB };
    return { last, ended: false, from: so.prevB };
  };
  /** Discontinuities from segment 1 to `k`: the discontinuity sequence of segment k (cached, counted from the last answer). */
  let cache = { k: 0, count: 0 };
  const discontinuities = (k) => {
    let { count } = cache;
    for (let j = cache.k + 1; j <= k; j++) if (startsItem(j)) count++;
    for (let j = cache.k; j > k; j--) if (startsItem(j)) count--;
    cache = { k, count };
    return count;
  };
  /** Switch on a sign-off: at the next loop's start at least `lead` segments after `last`. */
  const signOff = (last, lead = 5) => {
    const so = latest(Number.MAX_SAFE_INTEGER);
    if (so && so.B > last) return so; // One at a time.
    let S = last + lead;
    while (at(S).kind !== "seg" || at(S).file !== 0) S++;
    const entry = { S, B: S + slateSegments + OFF_SEGMENTS, prevB: so ? so.B : 0 };
    signOffs.push(entry);
    return entry;
  };
  return { at, item, startsItem, shown, discontinuities, signOff, signOffs };
}

/** DATERANGE lines for an item starting at segment `k0` (the contract's dateRangeTag). */
function tagsFor({ station, it, k0, pdt, seg, backAt, host, breakSegments, upNext = false }) {
  // An external station's stream (follow-up Phase 6) is the source's own: none of Opencast's tags.
  if (!contracts || station.external) return [];
  const { dateRangeTag, HLS_CLASS } = contracts;
  const g = GRAPHICS[station.slug] ?? {};
  const tv = !station.audioOnly;
  const start = pdt(k0);
  const seconds = it.count * seg;
  const id = (what) => `${station.slug}-${what}-${k0}`;
  const out = [];
  if (it.code === "OFF") {
    out.push(dateRangeTag({ id: id("sign-off"), class: HLS_CLASS.signOff, start, durationSeconds: seconds, attributes: { backAt } }));
    return out;
  }
  if (it.code === "PGM" && g.live) {
    out.push(dateRangeTag({ id: id("live"), class: HLS_CLASS.live, start, durationSeconds: seconds, attributes: g.live }));
  } else {
    const title = it.code === "PGM" ? station.title : it.code === "SPT" ? station.spot.title : `${station.callSign} ${station.channel}, station ID`;
    out.push(
      dateRangeTag({
        id: id("item"),
        class: HLS_CLASS.item,
        start,
        durationSeconds: seconds,
        attributes: { logEntryId: `mock-${station.slug}-${it.code.toLowerCase()}`, code: it.code, contentId: `bafkreimock${station.slug}${it.code.toLowerCase()}`, title, carriedFrom: it.code === "PGM" ? (g.carriedFrom ?? null) : null }
      })
    );
  }
  if (it.code === "PGM" && tv) {
    const bug = g.logo
      ? { mode: "logo", logoUrl: `http://${host}/mock-hls/${station.slug}/logo.svg`, position: "top_right", opacity: 90 }
      : { mode: "call_sign_and_channel", callSign: station.callSign, channel: station.channel, position: "bottom_right", opacity: 78 };
    out.push(dateRangeTag({ id: id("bug"), class: HLS_CLASS.bug, start, durationSeconds: seconds, attributes: bug }));
    for (const l3 of g.lowerThirds ?? []) {
      out.push(dateRangeTag({ id: id(`l3-${l3.at}`), class: HLS_CLASS.lowerThird, start: pdt(k0 + l3.at), durationSeconds: l3.count * seg, attributes: { name: l3.name, title: l3.title } }));
    }
    if (upNext && HLS_CLASS.upNext) {
      const from = k0 + it.count - Math.round(12 / seg);
      out.push(
        dateRangeTag({
          id: id("up-next"),
          class: HLS_CLASS.upNext,
          start: pdt(from),
          durationSeconds: (k0 + it.count - from) * seg,
          attributes: { logEntryId: `mock-${station.slug}-next`, title: UP_NEXT.title, episodeTitle: UP_NEXT.episodeTitle, startsAt: new Date(pdt(k0 + it.count + breakSegments)).toISOString(), immediate: 1, carriedFrom: null }
        })
      );
    }
  }
  if (it.code === "SPT") {
    // The break: the spot and the station ID (to the end of the loop).
    out.push(dateRangeTag({ id: id("break"), class: HLS_CLASS.break, start, durationSeconds: breakSegments * seg, scte35Out: SCTE35_OUT, scte35In: SCTE35_IN, attributes: { breakId: `mock-${station.slug}-break` } }));
    if (tv) {
      const codeSeconds = 10;
      out.push(
        dateRangeTag({
          id: id("code"),
          class: HLS_CLASS.code,
          start: start + (seconds - codeSeconds) * 1000,
          durationSeconds: codeSeconds,
          attributes: { spotId: "mock-spot-orange-fall", code: station.spot.code, offer: station.spot.offer, qrUrl: `https://useopencast.org/c/${station.spot.code}` }
        })
      );
    }
  }
  return out;
}

/**
 * The media playlist at `last` (the newest segment published): a window of up to `window`
 * segments, with discontinuities between items, program date-times, the tags, and ENDLIST after a
 * sign-off slate.
 */
export function playlist({ timeline, last, window, seg, file, pdt, tags }) {
  const view = timeline.shown(last);
  const first = Math.max(view.from, view.last - window + 1);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${seg}`, `#EXT-X-MEDIA-SEQUENCE:${first}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${timeline.discontinuities(first)}`];
  // Tags for items that started before the window and still run in it.
  const firstItem = timeline.item(first);
  if (firstItem && firstItem.start < first && tags) lines.push(...tags(firstItem, firstItem.start));
  for (let k = first; k <= view.last; k++) {
    const a = timeline.at(k);
    if (a.kind === "none") continue;
    const starts = timeline.startsItem(k);
    if (starts && k !== first) lines.push("#EXT-X-DISCONTINUITY");
    if (starts && tags) lines.push(...tags(timeline.item(k), k));
    if (starts || k === first) lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(pdt(k)).toISOString()}`);
    lines.push(`#EXTINF:${seg.toFixed(3)},`, file(a));
  }
  if (view.ended) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

/** What up next names in the mock (A243). */
const UP_NEXT = { title: "Late Crate", episodeTitle: "Crate Session 03" };

/** The slugs a request asks to draw up next for (A243): `upnext`, as `signoff`. */
function upNextAsked(req) {
  return signOffAsked(req, "upnext", "beat");
}

/** The slugs a request asks to sign off: its own `signoff` query, or its page's (the Referer). */
function signOffAsked(req, param = "signoff", fallback = DEFAULT_SIGNOFF) {
  const values = [];
  for (const u of [req.url ?? "", req.headers?.referer ?? ""]) {
    try {
      const v = new URL(u, "http://localhost").searchParams.get(param);
      if (v) values.push(...v.split(","));
    } catch {
      // Not a URL.
    }
  }
  return values.map((v) => (["1", "on", "true", "yes"].includes(v.toLowerCase()) ? fallback : v.toLowerCase()));
}

/**
 * The station's master playlist, written as the worker writes a channel's (renderMaster): the
 * reference rendition first, then the rest best first, each with its bandwidth, codecs and (for
 * pictures) resolution and frame rate, and the caption rendition.
 */
export function masterPlaylist(station) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS", '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs.m3u8"'];
  for (const r of station.renditions) {
    const picture = r.audioOnly ? "" : `,RESOLUTION=${r.width}x${r.height},FRAME-RATE=25.000`;
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},AVERAGE-BANDWIDTH=${r.averageBandwidth},CODECS="${r.codecs}"${picture},SUBTITLES="subs"`, `${r.name}.m3u8`);
  }
  return lines.join("\n") + "\n";
}

const logoSvg = (s) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="96" viewBox="0 0 240 96"><rect x="3" y="3" width="234" height="90" rx="45" fill="none" stroke="#fff" stroke-width="6"/><text x="120" y="63" text-anchor="middle" font-family="Helvetica Neue, Arial" font-weight="800" font-size="44" fill="#fff">${s.name}</text></svg>`;

export function mockLiveHls({ root = MOCK_STREAMS_DIR, window = 6, latencyMs = 0, now = () => Date.now() } = {}) {
  const manifestPath = path.join(root, "manifest.json");
  const started = now();
  /** Stations up next was switched on for (`/_upnext`). */
  const upNextOn = new Set();
  let manifest = null;
  const timelines = new Map();
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
    if (!m.items || m.version !== 2) {
      res.statusCode = 503;
      res.end("The mock streams are from an older generator: run `npm run mock:streams -w @opencast/player` again.");
      return;
    }
    const seg = m.segmentSeconds;
    const n = m.segments;
    const lastOf = (slug) => Math.floor(((now() - started) / 1000 + offsetSeconds(slug) + window * seg) / seg) - 1;
    /** Segment k's program date-time: when it went out (it's published a segment later). */
    const pdtOf = (slug) => (k) => started + (k * seg - offsetSeconds(slug) - window * seg) * 1000;
    const timelineOf = (slug) => {
      if (!timelines.has(slug)) timelines.set(slug, stationTimeline({ n, items: m.items, slateSegments: m.slateSegments }));
      return timelines.get(slug);
    };

    // A sign-off asked for, by this request or the page it came from.
    for (const slug of signOffAsked(req)) {
      if (slug === "off") continue;
      if (m.stations.some((s) => s.slug === slug)) timelineOf(slug).signOff(lastOf(slug));
    }

    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    // A243: switches up next on for a station from now on (`?station=beat`), as `/_signoff` does a sign-off.
    if (url === "/_upnext") {
      const slug = new URL(req.url, "http://localhost").searchParams.get("station") ?? "beat";
      upNextOn.add(slug);
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({ station: slug, upNext: true }));
      return;
    }
    if (url === "/_signoff") {
      const slug = signOffAsked(req)[0] ?? new URL(req.url, "http://localhost").searchParams.get("station") ?? DEFAULT_SIGNOFF;
      const station = m.stations.find((s) => s.slug === slug);
      if (!station) return next();
      const so = timelineOf(slug).signOff(lastOf(slug));
      const pdt = pdtOf(slug);
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({ station: slug, slateAt: new Date(pdt(so.S)).toISOString(), offAt: new Date(pdt(so.S + m.slateSegments)).toISOString(), backAt: new Date(pdt(so.B)).toISOString() }));
      return;
    }

    const match = /^\/([a-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(url);
    const station = match && stationBySlug(m, match[1]);
    if (!match || !station) return next();
    const [, slug, name] = match;
    const last = lastOf(slug);
    const timeline = timelineOf(slug);
    const pdt = pdtOf(slug);

    /** A playlist (text) or a file on disk ({ file }). */
    const send = (type, body) => {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", type);
      res.setHeader("cache-control", name.endsWith(".m3u8") ? "no-store" : "public, max-age=3600");
      const finish = () => (typeof body === "string" ? res.end(body) : fs.createReadStream(body.file).pipe(res));
      if (latencyMs) setTimeout(finish, latencyMs);
      else finish();
    };

    if (name === "master.m3u8" || name === "index.m3u8") return send("application/vnd.apple.mpegurl", masterPlaylist(station));
    const pad = (i) => String(i).padStart(3, "0");
    const rendition = station.renditions.find((r) => `${r.name}.m3u8` === name);
    if (rendition) {
      const spot = m.spot;
      const host = req.headers?.host ?? "localhost";
      const breakSegments = n - m.items[0].count;
      const tags = (it, k0) => {
        const so = it.code === "OFF" ? timeline.signOffs.find((x) => x.S === k0) : null;
        return tagsFor({ station: { ...station, spot }, it, k0, pdt, seg, host, breakSegments, backAt: so ? new Date(pdt(so.B)).toISOString() : null, upNext: upNextOn.has(station.slug) || upNextAsked(req).includes(station.slug) });
      };
      const r = rendition.name;
      return send("application/vnd.apple.mpegurl", playlist({ timeline, last, window, seg, pdt, tags, file: (a) => (a.kind === "off" ? `${r}_off_${pad(a.file)}.ts` : `${r}_seg_${pad(a.file)}.ts`) }));
    }
    if (name === "subs.m3u8") {
      return send("application/vnd.apple.mpegurl", playlist({ timeline, last, window, seg, pdt, tags: null, file: (a) => (a.kind === "off" ? `suboff_${pad(a.file)}.vtt` : `sub_${pad(a.file)}.vtt`) }));
    }
    if (name === "logo.svg") return send("image/svg+xml", logoSvg(station));
    const file = path.join(root, station.files, name);
    if (/^([a-z0-9]+_(seg|off)_\d{3}\.ts|(sub|suboff)_\d{3}\.vtt)$/.test(name) && fs.existsSync(file)) {
      return send(name.endsWith(".ts") ? "video/mp2t" : "text/vtt", { file });
    }
    return next();
  };
}
