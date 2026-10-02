// Makes the mock DASH stream (A201): an external station's stream link that is the source's own
// DASH manifest, like the "colt" HLS stream (generate-streams.mjs) but in DASH. A 60-second loop,
// cut into 2-second fMP4 segments, in a small ladder (540p, 360p, 216p and AAC audio), with
// keyframes on every segment. The live server (live-dash.mjs) serves it as a live (dynamic) MPD,
// so tuning in joins mid-loop, exactly as a public-access channel's DASH stream would.
//
//   npm run mock:streams -w @opencast/player            (the HLS stations, then this)
//   node packages/player/mock/generate-dash.mjs         (this one only)
//
// Needs ffmpeg on PATH. Writes packages/player/.mock-streams/dash/ (git-ignored): per station
// init-<rep>.m4s, chunk-<rep>-NNNNN.m4s, ffmpeg's own (static) manifest.mpd, and dash.json, which
// live-dash.mjs writes the live manifest from. It's a mock, clearly: every frame says so, and the
// station (LOMA 9.7, "Loma Linda Community Access") exists only in the mocks.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../.mock-streams/dash");
const SEGMENT = 2;
const LOOP = 60;
const W = 960;
const H = 540;

/** The ladder: three pictures sharing one audio track (the reference, 360p, listed first by ffmpeg order). */
const VIDEO = [
  { width: 960, height: 540, kbps: 400 },
  { width: 640, height: 360, kbps: 220 },
  { width: 384, height: 216, kbps: 110 }
];
const AUDIO_KBPS = 96;

/** The mock DASH stations. */
const STATIONS = [
  { slug: "loma", callSign: "LOMA", channel: "9.7", name: "Loma Linda Community Access", colour: "#5A4E7A", title: "Parks and Recreation Commission", tone: 415 }
];

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const mmss = (second) => `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;

function frameSvg(s, second) {
  const bar = Math.round(((second + 1) / LOOP) * (W - 96));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.colour}"/><stop offset="1" stop-color="#0A1124"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="48" y="64" font-family="Helvetica Neue, Arial" font-size="22" fill="#ECE9E1" opacity=".7">Mock stream for development · the source's own DASH stream</text>
  <text x="${W - 48}" y="64" text-anchor="end" font-family="Menlo, monospace" font-size="30" fill="#FFFFFF" opacity=".9">${mmss(second)}</text>
  <rect x="48" y="84" width="${W - 96}" height="6" rx="3" fill="#FFFFFF" opacity=".2"/>
  <rect x="48" y="84" width="${bar}" height="6" rx="3" fill="#FFFFFF" opacity=".85"/>
  <text x="48" y="220" font-family="Helvetica Neue, Arial" font-weight="800" font-size="110" fill="#FFFFFF" letter-spacing="-4">${esc(s.callSign)}</text>
  <text x="48" y="282" font-family="Menlo, monospace" font-size="40" fill="#FFFFFF" opacity=".92">${esc(s.channel)}  ${esc(s.name)}</text>
  <text x="48" y="342" font-family="Helvetica Neue, Arial" font-weight="700" font-size="32" fill="#ECE9E1">${esc(s.title)}</text>
  <text x="48" y="392" font-family="Menlo, monospace" font-size="26" fill="#ECE9E1" opacity=".8">MPEG-DASH · fMP4</text>
</svg>`;
}

function run(args, cwd) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, stdio: "inherit" });
}

/** A tone with quiet pink noise and a slow swell (as generate-streams.mjs's). */
const toneInput = (seconds, freq) => ["-f", "lavfi", "-t", String(seconds), "-i", `sine=frequency=${freq}:sample_rate=48000,volume=0.06[t];anoisesrc=color=pink:amplitude=0.05:sample_rate=48000,lowpass=f=6000[n];[t][n]amix=inputs=2:normalize=0,tremolo=f=0.6:d=0.7`];

