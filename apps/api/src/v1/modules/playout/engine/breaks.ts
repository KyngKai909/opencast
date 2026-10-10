// Suggested break points (programming prompt, Phase 4, 2026-10-10). While a program is prepared,
// its file is read for places a break could go: its chapter marks, or, for a file without them,
// where the picture is black and the sound silent together (old TV episodes have these where the
// commercials were). They're suggestions only, kept apart from the maker's own break points
// (`break_suggestions`), and become the item's break points only when the station says Use these:
// a bad break in the middle of a sentence is worse than none.
//
// Chapters: each chapter's start, except in the first and last two minutes, and except one closer
// than five minutes to the last one kept. Fades: the sound is read first (silencedetect, quick:
// no picture is decoded), then the picture only around the longest silences (blackdetect from a
// second before each); a stretch at least 0.3 s long that's both black and silent is a candidate,
// and the strongest (longest) one in each stretch of eight minutes is kept, clear of the edges too.

import { spawn } from "node:child_process";

/** No break this close to the start or the end. */
export const EDGE_MS = 2 * 60_000;
/** Chapter starts closer than this to the last one kept aren't breaks. */
export const CHAPTER_GAP_MS = 5 * 60_000;
/** At least this long both black and silent. */
export const FADE_MIN_MS = 300;
/** The strongest fade in each stretch this long. */
export const FADE_WINDOW_MS = 8 * 60_000;
/** Files shorter than this aren't looked at (nothing would be kept in most of them). */
export const BREAKS_FROM_MS = 8 * 60_000;
/** The picture is read around this many of the longest silences, at most. */
const SILENCES_LOOKED_AT = 60;

export interface Span {
  startMs: number;
  endMs: number;
}

export interface FoundBreaks {
  /** Null when nothing qualified. */
  source: "chapter" | "fade" | null;
  offsetsMs: number[];
}

/** Looks in a file (a local path, or a URL FFmpeg can read) for break points. */
export type BreakFinder = (input: { file: string; durationMs: number; video: boolean }) => Promise<FoundBreaks>;

/** Chapter starts that make breaks: clear of the edges, and five minutes from the last one kept. */
export function chapterBreaks(startsMs: number[], durationMs: number): number[] {
  const kept: number[] = [];
  for (const at of [...startsMs].map(Math.round).sort((a, b) => a - b)) {
    if (at < EDGE_MS || at > durationMs - EDGE_MS) continue;
    if (kept.length && at - kept[kept.length - 1] < CHAPTER_GAP_MS) continue;
    kept.push(at);
  }
  return kept;
}

/**
 * Where it's both black and silent for at least 0.3 s, each a candidate at its middle, as strong
 * as it's long; the strongest kept in each stretch of `windowMs` (no two kept closer than that),
 * clear of the edges. In time order.
 */
export function fadeBreaks(black: Span[], silence: Span[], durationMs: number, windowMs = FADE_WINDOW_MS): number[] {
  const candidates: Array<{ at: number; strength: number }> = [];
  for (const b of black) {
    for (const s of silence) {
      const start = Math.max(b.startMs, s.startMs);
      const end = Math.min(b.endMs, s.endMs);
      if (end - start < FADE_MIN_MS) continue;
      const at = Math.round((start + end) / 2);
      if (at < EDGE_MS || at > durationMs - EDGE_MS) continue;
      candidates.push({ at, strength: end - start });
    }
  }
  candidates.sort((a, b) => b.strength - a.strength || a.at - b.at);
  const kept: number[] = [];
  for (const c of candidates) if (kept.every((k) => Math.abs(k - c.at) >= windowMs)) kept.push(c.at);
  return kept.sort((a, b) => a - b);
}

