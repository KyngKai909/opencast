// The swipe's order (swipe home 08, "Order"): presets in preset order, then the rest of the band in
// channel order, skipping presets; after the last station it wraps back to preset 1. No presets: the
// dial alone. The radio band is the same, by frequency. The phone and tablet app's swipe, its guide
// and the player's channel up and down there all read it from here, so they never disagree. Nothing
// is ranked: the same swipe always lands on the same station.

import type { Channel } from "./types";
import { inChannelOrder } from "./dial";

export type Band = "tv" | "radio";

/** A band's order, by station id: presets first (the first `presets` ids), then the dial. */
export interface OrderIds {
  band: Band;
  ids: readonly string[];
  presets: number;
}

/** A band's order as rows. */
export interface SwipeOrder<T extends Channel = Channel> {
  band: Band;
  rows: T[];
  /** How many of `rows` are presets. */
  presets: number;
}

export function bandOf(c: Pick<Channel, "station">): Band {
  return c.station.band === "radio" ? "radio" : "tv";
}

/**
 * The order for one band: the presets on that band in preset order (`presetIds`, as the viewer
 * keeps them), then every other station on it in channel order.
 */
export function swipeOrder<T extends Channel>(channels: readonly T[], presetIds: readonly string[], band: Band): SwipeOrder<T> {
  const inBand = channels.filter((c) => bandOf(c) === band);
  const byId = new Map(inBand.map((c) => [c.station.id, c]));
  const taken = new Set<string>();
  const presets: T[] = [];
  for (const id of presetIds) {
    const c = byId.get(id);
    if (!c || taken.has(id)) continue;
    taken.add(id);
    presets.push(c);
  }
  const dial = (inChannelOrder(inBand) as T[]).filter((c) => !taken.has(c.station.id));
  return { band, rows: [...presets, ...dial], presets: presets.length };
}

export function orderIds(o: SwipeOrder): OrderIds {
  return { band: o.band, ids: o.rows.map((r) => r.station.id), presets: o.presets };
}

export type OrderDir = "next" | "prev";

/**
 * One step along the order from `currentId`, wrapping at the ends; `skip` leaves out stations this
 * device can't play (they stay tunable by number and the guide). Null when there's nowhere else to
 * go. From a station not in the order, next is its first station and previous its last.
 */
export function stepId(o: Pick<OrderIds, "ids">, currentId: string | null, dir: OrderDir, skip?: (id: string) => boolean): string | null {
  const ids = o.ids;
  const n = ids.length;
  if (!n) return null;
  const i = currentId ? ids.indexOf(currentId) : -1;
  const step = dir === "next" ? 1 : -1;
  let k = i < 0 ? (dir === "next" ? 0 : n - 1) : (i + step + n) % n;
  for (let tries = 0; tries < n; tries++, k = (k + step + n) % n) {
    const id = ids[k]!;
    if (id === currentId) return null;
    if (!skip?.(id)) return id;
  }
  return null;
}

/** Where a station sits: "Preset 2 of 3", or "Dial, 4 of 5" (the band's own words are the app's). */
export type OrderPlace = { kind: "preset" | "dial"; n: number; of: number };

export function orderPlace(o: Pick<OrderIds, "ids" | "presets">, id: string | null): OrderPlace | null {
  const i = id ? o.ids.indexOf(id) : -1;
  if (i < 0) return null;
  return i < o.presets ? { kind: "preset", n: i + 1, of: o.presets } : { kind: "dial", n: i - o.presets + 1, of: o.ids.length - o.presets };
}

/**
 * The detent (swipe home 08): crossing from the last preset into the dial (and back), and the wrap
 * at either end. Null for an ordinary step.
 */
export type Boundary = "presets_end" | "presets_start" | "wrap_end" | "wrap_start";

export function boundaryFrom(o: Pick<OrderIds, "ids" | "presets">, fromId: string | null, dir: OrderDir): Boundary | null {
  const n = o.ids.length;
  const i = fromId ? o.ids.indexOf(fromId) : -1;
  if (n < 2 || i < 0) return null;
  const p = o.presets;
  if (dir === "next") {
    if (i === n - 1) return "wrap_end";
    if (p > 0 && i === p - 1) return "presets_end";
    return null;
  }
  if (i === 0) return "wrap_start";
  if (p > 0 && i === p) return "presets_start";
  return null;
}

/**
 * What to keep ready (swipe home 08, "Preloading"): the next and previous station in the order, and
 * while in the presets the first station of the dial too.
 */
export function preloadIds(o: Pick<OrderIds, "ids" | "presets">, currentId: string | null, skip?: (id: string) => boolean): string[] {
  const out: string[] = [];
  const add = (id: string | null) => id && id !== currentId && !out.includes(id) && out.push(id);
  add(stepId(o, currentId, "next", skip));
  add(stepId(o, currentId, "prev", skip));
  const i = currentId ? o.ids.indexOf(currentId) : -1;
  if (i >= 0 && i < o.presets && o.presets < o.ids.length) {
    const first = o.ids.slice(o.presets).find((id) => !skip?.(id));
    add(first ?? null);
  }
  return out;
}
