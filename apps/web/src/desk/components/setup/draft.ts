// A claimable station prepared before it exists (N5 asks the API to keep these; until then the
// desk keeps the draft on this device): the recipe, the channel from the board, a call sign from
// the creator's name, who runs it, and when it signs on.

import { stationColourPasses } from "@opencast/ui";
import type { CreatorX, MarketBoardX } from "../../api/ext";

export interface Draft {
  recipeId: string;
  band: "tv" | "radio";
  channel: string;
  callSign: string;
  operatorId: string | null;
  signOnAt: string;
}

const KEY = (id: string) => `oc-desk-draft-${id}`;

export function loadDraft(creatorId: string): Partial<Draft> | null {
  try {
    const raw = localStorage.getItem(KEY(creatorId));
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    return null;
  }
}

export function saveDraft(creatorId: string, d: Draft) {
  try {
    localStorage.setItem(KEY(creatorId), JSON.stringify(d));
  } catch {
    /* private window */
  }
}

export function clearDraft(creatorId: string) {
  try {
    localStorage.removeItem(KEY(creatorId));
  } catch {
    /* private window */
  }
}

/** The name a call sign is suggested from: the person's first name, else the creator's first word. */
export function shortName(c: Pick<CreatorX, "personName" | "displayName">): string {
  const source = c.personName ?? c.displayName;
  const word = source.replace(/^T[ií]a\s+/i, "").split(/\s+/)[0] ?? source;
  return word.replace(/[’'].*$/, "");
}

/** Call signs to suggest, best first: letters only, 3 to 5, no K or W prefix (B9, checked here until the API does). */
export function callSignIdeas(c: Pick<CreatorX, "personName" | "displayName">): string[] {
  const letters = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
  const first = letters(shortName(c));
  const words = c.displayName.split(/\s+/).map(letters).filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  // A person's name makes the call sign ("LUPE"); a crew or a club reads better as its initials ("DSF").
  const ideas = c.personName || words.length < 3 ? [first.slice(0, 4), first.slice(0, 5), initials, first.slice(0, 3)] : [initials, first.slice(0, 4), (words[0] ?? "").slice(0, 3) + (words[1] ?? "").slice(0, 1)];
  return [...new Set(ideas.filter((s) => callSignOk(s)))];
}

/** A call sign's own rules: 3 to 5 capital letters, and no K or W at the front (US stations' prefixes). */
export function callSignOk(s: string): boolean {
  return /^[A-Z]{3,5}$/.test(s) && !/^[KW]/.test(s);
}

export function callSignProblem(s: string): string | null {
  if (!/^[A-Z]{3,5}$/.test(s)) return "Three to five capital letters.";
  if (/^[KW]/.test(s)) return "No K or W at the start: those are US broadcast prefixes.";
  return null;
}

/** Open channels on a band's board: TV "33.1" for each open main channel; radio each open frequency. */
export function openChannels(board: MarketBoardX | undefined): string[] {
  if (!board) return [];
  return board.slots.filter((s) => s.state === "open").map((s) => (board.band === "tv" ? `${s.major}.1` : (s.major / 10).toFixed(1)));
}

/** Who holds a channel on the board: "GOSP" for a waitlist hold, a call sign for a station, or null when it's open. */
export function holderOf(board: MarketBoardX | undefined, channel: string): { kind: "held" | "station"; who: string } | null {
  if (!board) return null;
  const t = Math.round(Number(channel) * 10);
  const major = board.band === "tv" ? Math.floor(t / 10) : t;
  const slot = board.slots.find((s) => s.major === major);
  if (!slot || slot.state === "open") return null;
  if (slot.state === "held") return { kind: "held", who: slot.heldFor ?? "the waitlist" };
  return { kind: "station", who: slot.stations[0]?.callSign ?? slot.stations[0]?.name ?? "a station" };
}

/** The first proposed channel that's open, else the nearest open one to it, else the first open one. */
export function chooseChannel(board: MarketBoardX | undefined, proposed: readonly string[]): string | null {
  const open = openChannels(board);
  const free = proposed.find((ch) => open.includes(ch));
  if (free) return free;
  const want = proposed[0] ? Number(proposed[0]) : null;
  if (want !== null && open.length) return [...open].sort((a, b) => Math.abs(Number(a) - want) - Math.abs(Number(b) - want))[0]!;
  return open[0] ?? null;
}

/** The next Monday at 6:00 am in the market, at least a day away (a new station's usual first sign-on). */
export function nextMondaySixAm(from: Date, timeZone: string): string {
  for (let i = 1; i <= 8; i++) {
    const d = new Date(from.getTime() + i * 86_400_000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
    if (wd !== "Mon") continue;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return zonedToUtc(ymd, "06:00", timeZone);
  }
  return new Date(from.getTime() + 2 * 86_400_000).toISOString();
}

/** A market's wall-clock date and time as a UTC instant. */
export function zonedToUtc(ymd: string, hhmm: string, timeZone: string): string {
  const guess = Date.parse(`${ymd}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const seen = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (seen - guess)).toISOString();
}

/** The `datetime-local` value for an instant, in the market's time. */
export function toLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// A station colour for a new claimable station (the frame draws no colour field; inventory 9). Each
// holds 4.5:1 against white; picked from the creator's name so it's steady.
const PALETTE = ["#A3402A", "#2E6B5A", "#1F5E8C", "#8C3B7A", "#9A5412", "#56508A", "#1D6A70", "#5B3F8C", "#3D6547", "#7A4B1F"];

export function colourFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = PALETTE[h % PALETTE.length]!;
  return stationColourPasses(c) ? c : PALETTE[0]!;
}

/** "her", "his", "their"; "She", "He", "They". */
export function pronouns(p: CreatorX["pronoun"]) {
  return p === "she" ? { pos: "her", subj: "She", obj: "her" } : p === "he" ? { pos: "his", subj: "He", obj: "him" } : { pos: "their", subj: "They", obj: "them" };
}
