// One station on air. A long-running muxer copies a continuous MPEG-TS stream
// into HLS and the RTMP outputs (Livepeer, and relays that air spots); relays set
// to "Station ID slate" get their own feed, with a slate in place of each break.
// Each segment of the run sheet is encoded in real time, joining mid-segment if
// we're late, with timestamps carried on from the last one, so the outputs never
// reconnect between items. When a segment ends, what actually aired goes in the
// as-run log, and a spot's airing is settled from it.

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModuleContext } from "../../../context.js";
import type { Segment } from "./plan.js";
import type { Slates, StationLook } from "./slates.js";
import { LiveFeed, type LiveInput } from "./live.js";
import type { ContentCache } from "./cache.js";
import { schema } from "@opencast/db";
import { eq } from "drizzle-orm";

export interface Output {
  kind: "livepeer" | "relay";
  url: string;
  /** Relays set to "Station ID slate" get a slate during breaks. */
  slateDuringBreaks: boolean;
}

export interface RunnerOptions {
  hlsDir: string;
  outputs: Output[];
  plan(from: Date, to: Date): Promise<Segment[]>;
  slates: Slates;
  look: StationLook & { bug: { mode: string; opacity: number } };
  /** How a live source is read: an HLS or RTMP URL, or "listen" for a local RTMP listener. */
  liveInput(liveSourceId: string): Promise<LiveInput | null>;
  appOrigin: string;
  onSignalLost?(): void;
  /** Files come from here at air time; a miss airs the usual fill and is reported. */
  cache?: ContentCache;
  onFileMissing?(missing: { itemId: string; title: string; airsAt: Date }): void;
  log?(line: string): void;
}

interface Producer {
  process: ChildProcess;
  done: Promise<number>;
}

const FPS = 30;
/** Live feeds open this far ahead of their block, so encoders can connect early. */
const LIVE_PREROLL_MS = 60_000;
/** A program with less than this left isn't joined; the next segment starts instead. */
const MIN_JOIN_MS = 1_500;
const hasAudioCache = new Map<string, boolean>();

async function hasAudio(location: string): Promise<boolean> {
  if (hasAudioCache.has(location)) return hasAudioCache.get(location)!;
  const result = await new Promise<boolean>((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", location]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.trim().length > 0));
    child.on("error", () => resolve(false));
  });
  hasAudioCache.set(location, result);
  return result;
}

const ENCODE = [
  "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-r", String(FPS), "-g", String(FPS * 2), "-keyint_min", String(FPS * 2), "-sc_threshold", "0",
  "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
  "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"
];

const FIT = `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p`;

export class StationRunner {
  private muxer?: ChildProcess;
  private slateMuxers: ChildProcess[] = [];
  private producer?: Producer;
  private stopped = false;
  private mediaClockS = 0;
  private skipped = new Set<string>();
  private plan: Segment[] = [];
  private planUntil = 0;
  /** Bumped by replan(): a plan started before it is stale when it lands. */
  private planVersion = 0;
  private loop?: Promise<void>;
  private feeds = new Map<string, LiveFeed>();
  private feedTimer?: NodeJS.Timeout;
  /** Segments that air in full, once aired (so a quick exit never replays them). */
  private aired = new Set<string>();

  constructor(
    private ctx: ModuleContext,
    private stationId: string,
    private options: RunnerOptions
  ) {}

  private log(line: string) {
    this.options.log?.(`[playout ${this.options.look.callSign ?? this.stationId.slice(0, 8)}] ${line}`);
  }

