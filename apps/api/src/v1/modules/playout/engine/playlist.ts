// A channel's playlists, rendered from its assembled timeline (`channel_items`). Writing them takes
// almost no CPU: a master playlist per band, and per rendition a rolling media playlist of the
// segments published so far (a segment is published once its program date-time plus its length
// has passed), in log order:
//
//   - `#EXT-X-DISCONTINUITY` between items, `#EXT-X-PROGRAM-DATE-TIME` on each item's first segment
//     (and on the window's first);
//   - each item's `#EXT-X-DATERANGE` tags (packages/contracts/src/hls.ts) before its first segment;
//   - after a planned sign-off's slate, `#EXT-X-ENDLIST`; the next run (a new playlist) starts from
//     the station ID at the back time.
//
// On the TV band the master also names a subtitle rendition (X2): `subs.m3u8`, WebVTT on the same
// timeline (the same media and discontinuity sequences, discontinuities and program date-times),
// an item's prepared caption segments where it has captions, and an empty WebVTT segment for
// every segment of anything that hasn't (live blocks carry Livepeer's, if it gives any).
//
// Programming Phase 6: other apps (a playlist asked for with `?via=iptv`) get a variant in which a
// program not cleared for them is the station's "Airing on Opencast" slate, a prepared slate
// segment in place of each of the program's (the same media sequence numbers and lengths, near
// enough, so the variant stays one continuous live playlist), without the program's own tags. The
// slate's segments are played straight on from each other (`/hls/elsewhere/…`, tsretime.ts
// `shiftSegment`), so only the item boundaries carry a discontinuity, as in the plain playlist.
//
// The same function serves the API and the worker, so any replica answers the same playlist.

import { bandwidthOf, BAND_RENDITIONS, FPS, REFERENCE, type Band, type Ladder, type RenditionName } from "./ladder.js";

export interface ChannelRow {
  id: string;
  run: number;
  seq: number;
  disc: number;
  discontinuity: boolean;
  startsAt: Date;
  endsAt: Date;
  kind: "prepared" | "live" | "end";
  preparedKey: string | null;
  firstSegment: number;
  segments: number;
  segmentMs: number[];
  liveUris: Record<string, string[]> | null;
  tags: string[];
}

/** How long a playlist reaches back (X1: pause holds your place for up to 30 minutes). */
export const WINDOW_MS = 30 * 60_000;

/** How many of a row's segments are published at `now`. */
export function publishedCount(row: Pick<ChannelRow, "startsAt" | "segmentMs" | "kind">, now: number): number {
  if (row.kind === "end") return 0;
  let t = row.startsAt.getTime();
  let n = 0;
  for (const ms of row.segmentMs) {
    t += ms;
    if (t > now) break;
    n++;
  }
  return n;
}

/** The channel's subtitle playlist, and the group every variant names. */
export const SUBTITLES = { group: "subs", file: "subs.m3u8", empty: "empty.vtt" } as const;

/**
 * The master playlist. With `subtitles` (the TV band), a SUBTITLES rendition in that language: not
 * DEFAULT, so captions stay off until the viewer (or the TV's setting) turns them on; AUTOSELECT,
 * so a device set to show captions picks it; marked as transcribing dialogue and describing sound.
 */
