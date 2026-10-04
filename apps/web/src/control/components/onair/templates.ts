// Day templates (G8) in master control's words: the four choices as the frame draws them (Every
// Saturday, Weekdays, Every day, Once), and what a write made. A246 (Phase 4): the Templates tab's
// cards (how one repeats, its dates ahead, which template wins a date and the precedence note),
// what saving one does (dates rebuilt, edited dates kept), and "Reset to template".

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

/** "3 dates ahead, 1 edited". */
export function datesText(t: Pick<DayTemplate, "dates">): string {
  const n = t.dates.length;
  const edited = t.dates.filter((d) => d.edited).length;
  const ahead = n === 0 ? "No dates ahead" : `${n} ${n === 1 ? "date" : "dates"} ahead`;
  return edited ? `${ahead}, ${edited} edited` : ahead;
}

export type LogRepeat = NonNullable<ProgramLog["repeats"]>[number];

/** A G7 copy's name: "Every Saturday", "Every day", "Once". */
export function copyName(r: LogRepeat): string {
  if (r.label) return r.label;
  if (r.pattern === "weekly") return `Every ${DAY_WORDS[new Date(`${r.day}T12:00:00Z`).getUTCDay()]}`;
  return r.pattern === "daily" ? "Every day" : "Once";
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

// ---- A246, Phase 4: the Templates tab (opencast-schedule 06) ----

const RANK: Record<RepeatPattern, number> = { once: 3, weekly: 2, weekdays: 1, daily: 0 };
const PLURAL_DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const weekdayOfDate = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDate = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "Oct 3": a date as the Templates tab says it. */
export function monthDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

type Covering = Pick<DayTemplate, "id" | "pattern" | "weekday" | "fromDay" | "onDate" | "until" | "createdAt">;

/** Whether a template covers a broadcast date, as the API decides (the day it's built from is the station's own). */
export function coversDate(t: Covering, date: string): boolean {
  if (t.pattern === "once") return date === t.onDate;
  if (date <= t.fromDay) return false;
  if (t.until && date > t.until) return false;
  const wd = weekdayOfDate(date);
  if (t.pattern === "weekdays") return wd >= 1 && wd <= 5;
  if (t.pattern === "weekly") return wd === t.weekday;
  return true;
}

/** The template that makes a date: the more specific wins (once, a weekday, weekdays, every day), the newest among equals. */
export function winnerOn<T extends Covering>(templates: T[], date: string): T | null {
  return [...templates].filter((t) => coversDate(t, date)).sort((a, b) => RANK[b.pattern] - RANK[a.pattern] || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * "Overrides Saturdays that day" (06's precedence note): the templates this one wins over on dates
 * both cover in the next three weeks (from `from`, tomorrow). Null when it overrides none.
 */
export function precedenceNote(t: Covering & Pick<DayTemplate, "name" | "label">, all: Array<Covering & Pick<DayTemplate, "name" | "label">>, from: string, days = 21): string | null {
  const beaten = new Set<string>();
  for (let i = 0; i < days; i++) {
    const date = addDate(from, i);
    if (!coversDate(t, date) || winnerOn(all, date)?.id !== t.id) continue;
    for (const o of all) if (o.id !== t.id && coversDate(o, date)) beaten.add(o.id);
  }
  if (!beaten.size) return null;
  const names = all.filter((o) => beaten.has(o.id)).map(templateName);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  if (t.pattern === "once") return `Overrides ${list} that day`;
  if (t.pattern === "weekly") return `Overrides ${list} on ${PLURAL_DAYS[t.weekday ?? 0]}`;
  if (t.pattern === "weekdays") return `Overrides ${list} on weekdays`;
  return `Overrides ${list}`;
}

/** How a template repeats, in a card's words: "Every Saturday", "Monday to Friday", "Every day", "Once, Sat Oct 31". */
export function patternWords(t: Pick<DayTemplate, "pattern" | "weekday" | "label">): string {
  if (t.pattern === "weekdays") return "Monday to Friday";
  if (t.pattern === "weekly") return `Every ${DAY_WORDS[t.weekday ?? 0]}`;
  if (t.pattern === "daily") return "Every day";
  return t.label;
}

/**
 * A template card's line (06): `"After work". Every Saturday from Sep 26. 3 dates ahead`, "Monday to
 * Friday. 15 dates ahead", "Once, Sat Oct 31. Overrides Saturdays that day".
 */
export function cardLine(t: DayTemplate, precedence: string | null): string {
  const named = !!t.name?.trim();
  if (t.pattern === "once") return [named ? t.label : null, precedence].filter(Boolean).join(". ") || datesText(t);
  const how = named || t.pattern === "weekdays" ? patternWords(t) : null;
  const from = `from ${monthDate(t.fromDay)}${t.until ? `, until ${monthDate(t.until)}` : ""}`;
  return [how ? `${how} ${from}` : from.replace(/^f/, "F"), datesText(t), precedence].filter(Boolean).join(". ");
}

/** What the dates a template makes are called: "Saturdays", "weekdays", "days", "Sat Oct 31". */
function datesNoun(t: Pick<DayTemplate, "pattern" | "weekday" | "label">, n: number): string {
  if (t.pattern === "weekly") return n === 1 ? DAY_WORDS[t.weekday ?? 0] : PLURAL_DAYS[t.weekday ?? 0];
  if (t.pattern === "weekdays") return n === 1 ? "weekday" : "weekdays";
  return n === 1 ? "day" : "days";
}

const listDates = (dates: string[]) => (dates.length > 1 ? `${dates.slice(0, -1).map(monthDate).join(", ")} and ${monthDate(dates[dates.length - 1])}` : monthDate(dates[0]));

/**
 * Decision 7: what saving a template does, before it's saved: "Saving changes here rebuilds 3
 * upcoming Saturdays. Oct 3, edited by hand, is kept as an exception."
 */
export function saveCounts(t: Pick<DayTemplate, "pattern" | "weekday" | "label" | "onDate" | "dates">): { rebuilt: number; kept: number; line: string } {
  const rebuilt = t.dates.filter((d) => !d.edited);
  const kept = t.dates.filter((d) => d.edited).map((d) => d.date);
  const first =
    t.pattern === "once"
      ? rebuilt.length
        ? `Saving changes here rebuilds ${shortDate(t.onDate ?? rebuilt[0].date)}.`
        : "Saving changes here rebuilds no dates."
      : rebuilt.length
        ? `Saving changes here rebuilds ${rebuilt.length} upcoming ${datesNoun(t, rebuilt.length)}.`
        : "Saving changes here rebuilds no dates yet.";
  const second = !kept.length ? "" : kept.length <= 3 ? ` ${listDates(kept)}, edited by hand, ${kept.length === 1 ? "is kept as an exception" : "are kept as exceptions"}.` : ` ${kept.length} dates edited by hand are kept as exceptions.`;
  return { rebuilt: rebuilt.length, kept: kept.length, line: first + second };
}

/**
 * After saving: "Template saved. 3 dates rebuilt; 1 edited date kept as an exception." The dates
 * made again (the API's count), and the template's own dates edited by hand.
 */
export function savedLine(rebuilt: number, kept: number): string {
  const made = `${rebuilt} ${rebuilt === 1 ? "date" : "dates"} rebuilt`;
  const left = kept ? `; ${kept} edited ${kept === 1 ? "date" : "dates"} kept as ${kept === 1 ? "an exception" : "exceptions"}` : "";
  return `Template saved. ${made}${left}.`;
}

/** After "Reset to template": "Sep 30 is back to After work: 2 programs back on, 1 taken off." */
export function resetLine(date: string, name: string, g: Pick<TemplateGeneration, "created" | "removed">): string {
  const parts = [g.created ? `${g.created} ${g.created === 1 ? "program" : "programs"} back on` : null, g.removed ? `${g.removed} taken off` : null].filter(Boolean);
  return `${monthDate(date)} is back to ${name}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/** The next broadcast date a template makes (its first date ahead), else the next it covers, else the day it was built from. */
export function referenceDate(t: Covering & Pick<DayTemplate, "dates">, today: string): string {
  if (t.dates[0]) return t.dates[0].date;
  for (let i = 1; i <= 21; i++) if (coversDate(t, addDate(today, i))) return addDate(today, i);
  return t.fromDay;
}
