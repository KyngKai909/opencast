// A spot's proof frame: one picture from the middle of the spot, taken from the segment that was
// published to the channel's playlist, with the station's bug composited on (the player draws the
// bug; anywhere the picture leaves Opencast's players, the worker draws it). Stored in object
// storage under `proof/<station>/<airing>.jpg` and kept for a year (an R2 lifecycle rule).

import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ModuleContext } from "../../../context.js";
import { contentIdOf, objectKey } from "../../../storage.js";

export async function proofFrame(
  { deps }: ModuleContext,
  input: { stationId: string; airingId: string; preparedKey: string; rendition: string; width: number; height: number; segment: number; bug: string | null; scratchDir: string }
): Promise<string | null> {
  const objects = deps.storage.objects;
  if (!objects.open) return null;
  const dir = path.join(input.scratchDir, `proof-${input.airingId}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const segment = path.join(dir, "segment.ts");
    const name = `seg_${String(input.segment).padStart(5, "0")}.ts`;
    await pipeline(await objects.open(`${objectKey.prepared(input.preparedKey, input.rendition)}/${name}`), createWriteStream(segment));
    const jpg = path.join(dir, "proof.jpg");
    // A second into the segment, with the bug (a full-frame picture) scaled to the rendition.
    const args = input.bug
      ? ["-i", segment, "-loop", "1", "-i", input.bug, "-filter_complex", `[1:v]scale=${input.width}:${input.height}[b];[0:v][b]overlay=shortest=1,format=yuvj420p`, "-ss", "1", "-frames:v", "1", jpg]
      : ["-i", segment, "-vf", "format=yuvj420p", "-ss", "1", "-frames:v", "1", jpg];
    const code = await new Promise<number>((resolve) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
      child.on("close", (c) => resolve(c ?? 1));
      child.on("error", () => resolve(1));
    });
    if (code !== 0) return null;
    const { sha256 } = await contentIdOf(jpg);
    const key = objectKey.proof(input.stationId, input.airingId);
    await objects.put(key, jpg, { contentType: "image/jpeg", storageClass: "infrequent", sha256 });
    return objects.publicUrl?.(key) ?? (await objects.url(key));
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
