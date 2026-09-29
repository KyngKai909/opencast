// What the permission page says, worked out from the page's facts: the works in a line, what the
// creator makes, when their work airs, and which state the page is in.

import type { PermissionPageX } from "./api";

export const PLATFORMS: Record<string, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  internet_archive: "Internet Archive",
  instagram: "Instagram",
  facebook: "Facebook",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp"
};

export function plural(noun: string, n = 2): string {
  if (n === 1) return noun;
  return /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

type Works = PermissionPageX["works"];

/** What they mostly make: the noun with the most hours among the included works ("films"). */
export function mainNoun(works: Works): string {
  const hours = new Map<string, number>();
  for (const w of works.filter((x) => x.included)) hours.set(w.noun ?? "work", (hours.get(w.noun ?? "work") ?? 0) + (w.durationMs ?? 1));
  return plural([...hours.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "work");
}

/** "6 skate films and 7 park session edits"; the page's own summary (N4) when it has one. */
export function worksLine(page: Pick<PermissionPageX, "works" | "summary">): { included: string; leftOut: string | null } {
  if (page.summary) return page.summary;
  // By group ("6 full-length skate films"); works with no group by what they are ("10 videos").
  const groups: Array<{ key: string; label: string; one: string; n: number }> = [];
  for (const w of page.works.filter((x) => x.included)) {
    const key = w.groupLabel ? `g:${w.groupLabel}` : w.noun ? `n:${w.noun}` : `w:${w.id}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.n++;
    else groups.push({ key, label: w.groupLabel ?? (w.noun ? plural(w.noun) : w.title), one: w.title, n: 1 });
  }
  const parts = groups.map((g) => (g.n === 1 ? g.one : `${g.n} ${g.label.charAt(0).toLowerCase()}${g.label.slice(1)}`));
  const included = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "No works");
  const out = page.works.filter((x) => !x.included);
  const leftOut = out.length === 0 ? null : out.length === 1 ? `the ${out[0]!.title.charAt(0).toLowerCase()}${out[0]!.title.slice(1)}` : `${out.length} others`;
  return { included, leftOut };
}

/** "in the evenings" when most of their preview airs from 5 pm; "through the day" otherwise. */
export function whenLine(page: Pick<PermissionPageX, "schedulePreview">): string {
  const theirs = page.schedulePreview.filter((r) => r.source === "creator");
  if (!theirs.length) return "in the evenings";
  const late = theirs.filter((r) => Number(r.time.split(":")[0]) >= 17).length;
  return late * 2 >= theirs.length ? "in the evenings" : "through the day";
}

export type PageState = "unanswered" | "yes" | "no" | "stopped" | "claiming";

export function pageState(page: Pick<PermissionPageX, "answer" | "stoppedAt" | "claim">): PageState {
  if (page.stoppedAt) return "stopped";
  if (!page.answer) return "unanswered";
  if (page.answer.answer === "no") return "no";
  if (page.claim && page.claim.status !== "cancelled") return "claiming";
  return "yes";
}
