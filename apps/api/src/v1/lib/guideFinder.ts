// A249 (2026-10-06): "Find this channel's guide". iptv-org's public lists say, for some 31,000
// channels, which sites have guide data for them (`channels.json`: id, name, other names;
// `guides.json`: channel, site, the site's id for it, the site's name for it). Most of those sites
// need their pages read (iptv-org's own grabber does that); a few publish plain XMLTV files whose
// address follows from the site's id, and only those are offered:
// - i.mjh.nz (Pluto TV, Plex, Roku, Samsung TV Plus, DStv, PBS, Australian and New Zealand
//   free-to-air and the rest): `PlutoTV/us#<id>` is https://i.mjh.nz/PlutoTV/us.xml.gz, channel
//   <id>. Plex's ids are "<a>-<b>" in the list, but the files' first half has changed since: the
//   second half is the channel's own, so the address names that (the reader takes an id ending in it).
// - nzxmltv.com's Freeview and Sky guides (`xmltv/guide#1` is https://nzxmltv.com/xmltv/guide.xml,
//   channel 1). Its IPTV files reuse ids across channels, so they aren't offered.
// Pure (but for reading the lists as they download), so it's tested alone.

import { NAME_EXTRAS, plain } from "./schedules.js";

export const IPTV_ORG_CHANNELS = "https://iptv-org.github.io/api/channels.json";
export const IPTV_ORG_GUIDES = "https://iptv-org.github.io/api/guides.json";

export interface ListChannel {
  id: string;
  name: string;
  altNames: string[];
}

export interface ListGuide {
  channel: string | null;
  site: string;
  siteId: string;
  siteName: string;
}

/** A guide file that can be fetched as it is. */
export interface FetchableGuide {
  label: string;
  via: string;
  /** The file's address, and the channel's id in it. */
  file: string;
  channel: string;
}

/** The platforms i.mjh.nz has files for, by the first folder of the site's id (Flash's file isn't there: left out). */
const MJH: Record<string, string> = {
  PlutoTV: "Pluto TV",
  Plex: "Plex",
  Roku: "Roku",
  SamsungTVPlus: "Samsung TV Plus",
  DStv: "DStv",
  PBS: "PBS",
  Singtel: "Singtel",
  SkyGo: "Sky Go",
  Foxtel: "Foxtel",
  Binge: "Binge",
  hgtv_go: "HGTV GO",
  Kayo: "Kayo",
  SkySportNow: "Sky Sport Now",
  MeTV: "MeTV",
  au: "Australian free-to-air",
  nz: "New Zealand free-to-air"
};

/** nzxmltv.com's files that keep one id per channel. */
const NZXMLTV: Record<string, string> = { "xmltv/guide": "Freeview NZ", "sky/guide": "Sky NZ" };

/** A site's file path: letters, digits and underscores, a few folders deep. Nothing else is fetched. */
const SAFE_PATH = /^[A-Za-z0-9_]+(\/[A-Za-z0-9_]+){0,3}$/;

/** "Pluto TV (US)", "Roku", "Australian free-to-air (Adelaide)". */
function mjhLabel(path: string): string | null {
  const [platform, place] = path.split("/");
  const name = MJH[platform!];
  if (!name) return null;
  const where = place && place !== "all" && place !== "epg" ? (place.length === 2 ? place.toUpperCase() : place) : null;
  return where ? `${name} (${where})` : name;
}

/** The file and channel a guide's site id gives, for the sites that publish plain files; null for the rest. */
export function fetchableGuide(g: Pick<ListGuide, "site" | "siteId">): FetchableGuide | null {
  const hash = g.siteId.indexOf("#");
  if (hash <= 0) return null;
  const path = g.siteId.slice(0, hash);
  let channel = g.siteId.slice(hash + 1);
  if (!channel || !SAFE_PATH.test(path)) return null;
  if (g.site === "i.mjh.nz") {
    const label = mjhLabel(path);
    if (!label) return null;
    // Plex: "<a>-<b>", of which <b> is the channel's own id.
    const plex = path.startsWith("Plex/") ? /^[0-9a-f]{24}-([0-9a-f]{24})$/i.exec(channel) : null;
    if (plex) channel = plex[1]!;
    return { label, via: "i.mjh.nz", file: `https://i.mjh.nz/${path}.xml.gz`, channel };
  }
  if (g.site === "nzxmltv.com" && NZXMLTV[path]) return { label: NZXMLTV[path]!, via: "nzxmltv.com", file: `https://nzxmltv.com/${path}.xml`, channel };
  return null;
}

/** The address to save: the file, its channel in the fragment. */
export const guideUrl = (g: FetchableGuide) => `${g.file}#channel=${encodeURIComponent(g.channel)}`;

/** A name as it's matched: "&" as "and", then letters and digits only. */
const keyOf = (s: string) => plain(s.replace(/&amp;/gi, "&").replace(/&/g, " and "));

