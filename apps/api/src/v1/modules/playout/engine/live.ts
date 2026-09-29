// A live source, as the channel's playlist reads it. Two kinds:
//
//   - TV: Livepeer transcodes the block's source to the same ladder, and its HLS output is polled
//     here (`LiveHlsSource`). Each new segment (in every rendition we map to) is handed to the
//     assembler, which points the channel's playlists at it. The picture's bytes don't pass
//     through the worker. Livepeer makes no audio-only rendition, so the channel's audio-only one
//     is made here: the sound of Livepeer's smallest rendition, stream-copied into a segment of
//     its own (no re-encode, its timestamps kept) and stored with the platform's objects.
//   - Radio: the worker takes the station's own RTMP push and packages its sound itself
//     (radiolive.ts). Radio never goes through Livepeer.
//
// Either way, a source with no new segment for a few seconds counts as not connected, and the
// assembler airs the stand-by slate until it's back.
//
// Livepeer's live renditions are mapped to the ladder by height (nearest), and the audio-only
// renditions to an audio-only variant if the source has one, else its smallest (whose sound is
// taken, as above). If the source's master names a subtitle rendition, its WebVTT segments are
// passed through too (by media sequence, as `uris.subs`); Livepeer gives none today, so a live
// block's captions are empty.

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
 */
export function audioOnlySegment(segment: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-copyts", "-f", "mpegts", "-i", "pipe:0", "-map", "0:a:0", "-c", "copy", "-muxdelay", "0", "-muxpreload", "0", "-f", "mpegts", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", () => undefined);
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    child.stdin.end(segment);
  });
}

/** Makes the channel's audio-only segment from a picture rendition's (TV live blocks): its URL, or null. */
export type AudioOnlyMaker = (input: { uri: string; seq: number; session: string; rendition: RenditionName }) => Promise<string | null>;

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

export class LiveHlsSource implements LiveSource {
  private map: Map<RenditionName, string> | null = null;
  /** Audio-only renditions read from a picture variant: their sound is taken (`audioOnly`). */
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
  private segments = new Map<number, LiveSegment>();
  private newest = -1;
  private lastNewAt = 0;
  private lastPoll = 0;
  private polling?: Promise<void>;

  constructor(
    readonly url: string,
    private renditions: RenditionName[],
    private ladder: Ladder,
    private now: () => number,
    /** Makes audio-only segments where the source has no audio-only variant (TV: Livepeer has none). */
    private audioOnly?: AudioOnlyMaker
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

  /** Reads the source's playlists (at most about once a second). */
  poll(): Promise<void> {
    if (this.polling) return this.polling;
    if (this.lastPoll && this.now() - this.lastPoll < 900) return Promise.resolve();
    this.lastPoll = this.now();
    this.polling = this.read().finally(() => (this.polling = undefined));
    return this.polling;
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
      if (seg.seq <= this.newest) continue;
      const uris: LiveSegment["uris"] = {};
      for (const [name, url] of map) {
        const found = lists.get(url)!.find((s) => s.seq === seg.seq);
        if (found) uris[name] = found.uri;
      }
      // Only segments every rendition has (renditions line up by media sequence).
      if (Object.keys(uris).length !== map.size) continue;
      // The audio-only renditions' own segments, from the picture's sound (else the picture's, as before).
      if (this.audioOnly) {
        for (const name of this.derived) {
          const made = await this.audioOnly({ uri: uris[name]!, seq: seg.seq, session: this.session, rendition: name }).catch(() => null);
          if (made) uris[name] = made;
        }
      }
      const caption = subs.find((s) => s.seq === seg.seq);
      if (caption) uris.subs = caption.uri;
      this.segments.set(seg.seq, { seq: seg.seq, durationMs: seg.durationMs, uris, session: this.session });
      this.segmentMs = seg.durationMs;
      this.newest = seg.seq;
      grew = true;
    }
    if (grew) this.lastNewAt = this.now();
    else this.forgetIfLost();
    for (const seq of this.segments.keys()) if (seq < this.newest - 30) this.segments.delete(seq);
  }

  /**
   * A source that stopped sending comes back as a new session, at new addresses (Livepeer's
   * renditions carry a session token): while it's lost, the master is read again.
   */
  private forgetIfLost() {
    if (!this.map || this.connected() || this.now() - this.mapAt < MASTER_AGAIN_MS) return;
    this.map = null;
    // Its media sequence starts again too.
    this.newest = -1;
    this.segments.clear();
  }

  /** A new segment within the last few seconds. */
  connected(): boolean {
    return this.lastNewAt > 0 && this.now() - this.lastNewAt < Math.max(SIGNAL_GAP_MS, SIGNAL_GAP_SEGMENTS * this.segmentMs);
  }

  /** Segments after `seq`, in order; with no `seq`, the newest one (the live edge). */
  after(seq: number | null): LiveSegment[] {
    if (seq === null) return this.newest >= 0 && this.segments.has(this.newest) ? [this.segments.get(this.newest)!] : [];
    return [...this.segments.values()].filter((s) => s.seq > seq).sort((a, b) => a.seq - b.seq);
  }
}
