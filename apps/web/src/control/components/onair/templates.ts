// "Repeat this day" as day templates (G8), in master control's words: the four choices as the
// frame draws them (Every Saturday, Weekdays, Every day, Once), which template made a date and
// whether that date was edited, a template's line in the list, and what a write made.

import type { DayTemplate, ProgramLog, RepeatPattern, TemplateGeneration } from "@opencast/contracts";
import { DAY_WORDS } from "./time";

export type { RepeatPattern };

/** The four choices, in the frame's order: "Every Saturday" is the day's own weekday. */
export function repeatOptions(weekday: number): Array<{ value: RepeatPattern; label: string }> {
  return [
    { value: "weekly", label: `Every ${DAY_WORDS[weekday]}` },
    { value: "weekdays", label: "Weekdays" },
    { value: "daily", label: "Every day" },
    { value: "once", label: "Once" }
  ];
}

/** A template by its name, else its label ("Every Saturday"). */
export function templateName(t: Pick<DayTemplate, "name" | "label">): string {
  return t.name?.trim() || t.label;
}

/** "Sat Oct 3", as the API writes a date in a label. */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(",", "");
}

/** The template a date was made from, and whether it was edited since (an exception). */
export function originOf(templates: DayTemplate[], date: string): { template: DayTemplate; edited: boolean } | null {
  for (const t of templates) {
    const d = t.dates.find((x) => x.date === date);
    if (d) return { template: t, edited: d.edited };
  }
  return null;
}

/** "3 dates ahead, 1 edited". */
export function datesText(t: Pick<DayTemplate, "dates">): string {
  const n = t.dates.length;
  const edited = t.dates.filter((d) => d.edited).length;
  const ahead = n === 0 ? "No dates ahead" : `${n} ${n === 1 ? "date" : "dates"} ahead`;
  return edited ? `${ahead}, ${edited} edited` : ahead;
}

/** A template's line in the list: "Built from Sat Sep 26, until Nov 21. 3 dates ahead, 1 edited." */
export function templateDetail(t: DayTemplate): string {
  const kind = t.name?.trim() ? `${t.label}. ` : "";
  const until = t.until && t.pattern !== "once" ? `, until ${shortDate(t.until)}` : "";
  return `${kind}Built from ${shortDate(t.fromDay)}${until}. ${datesText(t)}.`;
}

export type LogRepeat = NonNullable<ProgramLog["repeats"]>[number];

/** G7's one-time copies ("Repeat this day" before templates), still with entries to come. */
export function oldCopies(repeats: LogRepeat[] | undefined, templates: DayTemplate[]): LogRepeat[] {
  return (repeats ?? []).filter((r) => !r.template && !templates.some((t) => t.id === r.id));
}

/** A G7 copy's name: "Every Saturday", "Every day", "Once". */
export function copyName(r: LogRepeat): string {
  if (r.label) return r.label;
  if (r.pattern === "weekly") return `Every ${DAY_WORDS[new Date(`${r.day}T12:00:00Z`).getUTCDay()]}`;
  return r.pattern === "daily" ? "Every day" : "Once";
}

/** A G7 copy's line: "Copied from Sat Sep 26, until Nov 21. 12 entries to come." */
export function copyDetail(r: LogRepeat): string {
  const until = r.until ? `, until ${shortDate(r.until)}` : "";
  return `Copied from ${shortDate(r.day)}${until}. ${r.entries} ${r.entries === 1 ? "entry" : "entries"} to come.`;
}

/** What a template write made, as the result lists it. */
export function generationLines(g: TemplateGeneration): Array<{ label: string; value: string }> {
  const lines = [
    { label: "Dates made", value: String(g.dates) },
    { label: "Entries placed", value: String(g.created) },
    { label: "Skipped for conflicts", value: String(g.skippedForConflicts) }
  ];
  if (g.removed) lines.push({ label: "Taken off the log", value: String(g.removed) });
  if (g.exceptions) lines.push({ label: "Edited dates left as they are", value: String(g.exceptions) });
  return lines;
}
