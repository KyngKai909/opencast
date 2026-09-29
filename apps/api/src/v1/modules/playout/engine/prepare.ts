// Prepare once (platform prompt, Phase 5). Every item that can air (a program whose rights are
// confirmed, a spot, a bumper, a station ID, a generated underwriting credit, the station's
// slates) is transcoded once to the fixed ladder (ladder.ts) with FFmpeg on the worker: 4-second
// segments with aligned keyframes, loudness levelled to -24 LUFS, 10 ms of fade at each edge. The
// renditions go to object storage under `prepared/<content ID>/<rendition>/`, and the database
// records what's ready (`prepared_items`, `prepared_renditions`). A carried or catalog program
// has one content ID, so it's prepared once for every station that airs it.
//
// Nothing airs from a file any more: the channel's playlists point at these segments (assemble.ts).
//
// Captions (docs/contract-requests.md X2) are prepared here too, once, and never hold an item up:
// a track uploaded to an item whose file this is (the library keeps it by content ID), or one
// embedded in the file (mov_text and other text tracks, read in the same FFmpeg pass), is cut into
// the item's 4-second segments (lib/captions.ts), each WebVTT with an X-TIMESTAMP-MAP onto the
// item's own timestamps, and stored beside the renditions (`prepared/<key>/cc…/`, recorded in
// `prepared_captions`). A track uploaded after the item was prepared is cut within a minute
// (`captionsChangedSince`). Captions generated from speech wait on a provider: `CaptionGenerator`
// is the seam, and the default makes none.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { captionRendition, languageTag, segmentVtt, vttContentId } from "../../../lib/captions.js";
import { objectKey, sha256FromCid } from "../../../storage.js";
import { BAND_RENDITIONS, EDGE_FADE_MS, FPS, LADDER, REFERENCE, SEGMENT_MS, TARGET_LUFS, type Band, type Ladder, type Rendition, type RenditionName } from "./ladder.js";

const PI = schema.preparedItems;
const PR = schema.preparedRenditions;
const PC = schema.preparedCaptions;

/** Where FFmpeg's MPEG-TS muxer starts an item's timestamps (1.4 s at 90 kHz), when a segment can't be read. */
export const DEFAULT_START_PTS = 126_000;
/** Subtitle codecs read as text (anything else, DVD or PGS pictures, is left alone). */
const TEXT_SUBTITLES = new Set(["mov_text", "subrip", "srt", "ass", "ssa", "webvtt", "text"]);

/** A caption track to prepare with an item. */
export interface CaptionInput {
  vtt: string;
  language: string | null;
  source: "uploaded" | "embedded" | "generated";
}

/**
 * Captions generated from speech (X2): the seam, waiting on a provider choice. Given the item's
 * source file on local disk (its sound), a generator returns a WebVTT track on the item's own
 * clock, or null. It's asked only when the file has no caption track of its own (embedded or
 * uploaded); what it returns is prepared like any other track, once.
 */
export interface CaptionGenerator {
  readonly name: string;
  generate(input: { key: string; file: string; mediaKind: "video" | "audio"; durationMs: number }): Promise<{ vtt: string; language: string | null } | null>;
}

/** The default: no captions from speech until a provider is chosen. */
export const noCaptionGenerator: CaptionGenerator = { name: "none", generate: async () => null };

/** What can be prepared: a file by content ID, or (from before content IDs) by its old location. */
export interface MediaRef {
  contentId?: string | null;
  location?: string | null;
}

export interface WantRef extends MediaRef {
  mediaKind: "video" | "audio";
  band: Band;
  durationMs?: number | null;
  /** When it airs, as far as anyone knows. Earliest is prepared first. */
  neededAt?: Date | null;
}

/** The prepared item's key: its content ID, or `loc-…` from an old location. */
export function refKey(ref: MediaRef): string | null {
  if (ref.contentId) return ref.contentId;
  if (ref.location) return `loc-${createHash("sha256").update(ref.location).digest("hex").slice(0, 40)}`;
  return null;
}

