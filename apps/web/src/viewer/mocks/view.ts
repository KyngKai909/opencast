// Fixtures as contract shapes (with the viewer's proposed extensions, api/ext.ts).

import type { AiringX, DialRowX, StationIdentX } from "../api/ext";
import { now } from "../../lib/clock";
import { nowNext, toAiring, type MockAiring } from "./fixtures/schedule";
import { MARKETS, playbackFor, stationById, type MockStation } from "./fixtures/stations";
import { hiddenExternal } from "./external";

export function identX(s: MockStation): StationIdentX {
  return { ...s.ident, category: s.category };
}

export function airingX(x: MockAiring): AiringX {
  const a = toAiring(x);
  const from = a.carriedFrom ? stationById(a.carriedFrom.id) : undefined;
  return { ...a, note: x.note ?? null, episodeDescription: x.episodeDescription ?? null, carriedFrom: from ? identX(from) : null, listedAiringId: x.listed ? x.id : null };
}

export function dialRow(s: MockStation, t = now()): DialRowX {
  return rowOf(s, nowNext(s.ident.id, t));
}

/**
 * A dial row from what's on and next. Planned off air (G9) is its `off_air` airing as `now`, with
 * `onAir` false, no playback, and `backAt`; a gap between airings is off air with nothing said.
 */
export function rowOf(s: MockStation, nn: { now: MockAiring | null; next: MockAiring | null }): DialRowX {
  if (s.external) {
    // An external station (follow-up Phase 6) is on while its stream is up: what's on is the
    // source's own schedule, or nothing named (the banner says Live and the source).
    const up = !hiddenExternal(s.ident.id);
    return { station: identX(s), onAir: up, now: nn.now ? airingX(nn.now) : null, next: nn.next ? airingX(nn.next) : null, playback: up ? playbackFor(s) : null, external: s.external };
  }
  const planned = !!nn.now?.offAir;
  const onAir = !!nn.now && !planned;
  return {
    station: identX(s),
    onAir,
    now: nn.now ? airingX(nn.now) : null,
    next: nn.next ? airingX(nn.next) : null,
    playback: onAir ? playbackFor(s) : null,
    ...(planned ? { backAt: nn.now!.end } : {})
  };
}

export function marketOf(slug: string) {
  const m = MARKETS.find((x) => x.slug === slug);
  return m ? { id: m.id, slug: m.slug, name: m.name, timezone: m.timezone, open: m.open } : null;
}

/** Miles between two markets (for "Nearby: Inland Empire, 40 miles"). */
export function milesBetween(a: string, b: string): number {
  const A = MARKETS.find((m) => m.slug === a)!;
  const B = MARKETS.find((m) => m.slug === b)!;
  const R = 3959;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(B.lat - A.lat);
  const dLng = rad(B.lng - A.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
