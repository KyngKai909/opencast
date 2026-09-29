// Search's rules: when a query is a channel or frequency (numbers tune), how results are ordered
// (airing next first; within the same time, your market's own programs before carried copies
// elsewhere) and the matched words. The mock API uses the same functions, so the rules are
// written once.

import { channelValue } from "../station/when";

/** The digits of a channel or frequency ("12", "883", "88.3", "12."), or null for a title ("24 Hours"). */
export function numberQuery(q: string): string | null {
  const t = q.trim();
  return /^\d{1,4}(\.\d?)?$/.test(t) ? t : null;
}

export interface ChannelMatch {
  /** The channel it reads as: "12.1", "88.3". */
  channel: string;
  /** Whether a station is on it. */
  found: boolean;
}

/**
 * What typed digits tune to, as the keypad reads them: a TV channel fills in ".1" (12 → 12.1);
 * three or four digits with no TV station are a frequency, the last digit the tenth (883 → 88.3,
 * 1019 → 101.9); a dot is taken as typed.
 */
export function matchChannel(typed: string, channels: string[]): ChannelMatch | null {
  const t = numberQuery(typed);
  if (!t) return null;
  const has = (c: string) => channels.includes(c);
  if (t.includes(".")) {
    const c = t.endsWith(".") ? `${t}1` : t;
    return { channel: c, found: has(c) };
  }
  const tv = `${t}.1`;
  if (has(tv)) return { channel: tv, found: true };
  if (t.length >= 3) {
    const radio = `${t.slice(0, -1)}.${t.slice(-1)}`;
    if (has(radio)) return { channel: radio, found: true };
  }
  return { channel: tv, found: false };
}

/** The two stations nearest a channel with nothing on it, by number, in channel order. */
export function nearestChannels(channel: string, channels: string[], n = 2): string[] {
  const x = Number(channel);
  return [...channels]
    .sort((a, b) => Math.abs(Number(a) - x) - Math.abs(Number(b) - x) || channelValue(a) - channelValue(b))
    .slice(0, n)
    .sort((a, b) => channelValue(a) - channelValue(b));
}

export interface Orderable {
  station: { marketSlug: string | null; channel: string | null };
  airing: { startsAt: string; endsAt: string; carriedFrom: unknown };
}

/**
 * Ordered by when it airs, not relevance: what's on now counts as airing now and comes first.
 * Within the same time, your market's programs come before carried copies elsewhere (in market,
 * then in market but carried, then outside the market), then channel order. Ended airings go.
 */
export function orderAirings<T extends Orderable>(rows: T[], now: Date, market: string | null): T[] {
  const t = now.getTime();
  const when = (r: T) => Math.max(Date.parse(r.airing.startsAt), t);
  const rank = (r: T) => (market && r.station.marketSlug !== market ? 2 : 0) + (r.airing.carriedFrom ? 1 : 0);
  return rows
    .filter((r) => Date.parse(r.airing.endsAt) > t)
    .sort((a, b) => when(a) - when(b) || rank(a) - rank(b) || channelValue(a.station.channel) - channelValue(b.station.channel));
}

/** The query's words marked in a title (case-insensitive), for <mark>. */
export function highlight(text: string, q: string): Array<{ text: string; hit: boolean }> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  const hay = text.toLowerCase();
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    if (j > i) out.push({ text: text.slice(i, j), hit: false });
    out.push({ text: text.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/** A station's name is given on its first result only ("CIVC 7.1, Inland Civic", then "CIVC 7.1"). */
export function namedOnce(stationIds: string[]): boolean[] {
  const seen = new Set<string>();
  return stationIds.map((id) => (seen.has(id) ? false : (seen.add(id), true)));
}
