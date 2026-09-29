// Translators: relays of a channel to YouTube, Twitch or any RTMP address. The one place a
// continuous encode can be needed, and only while a translator is on. It reads the channel's own
// timeline (the segments its playlist publishes, 720p on the TV band), joins them into one stream
// (tsretime.ts), and pushes it over RTMP with FFmpeg:
//
//   - stream-copied when nothing has to be drawn (the station's bug is off, or the break handling
//     needs no picture change);
//   - re-encoded when the bug is drawn on (players draw it themselves; here the picture leaves
//     Opencast's players, so the worker composites it), and on the radio band (sound with the
//     station ID picture, since the services want video);
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
import { and, asc, eq, gt, lte } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { parseVtt } from "../../../lib/captions.js";
import { objectKey } from "../../../storage.js";
import { captionSources, type CaptionSource } from "./captions.js";
import type { ChannelLook } from "./assemble.js";
import { REFERENCE, type RenditionName } from "./ladder.js";
import type { Preparer } from "./prepare.js";
import { publishedCount } from "./playlist.js";
import { captionPng, type Slates } from "./slates.js";
import { TsRetimer } from "./tsretime.js";

const CI = schema.channelItems;
const TS = schema.translatorSessions;

export interface TranslatorTarget {
  id: string;
  rtmpUrl: string;
  streamKey: string;
  breakHandling: "air_spots" | "station_id_slate";
  /** Draw captions into the picture (X2). Off unless the station chose it. */
  burnCaptions?: boolean;
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
 * Draws caption cues into one TS segment's picture: each cue a picture laid over the frames it
 * shows on (`from`/`to` in the segment's own seconds, as its timestamps say). The segment is
 * re-encoded with its timestamps kept (the relay retimes it with the rest); the sound is copied.
 * Null when FFmpeg fails (the segment then goes as it was).
 */
export async function burnCaptionsIn(segment: Buffer, cues: Array<{ text: string; from: number; to: number }>, size: { width: number; height: number; videoKbps: number }, scratchDir: string): Promise<Buffer | null> {
  if (!cues.length) return segment;
  const dir = await fs.mkdtemp(path.join(scratchDir, "burn-"));
  try {
    const inputs: string[] = [];
    const graph: string[] = [];
    let last = "0:v";
    for (const [i, cue] of cues.entries()) {
      const png = path.join(dir, `cue${i}.png`);
      await captionPng(cue.text, size.width, size.height, png);
      inputs.push("-loop", "1", "-i", png);
      graph.push(`[${last}][${i + 1}:v]overlay=0:0:shortest=1:enable='between(t,${cue.from.toFixed(3)},${cue.to.toFixed(3)})'[c${i}]`);
      last = `c${i}`;
    }
    const args = [
      "-hide_banner", "-loglevel", "error", "-copyts", "-f", "mpegts", "-i", "pipe:0", ...inputs,
      "-filter_complex", graph.join(";"), "-map", `[${last}]`, "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${size.videoKbps}k`, "-maxrate", `${Math.round(size.videoKbps * 1.1)}k`, "-bufsize", `${size.videoKbps * 2}k`, "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-muxdelay", "0", "-muxpreload", "0", "-f", "mpegts", "pipe:1"
    ];
    return await new Promise<Buffer | null>((resolve) => {
      const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", () => undefined);
      child.stdin.on("error", () => undefined);
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
      child.stdin.end(segment);
    });
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

  constructor(
    private ctx: ModuleContext,
    readonly stationId: string,
    readonly target: TranslatorTarget,
    private options: TranslatorOptions
  ) {}

  /** A signature of what the relay was started with (a change restarts it). */
  static signature(t: TranslatorTarget) {
    return `${t.rtmpUrl}|${t.streamKey}|${t.breakHandling}${t.burnCaptions ? "|captions" : ""}`;
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

  get mode(): "copy" | "composite" {
    const look = this.options.look;
    return look.band === "radio" || look.bug.mode !== "off" ? "composite" : "copy";
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
      const picture = await this.options.slates.stationId(look);
      args = [...common, "-loop", "1", "-framerate", "30", "-i", picture, "-map", "1:v", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-r", "30", "-g", "60", "-b:v", "400k", "-pix_fmt", "yuv420p", "-c:a", "copy", "-bsf:a", "aac_adtstoasc", "-shortest", ...out];
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
    this.log(`relaying (${this.mode}${this.target.breakHandling === "station_id_slate" ? ", station ID slate in breaks" : ""}${this.target.burnCaptions ? ", captions drawn in" : ""})`);
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

  /** A segment's bytes: prepared ones from storage, live ones from Livepeer. */
  private async segment(row: typeof CI.$inferSelect, index: number): Promise<{ buf: Buffer; item: string; ms: number } | null> {
    const ms = row.segmentMs[index];
    if (row.inBreak && this.target.breakHandling === "station_id_slate") {
      // The station ID slate in place of the break, a slate per segment.
      const seconds = Math.max(1, Math.min(4, Math.round(ms / 1000)));
      const key = await this.options.preparer.slate(await this.options.slates.stationId(this.options.look), seconds, this.options.look.band);
      const stream = await this.ctx.deps.storage.objects.open?.(`${objectKey.prepared(key, this.rendition)}/seg_00000.ts`);
      return stream ? { buf: await bytesOf(stream), item: `${row.id}:${index}`, ms } : null;
    }
    if (row.kind === "live") {
      const uri = row.liveUris?.[this.rendition]?.[index];
      if (!uri) return null;
      const response = await fetch(uri, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
      return response?.ok ? { buf: Buffer.from(await response.arrayBuffer()), item: row.id, ms } : null;
    }
    if (!row.preparedKey) return null;
    const name = `seg_${String(row.firstSegment + index).padStart(5, "0")}.ts`;
    const stream = await this.ctx.deps.storage.objects.open?.(`${objectKey.prepared(row.preparedKey, this.rendition)}/${name}`).catch(() => null);
    if (!stream) return null;
    let buf = await bytesOf(stream);
    // Captions drawn in, only if the station chose it (and only on the TV band's picture).
    if (this.target.burnCaptions && this.options.look.band === "tv") {
      const cues = await this.cuesFor(row, index).catch(() => []);
      if (cues.length) {
        const r = this.options.preparer.ladder[this.rendition];
        buf = (await burnCaptionsIn(buf, cues, { width: r.width, height: r.height, videoKbps: r.videoKbps }, this.options.scratchDir ?? os.tmpdir())) ?? buf;
      }
    }
    return { buf, item: row.id, ms };
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
            await this.write(this.retimer.retime(seg.buf, seg.item, seg.ms));
          }
        }
      }
      if (Date.now() - this.lastSaved > 15_000) await this.save();
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** Bytes sent in this session so far. */
  get bytesSent() {
    return this.bytes;
  }
}
