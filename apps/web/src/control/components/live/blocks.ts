// A244: programming blocks' words in master control (no frame draws them; the rows and words follow
// the library's own and Settings, Breaks). The Blocks page, the block editor, the log's block pane
// and the Monitor's chip read them from here.

import type { BlockSpan, BumperRole, ProgramBlock } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MIN = 60_000;

/** ":06", "1:30": a short length, as the rundown says it. */
export function lengthWords(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${total >= 60 ? Math.floor(total / 60) : ""}:${String(total % 60).padStart(2, "0")}`;
}

/** "Sat Oct 10", in the station's time zone. */
export function dayWords(iso: string, tz = STATION_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso)).replace(",", "");
}

/** "Next Sat Oct 10", or null. */
export function nextWords(b: Pick<ProgramBlock, "schedule">, tz = STATION_TZ): string | null {
  return b.schedule.next ? `Next ${dayWords(b.schedule.next, tz)}` : null;
}

/** What the block's intro (or outro) is: its own, or the automatic card. */
export function partLine(b: Pick<ProgramBlock, "items" | "intro" | "outro">, part: "intro" | "outro"): string {
  if (!(part === "intro" ? b.intro : b.outro)) return part === "intro" ? "No intro." : "No outro.";
  const own = part === "intro" ? b.items.intro : b.items.outro;
  if (own.length) return `Uses: ${own.map((i) => `${i.title}${i.durationMs ? ` (${lengthWords(i.durationMs)})` : ""}`).join(", ")}`;
  return `No ${part} of its own yet, so a :05 card with the block's name and logo`;
}

/** The block's ID: its own, or the station's. */
export function idLine(b: Pick<ProgramBlock, "items">): string {
  return b.items.id.length ? `Uses: ${b.items.id.map((i) => `${i.title}${i.durationMs ? ` (${lengthWords(i.durationMs)})` : ""}`).join(", ")}` : "No ID of its own, so your station ID airs.";
}

export const BLOCK_ROLE_WORDS: Record<BumperRole, string> = { into_break: "Into a break", out_of_break: "Out of a break", up_next: "Up next", any: "Any" };

/** "2 in this block", or where the block's role comes from without one. */
export function blockRoleSupply(b: Pick<ProgramBlock, "items">, role: BumperRole, callSign: string): string {
  const n = b.items.bumpers[role] ?? 0;
  if (n) return `${n} in this block`;
  if (role === "up_next") return `None yet, so ${callSign}'s up next airs`;
  if ((role === "into_break" || role === "out_of_break") && (b.items.bumpers.any ?? 0) > 0) return "None yet, so its Any bumper airs";
  return `None yet, so ${callSign}'s airs`;
}

/** "3 programs, 9:00 pm to 1:10 am" (where a span airs), or "Nothing in it yet". */
export function spanSummary(span: Pick<BlockSpan, "entryIds" | "airsFrom" | "airsUntil">, tz = STATION_TZ): string {
  if (!span.entryIds.length || !span.airsFrom || !span.airsUntil) return "Nothing in it yet";
  const n = span.entryIds.length;
  return `${n} ${n === 1 ? "program" : "programs"}, ${clock(span.airsFrom, { timeZone: tz })} to ${clock(span.airsUntil, { timeZone: tz })}`;
}

/** "Late Crate Nights · until 1:00 am": the Monitor's chip. */
export function untilWords(b: { name: string; endsAt: string }, tz = STATION_TZ): string {
  return `${b.name} · until ${clock(b.endsAt, { timeZone: tz })}`;
}

/** "Late Crate Nights starts at 9:00 pm": the preview card's line. */
export function startsWords(b: { name: string; startsAt: string }, tz = STATION_TZ): string {
  return `${b.name} starts at ${clock(b.startsAt, { timeZone: tz })}`;
}

/** Where a block is on the log, in lines: "Every Saturday, 9:00 pm to 1:00 am (from the template After dark)", then one-off dates. */
export function onLogLines(b: Pick<ProgramBlock, "onLog">, tz = STATION_TZ): Array<{ text: string; date: string | null }> {
  const out: Array<{ text: string; date: string | null }> = [];
  const clockOfMinute = (hhmm: string, plusMs = 0) => {
    const [h, m] = hhmm.split(":").map(Number);
    const total = (h * 60 + m + Math.round(plusMs / MIN)) % 1440;
    const hh = Math.floor(total / 60);
    return `${((hh + 11) % 12) + 1}:${String(total % 60).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
  };
  for (const t of b.onLog?.templates ?? []) out.push({ text: `${t.label}, ${clockOfMinute(t.startTime)} to ${clockOfMinute(t.startTime, t.lengthMs)} (from the template ${t.name ?? t.label})`, date: null });
  for (const d of (b.onLog?.dates ?? []).filter((x) => !x.templateId)) {
    const day = DAYS[new Date(new Date(d.startsAt).toLocaleString("en-US", { timeZone: tz })).getDay()];
    out.push({ text: `${day} ${dayWords(d.startsAt, tz).slice(4)}, ${clock(d.startsAt, { timeZone: tz })} to ${clock(d.endsAt, { timeZone: tz })}`, date: d.startsAt });
  }
  return out;
}