export interface TranscodeJob {
  key: string;
  source: { kind: "file"; path: string } | { kind: "slate"; png: string | null; seconds: number };
  mediaKind: "video" | "audio";
  /** Known length (the library's), if any. The transcoder measures it anyway. */
  durationMs: number | null;
  renditions: Rendition[];
  /** Writes `<outDir>/<rendition>/index.m3u8` and `seg_00000.ts`… */
  outDir: string;
}

export interface TranscodeResult {
  durationMs: number;
  renditions: Partial<Record<RenditionName, { segmentMs: number[] }>>;
  /** A text subtitle track found in the file, as WebVTT on the item's clock (X2). */
  captions?: { vtt: string; language: string | null } | null;
  /** The item's first MPEG-TS timestamp (90 kHz), where its captions' time zero goes. */
  startPts?: number | null;
}

export type Transcoder = (job: TranscodeJob) => Promise<TranscodeResult>;

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

/** The EXTINF lengths of an HLS media playlist, in milliseconds. */
export function segmentLengths(playlist: string): number[] {
  return [...playlist.matchAll(/^#EXTINF:([\d.]+)/gm)].map((m) => Math.round(Number(m[1]) * 1000));
}

async function probe(file: string): Promise<{ durationMs: number | null; hasAudio: boolean; hasVideo: boolean; subtitle: { index: number; language: string | null } | null }> {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,disposition:stream_tags=language", "-of", "json", file]);
  try {
    const json = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type: string; codec_name?: string; disposition?: { attached_pic?: number }; tags?: { language?: string } }>;
    };
    const streams = json.streams ?? [];
    const duration = Number(json.format?.duration);
    // The first text subtitle track, by its place among the file's subtitle streams.
    const subtitles = streams.filter((s) => s.codec_type === "subtitle");
    const index = subtitles.findIndex((s) => TEXT_SUBTITLES.has(s.codec_name ?? ""));
    return {
      durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
      hasAudio: streams.some((s) => s.codec_type === "audio"),
      // Cover art on an audio file isn't a picture to air.
      hasVideo: streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic),
      subtitle: index >= 0 ? { index, language: languageTag(subtitles[index].tags?.language) } : null
    };
  } catch {
    return { durationMs: null, hasAudio: false, hasVideo: false, subtitle: null };
  }
}

/** A TS segment's first timestamp (90 kHz), or null when it can't be read. */
export async function startPtsOf(segment: string): Promise<number | null> {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", segment]);
  const seconds = Number(result.stdout.trim());
  return result.code === 0 && result.stdout.trim() && Number.isFinite(seconds) ? Math.round(seconds * 90_000) : null;
}

/**
 * FFmpeg, one pass: the source decoded once, split to every rendition asked for. Video at 30 fps
 * with a keyframe every 4 s (every segment starts on one, in every rendition), fitted and padded to
 * each size; sound levelled, faded in and out, padded or cut to the item's exact length.
 */
