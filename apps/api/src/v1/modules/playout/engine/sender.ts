// A station's relay sender (follow-up Phase 3; it was the worker's per-destination translator):
// one continuous stream per station, made by the relay service (apps/relay), never by the worker.
// It reads the channel's own timeline (the segments its playlist publishes, 720p on the TV band,
// prepared once), joins them into one stream (tsretime.ts) and hands it to the fan-out (fanout.ts),
// which pushes it to the station's Livepeer relay stream (or to each platform, in direct mode):
//
//   - stream-copied when nothing has to be drawn (the station bug is off on relays, or off for the
//     station), so nothing is re-encoded;
//   - re-encoded when the bug is drawn on (players draw it themselves; here the picture leaves
//     Opencast's players, so the relay composites it);
//   - live blocks (the segments the channel's playlist points at while they air: since 2026-09-30
//     always the worker's own copies in storage, TV ones copied once from Livepeer, livecopy.ts,
//     read here from storage like prepared ones, never from Livepeer) go through the same sender,
//     so platforms see one stream with no interruption when a live block starts or ends;
//   - on the radio band, the station's sound over its relay background (background.ts: prepared
//     once at upload into a loop, drawn once more with the bug when the relay starts), or without
//     one a picture in the station's colour with its call sign and channel. Nothing is encoded
//     while it relays: the loop's frames are laid under the sound and stream-copied;
//   - a spot's code, offer and QR for its last 10 s (its `code` DATERANGE), as the player draws
//     them: on the TV band drawn into the segments it shows in (each re-encoded on its own, its
//     timestamps kept, like captions); on the radio band a loop of its own, prepared once per
//     code, switched to at the keyframe nearest the code's start and back after;
//   - breaks follow the station's one setting for all relays (relayBreaks.ts): its spots, or the
//     prepared station ID slate in place of every segment in a break; time ads from partners would
//     fill always shows the slate. Spots and credits aired are reported (`onPaidPromotion`) so the
//     platforms can be marked as carrying paid promotion;
//   - (programming Phase 6) a program not cleared for relays (`licences.clearance`, no viewer
//     country) goes as the station's "Airing on Opencast, channel 12.1" slate, prepared once, for
//     the program's length (relayBreaks.ts);
//   - captions are drawn into the picture only if the station chose that (`burnCaptions`, off by
//     default; X2): each segment with cues is re-encoded on its own, with its timestamps kept.
//   - "Live shows only" (`relayMode: live_only`, a radio station's): only live rows are sent.
//
// Each session is recorded in `translator_sessions` (the station's ID as its translator ID, one
// sender per station), with its egress and what it relayed, for billing and the health endpoint.

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
import type { RelayOutput } from "./fanout.js";
import { isPaidPromotion, relayPicture, type RelayBreakHandling } from "./relayBreaks.js";

const CI = schema.channelItems;
const TS = schema.translatorSessions;

