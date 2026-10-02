// A radio station's picture for its translators (relays to YouTube, Twitch or any RTMP address,
// which want video). Relays only: Opencast's own apps draw the radio screen themselves and never
// show it.
//
// Prepared once, like everything else that airs:
//
//   - At upload (the API), the station's image, GIF or short video (up to 30 s) becomes a base
//     loop at the relay's size: H.264, 30 fps, a keyframe every 2 s, no sound (`prepareBaseLoop`).
//     A still image is a two-second loop; a GIF shorter than that is repeated to at least two.
//     Without one, the relay uses a picture in the station's colour with its call sign and
//     channel (the station ID slate), prepared the same way.
//   - When a relay starts (the worker), the base loop is drawn once more with the station's bug
//     (`relayLoop`), and once per spot code with the code and its QR over it too (the player's
//     code overlay, bottom left, for the spot's last 10 s), each with its keyframes on the same
//     frames. They're kept as H.264 access units.
//   - While it relays, nothing is encoded: the channel's sound segments are joined (tsretime.ts)
//     and the loop's frames are laid under them (`PictureTrack`, `RelayMuxer`), switching to a
//     code's loop at the keyframe nearest its start and back after, and FFmpeg stream-copies the
//     result over RTMP.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OUT_PID, patPacket, pmtPacket } from "./tsretime.js";

export const LOOP_FPS = 30;
/** A keyframe every 2 s: what the services ask for, and where the picture can change loop. */
export const LOOP_GOP = 60;
/** The longest background video; a little over is accepted and cut there. */
export const MAX_BACKGROUND_MS = 30_000;
const MAX_ACCEPTED_MS = 31_000;
/** A still image loops every two seconds (one keyframe). */
const STILL_MS = 2_000;
const TICKS_PER_FRAME = 90_000 / LOOP_FPS;

export type BackgroundKind = "image" | "gif" | "video";

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

const IMAGE_CODECS = new Set(["png", "mjpeg", "jpeg2000", "webp", "bmp", "tiff"]);

/** What an uploaded background is, from its first picture stream; an error code when it can't be one. */
export async function probeBackground(file: string): Promise<{ kind: BackgroundKind; durationMs: number | null; width: number; height: number } | { error: "unreadable_file" | "too_long" }> {
  const result = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_frames:format=duration,format_name", "-of", "json", file]);
  let json: { streams?: Array<{ codec_name?: string; width?: number; height?: number; nb_frames?: string }>; format?: { duration?: string; format_name?: string } };
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return { error: "unreadable_file" };
  }
  const stream = json.streams?.[0];
  if (result.code !== 0 || !stream?.codec_name || !stream.width || !stream.height) return { error: "unreadable_file" };
  const duration = Number(json.format?.duration);
  const durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null;
  if (stream.codec_name === "gif") return { kind: "gif", durationMs, width: stream.width, height: stream.height };
  // A picture: one frame (a JPEG's "duration" is a frame's).
  if (IMAGE_CODECS.has(stream.codec_name) && (json.format?.format_name?.includes("pipe") || json.format?.format_name?.includes("image2") || !durationMs || durationMs < 100)) {
    return { kind: "image", durationMs: null, width: stream.width, height: stream.height };
  }
  if (!durationMs) return { error: "unreadable_file" };
  if (durationMs > MAX_ACCEPTED_MS) return { error: "too_long" };
  return { kind: "video", durationMs, width: stream.width, height: stream.height };
}

const x264 = (crf: number, maxKbps: number) => [
  "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-bf", "0", "-g", String(LOOP_GOP), "-keyint_min", String(LOOP_GOP), "-sc_threshold", "0", "-force_key_frames", `expr:eq(mod(n,${LOOP_GOP}),0)`,
  "-crf", String(crf), "-maxrate", `${maxKbps}k`, "-bufsize", `${maxKbps * 2}k`
];

