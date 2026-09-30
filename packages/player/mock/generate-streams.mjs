// Makes the mock stations the player is developed and tested against: a 60-second loop per
// station, cut into 2-second HLS segments, in a small rendition ladder, with a caption rendition.
// The live server (live-hls.mjs) serves them as sliding-window live playlists behind a master
// playlist, so tuning in joins mid-program.
//
//   npm run mock:streams -w @opencast/player
//   npm run mock:streams -w @opencast/player -- nite hall   (only these stations, again)
//
// Needs ffmpeg on PATH. Writes packages/player/.mock-streams/ (git-ignored). Frames are drawn with
// sharp (Homebrew's ffmpeg has no drawtext), one per second, each showing the station and a
// running counter so it's plain which moment of the loop is on screen.
//
// Prepared once, then assembled (platform prompt, Phase 5): each loop is a small log, and every
// item is encoded on its own, with its own timestamps, the way the worker prepares items:
//   PGM  0:00–0:40  the program (segments 0–19)
//   SPT  0:40–0:56  a spot, Orange Street's (segments 20–27)
//   SID  0:56–1:00  the station ID (segments 28–29)
// so the live playlist has a real discontinuity between items. A sign-off slate (3 segments,
// off_000–002) is made too, for the planned sign-off live-hls.mjs can switch on.
//
// The ladder, like the worker's (TV 1080p, 720p, 480p, 360p and audio only; radio AAC 128k and
// 64k), only smaller: TV 540p, 360p and 216p and a 64k audio-only rendition; radio 128k and 64k.
// Every rendition of an item is its own encode from the same frames and tone, with keyframes on
// every segment, so the renditions' segments line up and a player can switch between them. The
// files are <rendition>_seg_NNN.ts and <rendition>_off_NNN.ts.
//
// Nothing is burned into the picture that the player draws: no bug, no lower third, no code.
// Those come from the playlist's DATERANGE tags. The picture keeps the bottom of the frame (the
// lower third's and the bug's places) clear.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../.mock-streams");
const SEGMENT = 2;
const LOOP = 60;
const W = 960;
const H = 540;

/**
 * The ladder per band, the reference rendition first (players start there; its segments pin the
 * captions). Video renditions share the audio (AAC 96k); `kbps` is the video's.
 */
const LADDERS = {
  tv: [
    { name: "v360", kind: "video", width: 640, height: 360, kbps: 220, audioKbps: 96 },
    { name: "v540", kind: "video", width: 960, height: 540, kbps: 400, audioKbps: 96 },
    { name: "v216", kind: "video", width: 384, height: 216, kbps: 110, audioKbps: 96 },
    { name: "a64", kind: "audio", width: 0, height: 0, kbps: 0, audioKbps: 64 }
  ],
  radio: [
    { name: "a128", kind: "audio", width: 0, height: 0, kbps: 0, audioKbps: 128 },
    { name: "a64", kind: "audio", width: 0, height: 0, kbps: 0, audioKbps: 64 }
  ]
};
const VIDEO_CODECS = "avc1.4d401f,mp4a.40.2";
const AUDIO_CODECS = "mp4a.40.2";
/** A rendition as the master playlist lists it. */
const variantOf = (r) => ({
  name: r.name,
  audioOnly: r.kind === "audio",
  width: r.width,
  height: r.height,
  bandwidth: Math.round((r.kbps * 1.25 + r.audioKbps) * 1000),
  averageBandwidth: Math.round((r.kbps + r.audioKbps) * 1000),
  codecs: r.kind === "audio" ? AUDIO_CODECS : VIDEO_CODECS
});

/** The loop's items, in segments. live-hls.mjs writes the tags from this (via manifest.json). */
const ITEMS = [
  { code: "PGM", from: 0, count: 20 },
  { code: "SPT", from: 20, count: 8 },
  { code: "SID", from: 28, count: 2 }
];
const SLATE_SEGMENTS = 3;

/** The spot in every break (business/opencast-biz-spots.html's illustration). */
const MOCK_SPOT = { title: "Fall at Orange Street", line: "Pumpkin bread, cider, and the big mugs are back.", colour: "#6B4A2B", code: "ORANGE10", offer: "10% off" };

