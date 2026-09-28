// Makes the mock stations the player is developed and tested against: a 60-second loop per
// station, cut into 2-second HLS segments, with a caption rendition. The live server
// (live-hls.mjs) serves them as sliding-window live playlists, so tuning in joins mid-program.
//
//   npm run mock:streams -w @opencast/player
//
// Needs ffmpeg on PATH. Writes packages/player/.mock-streams/ (git-ignored). Frames are drawn with
// sharp (Homebrew's ffmpeg has no drawtext), one per second, each showing the station and a
// running counter so it's plain which moment of the loop is on screen.

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

/** The stations in the reference frames (Saturday, 8:42 pm, Inland Empire). */
export const MOCK_STATIONS = [
  { slug: "civc", callSign: "CIVC", channel: "7.1", name: "Inland Civic", colour: "#2E6B5A", band: "tv", title: "Town Hall: backyard homes and ADUs", tone: 330, captions: ["Residents question the commission.", "The next speaker has two minutes.", "Backyard homes are allowed on most lots."] },
  { slug: "beat", callSign: "BEAT", channel: "12.1", name: "Inland Beat", colour: "#8C3B7A", band: "tv", title: "Saturday Reel", tone: 440, captions: ["Cartoons from 1928 to 1934.", "Carried from REEL 24.1.", "Beat Tape Live is next, at 9:00."] },
  { slug: "reel", callSign: "REEL", channel: "24.1", name: "Saturday Reel", colour: "#9A5412", band: "tv", title: "Cartoons from 1928 to 1934", tone: 523, captions: ["River boats and paddle wheels.", "Restored from the original prints.", "Newsreel hour is next, at 9:00."] },
  { slug: "sazn", callSign: "SAZN", channel: "18.1", name: "Sazón", colour: "#A3402A", band: "tv", title: "Tamales for forty", tone: 587, captions: ["Masa, then the filling.", "Forty tamales before the party.", "Orange Street after hours is next."] },
  { slug: "prep", callSign: "PREP", channel: "31.1", name: "Inland Preps", colour: "#1F5E8C", band: "tv", title: "Football: Redlands East Valley at Citrus Valley", tone: 392, captions: ["Third down on the forty.", "Citrus Valley leads by three.", "Friday scoreboard is next."] },
  { slug: "nite", callSign: "NITE", channel: "88.3", name: "Night Desk", colour: "#33507A", band: "radio", title: "Radio dramas from the 1940s", tone: 262, captions: ["The Hollow Door, part 2.", "A radio drama from 1946.", "Stay tuned for part 3."] },
  { slug: "hall", callSign: "HALL", channel: "90.7", name: "Study Hall", colour: "#56508A", band: "radio", title: "Slow beats for late work", tone: 294, captions: ["Slow beats for late work.", "Study Hall, 90.7.", "All night."] },
  { slug: "crat", callSign: "CRAT", channel: "101.9", name: "Crate", colour: "#7E2F35", band: "radio", title: "The Producers’ Hour", tone: 349, captions: ["Live from the Crate studio.", "Producers play unreleased tapes.", "The Producers’ Hour."] },
  { slug: "voze", callSign: "VOZE", channel: "104.3", name: "La Voz", colour: "#1D6A70", band: "radio", title: "Noche de oldies", tone: 311, captions: ["Noche de oldies.", "La Voz, 104.3.", "Hasta la medianoche."] }
];

function frameSvg(s, second) {
  const mm = String(Math.floor(second / 60)).padStart(2, "0");
  const ss = String(second % 60).padStart(2, "0");
  const bar = Math.round(((second + 1) / LOOP) * (W - 96));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.colour}"/><stop offset="1" stop-color="#0A1124"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="48" y="96" font-family="Helvetica Neue, Arial" font-size="22" fill="#ECE9E1" opacity=".7">Mock stream for development</text>
  <text x="48" y="250" font-family="Helvetica Neue, Arial" font-weight="800" font-size="120" fill="#FFFFFF" letter-spacing="-4">${s.callSign}</text>
  <text x="48" y="320" font-family="Menlo, monospace" font-size="44" fill="#FFFFFF" opacity=".92">${s.channel}  ${s.name}</text>
  <text x="48" y="400" font-family="Helvetica Neue, Arial" font-weight="700" font-size="34" fill="#ECE9E1">${s.title}</text>
  <text x="${W - 48}" y="96" text-anchor="end" font-family="Menlo, monospace" font-size="40" fill="#FFFFFF">${mm}:${ss}</text>
  <rect x="48" y="${H - 64}" width="${W - 96}" height="10" rx="5" fill="#FFFFFF" opacity=".2"/>
  <rect x="48" y="${H - 64}" width="${bar}" height="10" rx="5" fill="#FFFFFF" opacity=".85"/>
</svg>`;
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

fs.mkdirSync(OUT, { recursive: true });
const manifest = { segmentSeconds: SEGMENT, loopSeconds: LOOP, segments: LOOP / SEGMENT, stations: [] };

for (const s of MOCK_STATIONS) {
  const dir = path.join(OUT, s.slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  // A tone with quiet pink noise and a slow swell: enough spread across the bands for a level meter.
  const tone = ["-f", "lavfi", "-t", String(LOOP), "-i", `sine=frequency=${s.tone}:sample_rate=48000,volume=0.06[t];anoisesrc=color=pink:amplitude=0.05:sample_rate=48000,lowpass=f=6000[n];[t][n]amix=inputs=2:normalize=0,tremolo=f=0.6:d=0.7`];
  const hls = ["-f", "hls", "-hls_time", String(SEGMENT), "-hls_list_size", "0", "-hls_segment_filename", "seg_%03d.ts", "vod.m3u8"];

  if (s.band === "radio") {
    run([...tone, "-c:a", "aac", "-b:a", "96k", ...hls], dir);
  } else {
    for (let sec = 0; sec < LOOP; sec++) {
      await sharp(Buffer.from(frameSvg(s, sec))).png().toFile(path.join(dir, "frames", `f_${String(sec).padStart(3, "0")}.png`));
    }
    run(
      [
        "-framerate", "1", "-i", "frames/f_%03d.png", ...tone,
        "-vf", "fps=25,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
        "-b:v", "500k", "-maxrate", "600k", "-bufsize", "1200k",
        "-g", String(25 * SEGMENT), "-keyint_min", String(25 * SEGMENT), "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "96k", "-shortest", ...hls
      ],
      dir
    );
  }
  fs.rmSync(path.join(dir, "frames"), { recursive: true, force: true });

  // One WebVTT file per segment, pinned to that segment's first timestamp.
  for (let i = 0; i < LOOP / SEGMENT; i++) {
    const seg = path.join(dir, `seg_${String(i).padStart(3, "0")}.ts`);
    const pts = segmentStartPts(seg);
    const line = s.captions[i % s.captions.length];
    const vtt = `WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:${pts},LOCAL:00:00:00.000\n\n${vttTime(0)} --> ${vttTime(SEGMENT)}\n${line}\n`;
    fs.writeFileSync(path.join(dir, `sub_${String(i).padStart(3, "0")}.vtt`), vtt);
  }
  manifest.stations.push({ slug: s.slug, callSign: s.callSign, channel: s.channel, band: s.band, audioOnly: s.band === "radio" });
  console.log(`${s.callSign} ${s.channel}: ${LOOP / SEGMENT} segments`);
}

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${OUT}`);
