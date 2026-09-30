import { LIVEPEER_API_BASE, LIVEPEER_API_KEY, LIVEPEER_RTMP_INGEST_BASE } from "./config.js";
import { BAND_RENDITIONS, FPS, LADDER, SEGMENT_MS, type Ladder } from "./v1/modules/playout/engine/ladder.js";

/** One of Livepeer's transcode profiles (its stream-creation API). */
export interface LivepeerProfile {
  name: string;
  width: number;
  height: number;
  bitrate: number;
  fps: number;
  /** Seconds between keyframes, as Livepeer takes it ("4.0"). */
  gop: string;
  profile: "H264High";
}

/**
 * A live block is transcoded by Livepeer to the same video renditions every prepared item has
 * (ladder.ts): the same sizes, bitrates and frame rate, with a keyframe every segment, so the
 * channel's playlists switch into Livepeer's segments (the worker's copies of them in storage,
 * engine/livecopy.ts) and back without a player changing rendition. (Livepeer makes no audio-only
 * rendition; the channel's audio-only one is the sound of its smallest, cut by the worker.)
 */
export function livepeerProfiles(ladder: Ladder = LADDER): LivepeerProfile[] {
  return BAND_RENDITIONS.tv
    .map((name) => ladder[name])
    .filter((r) => r.kind === "video")
    .map((r) => ({ name: `${r.height}p`, width: r.width, height: r.height, bitrate: r.videoKbps * 1000, fps: FPS, gop: (SEGMENT_MS / 1000).toFixed(1), profile: "H264High" as const }));
}

interface LivepeerCreateResponse {
  id?: string;
  streamKey?: string;
  playbackId?: string;
  [key: string]: unknown;
}

function ensureApiKey(): string {
  const key = LIVEPEER_API_KEY.trim();
  if (!key) {
    throw new Error("LIVEPEER_API_KEY is not configured.");
  }
  return key;
}

function toPlaybackUrl(playbackId: string): string {
  return `https://playback.livepeer.studio/hls/${playbackId}/index.m3u8`;
}

function toIngestUrl(streamKey: string): string {
  const base = LIVEPEER_RTMP_INGEST_BASE.replace(/\/+$/, "");
  return `${base}/${streamKey}`;
}

function readString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const direct = (input as Record<string, unknown>)[key];
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const nested = (input as Record<string, unknown>).stream;
  if (nested && typeof nested === "object") {
    const nestedValue = (nested as Record<string, unknown>)[key];
    if (typeof nestedValue === "string" && nestedValue.trim()) {
      return nestedValue;
    }
  }

  return undefined;
}

export interface ProvisionedLivepeerStream {
  streamId: string;
  streamKey: string;
  playbackId: string;
  playbackUrl: string;
  ingestUrl: string;
}

export function hasLivepeerApiKey(): boolean {
  return Boolean(LIVEPEER_API_KEY.trim());
}

export async function createLivepeerStream(name: string): Promise<ProvisionedLivepeerStream> {
  const apiKey = ensureApiKey();
  const response = await fetch(`${LIVEPEER_API_BASE.replace(/\/+$/, "")}/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      record: false,
      profiles: livepeerProfiles()
    })
  });

  const payload = (await response.json().catch(() => ({}))) as LivepeerCreateResponse;
  if (!response.ok) {
    const detail = JSON.stringify(payload).slice(0, 300);
    throw new Error(`Livepeer stream create failed (${response.status}). ${detail}`);
  }

  const streamId = readString(payload, "id");
  const streamKey = readString(payload, "streamKey");
  const playbackId = readString(payload, "playbackId");

  if (!streamId || !streamKey || !playbackId) {
    throw new Error("Livepeer stream create returned missing id/streamKey/playbackId.");
  }

  return {
    streamId,
    streamKey,
    playbackId,
    playbackUrl: toPlaybackUrl(playbackId),
    ingestUrl: toIngestUrl(streamKey)
  };
}