/** What a station's relay is set to (the relays module reads it; a change to `signature` starts a new session). */
export interface SenderSettings {
  /** `everything` (billed per hour) or `live_only` (free: only live rows are sent). */
  relayMode: "everything" | "live_only";
  /** "During breaks, relays show". */
  breakHandling: RelayBreakHandling;
  /** "Station bug on relays" (on by default). Off, nothing is drawn: stream-copied. */
  bugOnRelays: boolean;
  /** The station's "Ads from partners" switch: their time shows the station ID slate. */
  partnerAds: boolean;
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

/**
 * The storage key of a live segment the worker stored (`prepared/live-…/<rendition>/seg_NNNNN.ts`,
 * a TV live block's copy or a radio station's own), from its URL in a channel row; null for any
 * other address. The sender reads these from storage, as it does prepared segments.
 */
export function storedSegmentKey(uri: string): string | null {
  return /(prepared\/[\w-]+\/[a-z0-9]+\/seg_\d{5}\.ts)(?:$|\?)/.exec(uri)?.[1] ?? null;
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

export interface SenderOptions {
  look: ChannelLook;
  preparer: Preparer;
  slates: Slates;
  log?(line: string): void;
  /** Scratch space for drawing captions and the radio picture in. */
  scratchDir?: string;
  /** A spot or credit went out on the relay as aired (paid promotion). */
  onPaidPromotion?(row: { id: string; code: string; startsAt: Date }): void;
  /** Where the platforms are counted from: how many it goes to (recorded on the session). */
  platforms?(): number;
  /** The worker's HLS origin (HLS_PUBLIC_URL): prepared segments are read there when storage doesn't have them. */
  segmentBase?: string | null;
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

export class StationSender {
  private child?: ChildProcess;
  private sessionId?: string;
  /** The output's byte count when this session started (its egress is what's sent since). */
  private bytesAtStart = 0;
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
    private settings: SenderSettings,
    private out: RelayOutput,
    private options: SenderOptions
  ) {}

  /** What the sender was started with that needs a new session to change (the picture's making, the mode). */
  static signature(s: SenderSettings, look: Pick<ChannelLook, "band" | "bug">) {
    return `${s.relayMode}|${senderPicture(s, look)}${s.burnCaptions ? "|captions" : ""}${s.background ? `|bg:${s.background.loopKey}` : ""}`;
  }

  /** Settings that apply from the next segment (what breaks show, partner time). */
  update(settings: SenderSettings) {
    this.settings = { ...settings, relayMode: this.settings.relayMode, bugOnRelays: this.settings.bugOnRelays, burnCaptions: this.settings.burnCaptions, background: this.settings.background };
  }

  get current(): SenderSettings {
    return this.settings;
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
    const bytes = await this.object(`${objectKey.prepared(source.key, source.rendition)}/seg_${String(n).padStart(5, "0")}.vtt`);
    if (!bytes) return [];
    const vtt = parseVtt(bytes.toString("utf8"));
    const map = vtt.timestampMap ?? { mpegts: 0, localMs: 0 };
    const at = (ms: number) => (map.mpegts + (ms - map.localMs) * 90) / 90_000;
    return vtt.cues.map((c) => ({ text: c.text, from: at(c.startMs), to: at(c.endMs) }));
  }

  /** `composite` when the relay re-encodes the picture (the TV band's bug, on for relays); `copy` otherwise (radio: the picture is prepared). */
  get mode(): "copy" | "composite" {
    return senderPicture(this.settings, this.options.look);
  }

  get rendition(): RenditionName {
    return REFERENCE[this.options.look.band];
  }

  private log(line: string) {
    this.options.log?.(`[relay ${this.options.look.callSign ?? this.stationId.slice(0, 8)}] ${line}`);
  }

  start() {
    this.loop = this.follow().catch((error) => this.log(`stopped: ${(error as Error).message}`));
  }

  async stop() {
    this.stopped = true;
    await this.loop;
    await this.close();
  }

  private async open() {
    const look = this.options.look;
    // One MPEG-TS stream on stdout, in real time, to the fan-out (which pushes it over RTMP).
    const out = ["-muxdelay", "0", "-muxpreload", "0", "-f", "mpegts", "pipe:1"];
    const common = ["-hide_banner", "-loglevel", "error", "-nostats", "-re", "-f", "mpegts", "-i", "pipe:0"];
    let args: string[];
    if (look.band === "radio") {
      // The picture is prepared (the loop, with the bug); the sound is the channel's. Both copied.
      if (!this.picture) {
        this.picture = await this.preparePicture(true).catch(async (error) => {
          // A background that can't be read or drawn: the station's colour instead.
          if (this.settings.background) this.log(`the background couldn't be used (${(error as Error).message.slice(0, 200)}): the station's colour instead`);
          return this.preparePicture(false);
        });
      }
      this.picture.track = new PictureTrack((await this.loopFor([])) ?? []);
      this.muxer = new RelayMuxer();
      args = [...common, "-map", "0:v", "-map", "0:a", "-c", "copy", ...out];
    } else if (this.mode === "composite") {
      const r = this.options.preparer.ladder[this.rendition];
      const bug = await this.options.slates.bug(look, look.bug.opacity);
      args = [
        ...common, "-loop", "1", "-i", bug,
        // The picture fitted to the relay's size first: a live block's source may arrive at another size.
        "-filter_complex", `[0:v]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[m];[1:v]scale=${r.width}:${r.height},format=rgba[b];[m][b]overlay=0:0:shortest=1,format=yuv420p[out]`,
        "-map", "[out]", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${r.videoKbps}k`, "-maxrate", `${Math.round(r.videoKbps * 1.1)}k`, "-bufsize", `${r.videoKbps * 2}k`, "-g", "60", "-r", "30",
        "-c:a", "copy", ...out
      ];
    } else {
      args = [...common, "-map", "0:v?", "-map", "0:a?", "-c", "copy", ...out];
    }
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.bytesAtStart = this.out.bytes();
    this.retimer = new TsRetimer();
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("data", (d: Buffer) => this.out.write(d));
    let lastError = "";
    child.stderr?.on("data", (d) => (lastError = String(d).trim().slice(-300)));
    child.on("close", (code) => {
      if (this.child === child) this.child = undefined;
      if (code && !this.stopped) {
        this.errors++;
        this.lastError = lastError || `ffmpeg exited ${code}`;
        this.log(`ffmpeg exited ${code}: ${lastError}`);
      }
      this.ending = this.save(true, code ? lastError : null);
    });
    const [session] = await this.ctx.deps.db
      .insert(TS)
      .values({
        // One sender per station: the station's ID stands for its relay.
        translatorId: this.stationId,
        stationId: this.stationId,
        mode: this.mode,
        swapsBreaks: this.settings.breakHandling === "station_id_slate",
        relayMode: this.settings.relayMode,
        platforms: this.options.platforms?.() ?? this.out.destinations,
        startedAt: this.ctx.deps.clock.now()
      })
      .returning({ id: TS.id });
    this.sessionId = session.id;
    this.log(`relaying ${this.settings.relayMode === "live_only" ? "live shows" : "everything"} (${this.mode}${look.band === "radio" ? (this.settings.background ? ", over the station's background" : ", over the station's colour") : ""}${this.settings.breakHandling === "station_id_slate" ? ", station ID slate in breaks" : ""}${this.settings.burnCaptions ? ", captions drawn in" : ""})`);
  }

  /** FFmpeg failures this sender has had (the health endpoint). */
  errors = 0;
  lastError: string | null = null;

  /** Whether the encoder is running (a session is open). */
  get running() {
    return Boolean(this.child);
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
    const bg = withBackground ? this.settings.background : null;
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
    const overlays = look.bug.mode !== "off" && this.settings.bugOnRelays ? [await this.options.slates.bug(look, look.bug.opacity)] : [];
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
      .set({ bytesSent: Math.max(0, this.out.bytes() - this.bytesAtStart), updatedAt: this.ctx.deps.clock.now(), ...(ended ? { endedAt: this.ctx.deps.clock.now() } : {}), ...(error ? { lastError: error } : {}) })
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

  /**
   * An object prepared for air, from storage; or, where this relay has no access to it (a relay on
   * another host with only the channel's address), from the worker's HLS origin (`segmentBase`,
   * HLS_PUBLIC_URL), which serves prepared segments at `/hls/prepared/…`.
   */
  private async object(key: string): Promise<Buffer | null> {
    const stream = await this.ctx.deps.storage.objects.open?.(key).catch(() => null);
    if (stream) {
      const bytes = await bytesOf(stream).catch(() => null);
      if (bytes) return bytes;
    }
    const base = this.options.segmentBase;
    if (!base || !key.startsWith("prepared/")) return null;
    const response = await fetch(`${base.replace(/\/+$/, "")}/hls/${key}`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
  }

  /** Reads a live segment: the worker's own from storage, Livepeer's over HTTP. */
  private async liveBytes(uri: string): Promise<Buffer | null> {
    const own = storedSegmentKey(uri);
    if (own) {
      const bytes = await this.object(own);
      if (bytes) return bytes;
    }
    if (!/^https?:\/\//.test(uri)) return null;
    const response = await fetch(uri, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
  }

  /** A segment's bytes (prepared ones from storage, live ones as above), with the code it shows, if any. */
  private async segment(row: typeof CI.$inferSelect, index: number): Promise<{ buf: Buffer; item: string; ms: number; code: CodeWindow | null; startsAt: number } | null> {
    const ms = row.segmentMs[index];
    const startsAt = row.startsAt.getTime() + row.segmentMs.slice(0, index).reduce((a, b) => a + b, 0);
    const picture = relayPicture(row, this.settings, await this.clearedForRelays(row));
    if (picture.show === "airing_on_opencast") {
      // Programming Phase 6: a program not cleared for relays. The station's "Airing on Opencast,
      // channel 12.1" slate in its place, a slate per segment, for as long as it airs.
      const seconds = Math.max(1, Math.min(4, Math.round(ms / 1000)));
      const key = await this.options.preparer.slate(await this.options.slates.airingOnOpencast(this.options.look), seconds, this.options.look.band);
      const slate = await this.object(`${objectKey.prepared(key, this.rendition)}/seg_00000.ts`);
      if (slate) this.elsewhereSegments++;
      return slate ? { buf: slate, item: `${row.id}:${index}`, ms, code: null, startsAt } : null;
    }
    if (picture.show === "station_id_slate") {
      // The station ID slate in place of the break (the station's choice, or partner time), a slate
      // per segment (and not the spot's code).
      const seconds = Math.max(1, Math.min(4, Math.round(ms / 1000)));
      const key = await this.options.preparer.slate(await this.options.slates.stationId(this.options.look), seconds, this.options.look.band);
      const slate = await this.object(`${objectKey.prepared(key, this.rendition)}/seg_00000.ts`);
      if (slate) this.slateSegments++;
      return slate ? { buf: slate, item: `${row.id}:${index}`, ms, code: null, startsAt } : null;
    }
    if (isPaidPromotion(row, this.settings) && this.lastPaid !== row.id) {
      this.lastPaid = row.id;
      this.options.onPaidPromotion?.({ id: row.id, code: row.code, startsAt: row.startsAt });
    }
    const code = codeWindow(row.tags);
    if (row.kind === "live") {
      const uri = row.liveUris?.[this.rendition]?.[index];
      const buf = uri ? await this.liveBytes(uri) : null;
      if (buf) this.liveSegments++;
      return buf ? { buf, item: row.id, ms, code, startsAt } : null;
    }
    if (!row.preparedKey) return null;
    const name = `seg_${String(row.firstSegment + index).padStart(5, "0")}.ts`;
    const found = await this.object(`${objectKey.prepared(row.preparedKey, this.rendition)}/${name}`);
    if (!found) return null;
    let buf = found;
    if (this.options.look.band === "tv") {
      const r = this.options.preparer.ladder[this.rendition];
      const size = { width: r.width, height: r.height, videoKbps: r.videoKbps };
      // Captions drawn in, only if the station chose it.
      if (this.settings.burnCaptions) {
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
  /** Segments sent as the station ID slate (breaks, or partner time). */
  slateSegments = 0;
  /** Programming Phase 6: segments sent as the "Airing on Opencast" slate (programs not cleared for relays). */
  elsewhereSegments = 0;
  /** Each row's clearance for relays, looked up once (rows are relayed in order). */
  private clearances = new Map<string, boolean>();
  private timeZone?: string;

  /**
   * Programming Phase 6: whether a program row may go out on relays (its rights, the agreement it's
   * carried under, its network licences; relays have no viewer country). Breaks, live blocks and
   * rows without an item go as before. A lookup that fails sends it as aired, as before Phase 6.
   */
  private async clearedForRelays(row: typeof CI.$inferSelect): Promise<boolean> {
    if (row.inBreak || row.kind !== "prepared" || !row.assetId) return true;
    const known = this.clearances.get(row.id);
    if (known !== undefined) return known;
    let cleared = true;
    try {
      this.timeZone ??= await this.ctx.services.stations.timezoneOf(this.stationId);
      const [answer] = await this.ctx.services.licences.clearance([{ assetId: row.assetId, agreementId: row.agreementId }], "relays", null, { at: row.startsAt, timeZone: this.timeZone });
      cleared = answer.cleared;
      if (!cleared) this.log(`${row.label} isn't cleared for relays (${answer.reason.replace(/_/g, " ")}): the "Airing on Opencast" slate in its place for ${Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 1000)} s`);
    } catch (error) {
      this.log(`couldn't check ${row.label} for relays (${(error as Error).message.slice(0, 200)}): sent as aired`);
    }
    this.clearances.set(row.id, cleared);
    if (this.clearances.size > 200) this.clearances.delete(this.clearances.keys().next().value!);
    return cleared;
  }
  /** The last row reported as paid promotion (once per row). */
  private lastPaid: string | null = null;
  /** Live segments sent (from Livepeer's playback, or the worker's radio ingest). */
  liveSegments = 0;

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
          if (this.settings.relayMode === "live_only" && row.kind !== "live") {
            // Live shows only: everything else stays on Opencast.
            this.nextSeq = Math.max(this.nextSeq, row.seq + published);
            continue;
          }
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

  /** Bytes sent (egress) in this session so far. */
  get bytesSent() {
    return this.child ? Math.max(0, this.out.bytes() - this.bytesAtStart) : 0;
  }
}

/** How the relay makes its picture: `composite` (the TV band's bug drawn in) or `copy` (nothing re-encoded). */
export function senderPicture(s: Pick<SenderSettings, "bugOnRelays">, look: Pick<ChannelLook, "band" | "bug">): "copy" | "composite" {
  return look.band === "tv" && look.bug.mode !== "off" && s.bugOnRelays ? "composite" : "copy";
}
