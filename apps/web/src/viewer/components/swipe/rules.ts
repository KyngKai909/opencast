// The swipe home's smaller rules (swipe home 01, 03 and 08), kept out of the components so they can
// be tested: the position line, the detent's words, where Back to live sits and how far behind it
// says, which station the home opens on, and the presets' order.

import type { Boundary, OrderPlace, Status } from "@opencast/player";

type Band = "tv" | "radio";

/** "Preset 2 of 3", "Dial, 4 of 5"; on the radio band "Band, 3 of 4". */
export function placeText(p: OrderPlace | null, band: Band): string | null {
  if (!p) return null;
  if (p.kind === "preset") return `Preset ${p.n} of ${p.of}`;
  return `${band === "radio" ? "Band" : "Dial"}, ${p.n} of ${p.of}`;
}

/** What the detent says as the drag meets it (the reference's words). */
export function boundaryText(b: Boundary, o: { presets: number; total: number; band: Band }): { title: string; sub: string } {
  const dial = o.band === "radio" ? "band" : "dial";
  const allPresets = o.presets > 0 && o.presets === o.total;
  switch (b) {
    case "presets_end":
      return { title: "End of your presets", sub: o.band === "radio" ? "The band, by frequency" : "The dial, in channel order" };
    case "presets_start":
      return { title: "Back to your presets", sub: `Preset ${o.presets}` };
    case "wrap_end":
      if (allPresets) return { title: "End of your presets", sub: "Back to preset 1" };
      return { title: `End of the ${dial}`, sub: o.presets ? "Back to preset 1" : "Back to the start" };
    case "wrap_start":
      if (o.presets) return { title: "Start of your presets", sub: allPresets ? "To your last preset" : `To the end of the ${dial}` };
      return { title: `Start of the ${dial}`, sub: `To the end of the ${dial}` };
  }
}

/**
 * Back to live (swipe home 03, 08): whenever playback is behind the broadcast. While the banner is
 * up (paused, or just after resuming) it sits just above the banner; once the banner hides, just
 * above the floating bar. Changing channel joins live, so it goes.
 */
export type LivePlace = "above_banner" | "above_bar";

export function backToLivePlace(s: { behindLive: boolean; status: Status; pendingId: string | null }, bannerUp: boolean): LivePlace | null {
  if (s.pendingId) return null;
  if (!s.behindLive && s.status !== "paused") return null;
  if (s.status !== "playing" && s.status !== "paused") return null;
  return bannerUp ? "above_banner" : "above_bar";
}

/**
 * How far behind live: the time spent paused, added up (behind live is only ever caused by
 * pausing: there's no scrubbing on a live channel).
 */
export function behindMs(o: { before: number; pausedSince: number | null; now: number }): number {
  return Math.max(0, o.before + (o.pausedSince !== null ? o.now - o.pausedSince : 0));
}

/** "0:48 behind", "2:14 behind", "1:02:05 behind". */
export function behindText(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${ss} behind`;
}

/**
 * The station the home opens on: what's already playing; else, with "Start on: Last channel", the
 * last channel; else the start of the order (preset 1, or the dial's first), TV before radio.
 */
export function startStation(o: { playingId: string | null; startOn: "dial" | "last_channel" | undefined | null; lastId: string | null; tv: readonly string[]; radio: readonly string[] }): string | null {
  const known = (id: string | null): id is string => !!id && (o.tv.includes(id) || o.radio.includes(id));
  if (known(o.playingId)) return o.playingId;
  if (o.startOn === "last_channel" && known(o.lastId)) return o.lastId;
  return o.tv[0] ?? o.radio[0] ?? null;
}

/** Presets in preset order: keys 1 to 6, then the rest (More presets) as they're kept. */
export function presetIdsInOrder(presets: ReadonlyArray<{ key: number | null; position: number; station: { id: string } }>): string[] {
  const keyed = presets.filter((p) => p.key !== null).sort((a, b) => a.key! - b.key!);
  const more = presets.filter((p) => p.key === null).sort((a, b) => a.position - b.position);
  return [...keyed, ...more].map((p) => p.station.id);
}
