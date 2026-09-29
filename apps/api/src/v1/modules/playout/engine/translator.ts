// Translators: relays of a channel to YouTube, Twitch or any RTMP address. The one place a
// continuous encode can be needed, and only while a translator is on. It reads the channel's own
// timeline (the segments its playlist publishes, 720p on the TV band), joins them into one stream
// (tsretime.ts), and pushes it over RTMP with FFmpeg:
//
//   - stream-copied when nothing has to be drawn (the station's bug is off, or the break handling
//     needs no picture change);
//   - re-encoded when the bug is drawn on (players draw it themselves; here the picture leaves
//     Opencast's players, so the worker composites it);
//   - on the radio band, the station's sound over its relay background (background.ts: prepared
//     once at upload into a loop, drawn once more with the bug when the relay starts), or without
//     one a picture in the station's colour with its call sign and channel. Nothing is encoded
//     while it relays: the loop's frames are laid under the sound and stream-copied;
//   - a spot's code, offer and QR for its last 10 s (its `code` DATERANGE), as the player draws
//     them: on the TV band drawn into the segments it shows in (each re-encoded on its own, its
//     timestamps kept, like captions); on the radio band a loop of its own, prepared once per
//     code, switched to at the keyframe nearest the code's start and back after;
//   - a station that chose "Station ID slate" for breaks gets the prepared station ID slate in
//     place of every segment in a break;
//   - captions are drawn into the picture only if the station chose that for the translator
//     (`burnCaptions`, off by default; X2): each segment with cues is re-encoded on its own, with
//     its timestamps kept, before it's relayed. Segments without cues pass as they are.
//
// Each session's egress (bytes sent) is recorded in `translator_sessions`: relaying a full channel
// around the clock is the largest per-station cost.

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import type { ModuleContext } from "../../../context.js";
import { parseVtt } from "../../../lib/captions.js";
import { objectKey } from "../../../storage.js";
import { captionSources, type CaptionSource } from "./captions.js";
import type { ChannelLook } from "./assemble.js";
import { firstSoundPts, loopName, PictureTrack, prepareBaseLoop, relayLoop, RelayMuxer } from "./background.js";
import { REFERENCE, type RenditionName } from "./ladder.js";
import type { Preparer } from "./prepare.js";
import { publishedCount } from "./playlist.js";
import { captionPng, type Slates } from "./slates.js";
import { firstPts, TsRetimer } from "./tsretime.js";

const CI = schema.channelItems;
const TS = schema.translatorSessions;

export interface TranslatorTarget {
  id: string;
  rtmpUrl: string;
  streamKey: string;
  breakHandling: "air_spots" | "station_id_slate";
  /** Draw captions into the picture (X2). Off unless the station chose it. */
  burnCaptions?: boolean;
  /** A radio station's relay background, prepared (its loop's storage prefix and frames); none: the picture in its colour. */
  background?: { loopKey: string; frames: number } | null;
}

/** A spot's code on a row (its `code` DATERANGE), in channel time. */
export interface CodeWindow {
  key: string;
  start: number;
  end: number;
  code: string;
  offer: string;
  qrUrl: string;
}

/** The code a channel row carries, if any. */
export function codeWindow(tags: string[]): CodeWindow | null {
  const range = parseDateRanges(tags.join("\n")).find((r) => r.class === HLS_CLASS.code);
  if (!range || range.end === null) return null;
  const a = range.attributes;
  const code = String(a.code ?? "");
  const offer = String(a.offer ?? "");
  const qrUrl = String(a.qrUrl ?? "");
  if (!code) return null;
  return { key: `code:${code}|${offer}|${qrUrl}`, start: range.start, end: range.end, code, offer, qrUrl };
}

/**
 * Where a code shows in one segment, in the segment's own seconds (as its timestamps say): the
 * segment starts at `segmentStart` (channel time) and at `firstSeconds` on its clock. Null when
 * the code doesn't show in it.
 */
export function codeInSegment(code: CodeWindow, segmentStart: number, segmentMs: number, firstSeconds: number): { from: number; to: number } | null {
  const from = Math.max(code.start, segmentStart);
  const to = Math.min(code.end, segmentStart + segmentMs);
  if (to - from < 1) return null;
  return { from: firstSeconds + (from - segmentStart) / 1000, to: firstSeconds + (to - segmentStart) / 1000 };
}

