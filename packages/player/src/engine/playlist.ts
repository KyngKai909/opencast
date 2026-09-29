// Reading HLS playlists without a player: for pre-warming the neighbouring channels (their
// playlists and first segment, no <video>), for checking whether a signed-off station is back,
// and for the browser's own HLS, which doesn't hand its playlists to the page.
//
// Only what those need: variants, segments, the target duration, program date-times and ENDLIST.
// The DATERANGE tags are read with the contract's parser (parseDateRanges), never here.
//
// A station's playback URL is a master playlist with a rendition ladder (prepare once, then
// assemble): TV 1080p, 720p, 480p and 360p plus an audio-only rendition, the reference (720p)
// listed first; radio AAC 128k and 64k. A picture is never started on the audio-only rendition.

import type { Quality } from "./driver";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Variant {
  url: string;
  bandwidth: number;
  height: number;
  /** Sound only: CODECS names no video codec and there's no RESOLUTION (a TV ladder's audio-only rendition, or radio's). */
  audioOnly: boolean;
}

/** Video codecs a CODECS attribute may name. */
const VIDEO_CODEC = /^(avc[1-4]|hvc1|hev1|dvh1|dvhe|av01|vp0?9|vp08|mp4v)\b/i;

export interface MediaPlaylist {
  url: string;
  targetDuration: number;
  segments: Array<{ url: string; duration: number }>;
  /** `#EXT-X-ENDLIST`: the station has signed off (or the stream ended). */
  ended: boolean;
  /** The program date-time at the end of the last segment (ms since the epoch), when the playlist has one. */
  edge: number | null;
}

const resolve = (uri: string, base: string) => new URL(uri, new URL(base, typeof location !== "undefined" ? location.href : "http://localhost/")).href;

export function isMaster(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF");
}

/** The master playlist's variants, in the order listed. */
export function variants(master: string, base: string): Variant[] {
  const out: Array<Variant & { codecs: string | null }> = [];
  const lines = master.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
    if (!uri) continue;
    const bandwidth = Number(/[:,]BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const height = Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] ?? 0);
    const codecs = /CODECS="([^"]*)"/.exec(line)?.[1] ?? null;
    out.push({ url: resolve(uri.trim(), base), bandwidth, height, codecs, audioOnly: false });
  }
  // Sound only: no RESOLUTION, and CODECS names no video codec. Without CODECS, a variant with no
  // RESOLUTION next to ones that have it is the sound-only one (as hls.js reads a ladder).
  const pictures = out.some((v) => v.height > 0);
  return out.map(({ codecs, ...v }) => ({
    ...v,
    audioOnly: !v.height && (codecs !== null ? !codecs.split(",").some((c) => VIDEO_CODEC.test(c.trim())) : pictures)
  }));
}

/** The variants a picture can play: every one but the audio-only rendition, unless that's all there is (radio). */
export function pictureVariants(list: Variant[]): Variant[] {
  const pictures = list.filter((v) => !v.audioOnly);
  return pictures.length ? pictures : list;
}

/**
 * The variant the player will start on, so a pre-warmed first segment is the one it asks for:
 * the top for "best", otherwise the lowest (a quick first picture; ABR climbs from there). Never
 * the audio-only rendition while there are pictures (hls.js leaves it out of a TV ladder too).
 */
export function startVariant(list: Variant[], quality: Quality): Variant | null {
  if (!list.length) return null;
  const by = [...pictureVariants(list)].sort((a, b) => a.height - b.height || a.bandwidth - b.bandwidth);
  return quality === "best" ? by[by.length - 1]! : by[0]!;
}

export function mediaPlaylist(text: string, url: string): MediaPlaylist {
  const segments: MediaPlaylist["segments"] = [];
  let targetDuration = 0;
  let duration = 0;
  let pdt: number | null = null;
  let edge: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-TARGETDURATION:")) targetDuration = Number(line.slice(22));
    else if (line.startsWith("#EXTINF:")) duration = parseFloat(line.slice(8));
    else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) pdt = Date.parse(line.slice(25));
    else if (!line.startsWith("#")) {
      segments.push({ url: resolve(line, url), duration });
      if (pdt !== null && !Number.isNaN(pdt)) {
        edge = pdt + duration * 1000;
        pdt = edge;
      } else if (edge !== null) edge += duration * 1000;
      duration = 0;
    }
  }
  return { url, targetDuration: targetDuration || 6, segments, ended: /^#EXT-X-ENDLIST/m.test(text), edge };
}