export function ffmpegTranscoder(options: { preset?: string; threads?: number } = {}): Transcoder {
  const preset = options.preset ?? "veryfast";
  return async (job) => {
    const src = job.source;
    let durationMs: number;
    const inputs: string[] = [];
    let videoIn: string | null = null;
    let audioIn: string;
    let levelled = true;
    let subtitle: { index: number; language: string | null } | null = null;
    const wantsVideo = job.renditions.some((r) => r.kind === "video");
    if (src.kind === "slate") {
      durationMs = src.seconds * 1000;
      const seconds = String(src.seconds);
      if (wantsVideo) {
        if (src.png) inputs.push("-loop", "1", "-framerate", String(FPS), "-t", seconds, "-i", src.png);
        else inputs.push("-f", "lavfi", "-t", seconds, "-i", `color=c=0x101010:s=1280x720:r=${FPS}`);
        videoIn = "0:v";
      }
      inputs.push("-f", "lavfi", "-t", seconds, "-i", "anullsrc=r=48000:cl=stereo");
      audioIn = `${wantsVideo ? 1 : 0}:a`;
      levelled = false;
    } else {
      const info = await probe(src.path);
      subtitle = info.subtitle;
      durationMs = info.durationMs ?? job.durationMs ?? 0;
      if (!durationMs) throw new Error("couldn't read the file's length");
      inputs.push("-i", src.path);
      let next = 1;
      if (wantsVideo) {
        if (info.hasVideo && job.mediaKind === "video") videoIn = "0:v";
        else {
          // Sound only on the TV band: a plain dark picture (the player draws the station's bug over it).
          inputs.push("-f", "lavfi", "-i", `color=c=0x101010:s=1280x720:r=${FPS}`);
          videoIn = `${next++}:v`;
        }
      }
      if (info.hasAudio) audioIn = "0:a";
      else {
        inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
        audioIn = `${next++}:a`;
        levelled = false;
      }
    }
    const seconds = (durationMs / 1000).toFixed(3);
    const fadeOut = Math.max(0, durationMs - EDGE_FADE_MS) / 1000;
    const videos = job.renditions.filter((r) => r.kind === "video");
    const n = job.renditions.length;
    const graph: string[] = [];
    if (videoIn && videos.length) {
      graph.push(`[${videoIn}]fps=${FPS},format=yuv420p,split=${videos.length}${videos.map((_, i) => `[s${i}]`).join("")}`);
      videos.forEach((r, i) => graph.push(`[s${i}]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`));
    }
    const fades = `afade=t=in:d=${EDGE_FADE_MS / 1000},afade=t=out:st=${fadeOut.toFixed(3)}:d=${EDGE_FADE_MS / 1000}`;
    const level = levelled ? `loudnorm=I=${TARGET_LUFS}:TP=-2:LRA=11,` : "";
    graph.push(`[${audioIn}]aresample=48000,${level}aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${seconds},atrim=0:${seconds},${fades},asplit=${n}${job.renditions.map((_, i) => `[a${i}]`).join("")}`);

    const outputs: string[] = [];
    let vi = 0;
    for (const [i, r] of job.renditions.entries()) {
      const dir = path.join(job.outDir, r.name);
      await fs.mkdir(dir, { recursive: true });
      const hls = ["-f", "hls", "-hls_time", String(SEGMENT_MS / 1000), "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_type", "mpegts", "-hls_segment_filename", path.join(dir, "seg_%05d.ts"), path.join(dir, "index.m3u8")];
      const audio = ["-c:a", "aac", "-b:a", `${r.audioKbps}k`, "-ar", "48000", "-ac", "2"];
      if (r.kind === "video") {
        const gop = String((FPS * SEGMENT_MS) / 1000);
        outputs.push(
          "-map", `[v${vi++}]`, "-map", `[a${i}]`,
          "-c:v", "libx264", "-preset", preset, "-profile:v", "high", "-pix_fmt", "yuv420p",
          "-b:v", `${r.videoKbps}k`, "-maxrate", `${Math.round(r.videoKbps * 1.1)}k`, "-bufsize", `${r.videoKbps * 2}k`,
          "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_MS / 1000})`,
          ...audio, "-t", seconds, ...hls
        );
      } else {
        outputs.push("-map", `[a${i}]`, ...audio, "-t", seconds, ...hls);
      }
    }
    // A text subtitle track in the file comes out as WebVTT in the same pass (X2).
    const embedded = path.join(job.outDir, "embedded.vtt");
    if (subtitle) outputs.push("-map", `0:s:${subtitle.index}`, "-c:s", "webvtt", "-t", seconds, "-f", "webvtt", embedded);
    const args = ["-hide_banner", "-loglevel", "error", "-y", ...(options.threads ? ["-threads", String(options.threads)] : []), ...inputs, "-filter_complex", graph.join(";"), ...outputs];
    const result = await run("ffmpeg", args);
    if (result.code !== 0) throw new Error(`ffmpeg exited ${result.code}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
    const renditions: TranscodeResult["renditions"] = {};
    for (const r of job.renditions) {
      const playlist = await fs.readFile(path.join(job.outDir, r.name, "index.m3u8"), "utf8");
      renditions[r.name] = { segmentMs: segmentLengths(playlist) };
    }
    const vtt = subtitle ? await fs.readFile(embedded, "utf8").catch(() => null) : null;
    const first = job.renditions[0] ? await startPtsOf(path.join(job.outDir, job.renditions[0].name, "seg_00000.ts")) : null;
    return { durationMs, renditions, captions: vtt && /-->/.test(vtt) ? { vtt, language: subtitle!.language } : null, startPts: first };
  };
}

export interface PreparationStats {
  /** Items prepared in every rendition wanted. */
  prepared: number;
  /** Queued or being prepared now. */
  waiting: number;
  preparing: number;
  failed: number;
  /** Over the last day: items, their length, and the time preparing them took. */
  lastDay: { items: number; mediaSeconds: number; prepSeconds: number; prepSecondsPerMediaHour: number | null };
  lastPreparedAt: string | null;
}

export interface PreparerOptions {
  ladder?: Ladder;
  transcoder?: Transcoder;
  /** Captions from speech (X2): none until a provider is chosen. */
  captionGenerator?: CaptionGenerator;
  /** Preparation scratch space (the worker's only disk need). */
  scratchDir: string;
  concurrency?: number;
  log?: (line: string) => void;
}

export type Preparer = ReturnType<typeof createPreparer>;

export function createPreparer({ deps, services }: ModuleContext, options: PreparerOptions) {
  const { db } = deps;
  const generator = options.captionGenerator ?? noCaptionGenerator;
  /** Each item's first timestamp, once read (for its captions' X-TIMESTAMP-MAP). */
  const startPts = new Map<string, number>();
  const objects = deps.storage.objects;
  const ladder = options.ladder ?? LADDER;
  const transcode = options.transcoder ?? ffmpegTranscoder();
  const concurrency = options.concurrency ?? 1;
  const log = options.log ?? (() => undefined);
  /** Renditions ready, per key (loaded at start, kept up to date by this process). */
  const ready = new Map<string, Set<string>>();
  const lengths = new Map<string, number[]>();
  const running = new Map<string, Promise<void>>();
  const listeners = new Set<(key: string) => void>();
  let loaded: Promise<void> | undefined;

  function markReady(key: string, renditions: string[]) {
    const set = ready.get(key) ?? new Set<string>();
    for (const r of renditions) set.add(r);
    ready.set(key, set);
  }

  async function load() {
    // Only the leader prepares: anything left "preparing" by a worker that stopped goes back in the queue.
    await db.update(PI).set({ status: "queued" }).where(eq(PI.status, "preparing"));
    const rows = await db.select({ key: PR.key, rendition: PR.rendition }).from(PR);
    for (const r of rows) markReady(r.key, [r.rendition]);
  }

  /** Reads what the database says is ready (another replica may have prepared it). */
  async function refresh(keys: string[]) {
    const unknown = [...new Set(keys)].filter((k) => !ready.has(k));
    if (!unknown.length) return;
    const rows = await db.select({ key: PR.key, rendition: PR.rendition }).from(PR).where(inArray(PR.key, unknown));
    for (const r of rows) markReady(r.key, [r.rendition]);
  }

  async function sourceFile(row: typeof PI.$inferSelect, dir: string): Promise<string> {
    if (row.contentId) {
      const file = path.join(dir, "source");
      await objects.download(objectKey.file(row.contentId), file, sha256FromCid(row.contentId));
      return file;
    }
    const location = row.sourceLocation;
    if (!location) throw new Error("nothing to prepare from");
    if (/^https?:\/\//.test(location)) {
      const response = await fetch(location);
      if (!response.ok || !response.body) throw new Error(`the old location answered ${response.status}`);
      const file = path.join(dir, "source");
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(file));
      return file;
    }
    await fs.access(location);
    return location;
  }

  async function prepare(key: string) {
    const [row] = await db.select().from(PI).where(eq(PI.key, key));
    if (!row) return;
    const started = Date.now();
    const dir = path.join(options.scratchDir, `prep-${key.slice(0, 48)}-${started}`);
    await fs.mkdir(dir, { recursive: true });
    try {
      const have = ready.get(key) ?? new Set<string>();
      const wanted = row.renditions.filter((r): r is RenditionName => r in ladder && !have.has(r)).map((r) => ladder[r as RenditionName]);
      let durationMs = row.durationMs;
      let bytes = 0;
      let result: TranscodeResult | null = null;
      let source: TranscodeJob["source"] | null = null;
      if (wanted.length) {
        source = row.kind === "slate" ? { kind: "slate", png: row.sourceLocation, seconds: Math.max(1, Math.round((row.durationMs ?? SEGMENT_MS) / 1000)) } : { kind: "file", path: await sourceFile(row, dir) };
        const out = path.join(dir, "out");
        result = await transcode({ key, source, mediaKind: row.mediaKind, durationMs: row.durationMs, renditions: wanted, outDir: out });
        if (typeof result.startPts === "number") {
          if (startPts.size > 5_000) startPts.clear();
          startPts.set(key, result.startPts);
        }
        durationMs = result.durationMs;
        for (const r of wanted) {
          const made = result.renditions[r.name];
          if (!made?.segmentMs.length) throw new Error(`no segments for ${r.name}`);
          const renditionDir = path.join(out, r.name);
          let renditionBytes = 0;
          for (const name of await fs.readdir(renditionDir)) renditionBytes += (await fs.stat(path.join(renditionDir, name))).size;
          bytes += renditionBytes;
          await objects.putDir(objectKey.prepared(key, r.name), renditionDir, "standard");
          await db
            .insert(PR)
            .values({ key, rendition: r.name, segments: made.segmentMs.length, segmentMs: made.segmentMs, bytes: renditionBytes, preparedAt: deps.clock.now() })
            .onConflictDoUpdate({ target: [PR.key, PR.rendition], set: { segments: made.segmentMs.length, segmentMs: made.segmentMs, bytes: renditionBytes, preparedAt: deps.clock.now() } });
          lengths.delete(`${key}/${r.name}`);
        }
      }
      const prepMs = Date.now() - started;
      await db
        .update(PI)
        .set({ status: "ready", durationMs, prepMs, bytes: sql`coalesce(${PI.bytes}, 0) + ${bytes}`, preparedAt: deps.clock.now(), error: null })
        .where(eq(PI.key, key));
      markReady(key, wanted.map((r) => r.name));
      if (wanted.length) log(`[prepare] ${key.slice(0, 16)}… ${wanted.map((r) => r.name).join(" ")} in ${(prepMs / 1000).toFixed(1)} s (${((durationMs ?? 0) / 1000).toFixed(0)} s of media)`);
      // Captions, once the segments they follow exist. They never hold the item up.
      if (row.kind === "file") {
        await captionsAfterPrepare(key, row.mediaKind, durationMs ?? 0, result, source?.kind === "file" ? source.path : null).catch((error) =>
          log(`[prepare] ${key.slice(0, 16)}… captions failed: ${(error as Error).message.slice(0, 200)}`)
        );
      }
      for (const listener of listeners) listener(key);
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      log(`[prepare] ${key.slice(0, 16)}… failed: ${message}`);
      await db
        .update(PI)
        .set({ status: row.attempts + 1 >= 3 ? "failed" : "queued", error: message })
        .where(eq(PI.key, key));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * The embedded track the transcode found, else one generated from speech (only for an item
   * prepared for TV with no captions yet, so a band's renditions added later don't ask again);
   * then every track the item has.
   */
  async function captionsAfterPrepare(key: string, mediaKind: "video" | "audio", durationMs: number, result: TranscodeResult | null, file: string | null) {
    const extra: CaptionInput[] = [];
    if (result?.captions) extra.push({ ...result.captions, source: "embedded" });
    else if (result && file && ready.get(key)?.has(REFERENCE.tv)) {
      const [made] = await db.select({ contentId: PC.contentId }).from(PC).where(eq(PC.key, key)).limit(1);
      const own = made ? true : (await uploadedTracks(key)).length > 0;
      const generated = own ? null : await generator.generate({ key, file, mediaKind, durationMs });
      if (generated) extra.push({ ...generated, source: "generated" });
    }
    await prepareCaptions(key, extra);
  }

  /** Caption tracks uploaded to the items whose current file is this one. */
  async function uploadedTracks(key: string): Promise<CaptionInput[]> {
    // Files from before content IDs (`loc-…`) have no uploaded captions prepared with them.
    if (key.startsWith("loc-") || key.startsWith("slate-")) return [];
    const tracks = await services.library.captionTracksForContent(key);
    return tracks.map((t) => ({ vtt: t.vtt, language: t.language, source: "uploaded" as const }));
  }

  /** The item's first MPEG-TS timestamp: from its transcode, else read from a stored segment. */
  async function itemStartPts(key: string): Promise<number> {
    const known = startPts.get(key);
    if (known !== undefined) return known;
    const have = ready.get(key) ?? new Set<string>();
    const rendition = (["v360", "a64", "a128", "v480", "v720", "v1080"] as const).find((r) => have.has(r));
    let pts: number | null = null;
    if (rendition) {
      const dir = await fs.mkdtemp(path.join(options.scratchDir, "pts-"));
      try {
        const file = path.join(dir, "seg_00000.ts");
        await objects.download(`${objectKey.prepared(key, rendition)}/seg_00000.ts`, file);
        pts = await startPtsOf(file);
      } catch {
        // Not readable: FFmpeg's usual start.
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
    startPts.set(key, pts ?? DEFAULT_START_PTS);
    return pts ?? DEFAULT_START_PTS;
  }

  /**
   * Cuts each of the item's caption tracks not prepared yet into its segments (the TV band's, whose
   * picture they're shown over) and stores them beside its renditions. Nothing to do until the item
   * is prepared for TV. Returns how many tracks were prepared.
   */
  async function prepareCaptions(key: string, extra: CaptionInput[] = []): Promise<number> {
    if (key.startsWith("slate-")) return 0;
    const lengths = await preparer.segmentMs(key, REFERENCE.tv);
    if (!lengths?.length) return 0;
    const tracks = [...extra, ...(await uploadedTracks(key))];
    if (!tracks.length) return 0;
    const done = new Set((await db.select({ contentId: PC.contentId }).from(PC).where(eq(PC.key, key))).map((r) => r.contentId));
    let made = 0;
    for (const track of tracks) {
      const { cid } = vttContentId(track.vtt);
      if (done.has(cid)) continue;
      done.add(cid);
      const segments = segmentVtt(track.vtt, lengths, await itemStartPts(key));
      const rendition = captionRendition(cid);
      const dir = await fs.mkdtemp(path.join(options.scratchDir, "cc-"));
      try {
        await fs.writeFile(path.join(dir, "track.vtt"), track.vtt);
        await Promise.all(segments.map((text, i) => fs.writeFile(path.join(dir, `seg_${String(i).padStart(5, "0")}.vtt`), text)));
        await fs.writeFile(
          path.join(dir, "index.m3u8"),
          ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.max(4, ...lengths.map((ms) => Math.ceil(ms / 1000)))}`, "#EXT-X-PLAYLIST-TYPE:VOD", ...lengths.flatMap((ms, i) => [`#EXTINF:${(ms / 1000).toFixed(3)},`, `seg_${String(i).padStart(5, "0")}.vtt`]), "#EXT-X-ENDLIST", ""].join("\n")
        );
        let bytes = 0;
        for (const name of await fs.readdir(dir)) bytes += (await fs.stat(path.join(dir, name))).size;
        await objects.putDir(objectKey.prepared(key, rendition), dir, "standard");
        await db
          .insert(PC)
          .values({ key, contentId: cid, rendition, source: track.source, language: track.language, segments: segments.length, bytes, preparedAt: deps.clock.now() })
          .onConflictDoNothing();
        made++;
        log(`[prepare] ${key.slice(0, 16)}… captions (${track.source}${track.language ? `, ${track.language}` : ""}) in ${segments.length} segments`);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
    return made;
  }

  /** Claims a queued item (another replica may be after it too) and prepares it. */
  function start(key: string): Promise<void> {
    const existing = running.get(key);
    if (existing) return existing;
    const work = (async () => {
      const [claimed] = await db
        .update(PI)
        .set({ status: "preparing", startedAt: deps.clock.now(), attempts: sql`${PI.attempts} + 1` })
        .where(and(eq(PI.key, key), sql`${PI.status} in ('queued', 'failed')`))
        .returning({ key: PI.key });
      if (claimed) await prepare(key);
    })().finally(() => running.delete(key));
    running.set(key, work);
    return work;
  }

  const preparer = {
    ladder,

    init() {
      return (loaded ??= load());
    },

    /** Is it prepared in every rendition this band airs? */
    isReady(ref: MediaRef | string, band: Band): boolean {
      const key = typeof ref === "string" ? ref : refKey(ref);
      if (!key) return false;
      const have = ready.get(key);
      return Boolean(have) && BAND_RENDITIONS[band].every((r) => have!.has(r));
    },

    refresh,

    /** Called with a key each time an item becomes ready (slates' keys start `slate-`). */
    onReady(listener: (key: string) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Asks for items to be prepared for a band: queued (earliest airtime first) unless they're
     * ready in every rendition the band needs. A band's missing renditions are added to what's there.
     */
    async want(refs: WantRef[]) {
      const merged = new Map<string, typeof PI.$inferInsert>();
      for (const ref of refs) {
        const key = refKey(ref);
        if (!key) continue;
        if (preparer.isReady(key, ref.band)) continue;
        const current = merged.get(key);
        const renditions = [...new Set([...(current?.renditions ?? []), ...BAND_RENDITIONS[ref.band]])].sort();
        const neededAt = [current?.neededAt, ref.neededAt].filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        merged.set(key, {
          key,
          contentId: ref.contentId ?? null,
          kind: "file",
          sourceLocation: ref.contentId ? null : (ref.location ?? null),
          mediaKind: ref.mediaKind,
          status: "queued",
          renditions,
          durationMs: ref.durationMs ?? current?.durationMs ?? null,
          neededAt
        });
      }
      const rows = [...merged.values()];
      for (let i = 0; i < rows.length; i += 200) {
        await db
          .insert(PI)
          .values(rows.slice(i, i + 200))
          .onConflictDoUpdate({
            target: PI.key,
            set: {
              renditions: sql`array(select distinct unnest(${PI.renditions} || excluded.renditions) order by 1)`,
              neededAt: sql`least(${PI.neededAt}, excluded.needed_at)`,
              // A band's new renditions put a ready item back in the queue (only those are made).
              status: sql`case when ${PI.status} = 'ready' and not (excluded.renditions <@ ${PI.renditions}) then 'queued' else ${PI.status} end`
            }
          });
      }
      return rows.length;
    },

    /** Prepares queued items, earliest airtime first, up to the concurrency. Doesn't wait for them. */
    async pump() {
      while (running.size < concurrency) {
        const queued = await db
          .select({ key: PI.key })
          .from(PI)
          .where(eq(PI.status, "queued"))
          .orderBy(sql`${PI.neededAt} asc nulls last`, asc(PI.queuedAt))
          .limit(concurrency * 2);
        const next = queued.find((q) => !running.has(q.key));
        if (!next) return;
        void start(next.key);
      }
    },

    /**
     * A generated slate (a picture held for `seconds`, with silence; silence alone on the radio
     * band), prepared now and ready when this resolves. Keyed by the picture and the length, so a
     * credit whose sponsors change is a new slate, and the same one is never prepared twice.
     */
    async slate(png: string | null, seconds: number, band: Band): Promise<string> {
      const whole = Math.max(1, Math.round(seconds));
      const picture = band === "radio" ? null : png;
      const pictureHash = picture ? createHash("sha256").update(await fs.readFile(picture)).digest("hex") : "silence";
      const sizes = BAND_RENDITIONS[band].map((r) => `${r}:${ladder[r].width}x${ladder[r].height}`).join(",");
      const key = `slate-${createHash("sha256").update(`${pictureHash}|${whole}|${sizes}|v1`).digest("hex").slice(0, 40)}`;
      if (preparer.isReady(key, band)) return key;
      await refresh([key]);
      if (preparer.isReady(key, band)) return key;
      await db
        .insert(PI)
        .values({ key, kind: "slate", sourceLocation: picture, mediaKind: "video", status: "queued", renditions: [...BAND_RENDITIONS[band]].sort(), durationMs: whole * 1000, neededAt: deps.clock.now() })
        .onConflictDoUpdate({ target: PI.key, set: { sourceLocation: picture, status: sql`case when ${PI.status} = 'preparing' then ${PI.status} else 'queued' end` } });
      await start(key);
      // Another replica had it: wait for it to land.
      for (let i = 0; i < 60 && !preparer.isReady(key, band); i++) {
        ready.delete(key);
        await refresh([key]);
        if (!preparer.isReady(key, band)) await new Promise((r) => setTimeout(r, 250));
      }
      if (!preparer.isReady(key, band)) throw new Error("the slate couldn't be prepared");
      return key;
    },

    /** Prepares an item's caption tracks now (it must be prepared for TV already). */
    prepareCaptions,

    /**
     * Caption tracks uploaded, replaced or backfilled since `since`: cut for the items already
     * prepared (the rest get theirs when they're prepared). Returns how many tracks were prepared.
     */
    async captionsChangedSince(since: Date): Promise<number> {
      const itemIds = await services.library.captionTracksChangedSince(since);
      if (!itemIds.length) return 0;
      const current = await services.library.currentContent(itemIds);
      const keys = [...new Set(current.values())];
      await refresh(keys);
      let made = 0;
      for (const key of keys) if (ready.get(key)?.has(REFERENCE.tv)) made += await prepareCaptions(key);
      return made;
    },

    /** A rendition's segment lengths (ms), from the database, remembered. */
    async segmentMs(key: string, rendition: string): Promise<number[] | null> {
      const id = `${key}/${rendition}`;
      if (lengths.has(id)) return lengths.get(id)!;
      const [row] = await db.select({ segmentMs: PR.segmentMs }).from(PR).where(and(eq(PR.key, key), eq(PR.rendition, rendition)));
      if (row) lengths.set(id, row.segmentMs);
      return row?.segmentMs ?? null;
    },

    /** Waits for preparations under way (tests, shutdown). */
    async settle() {
      while (running.size) await Promise.all([...running.values()]);
    },

    async stats(): Promise<PreparationStats> {
      const since = new Date(deps.clock.now().getTime() - 86_400_000);
      const [counts, [day], [last]] = await Promise.all([
        db.select({ status: PI.status, n: sql<number>`count(*)::int` }).from(PI).groupBy(PI.status),
        db
          .select({ items: sql<number>`count(*)::int`, media: sql<number>`coalesce(sum(${PI.durationMs}), 0)::float8`, prep: sql<number>`coalesce(sum(${PI.prepMs}), 0)::float8` })
          .from(PI)
          .where(and(eq(PI.kind, "file"), gte(PI.preparedAt, since), isNotNull(PI.prepMs))),
        db.select({ at: sql<Date | null>`max(${PI.preparedAt})` }).from(PI)
      ]);
      const by = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
      return {
        prepared: by("ready"),
        waiting: by("queued") + by("preparing"),
        preparing: by("preparing"),
        failed: by("failed"),
        lastDay: {
          items: day?.items ?? 0,
          mediaSeconds: Math.round((day?.media ?? 0) / 1000),
          prepSeconds: Math.round((day?.prep ?? 0) / 1000),
          prepSecondsPerMediaHour: day?.media ? Math.round(((day.prep / 1000) * 3600) / (day.media / 1000)) : null
        },
        lastPreparedAt: last?.at ? new Date(last.at).toISOString() : null
      };
    }
  };
  return preparer;
}
