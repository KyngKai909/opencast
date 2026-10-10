// A246 (Phase 4, opencast-schedule 07): the Blocks tab's words, worked out from what the API
// returns. A block's card (its schedule, what it has of its own, its next airing), what it airs part
// by part with where each falls back ("Uses BEAT's" only when the station really has one), where it
// airs (its templates, grouped where the times match, and one-off dates), and its look's preview.
//
// The fallback follows the API's chain (A244; `SequenceDecider.chain` in apps/api
// playout/engine/sequence.ts): a bumper is the block's for its role, then the block's Any (not for
// up next), then the station's role, then the station's Any (not for up next), each within its air
// window; the ID is the block's, then the station's, then the generated one; an intro or outro is
// the block's own, else a five-second card in its look.

import type { BumperRole, LibraryItem, ProgramBlock } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { broadcastDay, isoDate, localParts } from "../onair/time";
import { inWindow } from "./bumpers";

const DAY = 86_400_000;
const MIN = 60_000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const list = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? ""));

/** "Every Saturday" as a group of days: "Saturdays"; "Weekdays" and "Every day" stay. */
function daysOf(label: string): string {
  const m = /^Every (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/.exec(label.trim());
  return m ? PLURAL[DAYS.indexOf(m[1])] : label.trim();
}

/**
 * A card's schedule, as 07 draws it: "Fridays and Saturdays, 9:00 pm to 1:00 am" from the API's
 * label ("Every Friday, 9:00 pm to 1:00 am; Every Saturday, 9:00 pm to 1:00 am"), the days at the
 * same times together. A label that isn't a template's (a one-off date) stays as it is.
 */
export function scheduleWords(label: string | null): string | null {
  if (!label) return null;
  const groups = new Map<string, string[]>();
  for (const part of label.split("; ")) {
    const at = part.indexOf(", ");
    if (at < 0) return label;
    const time = part.slice(at + 2);
    groups.set(time, [...(groups.get(time) ?? []), daysOf(part.slice(0, at))]);
  }
  return [...groups].map(([time, days]) => `${list(days)}, ${time}`).join("; ");
}

/** What a block has of its own, for its card: "Its own look, bumpers and ID", "BEAT's bumpers and ID". */
export function ownWords(b: Pick<ProgramBlock, "colour" | "logoUrl" | "items" | "sequences">, callSign: string): string {
  const look = !!b.colour || !!b.logoUrl;
  const bumpers = Object.values(b.items.bumpers).some((n) => n > 0) || !!b.sequences;
  const id = b.items.id.length > 0;
  const own = [look && "look", bumpers && "bumpers", id && "ID"].filter((x): x is string => !!x);
  const theirs = [!bumpers && "bumpers", !id && "ID"].filter((x): x is string => !!x);
  if (!own.length) return `${callSign}'s bumpers and ID`;
  return `Its own ${list(own)}${theirs.length ? `. ${callSign}'s ${list(theirs)}` : ""}`;
}

/**
 * "Next: tonight at 9:00 pm", "Next: tomorrow at 6:00 am", "Next: Monday at 6:00 am", "Next: Sat
 * Oct 31 at 8:00 pm"; "On now, until 9:00 pm" while it's on. Null when it isn't on the log.
 */
export function nextAiring(next: string | null, now: number, until: string | null = null, tz = STATION_TZ): string | null {
  if (!next) return null;
  const at = Date.parse(next);
  if (at <= now) return until ? `On now, until ${clock(until, { timeZone: tz })}` : "On now";
  const time = clock(next, { timeZone: tz });
  const day = isoDate(broadcastDay(next, tz));
  const today = isoDate(broadcastDay(now, tz));
  const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
  if (days === 0) return `Next: ${localParts(next, tz).hour >= 17 || localParts(next, tz).hour < 6 ? "tonight" : "today"} at ${time}`;
  if (days === 1) return `Next: tomorrow at ${time}`;
  if (days < 7) return `Next: ${DAYS[localParts(next, tz).weekday]} at ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(next)).replace(",", "");
  return `Next: ${date} at ${time}`;
}

// ---- What it airs ----

/** A row of "What it airs". */
export type AirsPart = "intro" | "outro" | "id" | "into_break" | "out_of_break" | "up_next" | "any";

export interface AirsRow {
  part: AirsPart;
  /** The rundown's code: OPN, CLS, SID, BMP. */
  code: "OPN" | "CLS" | "SID" | "BMP";
  title: string;
  /** "Just before its first program. 2 in rotation", "4 of its own", "None of its own". */
  detail: string;
  /** How long it runs (its first item's, or the automatic card's), or null when nothing airs. */
  lengthMs: number | null;
  /** Where it falls back to, said on the row: "Uses BEAT's", "An automatic card airs"; null when it has its own. */
  fallback: string | null;
}

type Item = Pick<LibraryItem, "code" | "identCode" | "bumperRole" | "durationMs" | "status" | "rights" | "airs" | "programBlockId">;

/** The automatic intro or outro card, and the generated station ID, run five seconds. */
export const AUTOMATIC_MS = 5_000;

const ready = (i: Item) => i.status === "ready" && !!i.rights;
const bumpersOf = (items: Item[], role: BumperRole) => items.filter((i) => i.code === "BMP" && !i.identCode && (i.bumperRole ?? "any") === role);

/**
 * "What it airs", part by part: the block's own, or where it falls back (the API's chain). The
 * station's items count only where they can air now (ready, rights confirmed, inside their window).
 */
export function airsRows(b: Pick<ProgramBlock, "intro" | "outro">, own: Item[], station: Item[], callSign: string, at: Date): AirsRow[] {
  const stationReady = station.filter((i) => !i.programBlockId && ready(i) && inWindow(i.airs, at));
  const intros = own.filter((i) => i.identCode === "OPN");
  const outros = own.filter((i) => i.identCode === "CLS");
  const ids = own.filter((i) => i.code === "SID" && !i.identCode);
  const howMany = (n: number) => (n === 1 ? "1" : `${n} in rotation`);
  const first = (items: Item[]) => items.find((i) => i.durationMs)?.durationMs ?? null;
  const uses = `Uses ${callSign}'s`;

  const card = (part: "intro" | "outro", on: boolean, items: Item[]): AirsRow => {
    const where = part === "intro" ? "Just before its first program" : "Just after its last program";
    const title = part === "intro" ? "Intro" : "Outro";
    const code = part === "intro" ? "OPN" : "CLS";
    if (!on) return { part, code, title, detail: `Off. Nothing airs ${part === "intro" ? "before" : "after"} it`, lengthMs: null, fallback: null };
    if (items.length) return { part, code, title, detail: `${where}. ${howMany(items.length)}`, lengthMs: first(items), fallback: null };
    return { part, code, title, detail: `${where}. None of its own`, lengthMs: AUTOMATIC_MS, fallback: "An automatic card airs" };
  };

  const bumper = (role: Exclude<BumperRole, "any">, title: string): AirsRow => {
    const mine = bumpersOf(own, role);
    if (mine.length) return { part: role, code: "BMP", title, detail: `${mine.length} of its own`, lengthMs: first(mine), fallback: null };
    // Up next never falls back to an Any bumper.
    const anyOwn = role === "up_next" ? [] : bumpersOf(own, "any");
    if (anyOwn.length) return { part: role, code: "BMP", title, detail: "None of its own for this", lengthMs: first(anyOwn), fallback: "Uses its Any bumpers" };
    const theirs = [...bumpersOf(stationReady, role), ...(role === "up_next" ? [] : bumpersOf(stationReady, "any"))];
    if (theirs.length) return { part: role, code: "BMP", title, detail: "None of its own", lengthMs: first(theirs), fallback: uses };
    return { part: role, code: "BMP", title, detail: "None of its own", lengthMs: null, fallback: "Nothing airs here yet" };
  };

  const stationIds = stationReady.filter((i) => i.code === "SID" && !i.identCode);
  const rows: AirsRow[] = [
    card("intro", b.intro, intros),
    card("outro", b.outro, outros),
    ids.length
      ? { part: "id", code: "SID", title: "Block ID", detail: `Airs where the station ID would. ${howMany(ids.length)}`, lengthMs: first(ids), fallback: null }
      : { part: "id", code: "SID", title: "Block ID", detail: "Airs where the station ID would. None of its own", lengthMs: first(stationIds) ?? AUTOMATIC_MS, fallback: stationIds.length ? uses : "An automatic ID airs" },
    bumper("into_break", "Bumpers into the break"),
    bumper("out_of_break", "Bumpers out of the break"),
    bumper("up_next", "Up next")
  ];
  const any = bumpersOf(own, "any");
  if (any.length) rows.push({ part: "any", code: "BMP", title: "Any bumper", detail: `${any.length} of its own. Airs wherever a bumper is wanted`, lengthMs: first(any), fallback: null });
  return rows;
}

// ---- Where it airs ----

export interface WhereRow {
  key: string;
  title: string;
  detail: string;
  /** Where Open goes: a template, or the date on the Log. */
  href: string;
}

const clockOfMinute = (hhmm: string, plusMs = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + Math.round(plusMs / MIN)) % 1440;
  const hh = Math.floor(total / 60);
  return `${((hh + 11) % 12) + 1}:${String(total % 60).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
};

/**
 * "Where it airs" (07): its templates, those at the same times together ("Fridays and Saturdays
 * templates", "9:00 pm to 1:00 am. 6 dates ahead"), then its one-off dates ("Sat Oct 31", "Once,
 * 8:00 pm to 2:00 am"). Dates ahead are counted from `onLog.dates` (the API's first 20).
 */
export function whereRows(b: Pick<ProgramBlock, "onLog">, schedule: string, tz = STATION_TZ): WhereRow[] {
  const on = b.onLog;
  if (!on) return [];
  const groups = new Map<string, typeof on.templates>();
  for (const tpl of on.templates) groups.set(`${tpl.startTime}|${tpl.lengthMs}`, [...(groups.get(`${tpl.startTime}|${tpl.lengthMs}`) ?? []), tpl]);
  const rows: WhereRow[] = [...groups.values()].map((g) => {
    const names = g.map((tpl) => (tpl.name?.trim() ? tpl.name.trim() : daysOf(tpl.label)));
    const ahead = on.dates.filter((d) => d.templateId && g.some((tpl) => tpl.templateId === d.templateId)).length;
    const more = on.dates.length >= 20 && on.ahead > on.dates.length ? "+" : "";
    return {
      key: g.map((tpl) => tpl.templateId).join(","),
      title: `${list(names)} ${g.length === 1 ? "template" : "templates"}`,
      detail: `${clockOfMinute(g[0].startTime)} to ${clockOfMinute(g[0].startTime, g[0].lengthMs)}. ${ahead ? `${ahead}${more} ${ahead === 1 ? "date" : "dates"} ahead` : "No dates ahead yet"}`,
      href: `${schedule}/templates/${g[0].templateId}`
    };
  });
  for (const d of on.dates.filter((x) => !x.templateId)) {
    const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(d.startsAt)).replace(",", "");
    rows.push({ key: d.spanId, title: date, detail: `Once, ${clock(d.startsAt, { timeZone: tz })} to ${clock(d.endsAt, { timeZone: tz })}`, href: `${schedule}?day=${isoDate(broadcastDay(d.startsAt, tz))}&block=${d.spanId}` });
  }
  return rows;
}

/** "Made by BEAT. Offering blocks to other stations …" (07's syndication line), from `owner`, `carried` and `reskin`, read-only. */
export function madeByLine(b: Pick<ProgramBlock, "owner" | "carried" | "reskin">): string {
  const maker = b.owner.callSign ?? b.owner.name;
  if (b.carried) return `Made by ${maker}, carried here${b.reskin === "carrier_may_reskin" ? " in your look where it allows" : " in its look"}. The syndication market's screens come later.`;
  return `Made by ${maker}. Offering blocks to other stations, with your look or theirs, comes later with the syndication market.`;
}

/** "LCN": a block's initials for its mark (up to three words). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
