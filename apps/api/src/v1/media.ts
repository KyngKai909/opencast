// The media pipeline the v1 modules use: probe, measure, import from links.
// Wraps the ffmpeg and yt-dlp helpers the old API already had. Nothing is compressed here any more:
// uploads are kept as they came (the original, by content ID) and playout prepares them for air,
// once, from that original (modules/playout/engine/prepare.ts).

import { spawn } from "node:child_process";
import { expandExternalUrls, ingestFromExternalUrl, probeDurationSec, probeMediaKind } from "../media.js";

export interface Probe {
  durationMs: number | null;
  mediaKind: "video" | "audio";
  width: number | null;
  height: number | null;
  /** Channels in the first audio stream (1 mono, 2 stereo); null without audio. */
  audioChannels?: number | null;
}

export interface MediaPipeline {
  probe(file: string): Promise<Probe>;
  /** Integrated loudness in LUFS (EBU R128). */
  loudness(file: string): Promise<number | null>;
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

export function ffmpegPipeline(_storageRoot?: string): MediaPipeline {
  return {
    async probe(file) {
      const [durationSec, mediaKind, size, audio] = await Promise.all([
        probeDurationSec(file),
        probeMediaKind(file),
        run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file]),
        run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "json", file])
      ]);
      let audioChannels: number | null = null;
      try {
        audioChannels = JSON.parse(audio.stdout).streams?.[0]?.channels ?? null;
      } catch {
        // No audio stream.
      }
      let width: number | null = null;
      let height: number | null = null;
      try {
        const stream = JSON.parse(size.stdout).streams?.[0];
        width = stream?.width ?? null;
        height = stream?.height ?? null;
      } catch {
        // No video stream.
      }
      return { durationMs: durationSec != null ? Math.round(durationSec * 1000) : null, mediaKind, width, height, audioChannels };
    },

    async loudness(file) {
      const result = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"]);
      const match = [...result.stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].pop();
      return match ? Number(match[1]) : null;
    },

    importLink: (url, outDir, baseName, signal) => ingestFromExternalUrl(url, outDir, baseName, { signal }),
    expandLinks: (url) => expandExternalUrls(url)
  };
}