/** The stations in the reference frames (Saturday, 8:42 pm, Inland Empire). */
const MOCK_STATIONS = [
  { slug: "civc", callSign: "CIVC", channel: "7.1", name: "Inland Civic", colour: "#2E6B5A", band: "tv", title: "Town Hall: backyard homes and ADUs", tone: 330, captions: ["Residents question the commission.", "The next speaker has two minutes.", "Backyard homes are allowed on most lots."] },
  { slug: "beat", callSign: "BEAT", channel: "12.1", name: "Inland Beat", colour: "#8C3B7A", band: "tv", title: "Saturday Reel", tone: 440, captions: ["Cartoons from 1928 to 1934.", "Carried from REEL 24.1.", "Beat Tape Live is next, at 9:00."] },
  { slug: "reel", callSign: "REEL", channel: "24.1", name: "Saturday Reel", colour: "#9A5412", band: "tv", title: "Cartoons from 1928 to 1934", tone: 523, captions: ["River boats and paddle wheels.", "Restored from the original prints.", "Newsreel hour is next, at 9:00."] },
  { slug: "sazn", callSign: "SAZN", channel: "18.1", name: "Sazón", colour: "#A3402A", band: "tv", title: "Tamales for forty", tone: 587, captions: ["Masa, then the filling.", "Forty tamales before the party.", "Orange Street after hours is next."] },
  { slug: "prep", callSign: "PREP", channel: "31.1", name: "Inland Preps", colour: "#1F5E8C", band: "tv", title: "Football: Redlands East Valley at Citrus Valley", tone: 392, captions: ["Third down on the forty.", "Citrus Valley leads by three.", "Friday scoreboard is next."] },
  { slug: "nite", callSign: "NITE", channel: "88.4", name: "Night Desk", colour: "#33507A", band: "radio", title: "Radio dramas from the 1940s", tone: 262, captions: ["The Hollow Door, part 2.", "A radio drama from 1946.", "Stay tuned for part 3."] },
  { slug: "hall", callSign: "HALL", channel: "90.8", name: "Study Hall", colour: "#56508A", band: "radio", title: "Slow beats for late work", tone: 294, captions: ["Slow beats for late work.", "Study Hall, 90.8.", "All night."] },
  { slug: "crat", callSign: "CRAT", channel: "102.0", name: "Crate", colour: "#7E2F35", band: "radio", title: "The Producers’ Hour", tone: 349, captions: ["Live from the Crate studio.", "Producers play unreleased tapes.", "The Producers’ Hour."] },
  { slug: "voze", callSign: "VOZE", channel: "104.4", name: "La Voz", colour: "#1D6A70", band: "radio", title: "Noche de oldies", tone: 311, captions: ["Noche de oldies.", "La Voz, 104.4.", "Hasta la medianoche."] },
  // An external station's stream (follow-up Phase 6): a city's own raw HLS, as its stream link
  // would serve it. The whole loop is the city's picture (no spot, no station ID) and the live
  // server writes none of Opencast's tags for it (no bug, no breaks).
  { slug: "colt", callSign: "COLT", channel: "9.2", name: "City of Colton", colour: "#3F5A6E", band: "tv", title: "City Council, regular meeting", tone: 370, external: true, captions: ["The council will come to order.", "Item four, the consent calendar.", "Public comment is next."] }
];

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const mmss = (second) => `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;

/** The strip along the top: what this is, which item, and the loop's clock and progress. Nothing at the bottom. */
function topStrip(label, second) {
  const bar = Math.round(((second + 1) / LOOP) * (W - 96));
  return `<text x="48" y="64" font-family="Helvetica Neue, Arial" font-size="22" fill="#ECE9E1" opacity=".7">Mock stream for development · ${esc(label)}</text>
  <text x="${W - 48}" y="64" text-anchor="end" font-family="Menlo, monospace" font-size="30" fill="#FFFFFF" opacity=".9">${mmss(second)}</text>
  <rect x="48" y="84" width="${W - 96}" height="6" rx="3" fill="#FFFFFF" opacity=".2"/>
  <rect x="48" y="84" width="${bar}" height="6" rx="3" fill="#FFFFFF" opacity=".85"/>`;
}

function frameSvg(s, item, second) {
  const svg = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}${body}</svg>`;
  if (item === "SPT") {
    return svg(
      `${topStrip("spot", second)}
  <text x="86" y="250" font-family="Helvetica Neue, Arial" font-weight="800" font-size="60" fill="#FFFFFF" letter-spacing="-2">${esc(MOCK_SPOT.title)}</text>
  <text x="86" y="300" font-family="Helvetica Neue, Arial" font-size="26" fill="#FFFFFF" opacity=".9">${esc(MOCK_SPOT.line)}</text>`,
      `<rect width="${W}" height="${H}" fill="${MOCK_SPOT.colour}"/>`
    );
  }
  if (item === "SID" || item === "OFF") {
    return svg(
      `${topStrip(item === "SID" ? "station ID" : "sign-off slate", second)}
  <text x="${W / 2}" y="260" text-anchor="middle" font-family="Helvetica Neue, Arial" font-weight="800" font-size="130" fill="#FFFFFF" letter-spacing="-4">${esc(s.callSign)}</text>
  <text x="${W / 2}" y="330" text-anchor="middle" font-family="Menlo, monospace" font-size="44" fill="#FFFFFF" opacity=".92">${esc(s.channel)}  ${esc(s.name)}</text>
  ${item === "OFF" ? `<text x="${W / 2}" y="390" text-anchor="middle" font-family="Helvetica Neue, Arial" font-size="28" fill="#ECE9E1">Signing off. Thanks for watching.</text>` : ""}`,
      `<rect width="${W}" height="${H}" fill="${item === "SID" ? s.colour : "#0A1124"}"/>`
    );
  }
  return svg(
    `${topStrip(s.external ? "the source's own stream" : "program", second)}
  <text x="48" y="220" font-family="Helvetica Neue, Arial" font-weight="800" font-size="110" fill="#FFFFFF" letter-spacing="-4">${esc(s.callSign)}</text>
  <text x="48" y="282" font-family="Menlo, monospace" font-size="40" fill="#FFFFFF" opacity=".92">${esc(s.channel)}  ${esc(s.name)}</text>
  <text x="48" y="342" font-family="Helvetica Neue, Arial" font-weight="700" font-size="32" fill="#ECE9E1">${esc(s.title)}</text>`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.colour}"/><stop offset="1" stop-color="#0A1124"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`
  );
}

