// Public IPTV lists (follow-up Phase 6): an M3U playlist (`#EXTINF` lines with tvg-id, tvg-logo,
// group-title and tvg-country, each followed by the stream's address) or iptv-org's JSON (its
// streams.json: `{ channel, title, url }`, or anything with a name and a url). Channels found here
// become creator leads, never listings: nothing is played or checked from a list.

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
    // Player options between the #EXTINF and its address (#EXTVLCOPT, #KODIPROP, #EXTGRP) are skipped.
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