  start() {
    if (this.loop) return;
    this.stopped = false;
    this.loop = this.run().catch((error) => this.log(`stopped with an error: ${(error as Error).message}`));
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.feedTimer);
    this.producer?.process.kill("SIGTERM");
    await this.loop;
    for (const feed of this.feeds.values()) feed.stop();
    this.feeds.clear();
    this.muxer?.stdin?.end();
    for (const m of this.slateMuxers) m.stdin?.end();
    this.loop = undefined;
  }

  /** Stop what's airing now and move on. The rest of its time airs station ID and bumpers. */
  skip() {
    const current = this.current;
    if (current) this.skipped.add(current.key);
    this.producer?.process.kill("SIGTERM");
  }

  /** The run sheet changed (a break cued, the log edited): read it again. */
  replan(interruptCurrent = false) {
    this.planVersion++;
    this.planUntil = 0;
    if (interruptCurrent) this.producer?.process.kill("SIGTERM");
  }

  private current?: Segment;

  private async startMuxers() {
    await fs.mkdir(this.options.hlsDir, { recursive: true });
    const hls = [
      "f=hls",
      "hls_time=2",
      "hls_list_size=10",
      "hls_flags=delete_segments+omit_endlist+independent_segments+program_date_time+temp_file",
      `hls_segment_filename=${path.join(this.options.hlsDir, "seg_%09d.ts")}`
    ].join(":");
    const main = [`[${hls}]${path.join(this.options.hlsDir, "index.m3u8")}`];
    for (const out of this.options.outputs.filter((o) => !o.slateDuringBreaks)) main.push(`[f=flv:onfail=ignore]${out.url}`);
    this.muxer = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "mpegts", "-i", "pipe:0", "-map", "0", "-c", "copy", "-f", "tee", main.join("|")], {
      stdio: ["pipe", "ignore", "pipe"]
    });
    this.muxer.stderr?.on("data", (d) => this.log(`muxer: ${String(d).trim()}`));
    this.muxer.stdin?.on("error", () => undefined);
    this.slateMuxers = this.options.outputs
      .filter((o) => o.slateDuringBreaks)
      .map((o) => {
        const m = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "mpegts", "-i", "pipe:0", "-map", "0", "-c", "copy", "-f", "flv", o.url], { stdio: ["pipe", "ignore", "pipe"] });
        m.stdin?.on("error", () => undefined);
        return m;
      });
  }

  private async segmentAt(now: Date): Promise<Segment | null> {
    while (now.getTime() >= this.planUntil - 60_000) {
      const version = this.planVersion;
      const to = new Date(now.getTime() + 15 * 60_000);
      const plan = await this.options.plan(new Date(now.getTime() - 1000), to);
      // The log changed while this was being read (a break filled, a spot placed): read it again.
      if (version !== this.planVersion) continue;
      this.plan = plan;
      this.planUntil = to.getTime();
    }
    return this.plan.find((s) => s.startsAt <= now && s.endsAt > now) ?? null;
  }

  /**
   * The ffmpeg inputs and filter graph for a segment: the picture fitted to 720p, the
   * station's bug, and a spot's code and QR for its last :10; sound always present.
   */
  private async inputArgs(seg: Segment, offsetMs: number): Promise<{ args: string[]; filter: string; live: boolean; feed?: LiveFeed }> {
    const inputs: string[][] = [];
    const add = (args: string[]) => inputs.push(args) - 1;
    const loopImage = (file: string, paced: boolean) => add([...(paced ? ["-re"] : []), "-loop", "1", "-framerate", String(FPS), "-i", file]);
    const silence = () => add(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]);
    const seek = (ms: number) => ["-ss", (ms / 1000).toFixed(3)];

    let video: number;
    let audio: number;
    let live = false;
    let feed: LiveFeed | undefined;
    const src = seg.source;
    if (src.kind === "image") {
      video = loopImage(src.path, true);
      audio = silence();
    } else if (src.kind === "file" && src.mediaKind === "audio") {
      // Sound only (radio, music): the station ID slate is the picture.
      audio = add(["-re", ...seek(src.seekMs + offsetMs), "-i", src.location]);
      video = loopImage(await this.options.slates.stationId(this.options.look), true);
    } else if (src.kind === "file") {
      video = add(["-re", ...seek(src.seekMs + offsetMs), "-i", src.location]);
      audio = (await hasAudio(src.location)) ? video : silence();
    } else {
      feed = this.feeds.get(src.liveSourceId);
      if (!feed?.connected) throw new Error("no live signal");
      // The feed, remuxed, on stdin.
      video = add(["-f", "mpegts", "-i", "pipe:0"]);
      audio = video;
      live = true;
    }

    let filter = `[${video}:v]${FIT}[v0]`;
    let label = "v0";
    let n = 0;
    const overlay = (file: string, enable?: string) => {
      const idx = loopImage(file, false);
      const next = `v${++n}`;
      filter += `;[${label}][${idx}:v]overlay=shortest=1${enable ? `:enable='${enable}'` : ""}[${next}]`;
      label = next;
    };
    if (this.options.look.bug.mode === "call_sign_and_channel" && !["SID", "UND", "OPEN"].includes(seg.code)) {
      overlay(await this.options.slates.bug(this.options.look, this.options.look.bug.opacity));
    }
    if (seg.code10) {
      const url = `${this.options.appOrigin}/c/${encodeURIComponent(seg.code10.code)}?s=${this.stationId}`;
      const spotS = (seg.endsAt.getTime() - seg.startsAt.getTime()) / 1000;
      // t counts from where this run joined the spot.
      const from = Math.max(0, spotS - 10 - offsetMs / 1000);
      overlay(await this.options.slates.code(seg.code10.code, seg.code10.offer, url), `gte(t,${from.toFixed(2)})`);
    }
    filter += `;[${label}]null[vout];[${audio}:a]aresample=async=1:first_pts=0[aout]`;
    return { args: inputs.flat(), filter, live, feed };
  }

  private produce(args: string[], filter: string, durationMs: number, targets: Array<NodeJS.WritableStream | null | undefined>, feed?: LiveFeed): Producer {
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", ...args, "-t", (durationMs / 1000).toFixed(3), "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", ...ENCODE, "-output_ts_offset", this.mediaClockS.toFixed(3), "-muxdelay", "0", "-f", "mpegts", "pipe:1"],
      { stdio: [feed ? "pipe" : "ignore", "pipe", "pipe"] }
    );
    if (feed && child.stdin) {
      feed.attach(child.stdin);
      child.on("close", () => feed.detach(child.stdin!));
    }
    child.stderr?.on("data", (d) => {
      const text = String(d).trim();
      if (text) this.log(`producer: ${text.slice(0, 300)}`);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      let backpressure = false;
      for (const target of targets) if (target && !target.write(chunk)) backpressure = true;
      if (backpressure) {
        child.stdout?.pause();
        const resume = () => child.stdout?.resume();
        for (const target of targets) target?.once("drain", resume);
      }
    });
    const done = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
    return { process: child, done };
  }

  private async proofFrame(seg: Segment): Promise<string | null> {
    if (!seg.airingId || seg.source.kind !== "file") return null;
    const dir = path.join(this.ctx.deps.config.storageRoot, "proof", this.stationId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${seg.airingId}.jpg`);
    const midS = (seg.source.seekMs + (seg.endsAt.getTime() - seg.startsAt.getTime()) / 2) / 1000;
    const bug = this.options.look.bug.mode === "call_sign_and_channel" ? await this.options.slates.bug(this.options.look, this.options.look.bug.opacity) : null;
    // One frame from the middle of the spot, with the station's bug, as proof it aired.
    await new Promise<void>((resolve) => {
      const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", midS.toFixed(2), "-i", seg.source.kind === "file" ? seg.source.location : "", ...(bug ? ["-i", bug] : []), "-frames:v", "1", "-filter_complex", bug ? `[0:v]${FIT}[b];[b][1:v]overlay` : `[0:v]${FIT}`, file];
      const child = spawn("ffmpeg", args);
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
    return fs.access(file).then(() => file, () => null);
  }

  private async record(seg: Segment, startedAt: Date, endedAt: Date, reason: Segment["reason"], proof: string | null) {
    const { db } = this.ctx.deps;
    const [row] = await db
      .insert(schema.asRun)
      .values({
        stationId: this.stationId,
        code: seg.code,
        startedAt,
        endedAt,
        logEntryId: seg.logEntryId ?? null,
        breakId: seg.breakId ?? null,
        assetId: seg.itemId ?? null,
        programId: seg.programId ?? null,
        airingId: seg.airingId ?? null,
        carriageAgreementId: seg.agreementId ?? null,
        liveSourceId: seg.liveSourceId ?? null,
        reason,
        proofFrameUrl: proof,
        proofFrameAt: proof ? new Date((startedAt.getTime() + endedAt.getTime()) / 2) : null
      })
      .returning();
    if (seg.airingId) {
      await this.ctx.services.spots
        .settleAiring({ airingId: seg.airingId, asRunId: row.id, startedAt, endedAt })
        .catch((error) => this.log(`settling ${seg.airingId} failed: ${(error as Error).message}`));
    }
    // A carried episode under a cash deal: the carrier pays the maker (once per slot, however it's split).
    if (seg.agreementId && seg.logEntryId && seg.code === "PGM" && !seg.inBreak) {
      await this.ctx.services.catalog
        .chargeCarriedAiring({ agreementId: seg.agreementId, carrierStationId: this.stationId, logEntryId: seg.logEntryId })
        .catch((error) => this.log(`carriage fee for ${seg.logEntryId} failed: ${(error as Error).message}`));
    }
    return row;
  }

  private async setNow(seg: Segment | null, startedAt: Date | null, error: string | null = null) {
    await this.ctx.deps.db
      .insert(schema.playoutState)
      .values({ stationId: this.stationId, onAir: true, currentAssetId: seg?.itemId ?? null, currentLogEntryId: seg?.logEntryId ?? null, currentStartedAt: startedAt, lastError: error, updatedAt: this.ctx.deps.clock.now() })
      .onConflictDoUpdate({
        target: schema.playoutState.stationId,
        set: { currentAssetId: seg?.itemId ?? null, currentLogEntryId: seg?.logEntryId ?? null, currentStartedAt: startedAt, lastError: error, updatedAt: this.ctx.deps.clock.now() }
      });
  }

  private reported = new Set<string>();
  private reportMissing(missing: { itemId: string; title: string; airsAt: Date }) {
    const key = `${missing.itemId}:${missing.airsAt.getTime()}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.log(`${missing.title}: its file isn't in the cache; the usual fill airs instead`);
    this.options.onFileMissing?.(missing);
  }

  /** Opens the live feeds of blocks starting within the pre-roll; closes those whose blocks are over. */
  private async syncFeeds() {
    const now = this.ctx.deps.clock.now().getTime();
    const wanted = new Set<string>();
    for (const seg of this.plan) {
      if (seg.source.kind !== "live") continue;
      if (seg.startsAt.getTime() - LIVE_PREROLL_MS <= now && seg.endsAt.getTime() > now) wanted.add(seg.source.liveSourceId);
    }
    for (const [id, feed] of this.feeds) {
      if (!wanted.has(id)) {
        feed.stop();
        this.feeds.delete(id);
      }
    }
    for (const id of wanted) {
      if (this.feeds.has(id)) continue;
      const input = await this.options.liveInput(id);
      if (!input || this.stopped || this.feeds.has(id)) continue;
      const feed = new LiveFeed(input, (line) => this.log(line));
      this.feeds.set(id, feed);
      feed.start();
    }
  }

  /** The segment after this one on the run sheet. */
  private after(seg: Segment): Segment | null {
    return this.plan.find((s) => s.startsAt.getTime() >= seg.endsAt.getTime() && s.key !== seg.key) ?? null;
  }

  private async run() {
    await fs.rm(this.options.hlsDir, { recursive: true, force: true });
    await this.startMuxers();
    this.feedTimer = setInterval(() => void this.syncFeeds().catch(() => undefined), 1_000);
    this.log("signed on");
    let signalLostFor: string | undefined;
    while (!this.stopped) {
      const now = this.ctx.deps.clock.now();
      let seg = await this.segmentAt(now);
      // Spots, credits, bumpers and station IDs air in full, from the top, even when we're
      // running late (the next program is joined that much later). Once aired, never again.
      const isWhole = (s: Segment) => Boolean(s.airingId) || s.code === "UND" || s.code === "BMP" || s.code === "SID";
      // A program with a moment left (its file ended early, or we're late) isn't joined for it.
      while (seg && ((isWhole(seg) && this.aired.has(seg.key)) || (!isWhole(seg) && seg.endsAt.getTime() - now.getTime() < MIN_JOIN_MS))) seg = this.after(seg);
      if (!seg) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const whole = isWhole(seg);
      const offsetMs = whole ? 0 : Math.max(0, now.getTime() - seg.startsAt.getTime());
      const durationMs = whole ? seg.endsAt.getTime() - seg.startsAt.getTime() : seg.endsAt.getTime() - Math.max(now.getTime(), seg.startsAt.getTime());
      if (whole) {
        this.aired.add(seg.key);
        if (this.aired.size > 2_000) this.aired = new Set([...this.aired].slice(-1_000));
      }
      let reason = seg.reason;
      if (this.skipped.has(seg.key)) {
        // Skipped: the rest of its time on the station ID slate.
        seg = { ...seg, code: "OPEN", label: "Station ID slate", source: { kind: "image", path: await this.options.slates.stationId(this.options.look) }, airingId: undefined, code10: undefined };
        reason = "station_id_fill";
      }
      const cache = this.options.cache;
      if (seg.missing) {
        // Planned without its file. If the file has arrived since, plan again and air it.
        if (cache?.has(seg.missing.contentId)) {
          this.aired.delete(seg.key);
          this.replan();
          await this.segmentAt(this.ctx.deps.clock.now());
          continue;
        }
        cache?.take(seg.missing.contentId);
        this.reportMissing(seg.missing);
      } else if (seg.source.kind === "file" && seg.source.contentId && cache) {
        // At air: from the cache, or (evicted since it was planned) the station ID slate.
        if (!cache.take(seg.source.contentId)) {
          if (seg.itemId) this.reportMissing({ itemId: seg.itemId, title: seg.label, airsAt: seg.startsAt });
          seg = { ...seg, code: "OPEN", label: "Station ID slate", source: { kind: "image", path: await this.options.slates.stationId(this.options.look) }, airingId: undefined, code10: undefined };
          reason = "station_id_fill";
        }
      }
      const liveSourceId = seg.source.kind === "live" ? seg.source.liveSourceId : undefined;
      if (liveSourceId && !this.feeds.has(liveSourceId)) await this.syncFeeds();
      this.current = seg;
      const startedAt = this.ctx.deps.clock.now();
      let input;
      try {
        input = await this.inputArgs(seg, offsetMs);
      } catch {
        input = null;
      }
      if (!input) {
        // A live block with no signal: the stand-by slate, until the signal comes.
        seg = { ...seg, label: "Stand by", source: { kind: "image", path: await this.options.slates.standBy(this.options.look) } };
        reason = "slate";
        input = await this.inputArgs(seg, offsetMs);
        if (signalLostFor !== seg.key) {
          signalLostFor = seg.key;
          this.log("no live signal: standing by");
          this.options.onSignalLost?.();
        }
      }
      await this.setNow(seg, startedAt);
      const slateTargets = this.slateMuxers.map((m) => m.stdin);
      const targets = [this.muxer?.stdin, ...(seg.inBreak ? [] : slateTargets)];
      this.producer = this.produce(input.args, input.filter, durationMs, targets, input.feed);
      let slate: Producer | undefined;
      if (seg.inBreak && slateTargets.length) {
        const sid = { ...seg, code: "OPEN" as const, source: { kind: "image" as const, path: await this.options.slates.stationId(this.options.look) }, code10: undefined };
        const slateInput = await this.inputArgs(sid, 0);
        slate = this.produce(slateInput.args, slateInput.filter, durationMs, slateTargets);
      }
      // Live: switch to the slate when the signal drops, and back when it returns.
      const producer = this.producer;
      const watch: NodeJS.Timeout | undefined = liveSourceId
        ? setInterval(() => {
            const connected = this.feeds.get(liveSourceId)?.connected ?? false;
            if (connected !== input.live) {
              clearInterval(watch);
              producer.process.kill("SIGTERM");
              // ffmpeg waiting on a live input can ignore one polite signal.
              setTimeout(() => producer.process.exitCode === null && producer.process.signalCode === null && producer.process.kill("SIGKILL"), 1_500);
            }
          }, 250)
        : undefined;
      const proof = seg.airingId ? this.proofFrame(seg) : Promise.resolve(null);
      await this.producer.done;
      await slate?.done;
      clearInterval(watch);
      const endedAt = this.ctx.deps.clock.now();
      const airedMs = endedAt.getTime() - startedAt.getTime();
      if (input.live && airedMs < durationMs - 2_000 && !this.stopped) {
        // The live source dropped before the block ended.
        signalLostFor = seg.key;
        this.log("live signal lost: standing by");
        this.options.onSignalLost?.();
      }
      this.mediaClockS += Math.min(durationMs, Math.max(airedMs, 0)) / 1000;
      if (airedMs > 200) await this.record(seg, startedAt, endedAt, input.live ? "live" : reason, await proof);
      this.producer = undefined;
      this.current = undefined;
    }
    await this.setNow(null, null);
    this.log("signed off");
  }
}

export async function stationState(ctx: ModuleContext, stationId: string) {
  const [row] = await ctx.deps.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, stationId));
  return row;
}
