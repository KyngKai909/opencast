// The media pipeline the v1 modules use: probe, measure, prepare for air, store.
// Wraps the ffmpeg and yt-dlp helpers the old API already had.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { compressForStreaming, expandExternalUrls, ingestFromExternalUrl, probeDurationSec, probeMediaKind } from "../media.js";

export interface Probe {
  durationMs: number | null;
  mediaKind: "video" | "audio";
  width: number | null;
  height: number | null;
}

export interface Prepared {
  /** The stream-ready file on local disk, to be stored by its content ID. */
  file: string;
  compression: { tool: "ffmpeg"; profile: string; compressedAt: string };
}

export interface MediaPipeline {
  probe(file: string): Promise<Probe>;
  /** Integrated loudness in LUFS (EBU R128). */
  loudness(file: string): Promise<number | null>;
  /** Compress to the stream-ready profile. The caller stores the result by content ID. */
  prepare(file: string, input: { scope: string; itemId: string; mediaKind: "video" | "audio" }): Promise<Prepared>;
  importLink(url: string, outDir: string, baseName: string, signal?: AbortSignal): Promise<string>;
  expandLinks(url: string): Promise<string[]>;
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
  });
}

export function ffmpegPipeline(storageRoot: string): MediaPipeline {
  return {
    async probe(file) {
      const [durationSec, mediaKind, size] = await Promise.all([
        probeDurationSec(file),
        probeMediaKind(file),
        run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file])
      ]);
      let width: number | null = null;
      let height: number | null = null;
      try {
        const stream = JSON.parse(size.stdout).streams?.[0];
        width = stream?.width ?? null;
        height = stream?.height ?? null;
      } catch {
        // No video stream.
      }
      return { durationMs: durationSec != null ? Math.round(durationSec * 1000) : null, mediaKind, width, height };
    },

    async loudness(file) {
      const result = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"]);
      const match = [...result.stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].pop();
      return match ? Number(match[1]) : null;
    },

    async prepare(file, { scope, itemId, mediaKind }) {
      const outDir = path.join(storageRoot, "uploads", scope, "ready");
      const compressed = await compressForStreaming(file, outDir, itemId, mediaKind);
      return { file: compressed.outputPath, compression: { tool: "ffmpeg", profile: compressed.profile, compressedAt: new Date().toISOString() } };
    },

    importLink: (url, outDir, baseName, signal) => ingestFromExternalUrl(url, outDir, baseName, { signal }),
    expandLinks: (url) => expandExternalUrls(url)
  };
}
