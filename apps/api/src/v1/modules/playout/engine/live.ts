// A live source, as the channel's playlist reads it: Livepeer transcodes the block's source to the
// same ladder, and its HLS output is polled here. Each new segment (in every rendition we map to)
// is handed to the assembler, which points the channel's playlists at it. No bytes pass through
// the worker. A source with no new segment for a few seconds counts as not connected, and the
// assembler airs the stand-by slate until it's back.
//
// Livepeer's live renditions are mapped to the ladder by height (nearest), and the audio-only
// renditions to an audio-only variant if the source has one, else its smallest.

import type { Ladder, RenditionName } from "./ladder.js";

/** No new segment for this long and the source counts as lost. */
export const SIGNAL_GAP_MS = 8_000;

export interface LiveSegment {
  seq: number;
  durationMs: number;
  uris: Partial<Record<RenditionName, string>>;
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

export class LiveHlsSource {
  private map: Map<RenditionName, string> | null = null;
  private segments = new Map<number, LiveSegment>();
  private newest = -1;
  private lastNewAt = 0;
  private lastPoll = 0;
  private polling?: Promise<void>;

  constructor(
    readonly url: string,
    private renditions: RenditionName[],
    private ladder: Ladder,
    private now: () => number
  ) {}

  private async text(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { "cache-control": "no-cache" } });
      return response.ok ? await response.text() : null;
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
    if (!this.map) {
      const master = await this.text(this.url);
      if (master === null) return;
      const variants = parseMaster(master, this.url);
      const map = variants ? mapVariants(variants, this.renditions, this.ladder) : new Map(this.renditions.map((r) => [r, this.url] as const));
      if (!map.size) return;
      this.map = map;
    }
    const urls = [...new Set(this.map.values())];
    const lists = new Map<string, Array<{ seq: number; durationMs: number; uri: string }>>();
    for (const url of urls) {
      const text = await this.text(url);
      if (text !== null) lists.set(url, parseMedia(text, url));
    }
    if (lists.size !== urls.length) return;
    const reference = lists.get([...this.map.values()][0])!;
    let grew = false;
    for (const seg of reference) {
      if (seg.seq <= this.newest) continue;
      const uris: LiveSegment["uris"] = {};
      for (const [name, url] of this.map) {
        const found = lists.get(url)!.find((s) => s.seq === seg.seq);
        if (found) uris[name] = found.uri;
      }
      // Only segments every rendition has (renditions line up by media sequence).
      if (Object.keys(uris).length !== this.map.size) continue;
      this.segments.set(seg.seq, { seq: seg.seq, durationMs: seg.durationMs, uris });
      this.newest = seg.seq;
      grew = true;
    }
    if (grew) this.lastNewAt = this.now();
    for (const seq of this.segments.keys()) if (seq < this.newest - 30) this.segments.delete(seq);
  }

  /** A new segment within the last few seconds. */
  connected(): boolean {
    return this.lastNewAt > 0 && this.now() - this.lastNewAt < SIGNAL_GAP_MS;
  }

  /** Segments after `seq`, in order; with no `seq`, the newest one (the live edge). */
  after(seq: number | null): LiveSegment[] {
    if (seq === null) return this.newest >= 0 && this.segments.has(this.newest) ? [this.segments.get(this.newest)!] : [];
    return [...this.segments.values()].filter((s) => s.seq > seq).sort((a, b) => a.seq - b.seq);
  }
}