/** The segment a player joining live starts on: `count` target durations from the end (hls.js's liveSyncDurationCount). */
export function syncSegment(p: MediaPlaylist, count = 3): { url: string; index: number } | null {
  if (!p.segments.length) return null;
  const index = p.ended ? 0 : Math.max(0, p.segments.length - count);
  return { url: p.segments[index]!.url, index };
}

async function text(fetchFn: Fetch, url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/**
 * A station's media playlist, through its master playlist if it has one. `known` is a variant
 * already chosen from the master (a refresh), fetched directly.
 */
export async function loadMedia(fetchFn: Fetch, url: string, quality: Quality = "auto", signal?: AbortSignal, known?: Variant | null): Promise<{ media: MediaPlaylist; variant: Variant | null }> {
  if (known) return { media: mediaPlaylist(await text(fetchFn, known.url, signal), known.url), variant: known };
  const first = await text(fetchFn, url, signal);
  if (!isMaster(first)) return { media: mediaPlaylist(first, url), variant: null };
  const variant = startVariant(variants(first, url), quality);
  if (!variant) throw new Error(`No variants in ${url}`);
  return { media: mediaPlaylist(await text(fetchFn, variant.url, signal), variant.url), variant };
}

/** Whether a station's stream is live again: its playlist is there and doesn't end. */
export async function isLive(fetchFn: Fetch, url: string): Promise<boolean> {
  try {
    const { media } = await loadMedia(fetchFn, url);
    return !media.ended && media.segments.length > 0;
  } catch {
    return false;
  }
}

export type PrefetchState = "loading" | "ready" | "error";

export interface PrefetchOptions {
  url: string;
  quality: Quality;
  fetch: Fetch;
  /** Also fetch the segment a switch will start on (the default); false for playlists only. */
  segment?: boolean;
  onChange: () => void;
  now?: () => number;
}

/**
 * A neighbouring channel kept warm the cheap way: its playlists and the segment a switch would
 * start on, fetched into the HTTP cache (segments are immutable), then again every two target
 * durations while it stays a neighbour. No <video>, no decoding, one rendition (the one the
 * player starts on). A switch then starts on the fetched segment (`startHint`).
 */
export class Prefetch {
  state: PrefetchState = "loading";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort = new AbortController();
  private stopped = false;
  private now: () => number;
  /** What was fetched: the variant, the target duration, and when. */
  private last: { variant: Variant | null; targetDuration: number; at: number; ended: boolean } | null = null;

  private gen = 0;

  constructor(private o: PrefetchOptions) {
    this.now = o.now ?? (() => Date.now());
    void this.run(this.gen);
  }

  private async run(gen: number) {
    const current = () => !this.stopped && gen === this.gen;
    if (!current()) return;
    let next = 10_000;
    try {
      // The master once; after that, only the media playlist.
      const { media, variant } = await loadMedia(this.o.fetch, this.o.url, this.o.quality, this.abort.signal, this.last?.variant);
      const at = this.now();
      if (!current()) return;
      const seg = this.o.segment === false ? null : syncSegment(media);
      if (seg) {
        const res = await this.o.fetch(seg.url, { signal: this.abort.signal });
        // Read it through, so it lands in the cache whole.
        await res.arrayBuffer();
      }
      if (!current()) return;
      this.last = { variant, targetDuration: media.targetDuration, at, ended: media.ended };
      this.set("ready");
      next = media.ended ? 0 : Math.max(2, media.targetDuration * 2) * 1000;
    } catch {
      if (!current()) return;
      this.set("error");
    }
    if (next > 0 && current()) this.timer = setTimeout(() => void this.run(gen), next);
  }

  private set(s: PrefetchState) {
    if (s === this.state) return;
    this.state = s;
    this.o.onChange();
  }

  /** Another rendition: start over from the master playlist. */
  setQuality(q: Quality) {
    if (q === this.o.quality) return;
    this.o.quality = q;
    this.last = null;
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    this.abort = new AbortController();
    void this.run(++this.gen);
  }

  /**
   * How a switch lands on the fetched segment: the rendition to start at, and how many target
   * durations from the end to join (3, plus one for each segment the playlist has moved on since).
   * Null when nothing was fetched yet, or it's too old to be in the playlist's start window.
   */
  startHint(): { bandwidth: number | null; syncCount: number } | null {
    if (!this.last || this.last.ended) return null;
    const moved = Math.floor((this.now() - this.last.at) / (this.last.targetDuration * 1000));
    if (moved > 2) return null;
    return { bandwidth: this.last.variant?.bandwidth ?? null, syncCount: 3 + moved };
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
  }
}
