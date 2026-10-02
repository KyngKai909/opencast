// The arithmetic behind Settings, Breaks (station-settings 02.1): what fills every break, in
// order, with the station ID always last when it airs; how long each part runs; the hourly cap
// against TV; and how often the station ID, bumpers, credit and spots air (the cadence, added
// 2026-09-29). Since the user's decision of 2026-09-29 a bumper opens the break and one closes it
// (A143): the ladder draws both, fixed, and only the spots and the credit move. A243 (2026-10-02):
// those two rows are the bumper sequences ("Opening the break", "Closing the break"), each a row
// of roles with its own "How often", and a third sequence airs between programs; the "Bumpers"
// row leaves "How often".

import type { BreakCadence, BreakCadences, BreakRule, BumperRole, BumperSequences, LibraryItem, LogCode, PositionRule } from "@opencast/contracts";
import { duration } from "@opencast/ui";
import { chainOf, inWindow, notAiringLine } from "../live/bumpers";

/** The parts of a break a station can put in order. The station ID is always last. */
export type FillCode = "SPT" | "UND" | "BMP" | "SID";

/** How long the fixed parts run (the thank-you credit, a bumper, the station ID). */
export const FIXED_MS: Record<Exclude<FillCode, "SPT">, number> = { UND: 15_000, BMP: 10_000, SID: 5_000 };

export const FILL_WORDS: Record<FillCode, { title: string; detail: string }> = {
  SPT: { title: "Spots from your rotation", detail: "Up to the hourly cap" },
  UND: { title: "Thank-you credit", detail: "Members who asked to be named, then local sponsors. Made for you automatically" },
  BMP: { title: "Closing the break", detail: "After the credit, before the station ID. Time left over holds on the station ID slate" },
  SID: { title: "Station ID", detail: "Always last, can't be removed" }
};

/** The bumpers opening the break (A243): the ladder's first row, fixed. */
export const BUMPER_IN_WORDS = { title: "Opening the break", detail: "Before the spots" };

/** Broadcast TV runs about 16 minutes of advertising an hour. */
export const TV_MINUTES_PER_HOUR = 16;

const FILLS: FillCode[] = ["SPT", "UND", "BMP", "SID"];

/** The parts a station can put in order: the spots and the credit (bumpers and the station ID have their places). */
const MOVABLE: FillCode[] = ["SPT", "UND"];

/**
 * The order as the station set it, with every part once: the spots and the credit in its order,
 * then the bumper and the station ID last (where playout airs them, the bumper also opening the break).
 */
export function fillOrder(order: readonly LogCode[]): FillCode[] {
  const known = order.filter((c): c is FillCode => MOVABLE.includes(c as FillCode));
  const unique = known.filter((c, i) => known.indexOf(c) === i);
  for (const c of MOVABLE) if (!unique.includes(c)) unique.push(c);
  return [...unique, "BMP", "SID"];
}

/** Moves a part up (-1) or down (+1). The bumpers and the station ID don't move, and nothing passes them. */
export function moveFill(order: readonly LogCode[], code: FillCode, delta: -1 | 1): FillCode[] {
  const list = fillOrder(order);
  if (!MOVABLE.includes(code)) return list;
  const at = list.indexOf(code);
  const to = at + delta;
  if (to < 0 || to >= MOVABLE.length) return list;
  const next = [...list];
  next.splice(at, 1);
  next.splice(to, 0, code);
  return next;
}

/** Puts a part at an index among the parts that move (dragging), keeping the bumper and the station ID last. */
export function placeFill(order: readonly LogCode[], code: FillCode, index: number): FillCode[] {
  const list = fillOrder(order);
  if (!MOVABLE.includes(code)) return list;
  const rest = list.filter((c) => c !== code && MOVABLE.includes(c));
  const i = Math.max(0, Math.min(index, rest.length));
  rest.splice(i, 0, code);
  return [...rest, "BMP", "SID"];
}