/** The attributes of each tag named `tag` in the manifest's text. */
function tags(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map((m) => Object.fromEntries([...m[1].matchAll(/([A-Za-z:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
}

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const manifest = { version: 1, segmentSeconds: SEGMENT, loopSeconds: LOOP, segments: LOOP / SEGMENT, stations: [] };

for (const s of STATIONS) {
  const dir = path.join(OUT, s.slug);
  if (only.length && !only.includes(s.slug) && fs.existsSync(path.join(dir, "station.json"))) {
    manifest.stations.push(JSON.parse(fs.readFileSync(path.join(dir, "station.json"), "utf8")));
    continue;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  for (let i = 0; i < LOOP; i++) {
    await sharp(Buffer.from(frameSvg(s, i))).png().toFile(path.join(dir, "frames", `f_${String(i).padStart(3, "0")}.png`));
  }
  const split = VIDEO.map((_, i) => `[s${i}]`).join("");
  const scaled = VIDEO.map((v, i) => `[s${i}]scale=${v.width}:${v.height}[v${i}]`).join(";");
  run(
    [
      "-framerate", "1", "-i", "frames/f_%03d.png", ...toneInput(LOOP - 0.05, s.tone),
      "-filter_complex", `[0:v]fps=25,format=yuv420p,split=${VIDEO.length}${split};${scaled}`,
      ...VIDEO.flatMap((_, i) => ["-map", `[v${i}]`]), "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-bf", "0",
      "-g", String(25 * SEGMENT), "-keyint_min", String(25 * SEGMENT), "-sc_threshold", "0",
      ...VIDEO.flatMap((v, i) => [`-b:v:${i}`, `${v.kbps}k`, `-maxrate:v:${i}`, `${Math.round(v.kbps * 1.2)}k`, `-bufsize:v:${i}`, `${v.kbps * 2}k`]),
      // AAC frames do not land on 2 s: a hair short, so the tail stays in the last segment (as generate-streams.mjs does).
      "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ar", "48000", "-ac", "2",
      "-t", String(LOOP),
      "-f", "dash", "-seg_duration", String(SEGMENT), "-use_template", "1", "-use_timeline", "0",
      "-adaptation_sets", "id=0,streams=v id=1,streams=a",
      "-init_seg_name", "init-$RepresentationID$.m4s", "-media_seg_name", "chunk-$RepresentationID$-$Number%05d$.m4s",
      "manifest.mpd"
    ],
    dir
  );
  fs.rmSync(path.join(dir, "frames"), { recursive: true, force: true });

  // What the live manifest needs, from ffmpeg's own: each adaptation set's timescale and representations.
  const mpd = fs.readFileSync(path.join(dir, "manifest.mpd"), "utf8");
  const sets = [...mpd.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)].map((m) => {
    const attrs = tags(`<AdaptationSet${m[1]}>`, "AdaptationSet")[0];
    const template = tags(m[2], "SegmentTemplate")[0];
    const reps = tags(m[2], "Representation").map((r) => ({ id: r.id, mimeType: r.mimeType, codecs: r.codecs, bandwidth: Number(r.bandwidth), width: r.width ? Number(r.width) : undefined, height: r.height ? Number(r.height) : undefined, frameRate: r.frameRate, audioSamplingRate: r.audioSamplingRate }));
    return { contentType: attrs.contentType, timescale: Number(template.timescale), startNumber: Number(template.startNumber ?? 1), reps };
  });
  for (const set of sets) {
    for (const r of set.reps) {
      const chunks = fs.readdirSync(dir).filter((f) => f.startsWith(`chunk-${r.id}-`));
      if (chunks.length !== LOOP / SEGMENT) throw new Error(`${s.callSign} representation ${r.id}: ${chunks.length} segments, expected ${LOOP / SEGMENT}`);
    }
  }
  const entry = { slug: s.slug, callSign: s.callSign, channel: s.channel, name: s.name, adaptationSets: sets };
  fs.writeFileSync(path.join(dir, "station.json"), JSON.stringify(entry, null, 2));
  manifest.stations.push(entry);
  console.log(`${s.callSign} ${s.channel}: ${LOOP / SEGMENT} DASH segments per representation, ${sets.map((x) => `${x.contentType} ${x.reps.map((r) => r.height ? `${r.height}p` : `${Math.round(r.bandwidth / 1000)}k`).join("/")}`).join(", ")}`);
}

fs.writeFileSync(path.join(OUT, "dash.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${OUT}`);
