// Composing an episode: its items' originals, in order, joined into one file with FFmpeg. The file
// goes to the library as an item of the series' program on the catalog station (a new version of
// it on a rebuild), and playout prepares it once, like any program: carriers air the new version
// from their next airing. Pictures are fitted into 16:9 at the tallest item's height (up to 1080)
// with no cropping; an item with no sound gets silence, so the sound never drifts.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaPipeline } from "../../media.js";
import { FPS } from "../playout/engine/ladder.js";

/** The content IDs in order: an episode whose items haven't changed composes to the same key, and isn't touched. */
export function compositionKey(contentIds: string[]): string {
  return createHash("sha256").update(contentIds.join("\n")).digest("hex");
}

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (error) => resolve({ code: 1, stderr: String(error) }));
  });
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Joins the files (local paths) into `out`. Video: H.264 and AAC in MP4. Sound only: AAC in M4A. */
export async function composeFiles(media: MediaPipeline, files: string[], mediaKind: "video" | "audio", out: string): Promise<{ durationMs: number }> {
  if (!files.length) throw new Error("An episode needs at least one item.");
  const probes = await Promise.all(files.map((f) => media.probe(f)));
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts: string[] = [];
  const labels: string[] = [];
  if (mediaKind === "video") {
    const height = even(Math.min(1080, Math.max(...probes.map((p) => p.height ?? 360))));
    const width = even((height * 16) / 9);
    probes.forEach((p, i) => {
      parts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
      const seconds = ((p.durationMs ?? 0) / 1000).toFixed(3);
      parts.push(
        p.audioChannels
          ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
          : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${seconds}[a${i}]`
      );
      labels.push(`[v${i}][a${i}]`);
    });
    parts.push(`${labels.join("")}concat=n=${files.length}:v=1:a=1[v][a]`);
    const made = await run(["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
    if (made.code !== 0) throw new Error(`Composing the episode failed: ${made.stderr.trim().split("\n").pop() ?? "ffmpeg"}`);
  } else {
    probes.forEach((_, i) => {
      parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      labels.push(`[a${i}]`);
    });
    parts.push(`${labels.join("")}concat=n=${files.length}:v=0:a=1[a]`);
    const made = await run(["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[a]", "-c:a", "aac", "-b:a", "192k", out]);
    if (made.code !== 0) throw new Error(`Composing the episode failed: ${made.stderr.trim().split("\n").pop() ?? "ffmpeg"}`);
  }
  const probe = await media.probe(out);
  return { durationMs: probe.durationMs ?? probes.reduce((s, p) => s + (p.durationMs ?? 0), 0) };
}

/** A scratch folder for one composition, removed afterwards. */
export async function scratch<T>(root: string, work: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(root, "catalog", `compose-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    return await work(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