/** Spot time in one break: whatever the fixed parts leave of its length (a bumper for each role in its sequences; one at each end by default). */
export function spotMsPerBreak(rule: Pick<BreakRule, "lengthMs" | "fillOrder"> & Partial<Pick<BreakRule, "bumperSequences" | "cadence">>): number {
  const seq = sequencesOf(rule);
  const fixed = FIXED_MS.UND + (seq.open.roles.length + seq.close.roles.length) * FIXED_MS.BMP + FIXED_MS.SID;
  return Math.max(0, rule.lengthMs - fixed);
}

/**
 * The ladder's rows: number, code, words and time ("0:00 – 1:20", ":15"). A bumper into the
 * break first, then the spots and the credit in the station's order (`fillIndex`, for dragging),
 * a bumper out of the break, and the station ID last.
 */
export function ladder(rule: Pick<BreakRule, "lengthMs" | "fillOrder"> & Partial<Pick<BreakRule, "bumperSequences" | "cadence">>) {
  const order = fillOrder(rule.fillOrder);
  const rows: Array<{ key: string; code: FillCode; title: string; detail: string; time: string; fillIndex: number | null }> = [
    { key: "BMP-in", code: "BMP", ...BUMPER_IN_WORDS, time: duration(FIXED_MS.BMP), fillIndex: null },
    ...order
      .filter((c) => MOVABLE.includes(c))
      .map((code, i) => ({ key: code, code, ...FILL_WORDS[code], time: code === "SPT" ? `0:00 – ${duration(spotMsPerBreak(rule))}` : duration(FIXED_MS[code as "UND"]), fillIndex: i })),
    { key: "BMP", code: "BMP", ...FILL_WORDS.BMP, time: duration(FIXED_MS.BMP), fillIndex: null },
    { key: "SID", code: "SID", ...FILL_WORDS.SID, time: duration(FIXED_MS.SID), fillIndex: null }
  ];
  return rows.map((r, i) => ({ n: i + 1, ...r }));
}

/**
 * The ladder with "Ads from partners" (station-settings 02.1): a backfill for time still open,
 * placed after the rotation, backups and thank-you credit and before the bumpers and station ID
 * (the platform prompt fixes its place, so it can't be dragged). Up to half the break.
 */
export type LadderRow = ReturnType<typeof ladder>[number] & { partner?: boolean };

