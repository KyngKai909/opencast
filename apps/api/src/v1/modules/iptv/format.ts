// The dial in other apps (programming Phase 5): the channel list (M3U, as IPTV apps read it) and the
// guide (XMLTV, xmltv.dtd), written from plain rows. No database here: service.ts gathers them.

import { clockTime } from "../../lib/time.js";

export interface IptvChannel {
  /** `tvg-id` and the guide's channel id: stable, from the station id. */
  tvgId: string;
  /** The dial number, `12.1`. */
  number: string;
  callSign: string | null;
  name: string;
  band: "tv" | "radio";
  market: { slug: string; name: string; timezone: string };
  /** The station's mark (its logo) as a full URL, or null. */
  logo: string | null;
  /** The station's master playlist, with `?via=iptv`. */
  stream: string;
}

export interface IptvProgramme {
  start: Date;
  stop: Date;
  title: string;
  subTitle: string | null;
  desc: string | null;
  categories: string[];
  /** xmltv_ns when the season and episode are known ("0.13." is season 1, episode 14), onscreen otherwise. */
  episodeNum: { system: "xmltv_ns" | "onscreen"; value: string } | null;
  live: boolean;
  /** A first airing. */
  isNew: boolean;
  rating: { system: string; value: string } | null;
}

/** An M3U attribute's value: one line, no double quotes. */
const attr = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/"/g, "'");

/** The name an app lists: "BEAT · Inland Beat", or the name alone without a call sign. */
export function channelTitle(c: Pick<IptvChannel, "callSign" | "name">): string {
  return c.callSign && c.callSign !== c.name ? `${c.callSign} · ${c.name}` : c.name;
}

/** The channel list: an `#EXTINF` and the stream for each, with the guide's address in the header. */
export function writeM3u(channels: IptvChannel[], guideUrl: string): string {
  const lines = [`#EXTM3U url-tvg="${attr(guideUrl)}" x-tvg-url="${attr(guideUrl)}"`];
  for (const c of channels) {
    const attrs = [
      `tvg-id="${attr(c.tvgId)}"`,
      `tvg-chno="${attr(c.number)}"`,
      `tvg-name="${attr(c.callSign ?? c.name)}"`,
      ...(c.logo ? [`tvg-logo="${attr(c.logo)}"`] : []),
      `group-title="${attr(c.market.name)}"`,
      ...(c.band === "radio" ? [`radio="true"`] : [])
    ];
    lines.push(`#EXTINF:-1 ${attrs.join(" ")},${channelTitle(c).replace(/[\r\n]+/g, " ")}`, c.stream);
  }
  return lines.join("\n") + "\n";
}

const xml = (value: string) =>
  value
    // Characters XML 1.0 can't carry at all.
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** XMLTV's time: `20261010190000 +0000`. */
export function xmltvTime(at: Date): string {
  return `${at.toISOString().replace(/[-:T]/g, "").slice(0, 14)} +0000`;
}