export interface TranslatorOptions {
  look: ChannelLook;
  preparer: Preparer;
  slates: Slates;
  log?(line: string): void;
  /** Scratch space for drawing captions in (the worker's). */
  scratchDir?: string;
}

/**
 * Draws pictures into one TS segment: each a full-frame picture (transparent but for what it
 * shows) laid over the frames it shows on (`from`/`to` in the segment's own seconds, as its
 * timestamps say). The segment is re-encoded with its timestamps kept (the relay retimes it with
 * the rest); the sound is copied. Null when FFmpeg fails (the segment then goes as it was).
 */
export async function drawInto(segment: Buffer, pictures: Array<{ png: string; from: number; to: number }>, size: { width: number; height: number; videoKbps: number }): Promise<Buffer | null> {
  if (!pictures.length) return segment;
  const inputs: string[] = [];
  const graph: string[] = [];
  let last = "0:v";
  for (const [i, p] of pictures.entries()) {
    inputs.push("-loop", "1", "-i", p.png);
    graph.push(`[${i + 1}:v]scale=${size.width}:${size.height},format=rgba[p${i}]`);
    graph.push(`[${last}][p${i}]overlay=0:0:shortest=1:enable='between(t,${p.from.toFixed(3)},${p.to.toFixed(3)})'[c${i}]`);
    last = `c${i}`;
  }
  const args = [
    "-hide_banner", "-loglevel", "error", "-copyts", "-f", "mpegts", "-i", "pipe:0", ...inputs,
    "-filter_complex", graph.join(";"), "-map", `[${last}]`, "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${size.videoKbps}k`, "-maxrate", `${Math.round(size.videoKbps * 1.1)}k`, "-bufsize", `${size.videoKbps * 2}k`, "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-muxdelay", "0", "-muxpreload", "0", "-f", "mpegts", "pipe:1"
  ];
  return new Promise<Buffer | null>((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", () => undefined);
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    child.stdin.end(segment);
  });
}

/**
 * Draws caption cues into one TS segment's picture (X2): each cue a picture laid over the frames
 * it shows on (`from`/`to` in the segment's own seconds). Null when FFmpeg fails.
 */