export function renderMaster(band: Band, ladder: Ladder, subtitles?: { language: string; name: string } | null): string {
  const names = BAND_RENDITIONS[band];
  // The reference rendition first: players start there.
  const ordered = [REFERENCE[band], ...names.filter((n) => n !== REFERENCE[band])];
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];
  if (subtitles) {
    const name = subtitles.name.replace(/"/g, "'");
    lines.push(
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="${SUBTITLES.group}",NAME="${name}",LANGUAGE="${subtitles.language}",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound",URI="${SUBTITLES.file}"`
    );
  }
  for (const name of ordered) {
    const r = ladder[name];
    const video = r.kind === "video" ? `,RESOLUTION=${r.width}x${r.height},FRAME-RATE=${FPS.toFixed(3)}` : "";
    const subs = subtitles ? `,SUBTITLES="${SUBTITLES.group}"` : "";
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidthOf(r)},AVERAGE-BANDWIDTH=${Math.round((r.videoKbps + r.audioKbps) * 1000)},CODECS="${r.codecs}"${video}${subs}`, `${name}.m3u8`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Programming Phase 5: a master playlist whose renditions (and subtitle rendition) carry `query`.
 * Players resolve a master's relative lines against its URL without its query string, so a master
 * asked for with `?via=iptv` names its renditions with it too, and their polls count as well.
 */
export function masterWithQuery(body: string, query: string): string {
  return body
    .split("\n")
    .map((line) => (/^[a-z0-9]+\.m3u8$/.test(line) ? `${line}?${query}` : line.startsWith("#EXT-X-MEDIA:") ? line.replace(/URI="([a-z0-9]+\.m3u8)"/, `URI="$1?${query}"`) : line))
    .join("\n");
}

export interface MediaInput {
  rows: ChannelRow[];
  rendition: RenditionName;
  now: number;
  windowMs?: number;
  /** The rendition's own segment lengths for a prepared item (EXTINF), if known. */
  lengths(key: string): number[] | null;
  /** A prepared segment's URL. */
  uri(key: string, index: number): string;
  /** Programming Phase 6 (other apps): rows shown as the "Airing on Opencast" slate instead. */
  swapped?: ReadonlySet<string>;
  /**
   * A swapped row's slate segment in place of its own `index`th (from the row's first): its URL and
   * length. Null when no slate is ready: the playlist stops before it, and carries on once one is.
   */
  slate?(row: ChannelRow, index: number): { uri: string; ms: number } | null;
}

/** The rolling media playlist for one rendition, or null when nothing is published yet. */
export function renderMedia(input: MediaInput): string | null {
  const { now } = input;
  const started = input.rows.filter((r) => r.startsAt.getTime() <= now);
  if (!started.length) return null;
  const run = started[started.length - 1].run;
  const rows = started.filter((r) => r.run === run).sort((a, b) => a.seq - b.seq);
  const ended = rows.some((r) => r.kind === "end");
  // After the end, the playlist stays as it was when it ended.
  const edge = ended ? Math.min(now, rows.find((r) => r.kind === "end")!.startsAt.getTime()) : now;
  const windowStart = edge - (input.windowMs ?? WINDOW_MS);

  interface Out {
    row: ChannelRow;
    index: number;
    at: number;
    ms: number;
    uri: string;
  }
  const out: Out[] = [];
  let held = false;
  for (const row of rows) {
    if (row.kind === "end" || held) break;
    const n = publishedCount(row, edge);
    const swapped = input.swapped?.has(row.id) ?? false;
    const own = row.kind === "prepared" && row.preparedKey && !swapped ? input.lengths(row.preparedKey) : null;
    let at = row.startsAt.getTime();
    for (let i = 0; i < n; i++) {
      const refMs = row.segmentMs[i];
      const segEnd = at + refMs;
      if (segEnd > windowStart) {
        let uri: string | undefined;
        let ms = refMs;
        if (swapped) {
          // Programming Phase 6: the slate in its place; nothing ready, and the playlist holds here.
          const slate = input.slate?.(row, i) ?? null;
          if (!slate) {
            held = true;
            break;
          }
          ({ uri, ms } = slate);
        } else if (row.kind === "live") uri = row.liveUris?.[input.rendition]?.[i];
        else if (row.preparedKey) {
          const index = row.firstSegment + i;
          if (own && own[index] === undefined) uri = undefined;
          else {
            ms = own?.[index] ?? refMs;
            uri = input.uri(row.preparedKey, index);
          }
        }
        if (uri) out.push({ row, index: i, at, ms, uri });
      }
      at = segEnd;
    }
  }
  if (!out.length) return null;
  const first = out[0];
  const target = Math.max(4, ...out.map((o) => Math.round(o.ms / 1000)));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", `#EXT-X-TARGETDURATION:${target}`, `#EXT-X-MEDIA-SEQUENCE:${first.row.seq + first.index}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${first.row.disc}`];
  let previous: ChannelRow | null = null;
  for (const o of out) {
    const startsRow = o.row !== previous;
    if (startsRow) {
      // Between items; never before the window's first segment (the sequence above counts it).
      if (previous && o.row.discontinuity && o.index === 0) lines.push("#EXT-X-DISCONTINUITY");
      // A swapped program's tags (its title, bug, lower thirds) aren't what's showing.
      if (!input.swapped?.has(o.row.id)) lines.push(...o.row.tags);
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(o.at).toISOString()}`);
      previous = o.row;
    }
    lines.push(`#EXTINF:${(o.ms / 1000).toFixed(3)},`, o.uri);
  }
  if (ended && !held) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

export interface SubtitlesInput {
  rows: ChannelRow[];
  now: number;
  windowMs?: number;
  /** A row's caption segment URL (its own segment `index`, from its first), or null for none. */
  uri(row: ChannelRow, index: number): string | null;
  /** The empty WebVTT segment's URL, for everything without captions. */
  empty: string;
  /** Programming Phase 6 (other apps): rows shown as the "Airing on Opencast" slate, so without their captions. */
  swapped?: ReadonlySet<string>;
}

/**
 * The rolling subtitle playlist: every segment the reference rendition publishes, with the same
 * EXTINFs, media and discontinuity sequences, discontinuities and program date-times, so a player
 * lines the two up; each an item's caption segment, a live block's (Livepeer's, when it has
 * them), or the empty one. No DATERANGE tags: they're on the media playlists.
 */
export function renderSubtitles(input: SubtitlesInput): string | null {
  const { now } = input;
  const started = input.rows.filter((r) => r.startsAt.getTime() <= now);
  if (!started.length) return null;
  const run = started[started.length - 1].run;
  const rows = started.filter((r) => r.run === run).sort((a, b) => a.seq - b.seq);
  const ended = rows.some((r) => r.kind === "end");
  const edge = ended ? Math.min(now, rows.find((r) => r.kind === "end")!.startsAt.getTime()) : now;
  const windowStart = edge - (input.windowMs ?? WINDOW_MS);
  const out: Array<{ row: ChannelRow; index: number; at: number; ms: number; uri: string }> = [];
  for (const row of rows) {
    if (row.kind === "end") break;
    const n = publishedCount(row, edge);
    let at = row.startsAt.getTime();
    for (let i = 0; i < n; i++) {
      const ms = row.segmentMs[i];
      if (at + ms > windowStart) {
        const own = input.swapped?.has(row.id) ? null : row.kind === "live" ? row.liveUris?.subs?.[i] || null : input.uri(row, row.firstSegment + i);
        out.push({ row, index: i, at, ms, uri: own ?? input.empty });
      }
      at += ms;
    }
  }
  if (!out.length) return null;
  const first = out[0];
  const target = Math.max(4, ...out.map((o) => Math.round(o.ms / 1000)));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", `#EXT-X-TARGETDURATION:${target}`, `#EXT-X-MEDIA-SEQUENCE:${first.row.seq + first.index}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${first.row.disc}`];
  let previous: ChannelRow | null = null;
  for (const o of out) {
    if (o.row !== previous) {
      if (previous && o.row.discontinuity && o.index === 0) lines.push("#EXT-X-DISCONTINUITY");
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(o.at).toISOString()}`);
      previous = o.row;
    }
    lines.push(`#EXTINF:${(o.ms / 1000).toFixed(3)},`, o.uri);
  }
  if (ended) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}