export function ladderWithPartners(rule: Pick<BreakRule, "lengthMs" | "fillOrder" | "adsFromPartners"> & Partial<Pick<BreakRule, "bumperSequences" | "cadence">>): LadderRow[] {
  const rows: LadderRow[] = ladder(rule);
  // Before the bumper out of the break (the first row's bumper opens it).
  const at = rows.findIndex((r) => r.key === "BMP" || r.code === "SID");
  const partner: LadderRow = {
    n: 0,
    key: "partners",
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

// ---- How often (the cadence, added 2026-09-29; spots later that day) ----

/**
 * The parts whose cadence a station sets here, in the order the section lists them (the ladder's
 * order). A243: the bumpers' cadence is each sequence's own, on its row.
 */
export const CADENCE_PARTS = [
  { part: "spots", code: "SPT", title: "Spots" },
  { part: "underwriting", code: "UND", title: "Thank-you credit" },
  { part: "stationId", code: "SID", title: "Station ID" }
] as const;
export type CadencePart = (typeof CADENCE_PARTS)[number]["part"] | "bumpers";

/** A cadence with every part, spots included (the API always sends them; a rule from before may not). */
export type FullCadence = BreakCadences & { spots: BreakCadence };

/** Every part in every break: today's breaks, and what a rule without a cadence means. */
export const DEFAULT_CADENCE: FullCadence = { stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } };

/** The rule's cadence, the default filled in. */
export function cadenceOf(rule: Pick<BreakRule, "cadence">): FullCadence {
  return { ...DEFAULT_CADENCE, ...(rule.cadence ?? {}), spots: rule.cadence?.spots ?? DEFAULT_CADENCE.spots };
}

/** "In every break", "After every program", "After every 3 programs", "Once an hour", "Never". */
export function cadenceWords(c: BreakCadence): string {
  switch (c.every) {
    case "break":
      return "In every break";
    case "program":
      return "After every program";
    case "n_programs":
      return `After every ${c.n ?? 2} programs`;
    case "hour":
      return "Once an hour";
    case "never":
      return "Never";
  }
}

/** A cadence as one select value: "break", "program", "n:3", "hour", "never". */
export function cadenceKey(c: BreakCadence): string {
  return c.every === "n_programs" ? `n:${c.n ?? 2}` : c.every;
}

export function cadenceFromKey(key: string): BreakCadence {
  if (key.startsWith("n:")) return { every: "n_programs", n: Number(key.slice(2)) };
  return { every: key as BreakCadence["every"] };
}

/** The "How often" choices: every break, after programs (every one, 2, 3 or 4), once an hour, and never (not the station ID; spots, bumpers and the credit). */
export function cadenceOptions(part: CadencePart): Array<{ value: string; label: string }> {
  const list: BreakCadence[] = [{ every: "break" }, { every: "program" }, ...[2, 3, 4].map((n) => ({ every: "n_programs" as const, n })), { every: "hour" }];
  if (part !== "stationId") list.push({ every: "never" });
  return list.map((c) => ({ value: cadenceKey(c), label: cadenceWords(c) }));
}

/** The line under a part: when it airs, in the station's words. */
export function cadenceDetail(part: CadencePart, c: BreakCadence): string {
  if (part === "stationId") return c.every === "break" ? "Last in every break" : c.every === "hour" ? "Last in the first break after the top of the hour" : "Last in the break, when it airs";
  if (part === "spots") {
    if (c.every === "break") return "In every break, up to the hourly cap";
    if (c.every === "never") return "Breaks are only as long as the rest needs. Nothing is sold in them";
    return "Up to the hourly cap. Other breaks are only as long as the rest needs";
  }
  if (c.every === "never") return part === "bumpers" ? "No bumpers in breaks" : "Sponsors and members aren't thanked in breaks";
  return part === "bumpers" ? "One into the break and one out of it" : "In its place in the order above";
}

// ---- The bumper sequences (A243, 2026-10-02) ----

export type SequencePosition = keyof BumperSequences;

/** The rule's sequences, the defaults filled in (one into the break, one out of it, as often as `cadence.bumpers`; nothing between). */
export function sequencesOf(rule: Partial<Pick<BreakRule, "bumperSequences" | "cadence">>): BumperSequences {
  if (rule.bumperSequences) return rule.bumperSequences;
  const c = rule.cadence?.bumpers ?? { every: "break" as const };
  const every = c.every === "n_programs" ? { every: c.every, n: c.n ?? 2 } : { every: c.every };
  return { open: { roles: ["into_break"], ...every }, close: { roles: ["out_of_break"], ...every }, between: { roles: [], every: "program" } };
}

/** A role as the Breaks settings say it. */
export const SEQ_ROLE_WORDS: Record<BumperRole, string> = { into_break: "Into the break", out_of_break: "Out of the break", up_next: "Up next", any: "Any" };

/** Each position's name and where it airs. */
export const POSITION_WORDS: Record<SequencePosition, { title: string; detail: string }> = {
  open: { title: "Opening the break", detail: "Before the spots" },
  close: { title: "Closing the break", detail: "After the credit, before the station ID" },
  between: { title: "Between programs", detail: "After your station ID, just before the next program starts." }
};

/** At most this many in one position. */
export const MAX_ROLES = 4;

/** How often a position airs: the break rows' choices, or between programs' own words. */
export function sequenceOptions(position: SequencePosition): Array<{ value: string; label: string }> {
  if (position !== "between") return cadenceOptions("bumpers").map((o) => (o.value === "break" ? { ...o, label: "Every break" } : o));
  return [
    { value: "program", label: "Between every program" },
    ...[2, 3, 4].map((n) => ({ value: `n:${n}`, label: `Every ${n} programs` })),
    { value: "hour", label: "At the top of the hour" },
    { value: "never", label: "Never" }
  ];
}

/** A position's rule from its select's value. */
export function everyFromKey(key: string): Pick<PositionRule, "every" | "n"> {
  return cadenceFromKey(key);
}

/** Moves a role left (-1) or right (+1) in its position. */
export function moveRole(roles: readonly BumperRole[], role: BumperRole, delta: -1 | 1): BumperRole[] {
  const at = roles.indexOf(role);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= roles.length) return [...roles];
  const next = [...roles];
  next.splice(at, 1);
  next.splice(to, 0, role);
  return next;
}

