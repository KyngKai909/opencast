// The dial's order and neighbours. Up and down move through the stations in channel order, the
// same every time, wrapping at the ends; the band decides the neighbours (radio never flips into
// a TV station).

import type { Channel } from "./types";

export function channelNumber(c: Channel): string | null {
  return c.station.channel;
}

/** Sorts by channel number (7.1 < 9.1 < 12.1 < 88.3), stations without a channel last. */
export function inChannelOrder(channels: Channel[]): Channel[] {
  const key = (c: Channel) => {
    const [maj, min] = (c.station.channel ?? "9999.9").split(".").map(Number);
    return maj * 100 + (min || 0);
  };
  return [...channels].sort((a, b) => key(a) - key(b));
}

export interface NeighbourOptions {
  /** Skip city streams Opencast lists but doesn't restream (their own player can't be driven). */
  skipListed?: boolean;
  /** Keep to the current station's band (the default). */
  sameBand?: boolean;
}

function eligible(c: Channel, current: Channel | undefined, o: NeighbourOptions): boolean {
  if (o.skipListed && c.playback?.kind === "embed") return false;
  if ((o.sameBand ?? true) && current && c.station.band && current.station.band && c.station.band !== current.station.band) return false;
  return true;
}

/** The station one step up or down the dial from `currentId`, wrapping at the ends. */
export function neighbour(channels: Channel[], currentId: string | null, dir: "up" | "down", o: NeighbourOptions = {}): Channel | null {
  const list = inChannelOrder(channels);
  if (!list.length) return null;
  const current = list.find((c) => c.station.id === currentId);
  const pool = list.filter((c) => c.station.id === currentId || eligible(c, current, o));
  if (!current) return pool[0] ?? null;
  const i = pool.findIndex((c) => c.station.id === currentId);
  const step = dir === "up" ? 1 : -1;
  const next = pool[(i + step + pool.length) % pool.length];
  return next.station.id === currentId ? null : next;
}

/** Both neighbours, for pre-warming: [down, up], without duplicates or the station itself. */
export function neighbours(channels: Channel[], currentId: string | null, o: NeighbourOptions = {}): Channel[] {
  const down = neighbour(channels, currentId, "down", o);
  const up = neighbour(channels, currentId, "up", o);
  const out: Channel[] = [];
  for (const c of [down, up]) if (c && !out.some((x) => x.station.id === c.station.id)) out.push(c);
  return out;
}

export function findByChannel(channels: Channel[], channel: string): Channel | undefined {
  return channels.find((c) => c.station.channel === channel);
}
