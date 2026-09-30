// A live source, as the channel's playlist reads it. Two kinds:
//
//   - TV: Livepeer transcodes the block's source to the same ladder, and its HLS output is polled
//     here (`LiveHlsSource`). Each new segment of every rendition we map to is pulled from Livepeer
//     **once**, by the leading worker, and stored with the platform's objects
//     (`prepared/live-<source>-<session>/<rendition>/seg_NNNNN.ts`, livecopy.ts); the channel's
//     playlists point at those copies, so viewers and relays never fetch from Livepeer (its
//     delivery is billed per viewer; our storage has no egress charge) and a live block stays in
//     storage with its channel rows (two days), so pause and the 30-minute window replay it.
//     Livepeer makes no audio-only rendition, so the channel's audio-only one is made from the
//     bytes of Livepeer's smallest rendition already pulled: its sound, stream-copied into a
//     segment of its own (no re-encode, its timestamps kept).
//     Copying starts only once the channel wants the source (`after()`, called while its block
//     airs), not while it's read ahead of the block. A segment whose copy fails is tried again
//     briefly, then skipped: the segments after it are a new `part`, and the channel puts a
//     discontinuity there. A copy that falls behind drops to the newest segment (a new part too)
//     rather than piling up delay.
//   - Radio: the worker takes the station's own RTMP push and packages its sound itself
//     (radiolive.ts). Radio never goes through Livepeer.
//
// Either way, a source with no new segment for a few seconds counts as not connected (for a
// copied source, also one whose copies stopped landing), and the assembler airs the stand-by slate
// until it's back.
//
// Livepeer's live renditions are mapped to the ladder by height (nearest), and the audio-only
// renditions to an audio-only variant if the source has one, else its smallest (whose sound is
// taken, as above). If the source's master names a subtitle rendition, its WebVTT segments are
// passed through too (by media sequence, as `uris.subs`, copied like the rest); Livepeer gives
// none today, so a live block's captions are empty.

import { spawn } from "node:child_process";
import type { Ladder, RenditionName } from "./ladder.js";

/**
 * No new segment for this long and the source counts as lost: at least 8 s, and three of the
 * source's segments (Livepeer's 4-second segments arrive a few seconds apart, sometimes 8 or more).
 */
export const SIGNAL_GAP_MS = 8_000;
const SIGNAL_GAP_SEGMENTS = 3;
/** How often an incomplete master playlist (renditions still to come) is read again. */
export const MASTER_AGAIN_MS = 5_000;

export interface LiveSegment {
  seq: number;
  durationMs: number;
  /** Each rendition's segment, and `subs`, the source's caption segment when it has one. */
  uris: Partial<Record<RenditionName | "subs", string>>;
  /**
   * Which connection of the source it came from. Segments of one session run on (their
   * timestamps continue); a new session starts again, so the channel puts a discontinuity there.
   */
  session?: string;
  /**
   * Added 2026-09-30: a stretch of the session with nothing skipped. A segment that couldn't be
   * copied (or was dropped catching up) starts a new part; the channel puts a discontinuity there.
   */
  part?: number;
}

/** What the assembler reads a live block from. */
export interface LiveSource {
  /** Reads what's new (called about once a second while the block is on or near). */
  poll(): Promise<void>;
  /** A new segment within the last few seconds. */
  connected(): boolean;
  /** Segments after `seq`, in order; with no `seq`, the newest one (the live edge). */
  after(seq: number | null): LiveSegment[];
  /** The block no longer needs it. */
  close?(): Promise<void>;
}

/**
 * The sound of a TS segment, stream-copied into a segment of its own (no re-encode; its
 * timestamps kept, so it lines up with the pictures it came with). Null when FFmpeg can't.
 * `onCpu` gets the CPU seconds FFmpeg used (the shell's `times`, startup included).
 */