/** The guide: channels, then each channel's programmes in time order. */
export function writeXmltv(input: { channels: IptvChannel[]; programmes: Map<string, IptvProgramme[]>; generatedAt: Date; sourceUrl: string }): string {
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE tv SYSTEM "xmltv.dtd">`,
    `<tv date="${xmltvTime(input.generatedAt)}" source-info-name="Opencast" source-info-url="${xml(input.sourceUrl)}" generator-info-name="Opencast">`
  ];
  for (const c of input.channels) {
    out.push(`  <channel id="${xml(c.tvgId)}">`);
    // Call sign, number, name: apps match the channel list's `tvg-name` (the call sign) against these.
    for (const name of [...new Set([c.callSign, c.number, c.name].filter((n): n is string => Boolean(n)))]) out.push(`    <display-name lang="en">${xml(name)}</display-name>`);
    if (c.logo) out.push(`    <icon src="${xml(c.logo)}" />`);
    out.push(`  </channel>`);
  }
  for (const c of input.channels) {
    for (const p of input.programmes.get(c.tvgId) ?? []) {
      // The DTD's order: title, sub-title, desc, category, episode-num, new, rating.
      out.push(`  <programme start="${xmltvTime(p.start)}" stop="${xmltvTime(p.stop)}" channel="${xml(c.tvgId)}">`);
      out.push(`    <title lang="en">${xml(p.title)}</title>`);
      if (p.subTitle) out.push(`    <sub-title lang="en">${xml(p.subTitle)}</sub-title>`);
      if (p.desc) out.push(`    <desc lang="en">${xml(p.desc)}</desc>`);
      // Live blocks: xmltv.dtd has no `<live/>`, so they're the category "Live" (docs/open-decisions.md, programming Phase 5).
      for (const category of new Set([...p.categories, ...(p.live ? ["Live"] : [])])) out.push(`    <category lang="en">${xml(category)}</category>`);
      if (p.episodeNum) out.push(`    <episode-num system="${p.episodeNum.system}">${xml(p.episodeNum.value)}</episode-num>`);
      if (p.isNew) out.push(`    <new />`);
      if (p.rating) out.push(`    <rating system="${xml(p.rating.system)}">`, `      <value>${xml(p.rating.value)}</value>`, `    </rating>`);
      out.push(`  </programme>`);
    }
  }
  out.push(`</tv>`);
  return out.join("\n") + "\n";
}

/**
 * The episode number: xmltv_ns (zero-based `season.episode.part`) when the season and episode are
 * known, onscreen ("Episode 14") when only the episode is, else none.
 */
export function episodeNumOf(item: { seasonNumber: number | null; episodeNumber: number | null; partNumber?: number | null } | null): IptvProgramme["episodeNum"] {
  if (!item?.episodeNumber || item.episodeNumber < 1) return null;
  if (item.seasonNumber && item.seasonNumber >= 1) {
    const part = item.partNumber && item.partNumber >= 1 ? String(item.partNumber - 1) : "";
    return { system: "xmltv_ns", value: `${item.seasonNumber - 1}.${item.episodeNumber - 1}.${part}` };
  }
  return { system: "onscreen", value: `Episode ${item.episodeNumber}` };
}

/** The rating: the program's TV rating (VCHIP), else its advisory ("Language", "Mature"), else none. */
export function ratingOf(program: { rating: string | null; advisory: "none" | "language" | "mature" } | null): IptvProgramme["rating"] {
  if (program?.rating) return { system: "VCHIP", value: program.rating };
  if (program?.advisory === "language") return { system: "advisory", value: "Language" };
  if (program?.advisory === "mature") return { system: "advisory", value: "Mature" };
  return null;
}

/** Planned off air's description: "Back at 6:00 am.", with the day when it isn't within a day. */
export function offAirDesc(start: Date, backAt: Date, tz: string): string {
  const time = clockTime(backAt, tz);
  if (backAt.getTime() - start.getTime() < 24 * 3_600_000) return `Back at ${time}.`;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(backAt);
  return `Back ${day} at ${time}.`;
}

/** Programming Phase 6: a slot not cleared for other apps, as the guide lists it (what their stream shows then: the slate). */
export const ELSEWHERE_TITLE = "Airing on Opencast";

/** Its description: "On Opencast only. Watch it on BEAT, channel 12.1, in the Opencast app." */
export function elsewhereDesc(channel: Pick<IptvChannel, "callSign" | "name" | "number">): string {
  return `On Opencast only. Watch it on ${channel.callSign ?? channel.name}, channel ${channel.number}, in the Opencast app.`;
}

/** A gap this short between two programmes is a break between them: the first runs to the second. */
export const FOLD_GAP_MS = 15 * 60_000;

/**
 * Breaks fold into the program around them: a break's own log entries (spots, bumpers, station IDs,
 * underwriting) and short gaps join the programme before them (or, first thing, the one after).
 * Planned off air is a programme of its own and never takes anything in.
 */
export function foldBreaks<T extends { start: Date; stop: Date; fold: boolean; offAir: boolean }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: T[] = [];
  let carry: Date | null = null;
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (row.fold && !row.offAir) {
      if (last && !last.offAir && row.start.getTime() - last.stop.getTime() <= FOLD_GAP_MS) last.stop = new Date(Math.max(last.stop.getTime(), row.stop.getTime()));
      else if (!carry) carry = row.start;
      continue;
    }
    const next = { ...row };
    if (carry && !next.offAir) next.start = carry;
    carry = null;
    if (last && !last.offAir && !next.offAir) {
      const gap = next.start.getTime() - last.stop.getTime();
      if (gap > 0 && gap <= FOLD_GAP_MS) last.stop = next.start;
    }
    // Never overlapping: the later one starts where the earlier ends.
    if (last && next.start < last.stop) next.start = last.stop;
    if (next.stop > next.start) out.push(next);
  }
  return out;
}