export async function burnCaptionsIn(segment: Buffer, cues: Array<{ text: string; from: number; to: number }>, size: { width: number; height: number; videoKbps: number }, scratchDir: string): Promise<Buffer | null> {
  if (!cues.length) return segment;
  const dir = await fs.mkdtemp(path.join(scratchDir, "burn-"));
  try {
    const pictures: Array<{ png: string; from: number; to: number }> = [];
    for (const [i, cue] of cues.entries()) {
      const png = path.join(dir, `cue${i}.png`);
      await captionPng(cue.text, size.width, size.height, png);
      pictures.push({ png, from: cue.from, to: cue.to });
    }
    return await drawInto(segment, pictures, size);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export class TranslatorRelay {
  private child?: ChildProcess;
  private sessionId?: string;
  private bytes = 0;
  private nextSeq: number | null = null;
  private retimer = new TsRetimer();
  private stopped = false;
  private loop?: Promise<void>;
  private lastSaved = 0;
  private waitingForRun: number | null = null;
  private lastOpen = 0;
  /** The session's closing write, once FFmpeg has exited. */
  private ending?: Promise<void>;
  /** Radio: the picture under the sound, and the muxer that lays it in. */
  private picture: { track: PictureTrack | null; base: string; frames: number; overlays: string[]; size: { width: number; height: number } } | null = null;
  private muxer = new RelayMuxer();
  /** Code loops being prepared (radio), by key. */
  private codeLoops = new Map<string, Promise<void>>();
  private lastLookahead = 0;

  constructor(
    private ctx: ModuleContext,
    readonly stationId: string,
    readonly target: TranslatorTarget,
    private options: TranslatorOptions
  ) {}

  /** A signature of what the relay was started with (a change restarts it). */
  static signature(t: TranslatorTarget) {
    return `${t.rtmpUrl}|${t.streamKey}|${t.breakHandling}${t.burnCaptions ? "|captions" : ""}${t.background ? `|bg:${t.background.loopKey}` : ""}`;
  }

  /** Each row's captions, looked up once (rows are relayed in order, a few at a time). */
  private captions = new Map<string, CaptionSource | null>();

  /** The cues showing during a prepared segment, in its own seconds, or none. */
  private async cuesFor(row: typeof CI.$inferSelect, index: number): Promise<Array<{ text: string; from: number; to: number }>> {
    if (!this.captions.has(row.id)) {
      const found = await captionSources(this.ctx.deps.db, (ids) => this.ctx.services.library.captionTrackIds(ids), [row]).catch(() => new Map<string, CaptionSource>());
      this.captions.set(row.id, found.get(row.id) ?? null);
      if (this.captions.size > 200) this.captions.delete(this.captions.keys().next().value!);
    }
    const source = this.captions.get(row.id);
    const n = row.firstSegment + index;
    if (!source || n >= source.segments) return [];
    const stream = await this.ctx.deps.storage.objects.open?.(`${objectKey.prepared(source.key, source.rendition)}/seg_${String(n).padStart(5, "0")}.vtt`).catch(() => null);
    if (!stream) return [];
    const vtt = parseVtt((await bytesOf(stream)).toString("utf8"));
    const map = vtt.timestampMap ?? { mpegts: 0, localMs: 0 };
    const at = (ms: number) => (map.mpegts + (ms - map.localMs) * 90) / 90_000;
    return vtt.cues.map((c) => ({ text: c.text, from: at(c.startMs), to: at(c.endMs) }));
  }

  /** `composite` when the relay re-encodes the picture (the TV band's bug); `copy` otherwise (radio: the picture is prepared). */
  get mode(): "copy" | "composite" {
    const look = this.options.look;
    return look.band === "tv" && look.bug.mode !== "off" ? "composite" : "copy";
  }

  get rendition(): RenditionName {
    return REFERENCE[this.options.look.band];
  }

  private log(line: string) {
    this.options.log?.(`[translator ${this.options.look.callSign ?? this.stationId.slice(0, 8)}] ${line}`);
  }

  start() {
    this.loop = this.follow().catch((error) => this.log(`stopped: ${(error as Error).message}`));
  }

  async stop() {
    this.stopped = true;
    await this.loop;
    await this.close();
  }

  private destination() {
    return `${this.target.rtmpUrl.replace(/\/+$/, "")}/${this.target.streamKey}`;
  }

  private async open() {
    const look = this.options.look;
    const out = ["-f", "flv", "-flvflags", "no_duration_filesize", this.destination()];
    const common = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-re", "-f", "mpegts", "-i", "pipe:0"];
    let args: string[];
    if (look.band === "radio") {
      // The picture is prepared (the loop, with the bug); the sound is the channel's. Both copied.
      if (!this.picture) {
        this.picture = await this.preparePicture(true).catch(async (error) => {
          // A background that can't be read or drawn: the station's colour instead.
          if (this.target.background) this.log(`the background couldn't be used (${(error as Error).message.slice(0, 200)}): the station's colour instead`);
          return this.preparePicture(false);
        });
      }
      this.picture.track = new PictureTrack((await this.loopFor([])) ?? []);
      this.muxer = new RelayMuxer();
      args = [...common, "-map", "0:v", "-map", "0:a", "-c", "copy", "-bsf:a", "aac_adtstoasc", ...out];
    } else if (this.mode === "composite") {
      const r = this.options.preparer.ladder[this.rendition];
      const bug = await this.options.slates.bug(look, look.bug.opacity);
      args = [
        ...common, "-loop", "1", "-i", bug,
        // The picture fitted to the relay's size first: a live block's source may arrive at another size.
        "-filter_complex", `[0:v]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[m];[1:v]scale=${r.width}:${r.height},format=rgba[b];[m][b]overlay=0:0:shortest=1,format=yuv420p[out]`,
        "-map", "[out]", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${r.videoKbps}k`, "-maxrate", `${Math.round(r.videoKbps * 1.1)}k`, "-bufsize", `${r.videoKbps * 2}k`, "-g", "60", "-r", "30",
        "-c:a", "copy", "-bsf:a", "aac_adtstoasc", ...out
      ];
    } else {
      args = [...common, "-map", "0:v?", "-map", "0:a?", "-c", "copy", "-bsf:a", "aac_adtstoasc", ...out];
    }
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.bytes = 0;
    this.retimer = new TsRetimer();
    child.stdin?.on("error", () => undefined);
    let progress = "";
    child.stdout?.on("data", (d) => {
      progress += String(d);
      const lines = progress.split("\n");
      progress = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^total_size=(\d+)/.exec(line);
        if (m) this.bytes = Number(m[1]);
      }
    });
    let lastError = "";
    child.stderr?.on("data", (d) => (lastError = String(d).trim().slice(-300)));
    child.on("close", (code) => {
      if (this.child === child) this.child = undefined;
      if (code && !this.stopped) this.log(`ffmpeg exited ${code}: ${lastError}`);
      this.ending = this.save(true, code ? lastError : null);
    });
    const [session] = await this.ctx.deps.db
      .insert(TS)
      .values({ translatorId: this.target.id, stationId: this.stationId, mode: this.mode, swapsBreaks: this.target.breakHandling === "station_id_slate", startedAt: this.ctx.deps.clock.now() })
      .returning({ id: TS.id });
    this.sessionId = session.id;
    this.log(`relaying (${this.mode}${look.band === "radio" ? (this.target.background ? ", over the station's background" : ", over the station's colour") : ""}${this.target.breakHandling === "station_id_slate" ? ", station ID slate in breaks" : ""}${this.target.burnCaptions ? ", captions drawn in" : ""})`);
  }

  // --- The radio band's picture ---

  private scratch() {
    return this.options.scratchDir ?? os.tmpdir();
  }

  /** The base loop (the station's background, or its colour with its call sign and channel) and the bug over it. */
  private async preparePicture(withBackground: boolean) {
    const look = this.options.look;
    const r = this.options.preparer.ladder.v720;
    const size = { width: r.width, height: r.height };
    const dir = path.join(this.scratch(), "relay");
    await fs.mkdir(dir, { recursive: true });
    let base: string;
    let frames: number;
    const bg = withBackground ? this.target.background : null;
    const stored = bg ? await this.ctx.deps.storage.objects.open?.(`${bg.loopKey}/loop.mp4`).catch(() => null) : null;
    if (bg && stored) {
      base = path.join(dir, `bg-${createHash("sha256").update(bg.loopKey).digest("hex").slice(0, 16)}.mp4`);
      await fs.writeFile(base, await bytesOf(stored));
      frames = bg.frames;
    } else {
      const png = await this.options.slates.stationId(look);
      const out = path.join(dir, `sid-${createHash("sha256").update(await fs.readFile(png)).update(`${size.width}x${size.height}`).digest("hex").slice(0, 16)}`);
      const made = await fs.access(path.join(out, "loop.mp4")).then(
        async () => ({ loop: path.join(out, "loop.mp4"), frames: Number(await fs.readFile(path.join(out, "frames"), "utf8").catch(() => "60")) || 60 }),
        async () => {
          const p = await prepareBaseLoop(png, "image", null, size, out);
          await fs.writeFile(path.join(out, "frames"), String(p.frames));
          return { loop: p.loop, frames: p.frames };
        }
      );
      base = made.loop;
      frames = made.frames;
    }
    const overlays = look.bug.mode !== "off" ? [await this.options.slates.bug(look, look.bug.opacity)] : [];
    const picture = { track: null as PictureTrack | null, base, frames, overlays, size };
    // Drawn once now with the bug: a background that can't be drawn fails here, not mid-relay.
    this.picture = picture;
    await this.loopFor([]);
    return picture;
  }

  /** The loop with the bug and `more` over it (a code), prepared once and kept in scratch. */
  private async loopFor(more: string[]) {
    const p = this.picture;
    if (!p) return null;
    const overlays = [...p.overlays, ...more];
    const name = await loopName(p.base, overlays, p.size);
    return relayLoop(p.base, overlays, p.size, p.frames, path.join(this.scratch(), "relay", `${name}.h264`));
  }

  /** A spot's code over the loop (radio), prepared once per code and then kept. */
  private ensureCode(code: CodeWindow) {
    if (this.options.look.band !== "radio" || !this.picture) return;
    if (this.picture.track?.has(code.key) || this.codeLoops.has(code.key)) return;
    const work = (async () => {
      const png = await this.options.slates.code(code.code, code.offer, code.qrUrl, this.picture!.size);
      const units = await this.loopFor([png]);
      if (units && this.picture?.track) this.picture.track.add(code.key, units);
    })()
      .catch((error) => this.log(`the code ${code.code} couldn't be drawn: ${(error as Error).message.slice(0, 200)}`))
      .finally(() => this.codeLoops.delete(code.key));
    this.codeLoops.set(code.key, work);
  }

  /** What goes to FFmpeg for one segment: joined; on the radio band, with the picture laid in. */
  private output(seg: { buf: Buffer; item: string; ms: number; code: CodeWindow | null; startsAt: number }): Buffer {
    const joined = this.retimer.retime(seg.buf, seg.item, seg.ms);
    const track = this.picture?.track;
    if (this.options.look.band !== "radio" || !track) return joined;
    const first = firstSoundPts(joined);
    if (first === null) return joined;
    const code = seg.code;
    if (code) this.ensureCode(code);
    const wanted = (pts: number) => {
      const t = seg.startsAt + (pts - first) / 90;
      return code && t >= code.start && t < code.end ? code.key : "base";
    };
    return this.muxer.mux(joined, track.frames(first, first + seg.ms * 90, wanted));
  }

  /** Frames the radio relay drew from each loop this session ("base", or a code's key). */
  get pictureFrames(): Map<string, number> {
    return this.picture?.track?.sent ?? new Map();
  }

  private async save(ended = false, error: string | null = null) {
    if (!this.sessionId) return;
    const id = this.sessionId;
    if (ended) this.sessionId = undefined;
    this.lastSaved = Date.now();
    await this.ctx.deps.db
      .update(TS)
      .set({ bytesSent: this.bytes, updatedAt: this.ctx.deps.clock.now(), ...(ended ? { endedAt: this.ctx.deps.clock.now() } : {}), ...(error ? { lastError: error } : {}) })
      .where(eq(TS.id, id))
      .catch(() => undefined);
  }

  private async close() {
    const child = this.child;
    if (!child) return this.ending;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("close", () => {
        clearTimeout(kill);
        resolve();
      });
      child.stdin?.end();
    });
    // The session's end (and its last bytes) is written before this returns: a worker shutting
    // down exits right after.
    await this.ending;
    await this.save(true);
  }

  private async write(buf: Buffer) {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return;
    if (!stdin.write(buf)) await new Promise<void>((resolve) => stdin.once("drain", () => resolve()));
  }

  /** Reads a live segment: the worker's own from storage, Livepeer's over HTTP. */
  private async liveBytes(uri: string): Promise<Buffer | null> {
    const own = /(prepared\/[\w-]+\/[a-z0-9]+\/seg_\d{5}\.ts)(?:$|\?)/.exec(uri);
    if (own && this.ctx.deps.storage.objects.open) {
      const stream = await this.ctx.deps.storage.objects.open(own[1]).catch(() => null);
      if (stream) return bytesOf(stream);
    }
    if (!/^https?:\/\//.test(uri)) return null;
    const response = await fetch(uri, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
  }

  /** A segment's bytes (prepared ones from storage, live ones as above), with the code it shows, if any. */
  private async segment(row: typeof CI.$inferSelect, index: number): Promise<{ buf: Buffer; item: string; ms: number; code: CodeWindow | null; startsAt: number } | null> {
    const ms = row.segmentMs[index];
    const startsAt = row.startsAt.getTime() + row.segmentMs.slice(0, index).reduce((a, b) => a + b, 0);
    if (row.inBreak && this.target.breakHandling === "station_id_slate") {
      // The station ID slate in place of the break, a slate per segment (and not the spot's code).
      const seconds = Math.max(1, Math.min(4, Math.round(ms / 1000)));
      const key = await this.options.preparer.slate(await this.options.slates.stationId(this.options.look), seconds, this.options.look.band);
      const stream = await this.ctx.deps.storage.objects.open?.(`${objectKey.prepared(key, this.rendition)}/seg_00000.ts`);
      return stream ? { buf: await bytesOf(stream), item: `${row.id}:${index}`, ms, code: null, startsAt } : null;
    }
    const code = codeWindow(row.tags);
    if (row.kind === "live") {
      const uri = row.liveUris?.[this.rendition]?.[index];
      const buf = uri ? await this.liveBytes(uri) : null;
      return buf ? { buf, item: row.id, ms, code, startsAt } : null;
    }
    if (!row.preparedKey) return null;
    const name = `seg_${String(row.firstSegment + index).padStart(5, "0")}.ts`;
    const stream = await this.ctx.deps.storage.objects.open?.(`${objectKey.prepared(row.preparedKey, this.rendition)}/${name}`).catch(() => null);
    if (!stream) return null;
    let buf = await bytesOf(stream);
    if (this.options.look.band === "tv") {
      const r = this.options.preparer.ladder[this.rendition];
      const size = { width: r.width, height: r.height, videoKbps: r.videoKbps };
      // Captions drawn in, only if the station chose it.
      if (this.target.burnCaptions) {
        const cues = await this.cuesFor(row, index).catch(() => []);
        if (cues.length) buf = (await burnCaptionsIn(buf, cues, size, this.scratch())) ?? buf;
      }
      // The spot's code for its last 10 s, as the player draws it.
      const first = code ? firstPts(buf) : null;
      const shows = code && first !== null ? codeInSegment(code, startsAt, ms, first / 90_000) : null;
      if (code && shows) {
        const png = await this.options.slates.code(code.code, code.offer, code.qrUrl, { width: r.width, height: r.height });
        buf = (await drawInto(buf, [{ png, ...shows }], size)) ?? buf;
        this.codeSegments++;
      }
    }
    return { buf, item: row.id, ms, code, startsAt };
  }

  /** TV: segments the code was drawn into this session. */
  codeSegments = 0;

  /** Codes on rows about to air: their loops prepared before they're needed (radio). */
  private async lookahead(now: Date) {
    if (this.options.look.band !== "radio" || !this.picture || Date.now() - this.lastLookahead < 5_000) return;
    this.lastLookahead = Date.now();
    const soon = await this.ctx.deps.db
      .select({ tags: CI.tags })
      .from(CI)
      .where(and(eq(CI.stationId, this.stationId), gt(CI.startsAt, now), lte(CI.startsAt, new Date(now.getTime() + 60_000))));
    for (const row of soon) {
      const code = codeWindow(row.tags);
      if (code) this.ensureCode(code);
    }
  }

  private async follow() {
    const { db } = this.ctx.deps;
    while (!this.stopped) {
      const now = this.ctx.deps.clock.now();
      const rows = await db
        .select()
        .from(CI)
        .where(and(eq(CI.stationId, this.stationId), lte(CI.startsAt, now), gt(CI.endsAt, new Date(now.getTime() - 5 * 60_000))))
        .orderBy(asc(CI.seq), asc(CI.startsAt));
      const latestRun = rows.length ? rows[rows.length - 1].run : null;
      if (latestRun !== null && this.waitingForRun !== null && latestRun > this.waitingForRun) {
        this.waitingForRun = null;
        this.nextSeq = null;
      }
      if (this.waitingForRun === null && latestRun !== null) {
        const current = rows.filter((r) => r.run === latestRun);
        if (this.nextSeq === null) {
          // Join at the live edge: the newest published segment.
          const edge = current.filter((r) => r.kind !== "end").flatMap((r) => (publishedCount(r, now.getTime()) ? [r.seq + publishedCount(r, now.getTime()) - 1] : []));
          if (edge.length) this.nextSeq = Math.max(...edge);
        }
        for (const row of current) {
          if (this.stopped || this.nextSeq === null) break;
          if (row.kind === "end") {
            // Planned off air: the relay ends with the playlist, and starts again with the next one.
            this.log("the channel signed off: relay closed until it's back");
            await this.close();
            this.waitingForRun = row.run;
            break;
          }
          const published = publishedCount(row, now.getTime());
          for (let i = Math.max(0, this.nextSeq - row.seq); i < published; i++) {
            if (!this.child) {
              // The destination dropped: try again every few seconds, skipping what airs meanwhile.
              if (Date.now() - this.lastOpen < 5_000) {
                this.nextSeq = row.seq + i + 1;
                continue;
              }
              this.lastOpen = Date.now();
              await this.open();
            }
            const seg = await this.segment(row, i).catch(() => null);
            this.nextSeq = row.seq + i + 1;
            if (!seg) continue;
            await this.write(this.output(seg));
          }
        }
      }
      await this.lookahead(now).catch(() => undefined);
      if (Date.now() - this.lastSaved > 15_000) await this.save();
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** Bytes sent in this session so far. */
  get bytesSent() {
    return this.bytes;
  }
}