export function audioOnlySegment(segment: Buffer, onCpu?: (seconds: number) => void): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const ffmpeg = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-copyts", "-f", "mpegts", "-i", "pipe:0", "-map", "0:a:0", "-c", "copy", "-muxdelay", "0", "-muxpreload", "0", "-f", "mpegts", "pipe:1"];
    const child = spawn("sh", ["-c", `${ffmpeg.join(" ")}; code=$?; times >&2; exit $code`], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err = (err + String(d)).slice(-400)));
    child.stdin.on("error", () => undefined);
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const cpu = childCpuSeconds(err);
      if (cpu !== null) onCpu?.(cpu);
      resolve(code === 0 && out.length ? Buffer.concat(out) : null);
    });
    child.stdin.end(segment);
  });
}

/** The children's user and system time from a shell's `times` (its last line: "0m0.012s 0m0.004s"). */
export function childCpuSeconds(text: string): number | null {
  const last = text.trim().split(/\r?\n/).pop() ?? "";
  const m = /(\d+)m([\d.]+)s\s+(\d+)m([\d.]+)s\s*$/.exec(last);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) * 60 + Number(m[4]) : null;
}

/**
 * Copies one segment into storage (livecopy.ts): every channel rendition's, each of the source's
 * variants fetched once. `derived` names the audio-only renditions to take the sound of their
 * variant. Our URLs per rendition (and `subs`, when given and copied), or null when a rendition
 * couldn't be copied (after a brief retry).
 */
export type SegmentCopier = (input: { seq: number; session: string; sources: Partial<Record<RenditionName | "subs", string>>; derived: RenditionName[] }) => Promise<Partial<Record<RenditionName | "subs", string>> | null>;

/** What copying a live source did, as it happens (the worker's health adds it up). */
export type LiveCopyEvent = { kind: "copied"; durationMs: number; delayMs: number } | { kind: "skipped"; seq: number } | { kind: "caught_up"; dropped: number };

export interface LiveCopyOptions {
  copy: SegmentCopier;
  onEvent?(event: LiveCopyEvent): void;
  /** How long a poll waits for a copy under way (so the assembler sees it on this tick). */
  waitMs?: number;
}

/** The copy waits no longer than this at a poll; copying carries on behind it. */
export const COPY_WAIT_MS = 750;
/** More than this many segments waiting to be copied and the copy drops to the newest. */
export const COPY_MAX_BACKLOG = 2;
/** Copying stops when the channel hasn't asked for the source for this long. */
export const COPY_IDLE_MS = 15_000;

/** The source's subtitle rendition (its first), if its master names one. */
export function parseSubtitles(text: string, base: string): string | null {
  const line = text.split(/\r?\n/).find((l) => l.startsWith("#EXT-X-MEDIA:") && /TYPE=SUBTITLES/.test(l));
  const uri = line ? /URI="([^"]+)"/.exec(line)?.[1] : null;
  return uri ? new URL(uri, base).toString() : null;
}

interface Variant {
  url: string;
  height: number | null;
  bandwidth: number;
  audioOnly: boolean;
}

function attrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

export function parseMaster(text: string, base: string): Variant[] | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) return null;
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const a = attrs(lines[i].slice("#EXT-X-STREAM-INF:".length));
    const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
    if (!uri) continue;
    const height = a.RESOLUTION ? Number(a.RESOLUTION.split("x")[1]) : null;
    out.push({ url: new URL(uri.trim(), base).toString(), height, bandwidth: Number(a.BANDWIDTH ?? 0), audioOnly: !a.RESOLUTION && Boolean(a.CODECS) && !/avc|hvc|hev|vp0|av01/.test(a.CODECS) });
  }
  return out;
}

export function parseMedia(text: string, base: string): Array<{ seq: number; durationMs: number; uri: string }> {
  const lines = text.split(/\r?\n/);
  let seq = Number(lines.find((l) => l.startsWith("#EXT-X-MEDIA-SEQUENCE:"))?.split(":")[1] ?? 0);
  const out: Array<{ seq: number; durationMs: number; uri: string }> = [];
  let duration: number | null = null;
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) duration = Math.round(Number(line.slice(8).split(",")[0]) * 1000);
    else if (line.trim() && !line.startsWith("#")) {
      if (duration !== null) out.push({ seq, durationMs: duration, uri: new URL(line.trim(), base).toString() });
      seq++;
      duration = null;
    }
  }
  return out;
}

