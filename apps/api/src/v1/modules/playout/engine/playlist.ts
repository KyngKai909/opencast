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

export function renderMaster(band: Band, ladder: Ladder): string {
  const names = BAND_RENDITIONS[band];
  // The reference rendition first: players start there.
  const ordered = [REFERENCE[band], ...names.filter((n) => n !== REFERENCE[band])];
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const name of ordered) {
    const r = ladder[name];
    const video = r.kind === "video" ? `,RESOLUTION=${r.width}x${r.height},FRAME-RATE=${FPS.toFixed(3)}` : "";
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidthOf(r)},AVERAGE-BANDWIDTH=${Math.round((r.videoKbps + r.audioKbps) * 1000)},CODECS="${r.codecs}"${video}`, `${name}.m3u8`);
  }
  return lines.join("\n") + "\n";
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
  for (const row of rows) {
    if (row.kind === "end") break;
    const n = publishedCount(row, edge);
    const own = row.kind === "prepared" && row.preparedKey ? input.lengths(row.preparedKey) : null;
    let at = row.startsAt.getTime();
    for (let i = 0; i < n; i++) {
      const refMs = row.segmentMs[i];
      const segEnd = at + refMs;
      if (segEnd > windowStart) {
        let uri: string | undefined;
        let ms = refMs;
        if (row.kind === "live") uri = row.liveUris?.[input.rendition]?.[i];
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
      lines.push(...o.row.tags);
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(o.at).toISOString()}`);
      previous = o.row;
    }
    lines.push(`#EXTINF:${(o.ms / 1000).toFixed(3)},`, o.uri);
  }
  if (ended) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}
