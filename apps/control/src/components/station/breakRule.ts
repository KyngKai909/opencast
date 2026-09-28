// The arithmetic behind Settings, Breaks (station-settings 02.1): what fills every break, in
// order, with the station ID always last; how long each part runs; the hourly cap against TV.

import type { BreakRule, LogCode } from "@opencast/contracts";
import { duration } from "@opencast/ui";

/** The parts of a break a station can put in order. The station ID is always last. */
export type FillCode = "SPT" | "UND" | "BMP" | "SID";

/** How long the fixed parts run (the thank-you credit, a bumper, the station ID). */
export const FIXED_MS: Record<Exclude<FillCode, "SPT">, number> = { UND: 15_000, BMP: 10_000, SID: 5_000 };

export const FILL_WORDS: Record<FillCode, { title: string; detail: string }> = {
  SPT: { title: "Spots from your rotation", detail: "Up to the hourly cap" },
  UND: { title: "Thank-you credit", detail: "Members who asked to be named, then local sponsors. Made for you automatically" },
  BMP: { title: "A bumper", detail: "Fills any time left over" },
  SID: { title: "Station ID", detail: "Always last, can't be removed" }
};

/** Broadcast TV runs about 16 minutes of advertising an hour. */
export const TV_MINUTES_PER_HOUR = 16;

const FILLS: FillCode[] = ["SPT", "UND", "BMP", "SID"];

/** The order as the station set it, with every part once and the station ID last. */
export function fillOrder(order: readonly LogCode[]): FillCode[] {
  const known = order.filter((c): c is FillCode => (FILLS as string[]).includes(c) && c !== "SID");
  const unique = known.filter((c, i) => known.indexOf(c) === i);
  for (const c of FILLS) if (c !== "SID" && !unique.includes(c)) unique.push(c);
  return [...unique, "SID"];
}

/** Moves a part up (-1) or down (+1). The station ID doesn't move, and nothing passes it. */
export function moveFill(order: readonly LogCode[], code: FillCode, delta: -1 | 1): FillCode[] {
  const list = fillOrder(order);
  if (code === "SID") return list;
  const at = list.indexOf(code);
  const to = at + delta;
  if (to < 0 || to >= list.length - 1) return list;
  const next = [...list];
  next.splice(at, 1);
  next.splice(to, 0, code);
  return next;
}

/** Puts a part at an index (dragging), keeping the station ID last. */
export function placeFill(order: readonly LogCode[], code: FillCode, index: number): FillCode[] {
  const list = fillOrder(order);
  if (code === "SID") return list;
  const rest = list.filter((c) => c !== code && c !== "SID");
  const i = Math.max(0, Math.min(index, rest.length));
  rest.splice(i, 0, code);
  return [...rest, "SID"];
}

/** Spot time in one break: whatever the fixed parts leave of its length. */
export function spotMsPerBreak(rule: Pick<BreakRule, "lengthMs" | "fillOrder">): number {
  const fixed = fillOrder(rule.fillOrder).reduce((a, c) => a + (c === "SPT" ? 0 : FIXED_MS[c]), 0);
  return Math.max(0, rule.lengthMs - fixed);
}

/** The ladder's rows: number, code, words and time ("0:00 – 1:30", ":15"). */
export function ladder(rule: Pick<BreakRule, "lengthMs" | "fillOrder">) {
  return fillOrder(rule.fillOrder).map((code, i) => ({
    n: i + 1,
    code,
    ...FILL_WORDS[code],
    time: code === "SPT" ? `0:00 – ${duration(spotMsPerBreak(rule))}` : duration(FIXED_MS[code])
  }));
}

/**
 * The ladder with "Ads from partners" (station-settings 02.1): a backfill for time still open,
 * placed after the rotation, backups and thank-you credit and before the bumpers and station ID
 * (the platform prompt fixes its place, so it can't be dragged). Up to half the break.
 */
export type LadderRow = ReturnType<typeof ladder>[number] & { partner?: boolean; fillIndex: number | null };

export function ladderWithPartners(rule: Pick<BreakRule, "lengthMs" | "fillOrder" | "adsFromPartners">): LadderRow[] {
  const rows: LadderRow[] = ladder(rule).map((r, i) => ({ ...r, fillIndex: i }));
  const at = rows.findIndex((r) => r.code === "BMP" || r.code === "SID");
  const partner: LadderRow = {
    n: 0,
    code: "SPT",
    title: "Ads from partners",
    detail: `${rule.adsFromPartners ? "On" : "Off"}. Only time still open`,
    time: `0:00 – ${duration(Math.round(rule.lengthMs / 2 / 1000) * 1000)}`,
    partner: true,
    fillIndex: null
  };
  rows.splice(at < 0 ? rows.length : at, 0, partner);
  return rows.map((r, i) => ({ ...r, n: i + 1 }));
}

/** The cap meter: one cell a minute up to broadcast TV's 16; the station's minutes filled. */
export function capCells(spotMsPerHour: number): boolean[] {
  const filled = Math.round(spotMsPerHour / 60_000);
  return Array.from({ length: TV_MINUTES_PER_HOUR }, (_, i) => i < filled);
}

/** "3", "2.5": the station's minutes an hour, as the cap line says it. */
export function capMinutes(spotMsPerHour: number): string {
  const m = spotMsPerHour / 60_000;
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

/** The break rule's label: "After every program", "Every 30 min", "None". */
export function ruleLabel(mode: BreakRule["mode"], everyMinutes: number | null): string {
  if (mode === "after_every_program") return "After every program";
  if (mode === "every_n_minutes") return `Every ${everyMinutes ?? 30} min`;
  return "None";
}