/** Puts a dragged role at an index. */
export function placeRole(roles: readonly BumperRole[], role: BumperRole, index: number): BumperRole[] {
  const rest = roles.filter((r) => r !== role);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, role);
  return rest;
}

type Bumper = Pick<LibraryItem, "code" | "bumperRole" | "airs" | "status" | "rights" | "durationMs">;
const ready = (i: Bumper) => i.code === "BMP" && i.status === "ready" && !!i.rights;
const ofRole = (items: Bumper[], role: BumperRole) => items.filter((i) => ready(i) && (i.bumperRole ?? "any") === role);

/** What fills a role, under its chip: "2 in your library", "None yet, so an Any bumper airs", "1, not airing now (from Dec 1)". */
export function roleSupply(items: Bumper[], role: BumperRole, at: Date): string {
  const own = ofRole(items, role);
  const now = own.filter((i) => inWindow(i.airs, at));
  if (now.length) return `${now.length} in your library`;
  if (own.length) {
    const why = notAiringLine(own[0]!.airs, at)?.replace(/^Not airing now: /, "");
    return `${own.length}, not airing now${why ? ` (${why})` : ""}`;
  }
  if (role === "into_break" || role === "out_of_break") return ofRole(items, "any").length ? "None yet, so an Any bumper airs" : "None yet, so nothing airs";
  return "None yet, so nothing airs";
}

/** How long a role's bumper runs (the first in its chain that can air now), or null when nothing would. */
export function roleLength(items: Bumper[], role: BumperRole, at: Date): number | null {
  for (const pool of chainOf(role)) {
    const first = ofRole(items, pool).find((i) => inWindow(i.airs, at) && i.durationMs);
    if (first) return first.durationMs!;
  }
  return null;
}

/** Up next in more than one place: it airs once a break, in the first that has it. */
export function upNextTwice(seq: BumperSequences): boolean {
  return (["open", "close", "between"] as const).filter((p) => seq[p].roles.includes("up_next")).length > 1;
}

/** ":05", "1:30". */
const short = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${s >= 60 ? Math.floor(s / 60) : ""}:${String(s % 60).padStart(2, "0")}`;
};

/** "Example, a 2:00 break: Into the break :05, Up next :08, your spots, the credit, Out of the break :05, then your station ID." */
export function exampleLine(rule: Pick<BreakRule, "lengthMs" | "fillOrder"> & Partial<Pick<BreakRule, "bumperSequences" | "cadence">>, items: Bumper[], at: Date): string {
  const seq = sequencesOf(rule);
  const said = (roles: BumperRole[]) => roles.flatMap((r) => {
    const ms = roleLength(items, r, at);
    return ms ? [`${SEQ_ROLE_WORDS[r]} ${short(ms)}`] : [];
  });
  const middle = fillOrder(rule.fillOrder).filter((c) => c === "SPT" || c === "UND").map((c) => (c === "SPT" ? "your spots" : "the credit"));
  const between = said(seq.between.every === "never" ? [] : seq.between.roles);
  const parts = [...said(seq.open.every === "never" ? [] : seq.open.roles), ...middle, ...said(seq.close.every === "never" ? [] : seq.close.roles)];
  return `Example, a ${duration(rule.lengthMs)} break: ${parts.join(", ")}, then your station ID${between.length ? `; between programs, ${between.join(", ")}` : ""}.`;
}
