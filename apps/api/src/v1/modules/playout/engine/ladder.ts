// The fixed rendition ladder every prepared item is transcoded to, once (platform prompt, Phase 5:
// prepare once, then assemble). Four-second segments with a keyframe at every segment boundary,
// the same in every rendition, so a player can switch renditions, and a channel can switch items,
// cleanly at any segment.
//
//   TV band:    1080p, 720p, 480p, 360p (H.264 + AAC), and an audio-only rendition (AAC 128k)
//   Radio band: AAC 128k and 64k
//
// The TV's audio-only rendition and the radio band's 128k are the same encode, so an item aired on
// both bands shares it.

import { SEGMENT_MS } from "../../../lib/segments.js";

export { SEGMENT_MS };
/** Frames per second of every video rendition: a keyframe every 4 s is every 120th frame. */
export const FPS = 30;
/** Integrated loudness every item is levelled to (ATSC A/85, EBU R128's broadcast neighbour). */
export const TARGET_LUFS = -24;
/** Fade at each edge of an item, so joins don't pop. */
export const EDGE_FADE_MS = 10;

export type Band = "tv" | "radio";
export type RenditionName = "v1080" | "v720" | "v480" | "v360" | "a128" | "a64";

export interface Rendition {
  name: RenditionName;
  kind: "video" | "audio";
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
  /** For the master playlist's CODECS. */
  codecs: string;
}

export type Ladder = Record<RenditionName, Rendition>;

export const LADDER: Ladder = {
  v1080: { name: "v1080", kind: "video", width: 1920, height: 1080, videoKbps: 5000, audioKbps: 128, codecs: "avc1.640028,mp4a.40.2" },
  v720: { name: "v720", kind: "video", width: 1280, height: 720, videoKbps: 2800, audioKbps: 128, codecs: "avc1.64001f,mp4a.40.2" },
  v480: { name: "v480", kind: "video", width: 854, height: 480, videoKbps: 1400, audioKbps: 128, codecs: "avc1.64001e,mp4a.40.2" },
  v360: { name: "v360", kind: "video", width: 640, height: 360, videoKbps: 800, audioKbps: 96, codecs: "avc1.64001e,mp4a.40.2" },
  a128: { name: "a128", kind: "audio", width: 0, height: 0, videoKbps: 0, audioKbps: 128, codecs: "mp4a.40.2" },
  a64: { name: "a64", kind: "audio", width: 0, height: 0, videoKbps: 0, audioKbps: 64, codecs: "mp4a.40.2" }
};

/** What each band airs, best first. */
export const BAND_RENDITIONS: Record<Band, RenditionName[]> = {
  tv: ["v1080", "v720", "v480", "v360", "a128"],
  radio: ["a128", "a64"]
};

/** The rendition whose segment lengths are the channel's timeline (and translators relay). */
export const REFERENCE: Record<Band, RenditionName> = { tv: "v720", radio: "a128" };

/** The ladder shrunk (tests keep ffmpeg small): sizes and bitrates scaled, sizes kept even. */
export function scaledLadder(scale: number): Ladder {
  if (scale >= 1) return LADDER;
  const even = (n: number) => Math.max(16, Math.round((n * scale) / 2) * 2);
  const out = {} as Ladder;
  for (const r of Object.values(LADDER)) {
    out[r.name] = r.kind === "video" ? { ...r, width: even(r.width), height: even(r.height), videoKbps: Math.max(40, Math.round(r.videoKbps * scale)) } : r;
  }
  return out;
}

/** Peak bandwidth for the master playlist, in bits per second. */
export const bandwidthOf = (r: Rendition) => Math.round((r.videoKbps * 1.1 + r.audioKbps) * 1000);
