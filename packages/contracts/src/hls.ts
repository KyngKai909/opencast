// What a channel's HLS playlist says, besides its segments (platform prompt, Phase 5: prepare
// once, then assemble). The worker writes these tags; the player reads them. Both sides use the
// names and the parser here, so they can't drift.
//
// A channel's playlist, per rendition:
//   - `#EXT-X-PROGRAM-DATE-TIME` on the first segment of every item; `#EXT-X-DISCONTINUITY`
//     between items (and into and out of live blocks).
//   - `#EXT-X-DATERANGE` tags, one per thing the player draws or needs to know, with a CLASS
//     below and Opencast's attributes as `X-OC-…` client attributes (quoted strings, or decimal
//     numbers where noted). START-DATE and DURATION or END-DATE bound each one.
//   - Breaks carry SCTE-35 style cues on their DATERANGE (`SCTE35-OUT` at the start, `SCTE35-IN`
//     at the end), written by the worker, for ads from partners later.
//   - Off air (a planned sign-off): the sign-off slate's segments, then `#EXT-X-ENDLIST`. When the
//     station is back, a new playlist starts from its station ID.

import { z } from "zod";

/** DATERANGE CLASS values. */
export const HLS_CLASS = {
  /** One item from the log (a program, spot, underwriting credit, bumper or station ID). */
  item: "org.useopencast.item",
  /** A break: the span the break rule made. Carries SCTE35-OUT / SCTE35-IN. */
  break: "org.useopencast.break",
  /** A live block (the live source's segments for its hours: the worker's copies in storage). */
  live: "org.useopencast.live",
  /** The station's bug for a span (usually the whole item; absent where the station hides it). */
  bug: "org.useopencast.bug",
  /** A lower third over a live block or program. */
  lowerThird: "org.useopencast.lower-third",
  /** A spot's on-screen code and QR, for its last seconds (10 s by default). */
  code: "org.useopencast.code",
  /** The planned sign-off: what the slate says, and when the station is back. */
  signOff: "org.useopencast.sign-off",
  /**
   * A243 (added 2026-10-02): an up-next bumper's title, drawn by the player over the clip (never
   * burned in), from the guide's own data. Players built before it ignore classes they don't know.
   */
  upNext: "org.useopencast.up-next"
} as const;
export type HlsClass = (typeof HLS_CLASS)[keyof typeof HLS_CLASS];

/** The log codes, as items carry them. */
export const HlsLogCode = z.enum(["PGM", "SPT", "UND", "BMP", "SID"]);

/** Attributes per class (the `X-OC-` prefix and upper-kebab case are the wire form: `X-OC-LOG-ENTRY-ID`). */
export const HlsItem = z.object({
  logEntryId: z.string().nullable().default(null),
  code: HlsLogCode,
  /** The content ID (CIDv1) of the prepared item. */
  contentId: z.string(),
  title: z.string(),
  /** Carried from another station: its call sign. */
  carriedFrom: z.string().nullable().default(null),
  /**
   * A242 (added 2026-10-02): an opener (`OPN`) or closer (`CLS`). `code` then reads `SID`, so
   * players built before it (which drop an item whose code they don't know) still read the item.
   */
  identCode: z.enum(["OPN", "CLS"]).nullable().default(null),
  /**
   * A243 (added 2026-10-02): a bumper's role, informational only (players built before it drop it).
   * A role this build doesn't know reads as null rather than failing the item.
   */
  bumperRole: z.enum(["into_break", "out_of_break", "up_next", "any"]).nullable().catch(null).default(null)
});
export const HlsBreak = z.object({ breakId: z.string() });
export const HlsLive = z.object({ logEntryId: z.string(), sourceId: z.string() });
export const HlsBug = z.object({
  mode: z.enum(["call_sign_and_channel", "logo"]),
  /** For call_sign_and_channel. */
  callSign: z.string().nullable().default(null),
  channel: z.string().nullable().default(null),
  /** For logo: an absolute URL. */
  logoUrl: z.string().nullable().default(null),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]),
  /** 0 to 100. */
  opacity: z.number().min(0).max(100),
  /**
   * A244 (added 2026-10-02): during a programming block whose bug is its logo, the block (`logoUrl`
   * is then the block's, `mode` `logo`, so players built before it draw it as any logo). Null otherwise.
   */
  blockId: z.string().nullable().optional()
});
export const HlsLowerThird = z.object({ name: z.string(), title: z.string().nullable().default(null) });
export const HlsCode = z.object({
  spotId: z.string(),
  code: z.string(),
  /** The offer's words, as the frames draw them under the code. */
  offer: z.string(),
  /** What the QR opens (absolute URL). */
  qrUrl: z.string()
});
export const HlsSignOff = z.object({ backAt: z.string().nullable().default(null) });
/**
 * A243 (added 2026-10-02): what an up-next bumper names: the next program as the guide has it
 * (its title, episode title and start, a carried program's maker). `immediate` 1: it follows this
 * break ("Up next"); 0: later ("Next at 9:00 pm", in the market's time zone).
 */
