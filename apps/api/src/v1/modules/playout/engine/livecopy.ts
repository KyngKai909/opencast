// TV live blocks from our own storage (added 2026-09-30). The leading worker pulls each new
// segment of every Livepeer rendition the channel uses once, and stores it with the platform's
// objects, in Standard, at `prepared/live-<source>-<session>/<rendition>/seg_NNNNN.ts` (the same
// layout as radio live's, radiolive.ts): the channel's playlists point at these copies, so viewers
// and relays never fetch from Livepeer, whose delivery is billed per viewer-hour, and the copies
// last as long as their channel rows (two days, then pruned with them), so a live block can be
// paused and replayed within the playlist's 30-minute window like anything prepared.
//
//   - Each of Livepeer's variants is fetched once per segment, whichever renditions read it (before
//     Livepeer lists its transcoded renditions, every rendition reads the source's), and stored
//     once, under the first rendition that reads it.
//   - The audio-only rendition is the sound of Livepeer's smallest rendition, taken from the bytes
//     already fetched (stream-copied by FFmpeg, timestamps kept); if FFmpeg can't, the smallest
//     rendition's segment as it came.
//   - A fetch or store that fails is tried again briefly (within `deadlineMs`), then the segment is
//     given up on: LiveHlsSource skips it, and the channel puts a discontinuity there.
//
// What it costs is added up for the worker's health (`liveCopy`): bytes pulled from Livepeer and
// written, objects written, the CPU it took (the worker's own while copying, an upper bound since
// other work can interleave, plus FFmpeg's), and the delay a copy adds (from the segment appearing
// in Livepeer's playlist to its copy being stored).

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RenditionName } from "./ladder.js";
import { audioOnlySegment, type LiveCopyEvent, type SegmentCopier } from "./live.js";
import { liveSegmentKey } from "./radiolive.js";

/** A segment's copy is given up on after this long (fetches and stores retried within it). */
export const COPY_DEADLINE_MS = 6_000;
const FETCH_TIMEOUT_MS = 3_000;
const RETRY_WAIT_MS = [250, 500, 1_000];

/** What TV live copying has done since the worker started (the health endpoint's `liveCopy`). */
export interface LiveCopyStats {
  /** Segments copied (every rendition of one media segment counts once), and their media seconds. */
  segments: number;
  liveSeconds: number;
  /** Bytes pulled from Livepeer, and per live hour. */
  bytesPulled: number;
  bytesPulledPerLiveHour: number | null;
  /** Objects written to storage (every rendition's segment), and the bytes written. */
  objectsWritten: number;
  bytesWritten: number;
  /** CPU the copies took: the worker's own while copying (an upper bound) plus FFmpeg's. */
  cpuSeconds: number;
  cpuSecondsPerLiveHour: number | null;
  /** Segments skipped (a copy that failed after its retries), and catch-ups (a backlog dropped). */
  skipped: number;
  caughtUp: number;
  /** The delay a copy adds (listed by Livepeer to stored), over the last 200 segments. */
  addedLatencyMs: { average: number; p95: number; max: number } | null;
}

export function liveCopyCounter() {
  const t = { segments: 0, ms: 0, bytesPulled: 0, objectsWritten: 0, bytesWritten: 0, cpuSeconds: 0, skipped: 0, caughtUp: 0, delays: [] as number[] };
  return {
    totals: t,
    /** Counts what a copier did (called by the copier as it goes). */
    add(part: Partial<Pick<typeof t, "bytesPulled" | "objectsWritten" | "bytesWritten" | "cpuSeconds">>) {
      t.bytesPulled += part.bytesPulled ?? 0;
      t.objectsWritten += part.objectsWritten ?? 0;
      t.bytesWritten += part.bytesWritten ?? 0;
      t.cpuSeconds += part.cpuSeconds ?? 0;
    },
    /** A live source's events (LiveHlsSource's `onEvent`). */
    event(e: LiveCopyEvent) {
      if (e.kind === "copied") {
        t.segments++;
        t.ms += e.durationMs;
        t.delays.push(e.delayMs);
        if (t.delays.length > 200) t.delays.shift();
      } else if (e.kind === "skipped") t.skipped++;
      else t.caughtUp++;
    },
    stats(): LiveCopyStats {
      const perHour = (n: number) => (t.ms ? Math.round((n * 3_600_000) / t.ms) : null);
      const sorted = [...t.delays].sort((a, b) => a - b);
      return {
        segments: t.segments,
        liveSeconds: Math.round(t.ms / 1000),
        bytesPulled: t.bytesPulled,
        bytesPulledPerLiveHour: perHour(t.bytesPulled),
        objectsWritten: t.objectsWritten,
        bytesWritten: t.bytesWritten,
        cpuSeconds: Math.round(t.cpuSeconds * 100) / 100,
        cpuSecondsPerLiveHour: perHour(t.cpuSeconds),
        skipped: t.skipped,
        caughtUp: t.caughtUp,
        addedLatencyMs: sorted.length
          ? { average: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length), p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]), max: Math.round(sorted[sorted.length - 1]) }
          : null
      };
    }
  };
}