/** silencedetect's or blackdetect's spans from FFmpeg's log, in ms, shifted by `offsetMs`. */
export function detectedSpans(log: string, kind: "silence" | "black", offsetMs = 0, endMs?: number): Span[] {
  const spans: Span[] = [];
  let open: number | null = null;
  if (kind === "black") {
    for (const m of log.matchAll(/black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)/g)) spans.push({ startMs: Number(m[1]) * 1000 + offsetMs, endMs: Number(m[2]) * 1000 + offsetMs });
  } else {
    for (const m of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
      const t = Number(m[2]) * 1000 + offsetMs;
      if (m[1] === "start") open = t;
      else if (open !== null) {
        spans.push({ startMs: open, endMs: t });
        open = null;
      }
    }
    // Silent to the end of the file.
    if (open !== null && endMs !== undefined) spans.push({ startMs: open, endMs });
  }
  return spans.map((s) => ({ startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) }));
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    // Everything FFmpeg logs is read here (each silence is a line), up to 4 MB.
    child.stderr.on("data", (d) => (stderr = stderr.length < 4_000_000 ? stderr + d : stderr));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

/** The file's chapter starts (ms from its start), and where its timestamps start. */
async function chaptersOf(file: string): Promise<{ startsMs: number[]; startMs: number }> {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=start_time", "-show_chapters", "-of", "json", file]);
  if (result.code !== 0) throw new Error(`ffprobe exited ${result.code}: ${result.stderr.trim().split("\n").slice(-2).join(" ")}`);
  const json = JSON.parse(result.stdout) as { format?: { start_time?: string }; chapters?: Array<{ start_time?: string }> };
  const start = Number(json.format?.start_time);
  const startMs = Number.isFinite(start) ? start * 1000 : 0;
  const startsMs = (json.chapters ?? []).map((c) => Number(c.start_time) * 1000 - startMs).filter((ms) => Number.isFinite(ms));
  return { startsMs, startMs };
}

/** Where the sound is silent (-50 dB) for 0.3 s or more, from the file's start. */
async function silencesOf(file: string, startMs: number, durationMs: number): Promise<Span[]> {
  const result = await run("ffmpeg", ["-hide_banner", "-nostats", "-v", "info", "-i", file, "-map", "0:a:0?", "-vn", "-sn", "-af", `silencedetect=n=-50dB:d=${FADE_MIN_MS / 1000}`, "-f", "null", "-"]);
  // No sound at all: nothing silent to find.
  if (result.code !== 0 && /does not contain any stream/.test(result.stderr)) return [];
  if (result.code !== 0) throw new Error(`ffmpeg exited ${result.code}: ${result.stderr.trim().split("\n").slice(-2).join(" ")}`);
  return detectedSpans(result.stderr, "silence", -startMs, durationMs);
}

/** Where the picture is black around a stretch (from a second before it to a second after). */
async function blackAround(file: string, span: Span): Promise<Span[]> {
  const from = Math.max(0, span.startMs - 1000);
  const seconds = (span.endMs + 1000 - from) / 1000;
  const result = await run("ffmpeg", ["-hide_banner", "-nostats", "-v", "info", "-ss", (from / 1000).toFixed(3), "-i", file, "-t", seconds.toFixed(3), "-map", "0:v:0", "-an", "-sn", "-vf", "blackdetect=d=0.1:pix_th=0.10", "-f", "null", "-"]);
  if (result.code !== 0) return [];
  // After a seek, the picture's timestamps start at the seek.
  return detectedSpans(result.stderr, "black", from);
}

/**
 * FFmpeg's look for break points: chapter marks when they give any; else fades (a file with a
 * picture). `windowMs` is the fades' stretch (eight minutes; shorter only in tests).
 */
export function ffmpegBreakFinder(options: { windowMs?: number } = {}): BreakFinder {
  const windowMs = options.windowMs ?? FADE_WINDOW_MS;
  return async ({ file, durationMs, video }) => {
    const { startsMs, startMs } = await chaptersOf(file);
    const chapters = chapterBreaks(startsMs, durationMs);
    if (chapters.length) return { source: "chapter", offsetsMs: chapters };
    if (!video) return { source: null, offsetsMs: [] };
    const silences = (await silencesOf(file, startMs, durationMs))
      .filter((s) => s.endMs - s.startMs >= FADE_MIN_MS && s.endMs > EDGE_MS && s.startMs < durationMs - EDGE_MS)
      .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, SILENCES_LOOKED_AT);
    const black: Span[] = [];
    for (const s of silences) black.push(...(await blackAround(file, s)));
    const fades = fadeBreaks(black, silences, durationMs, windowMs);
    return fades.length ? { source: "fade", offsetsMs: fades } : { source: null, offsetsMs: [] };
  };
}
