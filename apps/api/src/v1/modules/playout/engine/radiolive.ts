// Radio live blocks, through the worker (never Livepeer): the station's encoder pushes to the
// worker's RTMP ingest (rtmp.ts) with its live source's stream key, and while the block is on (or
// about to be) its sound is packaged here into the channel's own renditions, AAC 128k and 64k, on
// the same 4-second segments as everything prepared. FFmpeg reads the push as FLV and writes both
// renditions in one pass; each finished segment is stored with the platform's objects (under
// `prepared/live-…/<rendition>/`, like a prepared item's, so the same routes serve it and the
// translators read it back from storage) and handed to the assembler like Livepeer's.
//
// Each connection of the encoder is a session: its segments' timestamps run on, and a new one
// starts again (the channel puts a discontinuity there). An encoder that isn't connected, or
// stopped sending, is "not connected", and the assembler airs the stand-by slate.
//
// Sound is cheap to encode: FFmpeg's CPU is sampled while it runs and reported per live hour
// (the worker's health endpoint, `live`).

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SEGMENT_MS, type Ladder, type RenditionName } from "./ladder.js";
import { SIGNAL_GAP_MS, type LiveSegment, type LiveSource } from "./live.js";
import { segmentLengths } from "./prepare.js";
import type { Publisher, RtmpIngest } from "./rtmp.js";

const SIGNAL_GAP_SEGMENTS = 3;
/** How often FFmpeg's CPU is read while it runs. */
const CPU_EVERY_MS = 10_000;

/** A process's CPU time so far (seconds), from `ps`; null once it's gone. */
export function cpuSecondsOf(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn("ps", ["-o", "time=", "-p", String(pid)]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      // [[dd-]hh:]mm:ss[.cc]
      const text = out.trim();
      if (!text) return resolve(null);
      const [days, rest] = text.includes("-") ? [Number(text.split("-")[0]), text.split("-")[1]] : [0, text];
      const parts = rest.split(":").map(Number);
      const seconds = parts.reduce((a, p) => a * 60 + p, 0);
      resolve(Number.isFinite(seconds) ? days * 86_400 + seconds : null);
    });
  });
}

/** A live hour's CPU, as measured: what the health endpoint reports. */
export interface LiveCpu {
  sessions: number;
  liveSeconds: number;
  cpuSeconds: number;
  cpuSecondsPerLiveHour: number | null;
}

export interface WorkerLiveOptions {
  sourceId: string;
  ingest: RtmpIngest;
  ladder: Ladder;
  /** The band's renditions (radio: a128, a64). */
  renditions: RenditionName[];
  scratchDir: string;
  /** Stores a finished segment; its URL for the playlists. */
  store(key: string, file: string): Promise<string>;
  now(): number;
  log?(line: string): void;
  /** A session ended: how long it ran and the CPU its FFmpeg used. */
  onSession?(stats: { ms: number; cpuSeconds: number }): void;
}

/** Where a session's segments are stored: `prepared/live-<source>-<session>/<rendition>/seg_NNNNN.ts`. */
export function liveSegmentKey(sourceId: string, session: string, rendition: string, index: number) {
  return `prepared/live-${sourceId.replace(/-/g, "").slice(0, 12)}-${session}/${rendition}/seg_${String(index % 100_000).padStart(5, "0")}.ts`;
}

/** One session's FFmpeg: FLV sound in, the band's renditions out as 4-second HLS segments. */
class Packager {
  readonly session: string;
  readonly startedAt = Date.now();
  private child: ChildProcess;
  private detach: () => void;
  /** Segments collected so far (the same in every rendition). */
  taken = 0;
  cpuSeconds = 0;
  private lastCpu = 0;
  exited = false;
  private closed: Promise<void>;

  constructor(
    readonly publisher: Publisher,
    private renditions: RenditionName[],
    private ladder: Ladder,
    readonly dir: string,
    log: (line: string) => void
  ) {
    this.session = publisher.session;
    const outputs: string[] = [];
    const graph = `[0:a:0]aresample=48000:async=1000:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${renditions.length}${renditions.map((_, i) => `[a${i}]`).join("")}`;
    for (const [i, name] of renditions.entries()) {
      const r = ladder[name];
      const out = path.join(dir, name);
      outputs.push(
        "-map", `[a${i}]`, "-c:a", "aac", "-b:a", `${r.audioKbps}k`, "-ar", "48000", "-ac", "2",
        "-f", "hls", "-hls_time", String(SEGMENT_MS / 1000), "-hls_list_size", "0", "-hls_flags", "independent_segments+temp_file", "-hls_segment_type", "mpegts",
        "-hls_segment_filename", path.join(out, "seg_%05d.ts"), path.join(out, "index.m3u8")
      );
    }
    const args = ["-hide_banner", "-loglevel", "error", "-nostats", "-probesize", "32768", "-analyzeduration", "500000", "-f", "flv", "-i", "pipe:0", "-filter_complex", graph, ...outputs];
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    this.child = child;
    let lastError = "";
    child.stderr?.on("data", (d) => (lastError = String(d).trim().slice(-300)));
    child.stdin?.on("error", () => undefined);
    this.closed = new Promise<void>((resolve) => {
      child.on("close", (code) => {
        this.exited = true;
        if (code && !publisher.ended) log(`packaging stopped (${code}): ${lastError}`);
        resolve();
      });
      child.on("error", () => resolve());
    });
    this.detach = publisher.attach((chunk) => {
      const stdin = child.stdin;
      if (stdin && !stdin.destroyed && stdin.writable) stdin.write(chunk);
    });
    // The encoder went: FFmpeg finishes its last segment and exits.
    publisher.once("end", () => this.finish());
  }

