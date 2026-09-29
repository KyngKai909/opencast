// A recipe's day, as the setup page draws it: 24 hours from 6 am, the hours each source fills,
// the break rule in words, and tonight's schedule built from titles and lengths only (the message
// preview in Ask: no files are copied before the yes).

import type { BreakRuleX, CreatorWorkX, RecipeBlockX, RecipeX } from "../../api/ext";
import { BreakRuleX as BreakRuleSchema } from "../../api/ext";

/** Minutes after midnight for "HH:MM"; "24:00" and "00:00" as an end both mean midnight. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A block's length in minutes, wrapping past midnight ("22:00" to "02:00" is 240). */
export function blockMinutes(b: Pick<RecipeBlockX, "start" | "end">): number {
  const s = minutesOf(b.start);
  let e = minutesOf(b.end);
  if (e <= s) e += 24 * 60;
  return e - s;
}

export interface DaySegment {
  block: RecipeBlockX;
  /** Minutes after the day bar's start (6 am). */
  from: number;
  minutes: number;
}

/** The recipe's blocks in order from `startHour` (6 am on the frame's bar). */
export function daySegments(recipe: Pick<RecipeX, "blocks">, startHour = 6): DaySegment[] {
  const origin = startHour * 60;
  return recipe.blocks
    .map((block) => ({ block, from: (minutesOf(block.start) - origin + 24 * 60) % (24 * 60), minutes: blockMinutes(block) }))
    .sort((a, b) => a.from - b.from);
}

export interface HoursBySource {
  /** The creator's own work, repeats included ("13 hr a day"). */
  creator: number;
  carried: number;
  /** The catalog, overnight included ("10 hr"). */
  catalog: number;
  total: number;
}

export function hoursBySource(recipe: Pick<RecipeX, "blocks">): HoursBySource {
  const h = { creator: 0, carried: 0, catalog: 0, total: 0 };
  for (const b of recipe.blocks) {
    const hours = blockMinutes(b) / 60;
    h.total += hours;
    if (b.source === "creator" || b.source === "repeats") h.creator += hours;
    else if (b.source === "carried") h.carried += hours;
    else h.catalog += hours;
  }
  return h;
}

/** "13 hr", "1 hr", "1.5 hr". */
export function hoursText(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
}

/** The break rule, parsed from the contract's loose record (N6). */
export function breakRuleOf(recipe: Pick<RecipeX, "breakRule">): BreakRuleX {
  const r = BreakRuleSchema.safeParse(recipe.breakRule);
  return r.success ? r.data : {};
}

/** "Every 30 min, 2:00, spots from the market, never alcohol". */
export function breakLine(rule: BreakRuleX): string {
  const parts: string[] = [];
  if (rule.everyMinutes) parts.push(`Every ${rule.everyMinutes} min`);
  if (rule.lengthMs) {
    const s = Math.round(rule.lengthMs / 1000);
    parts.push(s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `:${String(s).padStart(2, "0")}`);
  }
  if (rule.fillFrom) parts.push(rule.fillFrom === "market" ? "spots from the market" : "the house rotation");
  if (rule.blockedCategories?.length) parts.push(`never ${rule.blockedCategories.join(" or ")}`);
  return parts.join(", ") || "The market's usual breaks";
}

/** A block's words on the day bar. `{creator}` is the creator's short name ("Lupe"). */
export function blockLabel(b: RecipeBlockX, creatorShort: string): string {
  const fallback = { creator: creatorShort, repeats: `${creatorShort}, repeats`, catalog: "Catalog", overnight: "Catalog, overnight", carried: b.carried?.station.callSign ?? "Carried" }[b.source];
  return (b.label ?? fallback).replaceAll("{creator}", creatorShort);
}

export interface PreviewRow {
  /** Minutes after midnight. */
  at: number;
  title: string;
  source: "creator" | "catalog" | "carried" | "repeats";
}

/**
 * Tonight, if they say yes: from the first creator block that starts at 6 pm or later (else the
 * first creator block), the included works in order by their lengths, then the next block as one
 * line. Titles and lengths only.
 */
export function tonightSchedule(recipe: Pick<RecipeX, "blocks">, works: ReadonlyArray<Pick<CreatorWorkX, "title" | "durationMs">>, limit = 3): PreviewRow[] {
  const ordered = [...recipe.blocks].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  const creatorBlocks = ordered.filter((b) => b.source === "creator");
  const first = creatorBlocks.find((b) => minutesOf(b.start) >= 18 * 60) ?? creatorBlocks[0];
  if (!first || !works.length) return [];
  const rows: PreviewRow[] = [];
  let at = minutesOf(first.start);
  const end = at + blockMinutes(first);
  for (const w of works) {
    if (at >= end || rows.length >= limit) break;
    rows.push({ at, title: w.title, source: "creator" });
    at += Math.max(1, Math.round((w.durationMs ?? 30 * 60_000) / 60_000));
  }
  if (rows.length < limit) {
    const at2 = end % (24 * 60);
    const next = ordered.find((b) => minutesOf(b.start) === at2);
    if (next && next.source !== "creator") {
      const source = next.source === "overnight" ? "catalog" : next.source;
      rows.push({ at: end, title: next.listing ?? (source === "catalog" ? "From the Opencast catalog" : source === "carried" ? `${next.carried?.programTitle ?? "A local program"}, carried` : "Repeats"), source });
    }
  }
  return rows;
}

/** "7:00 pm" for minutes after midnight. */
export function clockOfMinutes(m: number): string {
  const mins = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}