/** A name's keys: as given, and without a trailing "TV", "Channel" and the like. */
function keys(name: string): string[] {
  return [...new Set([keyOf(name), keyOf(name.replace(NAME_EXTRAS, ""))])].filter((k) => k.length >= 2);
}

/** iptv-org's id from a playlist's tvg-id ("AnimexHIDIVE.us@SD" is the channel AnimexHIDIVE.us). */
export const channelIdOf = (tvgId: string | null | undefined) => (tvgId ? tvgId.split("@")[0]!.trim() || null : null);

export interface GuideLists {
  channels: ListChannel[];
  /** Only the guides from sites that publish plain files (the rest are counted). */
  guides: ListGuide[];
  /** Guides from other sites, by channel id, and by their own name for the channel, to count what's skipped. */
  otherByChannel: Map<string, number>;
  otherByName: Map<string, number>;
}

/**
 * The guide files for a channel: iptv-org's channels named `name` (or one of their other names), or
 * the one `tvgId` is, and every fetchable guide for them, or whose own name for its channel is
 * `name`. `skipped`: their guides on sites whose pages would have to be read.
 */
export function findGuides(lists: GuideLists, name: string, tvgId: string | null): { channels: ListChannel[]; guides: Array<FetchableGuide & { siteName: string; channelId: string | null }>; skipped: number } {
  const wanted = new Set(keys(name));
  const id = channelIdOf(tvgId)?.toLowerCase() ?? null;
  const channels = lists.channels.filter((c) => (id !== null && c.id.toLowerCase() === id) || [c.name, ...c.altNames].some((n) => keys(n).some((k) => wanted.has(k))));
  const ids = new Set(channels.map((c) => c.id));
  const byName = (g: ListGuide) => keys(g.siteName).some((k) => wanted.has(k));
  const seen = new Set<string>();
  const guides: Array<FetchableGuide & { siteName: string; channelId: string | null }> = [];
  // The channel's own guides first, then those that only share its name.
  for (const g of [...lists.guides.filter((g) => g.channel && ids.has(g.channel)), ...lists.guides.filter((g) => !(g.channel && ids.has(g.channel)) && byName(g))]) {
    const f = fetchableGuide(g);
    if (!f) continue;
    const url = guideUrl(f);
    if (seen.has(url)) continue;
    seen.add(url);
    guides.push({ ...f, siteName: g.siteName, channelId: g.channel });
  }
  let skipped = 0;
  for (const c of ids) skipped += lists.otherByChannel.get(c) ?? 0;
  for (const k of wanted) skipped += lists.otherByName.get(k) ?? 0;
  return { channels, guides, skipped };
}

/**
 * The items of a JSON array, as its text arrives: each top-level element's text is cut out (strings
 * and nesting followed) and parsed alone, so a 25 MB list is never one parse.
 */
export async function* jsonArrayItems(chunks: AsyncIterable<string>): AsyncGenerator<unknown> {
  let buf = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for await (const chunk of chunks) {
    const from = buf.length;
    buf += chunk;
    for (let i = from; i < buf.length; i++) {
      const ch = buf[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{" || ch === "[") {
        depth++;
        if (depth === 2) start = i;
      } else if (ch === "}" || ch === "]") {
        if (depth === 2 && start >= 0) {
          try {
            yield JSON.parse(buf.slice(start, i + 1));
          } catch {
            // A malformed item is skipped.
          }
          start = -1;
        }
        depth--;
      }
    }
    // Keep only the item still open.
    if (start >= 0) {
      buf = buf.slice(start);
      start = 0;
    } else buf = "";
  }
}

/** One of channels.json's items, as kept. */
export function listChannel(v: unknown): ListChannel | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  return { id: o.id, name: o.name, altNames: Array.isArray(o.alt_names) ? o.alt_names.filter((n): n is string => typeof n === "string") : [] };
}

/** One of guides.json's items, as kept. */
export function listGuide(v: unknown): ListGuide | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.site !== "string" || typeof o.site_id !== "string") return null;
  return { channel: typeof o.channel === "string" ? o.channel : null, site: o.site, siteId: o.site_id, siteName: typeof o.site_name === "string" ? o.site_name : "" };
}

/** Lists made from what was read: the fetchable guides kept, the others counted by channel and by name. */
export function guideLists(channels: ListChannel[], allGuides: Iterable<ListGuide>): GuideLists {
  const guides: ListGuide[] = [];
  const otherByChannel = new Map<string, number>();
  const otherByName = new Map<string, number>();
  for (const g of allGuides) {
    if (fetchableGuide(g)) {
      guides.push(g);
      continue;
    }
    if (g.channel) otherByChannel.set(g.channel, (otherByChannel.get(g.channel) ?? 0) + 1);
    else for (const k of keys(g.siteName)) otherByName.set(k, (otherByName.get(k) ?? 0) + 1);
  }
  return { channels, guides, otherByChannel, otherByName };
}