export type LiveCopyCounter = ReturnType<typeof liveCopyCounter>;

export interface LiveCopierOptions {
  liveSourceId: string;
  scratchDir: string;
  /** Stores a file at a key (Standard); its URL for the playlists. */
  store(key: string, file: string, contentType: string): Promise<string>;
  counter?: LiveCopyCounter;
  deadlineMs?: number;
  /** How a segment is fetched (tests count requests); `fetch` by default. */
  fetch?: typeof fetch;
}

/** Tries `attempt` until it gives something or the deadline passes. */
async function retrying<T>(deadline: number, attempt: () => Promise<T | null>): Promise<T | null> {
  for (let i = 0; ; i++) {
    const got = await attempt().catch(() => null);
    if (got !== null) return got;
    const wait = RETRY_WAIT_MS[Math.min(i, RETRY_WAIT_MS.length - 1)];
    if (i >= RETRY_WAIT_MS.length || Date.now() + wait >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Copies a TV live source's segments into storage, each of Livepeer's variants fetched once. */
export function createLiveCopier(options: LiveCopierOptions): SegmentCopier {
  const get = options.fetch ?? fetch;
  const counter = options.counter;

  async function pull(url: string, deadline: number): Promise<Buffer | null> {
    return retrying(deadline, async () => {
      const left = Math.max(500, Math.min(FETCH_TIMEOUT_MS, deadline - Date.now()));
      const response = await get(url, { signal: AbortSignal.timeout(left) });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length ? bytes : null;
    });
  }

  async function put(key: string, bytes: Buffer, contentType: string, deadline: number): Promise<string | null> {
    await fs.mkdir(options.scratchDir, { recursive: true });
    const file = path.join(options.scratchDir, `lc-${createHash("sha1").update(key).digest("hex").slice(0, 16)}${path.extname(key)}`);
    await fs.writeFile(file, bytes);
    try {
      const url = await retrying(deadline, () => options.store(key, file, contentType));
      if (url) counter?.add({ objectsWritten: 1, bytesWritten: bytes.length });
      return url;
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }

  return async ({ seq, session, sources, derived }) => {
    const cpuAt = process.cpuUsage();
    let ffmpegCpu = 0;
    const deadline = Date.now() + (options.deadlineMs ?? COPY_DEADLINE_MS);
    try {
      // Each of the source's variants once, whichever renditions read it.
      const readers = new Map<string, RenditionName[]>();
      for (const [name, url] of Object.entries(sources) as Array<[RenditionName | "subs", string]>) {
        if (name === "subs" || !url) continue;
        readers.set(url, [...(readers.get(url) ?? []), name]);
      }
      const pulled = new Map<string, Buffer>();
      await Promise.all(
        [...readers.keys()].map(async (url) => {
          const bytes = await pull(url, deadline);
          if (bytes) pulled.set(url, bytes);
        })
      );
      counter?.add({ bytesPulled: [...pulled.values()].reduce((a, b) => a + b.length, 0) });
      if (pulled.size !== readers.size) return null;

      const out: Partial<Record<RenditionName | "subs", string>> = {};
      const key = (rendition: string, ext = "ts") => liveSegmentKey(options.liveSourceId, session, rendition, seq).replace(/\.ts$/, `.${ext}`);
      const stored = await Promise.all(
        [...readers].map(async ([url, names]) => {
          const bytes = pulled.get(url)!;
          const pictures = names.filter((n) => !derived.includes(n));
          let pictureUrl: string | null = null;
          if (pictures.length) {
            pictureUrl = await put(key(pictures[0]), bytes, "video/mp2t", deadline);
            if (!pictureUrl) return false;
            for (const n of pictures) out[n] = pictureUrl;
          }
          for (const n of names.filter((n) => derived.includes(n))) {
            const sound = await audioOnlySegment(bytes, (s) => (ffmpegCpu += s));
            const url = await put(key(n), sound ?? bytes, "video/mp2t", deadline);
            if (!url) return false;
            out[n] = url;
          }
          return true;
        })
      );
      if (stored.includes(false)) return null;
      // Captions, when the source has them: never required.
      if (sources.subs) {
        const vtt = await pull(sources.subs, Math.min(deadline, Date.now() + 1_500));
        const url = vtt ? await put(key("subs", "vtt"), vtt, "text/vtt", deadline) : null;
        if (url) out.subs = url;
      }
      return out;
    } finally {
      const used = process.cpuUsage(cpuAt);
      counter?.add({ cpuSeconds: (used.user + used.system) / 1e6 + ffmpegCpu });
    }
  };
}
