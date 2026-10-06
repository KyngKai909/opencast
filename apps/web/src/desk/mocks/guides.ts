// A249 (2026-10-06): large guides and "Find this channel's guide", in mock mode. The mock never
// fetches: the lookup answers a canned extract of iptv-org's lists (three of Anime x HIDIVE's guides
// via i.mjh.nz, three more on sites whose pages would have to be read; WeatherNation's Samsung TV
// Plus id, which that file no longer has), and a
// guide address (an .xml.gz, or i.mjh.nz's) answers a canned read: a channel of the platform's
// guide with half-hour episodes from now on. A guide address without #channel= has none picked.

import type { GuideOption, GuideRead, SchedulePreview } from "@opencast/contracts";

/** iptv-org's lists, as the mock has them: by the plain name looked up. */
const FOUND: Record<string, { channels: Array<{ id: string; name: string }>; guides: GuideOption[]; skipped: number }> = {
  animexhidive: {
    channels: [{ id: "AnimexHIDIVE.us", name: "Anime x HIDIVE" }],
    guides: [
      { label: "Pluto TV (US)", via: "i.mjh.nz", url: "https://i.mjh.nz/PlutoTV/us.xml.gz#channel=6793eaa4bc03978b9bc63db1", siteName: "ANIME x HIDIVE", channelId: "AnimexHIDIVE.us", inGuide: true },
      { label: "Plex (US)", via: "i.mjh.nz", url: "https://i.mjh.nz/Plex/us.xml.gz#channel=63dea56a2a2abb171ff6dadf", siteName: "ANIME x HIDIVE", channelId: "AnimexHIDIVE.us", inGuide: true },
      { label: "Samsung TV Plus (US)", via: "i.mjh.nz", url: "https://i.mjh.nz/SamsungTVPlus/us.xml.gz#channel=US15000032I", siteName: "ANIME x HIDIVE", channelId: null, inGuide: true }
    ],
    skipped: 3
  },
  weathernation: {
    channels: [{ id: "WeatherNation.us", name: "WeatherNation" }],
    guides: [{ label: "Samsung TV Plus (US)", via: "i.mjh.nz", url: "https://i.mjh.nz/SamsungTVPlus/us.xml.gz#channel=USBC1500009LD", siteName: "WeatherNation", channelId: "WeatherNation.us", inGuide: false }],
    skipped: 2
  }
};

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The lookup's answer for a name: its guides, or none. */
export function foundGuides(name: string): { channels: Array<{ id: string; name: string }>; guides: GuideOption[]; skipped: number } {
  const key = plain(name.replace(/(\s+(channel|tv|television|network|live|hd))+$/i, ""));
  return FOUND[key] ?? FOUND[plain(name)] ?? { channels: [], guides: [], skipped: 0 };
}

/** An XMLTV guide's address, as the mock reads one: an .xml.gz file, or one of i.mjh.nz's. */
export const isGuideAddress = (url: string) => /\.xml\.gz($|[?#])/i.test(url) || /^https:\/\/i\.mjh\.nz\//i.test(url);

/** The channel an address names, if any. */
export const guideChannel = (url: string) => {
  const m = /#channel=([^&]+)/.exec(url)?.[1];
  return m ? decodeURIComponent(m) : null;
};

/** The canned episodes, in turn (the titles Pluto TV's guide listed for the channel on 2026-10-06). */
const SHOWS = ["Golden Time", "The Demon Girl Next Door", "The Demon Girl Next Door", "The Demon Girl Next Door", "Maid-Sama!", "Maid-Sama!", "K-ON!", "K-ON!"];

/** Half-hour airings from the half hour now on, for 16 hours (a platform's guide covers about a day). */
export function guideAirings(now: Date): SchedulePreview["airings"] {
  const start = Math.floor(now.getTime() / 1_800_000) * 1_800_000;
  return Array.from({ length: 32 }, (_, i) => ({ title: SHOWS[i % SHOWS.length]!, startsAt: new Date(start + i * 1_800_000).toISOString(), endsAt: new Date(start + (i + 1) * 1_800_000).toISOString() }));
}

/** What the canned read gives: a channel of a 427-channel guide, 965 KB gzipped. */
export function guideRead(url: string, now: Date): GuideRead {
  const channel = guideChannel(url);
  const name = Object.values(FOUND)
    .flatMap((f) => f.guides)
    .find((g) => guideChannel(g.url) === channel)?.siteName;
  return {
    channel,
    channelName: channel ? (name ?? null) : null,
    channels: 427,
    programmes: channel ? 32 : 0,
    compressedBytes: 965_313,
    bytes: 7_396_565,
    gzip: true,
    large: true,
    readAt: now.toISOString(),
    unchangedAt: null,
    limit: null
  };
}

/** The API's words for a guide without a channel picked, and for a channel not in it. */
export const PICK_CHANNEL = "This guide has 427 channels. Pick one: add #channel= and its id to the address (Find this channel's guide does it), so no other channel's shows are listed.";
export const notInGuide = (channel: string) => `Channel ${channel} isn't in this guide right now (it lists 427 channels). Find this channel's guide again, or check the address.`;

/** A channel the canned guides no longer have. */
export const goneFromGuide = (url: string) =>
  Object.values(FOUND)
    .flatMap((f) => f.guides)
    .some((g) => g.url === url && g.inGuide === false);