function run(args, cwd) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, stdio: "inherit" });
}

function segmentStartPts(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", file]).toString().trim();
  return Math.round(Number(out) * 90000);
}

function vttTime(sec) {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `00:00:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** A tone with quiet pink noise and a slow swell: enough spread across the bands for a level meter. */
const toneInput = (seconds, freq) => ["-f", "lavfi", "-t", String(seconds), "-i", `sine=frequency=${freq}:sample_rate=48000,volume=0.06[t];anoisesrc=color=pink:amplitude=0.05:sample_rate=48000,lowpass=f=6000[n];[t][n]amix=inputs=2:normalize=0,tremolo=f=0.6:d=0.7`];

/**
 * Encodes one item on its own (its own timestamps, as a prepared item has), once per rendition of
 * the station's ladder, into `part_NNN.ts` segments, renamed in `dir` to
 * `<rendition>_<prefix>` + the loop's numbering from `first`.
 */
async function encodeItem(s, dir, { item, seconds, firstSecond, tone, prefix, first }) {
  const work = path.join(dir, `work_${item}`);
  fs.mkdirSync(path.join(work, "frames"), { recursive: true });
  const ladder = LADDERS[s.band];
  if (ladder.some((r) => r.kind === "video")) {
    for (let i = 0; i < seconds; i++) {
      await sharp(Buffer.from(frameSvg(s, s.external && item !== "OFF" ? "PGM" : item, firstSecond + i))).png().toFile(path.join(work, "frames", `f_${String(i).padStart(3, "0")}.png`));
    }
  }
  for (const r of ladder) {
    const out = path.join(work, r.name);
    fs.mkdirSync(out, { recursive: true });
    const hls = ["-f", "hls", "-hls_time", String(SEGMENT), "-hls_list_size", "0", "-hls_segment_filename", path.join(out, "part_%03d.ts"), path.join(out, "item.m3u8")];
    if (r.kind === "audio") {
      // AAC frames don't land on 2 s: a hair short, so the item's tail stays in its last segment
      // rather than making a tiny extra one (the player jumps the 50 ms hole at the join).
      run([...toneInput(seconds - 0.05, tone), "-c:a", "aac", "-b:a", `${r.audioKbps}k`, ...hls], work);
    } else {
      run(
        [
          "-framerate", "1", "-i", "frames/f_%03d.png", ...toneInput(seconds, tone),
          "-vf", `fps=25,scale=${r.width}:${r.height},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
          "-b:v", `${r.kbps}k`, "-maxrate", `${Math.round(r.kbps * 1.2)}k`, "-bufsize", `${r.kbps * 2}k`,
          "-g", String(25 * SEGMENT), "-keyint_min", String(25 * SEGMENT), "-sc_threshold", "0",
          "-c:a", "aac", "-b:a", `${r.audioKbps}k`, "-shortest", ...hls
        ],
        work
      );
    }
    const parts = fs.readdirSync(out).filter((f) => /^part_\d{3}\.ts$/.test(f)).sort();
    if (parts.length !== seconds / SEGMENT) throw new Error(`${s.callSign} ${item} ${r.name}: ${parts.length} segments, expected ${seconds / SEGMENT}`);
    parts.forEach((f, i) => fs.renameSync(path.join(out, f), path.join(dir, `${r.name}_${prefix}${String(first + i).padStart(3, "0")}.ts`)));
  }
  fs.rmSync(work, { recursive: true, force: true });
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = { version: 2, segmentSeconds: SEGMENT, loopSeconds: LOOP, segments: LOOP / SEGMENT, items: ITEMS, slateSegments: SLATE_SEGMENTS, spot: MOCK_SPOT, stations: [] };

