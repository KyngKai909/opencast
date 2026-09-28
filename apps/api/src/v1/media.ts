// The media pipeline the v1 modules use: probe, measure, prepare for air, store.
// Wraps the ffmpeg and yt-dlp helpers the old API already had.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { compressForStreaming, expandExternalUrls, ingestFromExternalUrl, probeDurationSec, probeMediaKind } from "../media.js";
import { assetObjectKey, isR2Configured, uploadFileToR2 } from "../r2.js";

export interface Probe {
  durationMs: number | null;
  mediaKind: "video" | "audio";
  width: number | null;
  height: number | null;
}

export interface Prepared {
  storage: "local" | "r2";
  /** What the worker reads: a disk path or a URL. */
  location: string;
  r2Key: string | null;
  compression: { tool: "ffmpeg"; profile: string; compressedAt: string };
}

export interface MediaPipeline {
  probe(file: string): Promise<Probe>;
  /** Integrated loudness in LUFS (EBU R128). */
  loudness(file: string): Promise<number | null>;
  /** Compress to the stream-ready profile and put it where playout reads from. */
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
      const compression = { tool: "ffmpeg" as const, profile: compressed.profile, compressedAt: new Date().toISOString() };
      if (isR2Configured()) {
        try {
          const key = assetObjectKey(scope, itemId, compressed.outputPath);
          const stored = await uploadFileToR2(compressed.outputPath, key);
          if (stored.url) {
            await fs.unlink(compressed.outputPath).catch(() => undefined);
            return { storage: "r2", location: stored.url, r2Key: stored.key, compression };
          }
          return { storage: "local", location: compressed.outputPath, r2Key: stored.key, compression };
        } catch (error) {
          console.warn(`[media] R2 upload failed; keeping ${itemId} on local disk`, error);
        }
      }
      return { storage: "local", location: compressed.outputPath, r2Key: null, compression };
    },

    importLink: (url, outDir, baseName, signal) => ingestFromExternalUrl(url, outDir, baseName, { signal }),
    expandLinks: (url) => expandExternalUrls(url)
  };
}