const fit = (size: { width: number; height: number }) =>
  `scale=w=${size.width}:h=${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

/**
 * The base loop, once at upload: `loop.mp4` (H.264 at `size`, 30 fps, a keyframe every 2 s, no
 * sound, fast start, so a browser can preview it) and `still.jpg` (its first frame).
 */
export async function prepareBaseLoop(input: string, kind: BackgroundKind, durationMs: number | null, size: { width: number; height: number }, outDir: string): Promise<{ loop: string; still: string; frames: number; durationMs: number }> {
  await fs.mkdir(outDir, { recursive: true });
  const loop = path.join(outDir, "loop.mp4");
  const still = path.join(outDir, "still.jpg");
  let inputs: string[];
  let ms: number;
  if (kind === "image") {
    ms = STILL_MS;
    inputs = ["-loop", "1", "-framerate", String(LOOP_FPS), "-t", String(ms / 1000), "-i", input];
  } else if (kind === "gif") {
    // Repeated to at least two seconds (one keyframe interval), whole plays only, so it loops cleanly.
    const once = Math.max(1, durationMs ?? STILL_MS);
    const plays = Math.max(1, Math.ceil(STILL_MS / once));
    ms = Math.min(MAX_BACKGROUND_MS, once * plays);
    inputs = ["-stream_loop", String(plays - 1), "-i", input];
  } else {
    ms = Math.min(MAX_BACKGROUND_MS, durationMs ?? MAX_BACKGROUND_MS);
    inputs = ["-i", input];
  }
  const frames = Math.max(1, Math.round((ms / 1000) * LOOP_FPS));
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", ...inputs,
    "-vf", `fps=${LOOP_FPS},${fit(size)},format=yuv420p`, "-an", "-frames:v", String(frames),
    ...x264(20, 2500), ...(kind === "image" ? ["-tune", "stillimage"] : []),
    "-movflags", "+faststart", loop
  ];
  const made = await run("ffmpeg", args);
  if (made.code !== 0) throw new Error(`ffmpeg exited ${made.code}: ${made.stderr.trim().split("\n").slice(-2).join(" ")}`);
  const shot = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", loop, "-frames:v", "1", "-q:v", "3", still]);
  if (shot.code !== 0) throw new Error("couldn't take a still from the loop");
  const counted = await run("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", loop]);
  const n = Number(counted.stdout.trim()) || frames;
  return { loop, still, frames: n, durationMs: Math.round((n / LOOP_FPS) * 1000) };
}

// --- The relay's loops ---------------------------------------------------------------------

/** One H.264 access unit (Annex B, with its access unit delimiter; SPS and PPS before each IDR). */
export interface AccessUnit {
  data: Buffer;
  key: boolean;
}

/** Splits an Annex B stream into access units (it must carry access unit delimiters). */
export function accessUnits(stream: Buffer): AccessUnit[] {
  const starts: Array<{ at: number; nal: number }> = [];
  for (let i = 0; i + 3 < stream.length; i++) {
    if (stream[i] === 0 && stream[i + 1] === 0 && (stream[i + 2] === 1 || (stream[i + 2] === 0 && stream[i + 3] === 1))) {
      const long = stream[i + 2] === 0;
      const header = i + (long ? 4 : 3);
      if (header < stream.length) starts.push({ at: i, nal: stream[header] & 0x1f });
      i = header;
    }
  }
  const out: AccessUnit[] = [];
  let begin = -1;
  let key = false;
  for (const s of starts) {
    if (s.nal === 9) {
      if (begin >= 0) out.push({ data: stream.subarray(begin, s.at), key });
      begin = s.at;
      key = false;
    } else if (s.nal === 5) key = true;
  }
  if (begin >= 0) out.push({ data: stream.subarray(begin), key });
  return out;
}

/**
 * The base loop drawn once more for a relay, with pictures over it (the bug; a spot's code): the
 * relay's size, its keyframes on the same frames as the base loop's, as access units.
 */
export async function relayLoop(base: string, overlays: string[], size: { width: number; height: number }, frames: number, file: string): Promise<AccessUnit[]> {
  const cached = await fs.readFile(file).catch(() => null);
  if (cached) return accessUnits(cached);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const inputs = ["-i", base, ...overlays.flatMap((png) => ["-loop", "1", "-i", png])];
  const graph = [`[0:v]${fit(size)},format=yuv420p[m0]`];
  overlays.forEach((_, i) => {
    graph.push(`[${i + 1}:v]scale=${size.width}:${size.height},format=rgba[o${i}]`);
    graph.push(`[m${i}][o${i}]overlay=0:0:shortest=1:format=auto[m${i + 1}]`);
  });
  graph.push(`[m${overlays.length}]format=yuv420p[out]`);
  const partial = `${file}.${process.pid}.${Date.now()}.part`;
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-an", "-frames:v", String(frames), "-r", String(LOOP_FPS),
    ...x264(21, 1500), "-x264-params", "aud=1:repeat-headers=1", "-f", "h264", partial
  ];
  const made = await run("ffmpeg", args);
  if (made.code !== 0) {
    await fs.rm(partial, { force: true });
    throw new Error(`ffmpeg exited ${made.code}: ${made.stderr.trim().split("\n").slice(-2).join(" ")}`);
  }
  await fs.rename(partial, file);
  return accessUnits(await fs.readFile(file));
}

/** A cache name for a relay loop: what it's drawn from, and at what size. */
export async function loopName(base: string, overlays: string[], size: { width: number; height: number }): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`${size.width}x${size.height}|v1`);
  for (const f of [base, ...overlays]) hash.update(await fs.readFile(f));
  return hash.digest("hex").slice(0, 24);
}

// --- Laying the picture under the sound -------------------------------------------------------

export interface VideoFrame {
  pts: number;
  au: AccessUnit;
  /** Which loop it came from ("base", or a code's). */
  loop: string;
}

/**
 * The relay's picture: the base loop's frames, one after another at 30 fps, forever, timed against
 * the joined sound's clock; another loop (a spot's code) instead while it's wanted, switching at
 * keyframes only (every loop has them on the same frames).
 */
export class PictureTrack {
  private loops = new Map<string, AccessUnit[]>();
  private current = "base";
  private index = 0;
  private clock: number | null = null;
  /** Frames sent from each loop (what the relay drew, for its log and tests). */
  readonly sent = new Map<string, number>();

  constructor(base: AccessUnit[]) {
    if (!base.length || !base[0].key) throw new Error("the loop doesn't start on a keyframe");
    this.loops.set("base", base);
  }

  has(loop: string) {
    return this.loops.has(loop);
  }

  add(loop: string, units: AccessUnit[]) {
    const base = this.loops.get("base")!;
    // Only a loop whose keyframes fall where the base loop's do can be switched to.
    if (units.length !== base.length || units.some((u, i) => u.key !== base[i].key)) throw new Error("the loop's keyframes don't line up with the base loop's");
    this.loops.set(loop, units);
    if (this.loops.size > 12) {
      const drop = [...this.loops.keys()].find((k) => k !== "base" && k !== this.current);
      if (drop) this.loops.delete(drop);
    }
  }

  /** Where the picture's clock is (90 kHz), or null before the first frame. */
  get at() {
    return this.clock;
  }

  /**
   * The frames from the clock up to `until` (90 kHz), starting at `from` the first time. `wanted`
   * says which loop each frame's time asks for; loops not loaded yet stay on the one showing.
   */
  frames(from: number, until: number, wanted: (pts: number) => string): VideoFrame[] {
    this.clock ??= from;
    const out: VideoFrame[] = [];
    while (this.clock < until) {
      const base = this.loops.get("base")!;
      const unit = base[this.index];
      if (unit.key) {
        // A keyframe: the loop the middle of the coming two seconds asks for, so a code starts and
        // ends at the keyframe nearest its times (within a second).
        const want = wanted(this.clock + (LOOP_GOP / 2) * TICKS_PER_FRAME);
        this.current = this.loops.has(want) ? want : "base";
      }
      const units = this.loops.get(this.current) ?? base;
      out.push({ pts: this.clock, au: units[this.index], loop: this.current });
      this.sent.set(this.current, (this.sent.get(this.current) ?? 0) + 1);
      this.index = (this.index + 1) % base.length;
      this.clock += TICKS_PER_FRAME;
    }
    return out;
  }
}

const PACKET = 188;

function writePts(b: Buffer, at: number, prefix: number, value: number) {
  const v = ((value % 2 ** 33) + 2 ** 33) % 2 ** 33;
  b[at] = (prefix << 4) | (Math.floor(v / 2 ** 30) << 1) | 1;
  const mid = Math.floor(v / 2 ** 15) & 0x7fff;
  const low = v & 0x7fff;
  b[at + 1] = mid >> 7;
  b[at + 2] = ((mid & 0x7f) << 1) | 1;
  b[at + 3] = low >> 7;
  b[at + 4] = ((low & 0x7f) << 1) | 1;
}

function readPts(b: Buffer, at: number): number {
  return ((b[at] >> 1) & 0x07) * 2 ** 30 + ((b[at + 1] << 7) | (b[at + 2] >> 1)) * 2 ** 15 + ((b[at + 3] << 7) | (b[at + 4] >> 1));
}

/**
 * The joined sound (tsretime's output: sound on PID 0x101) with the picture's frames laid in as
 * PES on 0x100, interleaved by time under one program table (the PCR on the picture). Continuity
 * counters run on across calls.
 */
export class RelayMuxer {
  private cc = new Map<number, number>();

  private counter(pid: number) {
    const next = ((this.cc.get(pid) ?? -1) + 1) & 0x0f;
    this.cc.set(pid, next);
    return next;
  }

  /** The sound's PES packets grouped (each group starts a PES), with their times. */
  static soundGroups(ts: Buffer): Array<{ pts: number; packets: Buffer[] }> {
    const groups: Array<{ pts: number; packets: Buffer[] }> = [];
    for (let p = 0; p + PACKET <= ts.length; p += PACKET) {
      if (ts[p] !== 0x47) continue;
      const pid = ((ts[p + 1] & 0x1f) << 8) | ts[p + 2];
      if (pid !== OUT_PID.audio) continue;
      const packet = ts.subarray(p, p + PACKET);
      if (packet[1] & 0x40) {
        const adaptation = (packet[3] >> 4) & 0x3;
        const payload = 4 + (adaptation & 0x2 ? 1 + packet[4] : 0);
        let pts = groups.length ? groups[groups.length - 1].pts : 0;
        if (payload + 14 <= PACKET && packet[payload] === 0 && packet[payload + 1] === 0 && packet[payload + 2] === 1 && packet[payload + 7] & 0x80) pts = readPts(packet, payload + 9);
        groups.push({ pts, packets: [packet] });
      } else if (groups.length) groups[groups.length - 1].packets.push(packet);
    }
    return groups;
  }

  /** One frame as TS packets on 0x100: a PES with its PTS (no B-frames: decode order is display order). */
  private framePackets(frame: VideoFrame): Buffer[] {
    const head = Buffer.alloc(14);
    head.set([0, 0, 1, 0xe0, 0, 0, 0x84, 0x80, 5]);
    writePts(head, 9, 0x2, frame.pts);
    const payload = Buffer.concat([head, frame.au.data]);
    const out: Buffer[] = [];
    let at = 0;
    let first = true;
    while (at < payload.length) {
      const packet = Buffer.alloc(PACKET, 0xff);
      packet[0] = 0x47;
      packet[1] = (first ? 0x40 : 0) | (OUT_PID.video >> 8);
      packet[2] = OUT_PID.video & 0xff;
      // The adaptation field: the PCR (and random access on a keyframe) on a frame's first packet;
      // stuffing where the frame's last bytes don't fill a packet.
      let field: number[] | null = null;
      if (first) {
        const pcr = Math.max(0, frame.pts - 63_000);
        field = [(frame.au.key ? 0x40 : 0) | 0x10, Math.floor(pcr / 2 ** 25) & 0xff, Math.floor(pcr / 2 ** 17) & 0xff, Math.floor(pcr / 2 ** 9) & 0xff, Math.floor(pcr / 2) & 0xff, ((pcr & 1) << 7) | 0x7e, 0];
      }
      const left = payload.length - at;
      if (field) {
        const space = 184 - 1 - field.length;
        if (left < space) field.push(...new Array<number>(space - left).fill(0xff));
      } else if (left < 184) {
        const stuff = 184 - left;
        field = stuff === 1 ? [] : [0x00, ...new Array<number>(stuff - 2).fill(0xff)];
      }
      packet[3] = ((field ? 0x3 : 0x1) << 4) | this.counter(OUT_PID.video);
      let o = 4;
      if (field) {
        packet[o++] = field.length;
        for (const b of field) packet[o++] = b;
      }
      const take = Math.min(PACKET - o, left);
      payload.copy(packet, o, at, at + take);
      at += take;
      first = false;
      out.push(packet);
    }
    return out;
  }

  /** The sound of one stretch (TS, sound on 0x101) and the frames for it, as one TS stream. */
  mux(sound: Buffer, frames: VideoFrame[]): Buffer {
    const pat = patPacket();
    const pmt = pmtPacket(OUT_PID.video, 0x1b, 0x0f);
    pat[3] = (pat[3] & 0xf0) | this.counter(0);
    pmt[3] = (pmt[3] & 0xf0) | this.counter(OUT_PID.pmt);
    const out: Buffer[] = [pat, pmt];
    const groups = RelayMuxer.soundGroups(sound);
    let g = 0;
    for (const frame of frames) {
      while (g < groups.length && groups[g].pts < frame.pts) out.push(...groups[g++].packets);
      out.push(...this.framePackets(frame));
    }
    while (g < groups.length) out.push(...groups[g++].packets);
    return Buffer.concat(out);
  }
}

/** The first sound timestamp in joined TS (90 kHz), or null. */
export function firstSoundPts(ts: Buffer): number | null {
  const groups = RelayMuxer.soundGroups(ts);
  return groups.length ? Math.min(...groups.map((g) => g.pts)) : null;
}