const only = process.argv.slice(2);
for (const s of MOCK_STATIONS) {
  const entry = { slug: s.slug, callSign: s.callSign, channel: s.channel, name: s.name, colour: s.colour, title: s.title, band: s.band, audioOnly: s.band === "radio", ...(s.external ? { external: true } : {}), renditions: LADDERS[s.band].map(variantOf) };
  if (only.length && !only.includes(s.slug)) {
    manifest.stations.push(entry);
    continue;
  }
  const dir = path.join(OUT, s.slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tones = { PGM: s.tone, SPT: Math.round(s.tone * 1.5), SID: s.tone * 2 };
  for (const it of ITEMS) {
    await encodeItem(s, dir, { item: it.code, seconds: it.count * SEGMENT, firstSecond: it.from * SEGMENT, tone: tones[it.code], prefix: "seg_", first: it.from });
  }
  await encodeItem(s, dir, { item: "OFF", seconds: SLATE_SEGMENTS * SEGMENT, firstSecond: 0, tone: Math.round(s.tone / 2), prefix: "off_", first: 0 });

  // One WebVTT file per segment, pinned to the reference rendition's segment's first timestamp.
  // As the channel's subtitle playlist does (X2), an item without captions (the spot here) keeps
  // the caption timeline going with empty WebVTT segments.
  const ref = LADDERS[s.band][0].name;
  const captionFor = (i) => {
    const code = ITEMS.find((it) => i >= it.from && i < it.from + it.count)?.code;
    if (s.external) return s.captions[i % s.captions.length];
    if (code === "SPT") return null;
    if (code === "SID") return `${s.callSign} ${s.channel}, ${s.name}.`;
    return s.captions[i % s.captions.length];
  };
  const writeVtt = (seg, out, line) => {
    if (line === null) return fs.writeFileSync(out, "WEBVTT\n");
    const pts = segmentStartPts(seg);
    fs.writeFileSync(out, `WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:${pts},LOCAL:00:00:00.000\n\n${vttTime(0)} --> ${vttTime(SEGMENT)}\n${line}\n`);
  };
  for (let i = 0; i < LOOP / SEGMENT; i++) {
    const n = String(i).padStart(3, "0");
    writeVtt(path.join(dir, `${ref}_seg_${n}.ts`), path.join(dir, `sub_${n}.vtt`), captionFor(i));
  }
  for (let i = 0; i < SLATE_SEGMENTS; i++) {
    const n = String(i).padStart(3, "0");
    writeVtt(path.join(dir, `${ref}_off_${n}.ts`), path.join(dir, `suboff_${n}.vtt`), "Signing off.");
  }
  manifest.stations.push(entry);
  console.log(`${s.callSign} ${s.channel}: ${LOOP / SEGMENT} segments in ${ITEMS.length} items, and a ${SLATE_SEGMENTS}-segment sign-off slate, in ${LADDERS[s.band].map((r) => r.name).join(", ")}`);
}

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${OUT}`);