export const HlsUpNext = z.object({
  logEntryId: z.string().nullable().default(null),
  title: z.string(),
  episodeTitle: z.string().nullable().default(null),
  /** ISO: the program's start, as the guide has it. */
  startsAt: z.string(),
  immediate: z.number().default(1),
  carriedFrom: z.string().nullable().default(null),
  /** A244 (2026-10-02): the programming block the program is part of ("Up next · Late Crate Nights · Saturday Reel"). */
  blockName: z.string().nullable().default(null)
});

export const HLS_ATTRIBUTES = {
  [HLS_CLASS.item]: HlsItem,
  [HLS_CLASS.break]: HlsBreak,
  [HLS_CLASS.live]: HlsLive,
  [HLS_CLASS.bug]: HlsBug,
  [HLS_CLASS.lowerThird]: HlsLowerThird,
  [HLS_CLASS.code]: HlsCode,
  [HLS_CLASS.signOff]: HlsSignOff,
  [HLS_CLASS.upNext]: HlsUpNext
} as const;

/** One DATERANGE as read: its id, class, times, the SCTE-35 cues if any, and its Opencast attributes. */
export interface HlsDateRange {
  id: string;
  class: string;
  /** Milliseconds since the epoch. */
  start: number;
  /** Milliseconds since the epoch, when END-DATE or DURATION is given. */
  end: number | null;
  scte35Out: string | null;
  scte35In: string | null;
  /** The `X-OC-…` attributes, keyed in camelCase (`X-OC-LOG-ENTRY-ID` → `logEntryId`). */
  attributes: Record<string, string | number>;
}

const wireKey = (camel: string) => `X-OC-${camel.replace(/[A-Z]/g, (c) => `-${c}`).toUpperCase()}`;
const camelKey = (wire: string) => wire.slice(5).toLowerCase().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Splits an attribute list, honouring quoted strings. */
function attributeList(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]!] = m[2]!;
  return out;
}

/** Reads every `#EXT-X-DATERANGE` in a playlist. Unknown classes are kept; the reader decides. */
export function parseDateRanges(playlist: string): HlsDateRange[] {
  const ranges: HlsDateRange[] = [];
  for (const line of playlist.split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-DATERANGE:")) continue;
    const a = attributeList(line.slice("#EXT-X-DATERANGE:".length));
    const str = (v: string | undefined) => (v === undefined ? undefined : v.startsWith('"') ? v.slice(1, -1) : v);
    const start = Date.parse(str(a["START-DATE"]) ?? "");
    if (!a.ID || Number.isNaN(start)) continue;
    const endDate = str(a["END-DATE"]);
    const duration = a.DURATION !== undefined ? Number(a.DURATION) : undefined;
    const attributes: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(a)) {
      if (!k.startsWith("X-OC-")) continue;
      attributes[camelKey(k)] = v.startsWith('"') ? v.slice(1, -1) : Number(v);
    }
    ranges.push({
      id: str(a.ID)!,
      class: str(a.CLASS) ?? "",
      start,
      end: endDate ? Date.parse(endDate) : duration !== undefined && !Number.isNaN(duration) ? start + duration * 1000 : null,
      scte35Out: a["SCTE35-OUT"] ?? null,
      scte35In: a["SCTE35-IN"] ?? null,
      attributes
    });
  }
  return ranges;
}

/** Writes one `#EXT-X-DATERANGE` line (the worker's side). Null attributes are left out. */
export function dateRangeTag(o: {
  id: string;
  class: HlsClass;
  start: Date | number;
  durationSeconds?: number;
  scte35Out?: string;
  scte35In?: string;
  attributes: Record<string, string | number | null>;
}): string {
  const parts = [`ID="${o.id}"`, `CLASS="${o.class}"`, `START-DATE="${new Date(o.start).toISOString()}"`];
  if (o.durationSeconds !== undefined) parts.push(`DURATION=${Number(o.durationSeconds.toFixed(3))}`);
  if (o.scte35Out) parts.push(`SCTE35-OUT=${o.scte35Out}`);
  if (o.scte35In) parts.push(`SCTE35-IN=${o.scte35In}`);
  for (const [k, v] of Object.entries(o.attributes)) {
    if (v === null) continue;
    parts.push(`${wireKey(k)}=${typeof v === "number" ? v : `"${String(v).replace(/"/g, "'")}"`}`);
  }
  return `#EXT-X-DATERANGE:${parts.join(",")}`;
}
