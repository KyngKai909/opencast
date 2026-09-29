// What the channel's playlist says is on screen at a moment: the DATERANGE tags (read with the
// contract's parser and checked against its attribute schemas), timed against the media's
// program date-time. The player draws the bug, lower thirds and codes from this; nothing is
// burned into the picture (platform prompt, Phase 5: prepare once, then assemble).

import { HLS_CLASS, HlsBreak, HlsBug, HlsCode, HlsItem, HlsLive, HlsLowerThird, HlsSignOff, type HlsDateRange } from "@opencast/contracts";

/** A code without an end shows for this long (the contract's default, "the last 10 s"). */
export const CODE_SECONDS = 10;
/** Ranges that ended this long before the picture on screen are forgotten. */
const KEEP_ENDED_MS = 5 * 60_000;

/** A schema's parsed shape (without importing zod here). */
type Parsed<S> = S extends { parse(x: unknown): infer O } ? O : never;
type Schema<O> = { safeParse(x: unknown): { success: true; data: O } | { success: false } };
type Of<S> = Parsed<S> & { id: string };

export interface OnScreen {
  /** The item airing (program, spot, underwriting, bumper or station ID). */
  item: Of<typeof HlsItem> | null;
  /** In a break, with its SCTE-35 cues. */
  inBreak: (Of<typeof HlsBreak> & { scte35Out: string | null; scte35In: string | null }) | null;
  /** A live block. */
  live: Of<typeof HlsLive> | null;
  bug: Of<typeof HlsBug> | null;
  lowerThird: Of<typeof HlsLowerThird> | null;
  /** A spot's code and QR, until `until` (ms, program date-time). */
  code: (Of<typeof HlsCode> & { until: number }) | null;
}

export const NOTHING_ON_SCREEN: OnScreen = { item: null, inBreak: null, live: null, bug: null, lowerThird: null, code: null };

/** Folds a playlist's ranges into what's known: a range repeated with the same ID adds to it (SCTE35-IN, END-DATE). */
export function mergeRanges(known: Map<string, HlsDateRange>, incoming: HlsDateRange[], at: number | null): Map<string, HlsDateRange> {
  const out = new Map(known);
  for (const r of incoming) {
    const old = out.get(r.id);
    out.set(
      r.id,
      old
        ? { ...old, ...r, end: r.end ?? old.end, scte35Out: r.scte35Out ?? old.scte35Out, scte35In: r.scte35In ?? old.scte35In, attributes: { ...old.attributes, ...r.attributes } }
        : r
    );
  }
  if (at !== null) for (const [id, r] of out) if (r.end !== null && r.end < at - KEEP_ENDED_MS) out.delete(id);
  return out;
}

/** Whether a range covers the moment. A range without an end runs until the next one of its class starts. */
function covers(r: HlsDateRange, at: number, all: HlsDateRange[]): boolean {
  if (at < r.start) return false;
  if (r.end !== null) return at < r.end;
  const next = all.filter((o) => o.class === r.class && o.start > r.start).reduce<number | null>((m, o) => (m === null || o.start < m ? o.start : m), null);
  return next === null || at < next;
}

/** The latest-starting valid range of a class covering the moment, with its attributes parsed. */
function pick<O>(all: HlsDateRange[], cls: string, schema: Schema<O>, at: number, covering = covers): { range: HlsDateRange; value: O } | null {
  let best: { range: HlsDateRange; value: O } | null = null;
  for (const r of all) {
    if (r.class !== cls || !covering(r, at, all)) continue;
    const parsed = schema.safeParse(r.attributes);
    if (!parsed.success) continue;
    if (!best || r.start >= best.range.start) best = { range: r, value: parsed.data };
  }
  return best;
}

/** A code shows over its range; one without an end shows for CODE_SECONDS from its start. */
const codeCovers = (r: HlsDateRange, at: number) => at >= r.start && at < (r.end ?? r.start + CODE_SECONDS * 1000);

/** What's on screen at a program date-time (ms since the epoch). */
export function onScreenAt(ranges: Iterable<HlsDateRange>, at: number | null): OnScreen {
  if (at === null) return NOTHING_ON_SCREEN;
  const all = [...ranges];
  const item = pick(all, HLS_CLASS.item, HlsItem, at);
  const brk = pick(all, HLS_CLASS.break, HlsBreak, at);
  const live = pick(all, HLS_CLASS.live, HlsLive, at);
  const bug = pick(all, HLS_CLASS.bug, HlsBug, at);
  const l3 = pick(all, HLS_CLASS.lowerThird, HlsLowerThird, at);
  const code = pick(all, HLS_CLASS.code, HlsCode, at, codeCovers);
  return {
    item: item && { id: item.range.id, ...item.value },
    inBreak: brk && { id: brk.range.id, ...brk.value, scte35Out: brk.range.scte35Out, scte35In: brk.range.scte35In },
    live: live && { id: live.range.id, ...live.value },
    bug: bug && { id: bug.range.id, ...bug.value },
    lowerThird: l3 && { id: l3.range.id, ...l3.value },
    code: code && { id: code.range.id, ...code.value, until: code.range.end ?? code.range.start + CODE_SECONDS * 1000 }
  };
}

/** A key that changes when anything drawn or known changes (to patch state only then). */
export function onScreenKey(s: OnScreen): string {
  return [s.item?.id, s.inBreak?.id, s.live?.id, s.bug?.id, s.lowerThird?.id, s.code?.id].map((x) => x ?? "").join("|");
}

/** The planned sign-off in a playlist: the latest one, with when the station is back (ISO), if said. */
export function signOffIn(ranges: Iterable<HlsDateRange>): { id: string; backAt: string | null } | null {
  let best: HlsDateRange | null = null;
  for (const r of ranges) if (r.class === HLS_CLASS.signOff && (!best || r.start >= best.start)) best = r;
  if (!best) return null;
  const parsed = HlsSignOff.safeParse(best.attributes);
  return { id: best.id, backAt: parsed.success ? parsed.data.backAt : null };
}