  async prepareDirs() {
    for (const name of this.renditions) await fs.mkdir(path.join(this.dir, name), { recursive: true });
  }

  /** Segments finished in every rendition since the last call: their lengths and files. */
  async collect(): Promise<Array<{ index: number; durationMs: number; files: Partial<Record<RenditionName, string>> }>> {
    const lists: number[][] = [];
    for (const name of this.renditions) {
      const text = await fs.readFile(path.join(this.dir, name, "index.m3u8"), "utf8").catch(() => "");
      lists.push(segmentLengths(text));
    }
    const ready = Math.min(...lists.map((l) => l.length));
    const out: Array<{ index: number; durationMs: number; files: Partial<Record<RenditionName, string>> }> = [];
    for (let i = this.taken; i < ready; i++) {
      const files: Partial<Record<RenditionName, string>> = {};
      for (const name of this.renditions) files[name] = path.join(this.dir, name, `seg_${String(i).padStart(5, "0")}.ts`);
      out.push({ index: i, durationMs: lists[0][i], files });
    }
    this.taken = Math.max(this.taken, ready);
    return out;
  }

  async sampleCpu(force = false) {
    if (this.exited || !this.child.pid) return;
    if (!force && Date.now() - this.lastCpu < CPU_EVERY_MS) return;
    this.lastCpu = Date.now();
    const seconds = await cpuSecondsOf(this.child.pid);
    if (seconds !== null) this.cpuSeconds = Math.max(this.cpuSeconds, seconds);
  }

  private finish() {
    this.detach();
    this.child.stdin?.end();
  }

  /** Stops (the encoder went, or the block no longer needs it) and waits for FFmpeg's last segment. */
  async stop() {
    await this.sampleCpu(true);
    this.finish();
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
    await this.closed;
    clearTimeout(kill);
  }
}

/** A radio live source: the worker's own ingest, packaged into the band's renditions. */
export class WorkerLiveSource implements LiveSource {
  private packager: Packager | null = null;
  private segments = new Map<number, LiveSegment>();
  private nextSeq = 0;
  private newest = -1;
  private lastNewAt = 0;
  private segmentMs = 0;
  private polling?: Promise<void>;
  private closed = false;

  constructor(private options: WorkerLiveOptions) {}

  private log(line: string) {
    this.options.log?.(`[live ${this.options.sourceId.slice(0, 8)}] ${line}`);
  }

  poll(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = this.read().finally(() => (this.polling = undefined));
    return this.polling;
  }

  private async read() {
    if (this.closed) return;
    const publisher = this.options.ingest.publisher(this.options.sourceId);
    const current = this.packager;
    if (current && (current.publisher !== publisher || current.exited)) {
      // A new connection (or none): the last session's final segments, then it's done.
      await current.stop();
      await this.take(current);
      await this.retire(current);
      this.packager = null;
    }
    if (publisher && !this.packager) {
      const dir = path.join(this.options.scratchDir, `live-${this.options.sourceId.slice(0, 8)}-${publisher.session}`);
      const p = new Packager(publisher, this.options.renditions, this.options.ladder, dir, (line) => this.log(line));
      this.packager = p;
      await p.prepareDirs();
      this.log(`packaging the encoder's sound (session ${publisher.session})`);
    }
    if (this.packager) {
      await this.take(this.packager);
      await this.packager.sampleCpu();
    }
    for (const seq of this.segments.keys()) if (seq < this.newest - 30) this.segments.delete(seq);
  }

  /** Stores what the packager finished, and lists it. */
  private async take(p: Packager) {
    for (const seg of await p.collect()) {
      const uris: LiveSegment["uris"] = {};
      for (const [name, file] of Object.entries(seg.files) as Array<[RenditionName, string]>) {
        uris[name] = await this.options.store(liveSegmentKey(this.options.sourceId, p.session, name, seg.index), file);
        await fs.rm(file, { force: true }).catch(() => undefined);
      }
      const seq = this.nextSeq++;
      this.segments.set(seq, { seq, durationMs: seg.durationMs, uris, session: p.session });
      this.newest = seq;
      this.segmentMs = seg.durationMs;
      this.lastNewAt = this.options.now();
    }
  }

  private async retire(p: Packager) {
    this.options.onSession?.({ ms: Date.now() - p.startedAt, cpuSeconds: p.cpuSeconds });
    this.log(`session ${p.session} ended after ${Math.round((Date.now() - p.startedAt) / 1000)} s (${p.cpuSeconds.toFixed(1)} s of CPU)`);
    await fs.rm(p.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  connected(): boolean {
    const publisher = this.options.ingest.publisher(this.options.sourceId);
    if (!publisher || !this.packager || this.packager.publisher !== publisher) return false;
    return this.lastNewAt > 0 && this.options.now() - this.lastNewAt < Math.max(SIGNAL_GAP_MS, SIGNAL_GAP_SEGMENTS * this.segmentMs);
  }

  after(seq: number | null): LiveSegment[] {
    if (seq === null) return this.newest >= 0 && this.segments.has(this.newest) ? [this.segments.get(this.newest)!] : [];
    return [...this.segments.values()].filter((s) => s.seq > seq).sort((a, b) => a.seq - b.seq);
  }

  async close() {
    this.closed = true;
    await this.polling;
    const p = this.packager;
    this.packager = null;
    if (p) {
      await p.stop();
      await this.retire(p);
    }
  }
}
