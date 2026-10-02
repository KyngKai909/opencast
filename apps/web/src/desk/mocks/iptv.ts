// Public IPTV lists on the mocks (follow-up Phase 6): the API's reader (apps/api/src/v1/lib/iptv.ts),
// copied, for a pasted or uploaded M3U or iptv-org's JSON. The mock never fetches: an iptv-org
// address answers the canned list below, a few US community and government channels on example
// addresses (Inland Community TV and Rialto Community Access are already on the desk).

import { ICTV_STREAM } from "./fixtures/creators";

export interface ListedChannel {
  name: string;
  streamUrl: string;
  tvgId: string | null;
  group: string | null;
  country: string | null;
  logoUrl: string | null;
}

/** Where a list may be read from by its address: iptv-org's published lists only. */
export function isIptvOrgAddress(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname === "iptv-org.github.io") return true;
  return url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith("/iptv-org/");
}

const httpAddress = (s: string) => /^https?:\/\/\S+$/i.test(s);
const cap = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

function attribute(line: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`, "i").exec(line)?.[1]?.trim() || null;
}

/** An M3U playlist's channels, and how many entries weren't channels with an http(s) address. */
export function parseM3u(text: string): { channels: ListedChannel[]; skipped: number } {
  const channels: ListedChannel[] = [];
  let skipped = 0;
  let info: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      if (info) skipped++;
      info = line;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!info) continue;
    // The name follows the last comma outside quotes.
    let quoted = false;
    let comma = -1;
    for (let i = 0; i < info.length; i++) {
      if (info[i] === '"') quoted = !quoted;
      else if (info[i] === "," && !quoted) comma = i;
    }
    const name = comma >= 0 ? info.slice(comma + 1).trim() : "";
    if (name && httpAddress(line)) {
      channels.push({
        name: name.slice(0, 160),
        streamUrl: line,
        tvgId: cap(attribute(info, "tvg-id"), 120),
        group: cap(attribute(info, "group-title"), 120),
        country: cap(attribute(info, "tvg-country"), 8),
        logoUrl: cap(attribute(info, "tvg-logo"), 500)
      });
    } else skipped++;
    info = null;
  }
  if (info) skipped++;
  return dedupe(channels, skipped);
}

/** iptv-org's JSON (streams.json), or any array of objects with a name (or title, or channel) and a url. */
export function parseIptvJson(text: string): { channels: ListedChannel[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { channels: [], skipped: 0 };
  }
  const list = Array.isArray(data) ? data : [];
  const channels: ListedChannel[] = [];
  let skipped = 0;
  for (const item of list) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
    const name = str("title") ?? str("name") ?? str("channel");
    const url = str("url");
    if (!name?.trim() || !url || !httpAddress(url)) {
      skipped++;
      continue;
    }
    const channel = str("channel");
    channels.push({
      name: name.trim().slice(0, 160),
      streamUrl: url,
      tvgId: cap(channel, 120),
      group: cap(str("group") ?? (Array.isArray(o.categories) ? String(o.categories[0] ?? "") : null), 120),
      country: cap(str("country") ?? (channel && /\.([a-z]{2})(@|$)/i.exec(channel)?.[1]?.toUpperCase()) ?? null, 8),
      logoUrl: cap(str("logo"), 500)
    });
  }
  return dedupe(channels, skipped);
}

/** Either kind, by what the text looks like. */
export function parseIptvList(text: string): { channels: ListedChannel[]; skipped: number } {
  const head = text.trimStart();
  return head.startsWith("[") || head.startsWith("{") ? parseIptvJson(head) : parseM3u(text);
}

/** The same stream listed twice counts once (the first name wins). */
function dedupe(channels: ListedChannel[], skipped: number) {
  const seen = new Set<string>();
  const out: ListedChannel[] = [];
  for (const c of channels) {
    if (seen.has(c.streamUrl)) {
      skipped++;
      continue;
    }
    seen.add(c.streamUrl);
    out.push(c);
  }
  return { channels: out, skipped };
}

/** What an iptv-org address answers on the mocks: a short US list, one entry with no address. */
export const SAMPLE_LIST = `#EXTM3U
#EXTINF:-1 tvg-id="InlandCommunityTV.us" tvg-country="US" group-title="General",Inland Community TV
${ICTV_STREAM}
#EXTINF:-1 tvg-id="RialtoCommunityAccess.us" tvg-country="US" group-title="Public",Rialto Community Access
https://rialto-access.example.net/hls/live.m3u8
#EXTINF:-1 tvg-id="FontanaPublicAccess.us" tvg-country="US" group-title="Public",Fontana Public Access
https://fontana-access.example.net/live/playlist.m3u8
#EXTINF:-1 tvg-id="RiversideCountyTV.us" tvg-country="US" group-title="Legislative",Riverside County TV
https://rivco.example.net/hls/board.m3u8
#EXTINF:-1 tvg-id="OntarioCityTV.us" tvg-country="US" group-title="Legislative",Ontario City TV
https://ontario-city.example.net/live/index.m3u8
#EXTINF:-1 tvg-id="InlandWeatherNow.us" tvg-country="US" group-title="Weather",Inland Weather Now
https://weather-now.example.net/stream/manifest.mpd
#EXTINF:-1 tvg-id="NoAddress.us" group-title="General",A channel with no address
`;
