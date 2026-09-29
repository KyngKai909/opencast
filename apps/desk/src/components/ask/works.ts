// A creator's works as the ask draws them: grouped ("Full-length skate films, 6 films, 4 hr 10 min
// in total"), each group or single work ticked or left out, and the words that follow from them.

import type { CreatorWorkX, RecipeX } from "../../api/ext";
import { hoursMinutes } from "../../lib/dates";

export interface WorkGroup {
  key: string;
  title: string;
  works: CreatorWorkX[];
  /** A single work, not a group. */
  single: boolean;
}

/** Groups in the order their first work appears; a work with no group is its own row. */
export function groupWorks(works: readonly CreatorWorkX[]): WorkGroup[] {
  const groups: WorkGroup[] = [];
  for (const w of works) {
    const g = w.groupLabel ? groups.find((x) => !x.single && x.title === w.groupLabel) : undefined;
    if (g) g.works.push(w);
    else groups.push({ key: w.groupLabel ? `g:${w.groupLabel}` : `w:${w.id}`, title: w.groupLabel ?? w.title, works: [w], single: !w.groupLabel });
  }
  return groups;
}

/** "film" → "films", "mix" → "mixes". */
export function plural(noun: string, n = 2): string {
  if (n === 1) return noun;
  return /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

export function totalMs(works: readonly Pick<CreatorWorkX, "durationMs">[]): number {
  return works.reduce((s, w) => s + (w.durationMs ?? 0), 0);
}

/** A group's second line: "6 films, 4 hr 10 min in total", "7 shorts, 58 min"; a single work's length or why it's left out. */
export function groupDetail(g: WorkGroup, included: boolean): string {
  if (g.single) {
    const w = g.works[0]!;
    if (!included && w.leftOutReason) return `${w.leftOutReason}. Left out`;
    return w.durationMs ? hoursMinutes(w.durationMs) : "Length not known";
  }
  const ms = totalMs(g.works);
  const noun = g.works[0]?.noun ?? "work";
  return `${g.works.length} ${plural(noun, g.works.length)}, ${hoursMinutes(ms)}${ms >= 3_600_000 ? " in total" : ""}`;
}

/** What the creator mostly makes: the noun of the group with the most hours ("films"). */
export function mainNoun(works: readonly CreatorWorkX[]): string {
  const byNoun = new Map<string, number>();
  for (const w of works) byNoun.set(w.noun ?? "work", (byNoun.get(w.noun ?? "work") ?? 0) + (w.durationMs ?? 0));
  const best = [...byNoun.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "work";
  return plural(best);
}

/**
 * The works in the order tonight's schedule plays them: one from each group in turn (a film, then a
 * short), so the preview shows the mix.
 */
export function interleave(works: readonly CreatorWorkX[]): CreatorWorkX[] {
  const groups = groupWorks(works).map((g) => [...g.works]);
  const out: CreatorWorkX[] = [];
  while (groups.some((g) => g.length)) for (const g of groups) if (g.length) out.push(g.shift()!);
  return out;
}

const WORDS: Record<string, string[]> = {
  cooking: ["cooking", "kitchen", "food", "recipe"],
  films: ["film", "films", "video", "skate", "short"],
  music: ["music", "mix", "mixes", "fiddle", "mariachi", "songs", "producer"],
  faith: ["gospel", "choir", "choirs", "church", "service", "services", "faith"],
  community: ["community", "stories", "history", "histories"]
};

/** The recipe that fits a creator best: its band, then words its category shares with what they make. */
export function pickRecipe(recipes: readonly RecipeX[], band: "tv" | "radio" | null, about: string): RecipeX | undefined {
  const text = about.toLowerCase();
  const pool = recipes.filter((r) => !band || r.band === band);
  let best: RecipeX | undefined;
  let bestScore = -1;
  for (const r of pool) {
    const keys = r.category.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const words = keys.flatMap((k) => WORDS[k] ?? [k]);
    const score = words.filter((w) => new RegExp(`\\b${w}`).test(text)).length;
    if (score > bestScore) (best = r), (bestScore = score);
  }
  return best;
}