/** Which of the source's variants each of our renditions reads. */
export function mapVariants(variants: Variant[], renditions: RenditionName[], ladder: Ladder): Map<RenditionName, string> {
  const map = new Map<RenditionName, string>();
  if (!variants.length) return map;
  const video = variants.filter((v) => !v.audioOnly);
  const smallest = [...variants].sort((a, b) => a.bandwidth - b.bandwidth)[0];
  for (const name of renditions) {
    const r = ladder[name];
    if (r.kind === "audio") {
      map.set(name, (variants.find((v) => v.audioOnly) ?? smallest).url);
      continue;
    }
    const pool = video.length ? video : variants;
    const best = [...pool].sort((a, b) => Math.abs((a.height ?? r.height) - r.height) - Math.abs((b.height ?? r.height) - r.height) || b.bandwidth - a.bandwidth)[0];
    map.set(name, best.url);
  }
  return map;
}

interface Listed {
  seq: number;
  durationMs: number;
  /** The source's segment per rendition (and `subs`). */
  sources: LiveSegment["uris"];
  session: string;
  /** When it was first seen in the source's playlists (real time, for the copy's delay). */
  listedAt: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class LiveHlsSource implements LiveSource {
  private map: Map<RenditionName, string> | null = null;
  /** Audio-only renditions read from a picture variant: their sound is taken. */
  private derived = new Set<RenditionName>();
  /** Counts the source's sessions (a new one each time its master is read afresh). */
  private sessions = 0;
  private session = "";
  /** The source's subtitle playlist, when its master names one. */
  private subsUrl: string | null = null;
  /** Every video rendition has a variant of its own size (else the master is read again). */
  private complete = false;
  private mapAt = 0;
  /** The length of the source's latest segment. */
  private segmentMs = 0;
  /** Segments the channel can air (copied, when copying). */
  private segments = new Map<number, LiveSegment>();
  private newest = -1;
  /** The newest segment the source has listed, and when a new one last appeared there. */
  private listed = -1;
  private lastListed: Listed | null = null;
  private lastNewAt = 0;
  private lastPoll = 0;
  private polling?: Promise<void>;
  // Copying (TV): what's waiting, the pump, and whether the channel wants the source.
  private pending: Listed[] = [];
  private pumping?: Promise<void>;
  private part = 0;
  private armedAt = 0;
  private wantedAt = 0;
  private lastCopiedAt = 0;
  /** Until when (real time) a poll waits for the copy it started: one wait per poll, however many stations read the source. */
  private settleUntil = 0;
  private closed = false;

  constructor(
    readonly url: string,
    private renditions: RenditionName[],
    private ladder: Ladder,
    private now: () => number,
    /** Copies segments into storage (TV: the channel never points at Livepeer's). Without it, Livepeer's own URLs. */
    private copying?: LiveCopyOptions
  ) {}

  /** A playlist's text, and the address it came from after redirects (its URIs are relative to that). */
  private async text(url: string): Promise<{ text: string; url: string } | null> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { "cache-control": "no-cache" } });
      return response.ok ? { text: await response.text(), url: response.url || url } : null;
    } catch {
      return null;
    }
  }

  /** Reads the source's playlists (at most about once a second); waits briefly for a copy under way. */
  poll(): Promise<void> {
    if (this.polling) return this.polling;
    if (this.lastPoll && this.now() - this.lastPoll < 900) return this.settle();
    this.lastPoll = this.now();
    this.polling = this.read()
      .then(() => {
        this.idle();
        this.settleUntil = performance.now() + (this.copying?.waitMs ?? COPY_WAIT_MS);
        if (this.armedAt) void this.pump();
        return this.settle();
      })
      .finally(() => (this.polling = undefined));
    return this.polling;
  }

  /**
   * A copy under way, until `waitMs` after the last read of the source's playlists: copying
   * carries on behind it. Every station reading the source shares the one wait, so a tick waits
   * at most `waitMs` per source.
   */
  private settle(): Promise<void> {
    const pumping = this.pumping;
    const left = this.settleUntil - performance.now();
    return pumping && left > 0 ? Promise.race([pumping, sleep(left)]) : Promise.resolve();
  }

  private async read() {
    // Livepeer lists its transcoded renditions only once they're made, the source's first: until
    // every video rendition has one of its own size, the master is read again every few seconds.
    if (!this.map || (!this.complete && this.now() - this.mapAt >= MASTER_AGAIN_MS)) {
      const master = await this.text(this.url);
      // Before the source connects Livepeer answers a playlist with no media in it ("#EXT-X-ERROR:
      // Stream open failed"): not a map to keep, or the block would read it for good.
      const usable = master !== null && (/^#EXT-X-STREAM-INF/m.test(master.text) || /^#EXTINF/m.test(master.text));
      if (master === null || !usable) {
        if (!this.map) return;
      } else {
        const variants = parseMaster(master.text, master.url);
        const map = variants ? mapVariants(variants, this.renditions, this.ladder) : new Map(this.renditions.map((r) => [r, master.url] as const));
        this.subsUrl = variants ? parseSubtitles(master.text, master.url) : null;
        if (!map.size && !this.map) return;
        if (map.size) {
          if (!this.map) this.session = `${Date.now().toString(36)}${(++this.sessions).toString(36)}`;
          this.map = map;
          const audioVariants = new Set((variants ?? []).filter((v) => v.audioOnly).map((v) => v.url));
          this.derived = new Set([...map].filter(([name, url]) => this.ladder[name].kind === "audio" && Boolean(variants) && !audioVariants.has(url)).map(([name]) => name));
          this.mapAt = this.now();
          this.complete = !variants || this.renditions.every((name) => this.ladder[name].kind !== "video" || variants.some((v) => !v.audioOnly && v.height === this.ladder[name].height));
        }
      }
    }
    const map = this.map!;
    const urls = [...new Set(map.values())];
    const lists = new Map<string, Array<{ seq: number; durationMs: number; uri: string }>>();
    for (const url of urls) {
      const got = await this.text(url);
      if (got !== null) lists.set(url, parseMedia(got.text, got.url));
    }
    if (lists.size !== urls.length) return this.forgetIfLost();
    // Captions, if the source has them: never required for a segment to count.
    const subsText = this.subsUrl ? await this.text(this.subsUrl) : null;
    const subs = subsText ? parseMedia(subsText.text, subsText.url) : [];
    const reference = lists.get([...map.values()][0])!;
    let grew = false;
    for (const seg of reference) {
      if (seg.seq <= this.listed) continue;
      const uris: LiveSegment["uris"] = {};
      for (const [name, url] of map) {
        const found = lists.get(url)!.find((s) => s.seq === seg.seq);
        if (found) uris[name] = found.uri;
      }
      // Only segments every rendition has (renditions line up by media sequence).
      if (Object.keys(uris).length !== map.size) continue;
      const caption = subs.find((s) => s.seq === seg.seq);
      if (caption) uris.subs = caption.uri;
      const listed: Listed = { seq: seg.seq, durationMs: seg.durationMs, sources: uris, session: this.session, listedAt: performance.now() };
      this.listed = seg.seq;
      this.lastListed = listed;
      this.segmentMs = seg.durationMs;
      grew = true;
      if (!this.copying) {
        this.segments.set(seg.seq, { seq: seg.seq, durationMs: seg.durationMs, uris, session: this.session });
        this.newest = seg.seq;
      } else if (this.armedAt) this.pending.push(listed);
    }
    if (grew) this.lastNewAt = this.now();
    else this.forgetIfLost();
    for (const seq of this.segments.keys()) if (seq < this.newest - 30) this.segments.delete(seq);
  }

  /** Copying stops once the channel hasn't asked for the source for a while (the block ended, or it's standing by). */
  private idle() {
    if (!this.copying || !this.armedAt || this.now() - this.wantedAt < COPY_IDLE_MS) return;
    this.armedAt = 0;
    this.pending = [];
    this.segments.clear();
    this.newest = -1;
    // Whatever's copied next doesn't run on from what was.
    this.part++;
  }

  /** Copies what's waiting, oldest first; falls to the newest when behind; skips what can't be copied. */
  private pump(): Promise<void> {
    if (this.pumping || !this.copying) return this.pumping ?? Promise.resolve();
    const { copy, onEvent } = this.copying;
    this.pumping = (async () => {
      while (this.pending.length && this.armedAt && !this.closed) {
        if (this.pending.length > COPY_MAX_BACKLOG) {
          // Behind: the newest only, after a discontinuity (never more delay).
          const dropped = this.pending.length - 1;
          this.pending = this.pending.slice(-1);
          this.part++;
          onEvent?.({ kind: "caught_up", dropped });
        }
        const next = this.pending.shift()!;
        if (next.session !== this.session) continue;
        const uris = await copy({ seq: next.seq, session: next.session, sources: next.sources, derived: [...this.derived] }).catch(() => null);
        // The source reconnected meanwhile (a new session), or copying stopped.
        if (next.session !== this.session || !this.armedAt) continue;
        if (!uris || this.renditions.some((r) => !uris[r])) {
          this.part++;
          onEvent?.({ kind: "skipped", seq: next.seq });
          continue;
        }
        this.segments.set(next.seq, { seq: next.seq, durationMs: next.durationMs, uris, session: next.session, part: this.part });
        this.newest = Math.max(this.newest, next.seq);
        this.lastCopiedAt = this.now();
        onEvent?.({ kind: "copied", durationMs: next.durationMs, delayMs: performance.now() - next.listedAt });
      }
      for (const seq of this.segments.keys()) if (seq < this.newest - 30) this.segments.delete(seq);
    })().finally(() => (this.pumping = undefined));
    return this.pumping;
  }

  /**
   * A source that stopped sending comes back as a new session, at new addresses (Livepeer's
   * renditions carry a session token): while it's lost, the master is read again.
   */
  private forgetIfLost() {
    if (!this.map || this.signal() || this.now() - this.mapAt < MASTER_AGAIN_MS) return;
    this.map = null;
    // Its media sequence starts again too.
    this.newest = -1;
    this.listed = -1;
    this.lastListed = null;
    this.pending = [];
    this.segments.clear();
  }

  private get gap() {
    return Math.max(SIGNAL_GAP_MS, SIGNAL_GAP_SEGMENTS * this.segmentMs);
  }

  /** The source listed a new segment within the last few seconds. */
  private signal(): boolean {
    return this.lastNewAt > 0 && this.now() - this.lastNewAt < this.gap;
  }

  /**
   * A new segment within the last few seconds. Copying, the copies have to be landing too: copies
   * failing for as long (storage unreachable, say) air the stand-by slate, not a stalled channel.
   */
  connected(): boolean {
    if (!this.signal()) return false;
    if (!this.copying || !this.armedAt || this.now() - this.armedAt < this.gap) return true;
    return this.lastCopiedAt > 0 && this.now() - this.lastCopiedAt < this.gap;
  }

  /**
   * Segments after `seq`, in order; with no `seq`, the newest one (the live edge). Copying, asking
   * is what starts it (from the newest segment the source has listed).
   */
  after(seq: number | null): LiveSegment[] {
    if (this.copying) {
      this.wantedAt = this.now();
      if (!this.armedAt) {
        this.armedAt = this.now();
        this.pending = this.lastListed && this.lastListed.session === this.session ? [this.lastListed] : [];
        void this.pump();
      }
    }
    if (seq === null) return this.newest >= 0 && this.segments.has(this.newest) ? [this.segments.get(this.newest)!] : [];
    return [...this.segments.values()].filter((s) => s.seq > seq).sort((a, b) => a.seq - b.seq);
  }

  async close() {
    this.closed = true;
    this.pending = [];
    await this.pumping;
  }
}
