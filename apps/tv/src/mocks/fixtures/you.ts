// The You file's illustration data (viewer/opencast-you.html): Kai M.'s TVs, pledges and receipts,
// and the open channels "Run a station" counts. Used by the mock API only.

import { inMarket, uid } from "./stations";

/** Receipts for a pledge: one per charge, on the pledge's day of the month, up to `until`. */
export function receiptsFor(p: { id: string; cadence: "monthly" | "once"; amountMicros: number; startedAt: string; endsAfter: string | null }, until: Date) {
  const start = new Date(p.startedAt);
  const out: Array<{ id: string; on: string; amountMicros: number; url: string | null }> = [];
  const seed = parseInt(p.id.slice(-6), 10) * 100;
  for (let i = 0; ; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, start.getUTCDate(), 19));
    if (d > until || (p.endsAfter && d.toISOString().slice(0, 10) > p.endsAfter)) break;
    out.push({ id: uid(seed + i), on: d.toISOString().slice(0, 10), amountMicros: p.amountMicros, url: null });
    if (p.cadence === "once") break;
  }
  return out.reverse();
}

/** The next charge: the pledge's day of the month, after now. */
export function nextChargeFor(p: { cadence: "monthly" | "once"; startedAt: string; endsAfter: string | null }, now: Date): string | null {
  if (p.cadence !== "monthly" || p.endsAfter) return null;
  const day = new Date(p.startedAt).getUTCDate();
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 19));
  if (d <= now) d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, 19));
  return d.toISOString().slice(0, 10);
}

/**
 * Open channels in a market: "12 channels are open on the Inland Empire TV band, and 30 on the
 * radio band". Channels in use by the market's stations are taken; one is held.
 */
export function channelsFor(marketSlug: string, band: "tv" | "radio") {
  const used = new Set(inMarket(marketSlug, band).map((s) => s.ident.channel));
  if (band === "tv") {
    const open = new Set([3, 4, 5, 8, 10, 11, 14, 15, 16, 20, 22, 27]);
    return Array.from({ length: 35 }, (_, i) => i + 2).map((n) => {
      const channel = `${n}.1`;
      return { channel, state: used.has(channel) ? ("taken" as const) : n === 13 ? ("held" as const) : open.has(n) ? ("open" as const) : ("taken" as const) };
    });
  }
  // FM: 88.1 to 107.9 in 0.2 steps. Most are licensed stations; every third free one is open, up to 30.
  let opened = 0;
  return Array.from({ length: 100 }, (_, i) => {
    const tenths = 881 + i * 2;
    const channel = `${Math.floor(tenths / 10)}.${tenths % 10}`;
    const open = !used.has(channel) && i % 3 === 0 && opened < 30;
    if (open) opened++;
    return { channel, state: open ? ("open" as const) : ("taken" as const) };
  });
}
