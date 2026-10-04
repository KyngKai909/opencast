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

// ---- Break rules with a preview (A246, Schedule phase 3) ----

/** The cadence choices as chips: every break, after each program, every N programs, once an hour, never. */
export type CadenceChoice = "break" | "program" | "n" | "hour" | "never";

/** A chip's value for a cadence. */
export function choiceOf(c: Pick<BreakCadence, "every">): CadenceChoice {
  return c.every === "n_programs" ? "n" : c.every;
}

/** The chips' words ("Every 3 programs" once N is 3). */
export function choiceOptions(part: ChipPart, n: number): Array<{ value: CadenceChoice; label: string; disabled?: boolean }> {
  return [
    { value: "break", label: "Every break" },
    { value: "program", label: "After each program" },
    { value: "n", label: `Every ${n} programs` },
    { value: "hour", label: "Once an hour" },
    // The station ID can't be never: crossed out.
    { value: "never", label: "Never", ...(part === "stationId" ? { disabled: true } : {}) }
  ];
}

/** A chip back to a cadence (N kept from before, else 2). */
export function cadenceFromChoice(choice: CadenceChoice, n: number): BreakCadence {
  return choice === "n" ? { every: "n_programs", n } : { every: choice };
}

/** The N choices for "every N programs" (the contract takes 2 to 12). */
export const N_PROGRAMS = [2, 3, 4, 5, 6];

/** The parts with chips, in the reference's order, each with its swatch's kind and its line. */
export const CHIP_PARTS = [
  { part: "spots", kind: "spots", title: "Spots", detail: "Your rotation, then backups, then the spot market" },
  { part: "underwriting", kind: "credit", title: "Thank-you credit", detail: "Members and sponsors" },
  { part: "bumpers", kind: "bumper", title: "Bumpers", detail: "Into and out of the break" },
  { part: "stationId", kind: "id", title: "Station ID", detail: "Always last. Can't be never" },
  { part: "upNext", kind: "upnext", title: "Up next", detail: "Between programs" }
] as const;
export type ChipPart = (typeof CHIP_PARTS)[number]["part"];

/** S20: where Up next airs by its own cadence: the first sequence with its role, else between programs. */
export function upNextHome(seq: BumperSequences): SequencePosition {
  return (["open", "close", "between"] as const).find((p) => seq[p].roles.includes("up_next")) ?? "between";
}

/**
 * How often Up next airs (S20). Its own cadence when set; left out, as often as the position
 * holding its role (as before); with its role nowhere, never.
 */
export function upNextCadence(rule: Pick<BreakRule, "cadence" | "bumperSequences">): BreakCadence {
  if (rule.cadence?.upNext) return rule.cadence.upNext;
  const seq = sequencesOf(rule);
  const at = (["open", "close", "between"] as const).find((p) => seq[p].roles.includes("up_next"));
  if (!at) return { every: "never" };
  const p = seq[at];
  // Between programs, "every break" is every boundary.
  return p.every === "n_programs" ? { every: "n_programs", n: p.n ?? 2 } : at === "between" && p.every === "break" ? { every: "program" } : { every: p.every };
}

/** The Bumpers chips: the opening and closing sequences' cadence when they agree, else null (set below). */
export function bumpersCadence(rule: Pick<BreakRule, "cadence" | "bumperSequences">): BreakCadence | null {
  const { open, close } = sequencesOf(rule);
  if (open.every !== close.every || (open.every === "n_programs" && (open.n ?? 2) !== (close.n ?? 2))) return null;
  return open.every === "n_programs" ? { every: "n_programs", n: open.n ?? 2 } : { every: open.every };
}

/** One part's cadence as the chips show it. */
export function chipCadence(rule: BreakRule, part: ChipPart): BreakCadence | null {
  if (part === "upNext") return upNextCadence(rule);
  if (part === "bumpers") return bumpersCadence(rule);
  return cadenceOf(rule)[part];
}

/** The rule with one part's cadence changed by its chips. Bumpers set the opening and closing sequences together; Up next only its own (S20). */
export function withChipCadence(rule: BreakRule, part: ChipPart, c: BreakCadence): BreakRule {
  const cadence = cadenceOf(rule);
  const every = c.every === "n_programs" ? { every: c.every, n: c.n ?? 2 } : { every: c.every };
  if (part === "bumpers") {
    const seq = sequencesOf(rule);
    const strip = ({ n: _n, ...p }: PositionRule) => p;
    return { ...rule, cadence: { ...cadence, bumpers: every }, bumperSequences: { ...seq, open: { ...strip(seq.open), ...every }, close: { ...strip(seq.close), ...every } } };
  }
  if (part === "upNext") return { ...rule, cadence: { ...cadence, upNext: every } };
  return { ...rule, cadence: { ...cadence, [part]: every } as BreakCadences };
}

/** Two rules the same (as the form sees them: blocked categories in any order). */
export function sameRule(a: BreakRule, b: BreakRule): boolean {
  // A247's fields left out read as not set.
  const norm = (r: BreakRule) => JSON.stringify({ ...r, blockedCategories: [...r.blockedCategories].sort(), fillOrder: fillOrder(r.fillOrder), cadence: cadenceOf(r), bumperSequences: sequencesOf(r), everyPrograms: r.everyPrograms ?? null, clockMinutes: r.clockMinutes ?? null, longPrograms: r.longPrograms ?? null }, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v));
  return norm(a) === norm(b);
}

/** One part of the recipe strip: its kind, length, words and length line. */
export interface RecipePart {
  kind: "bumper" | "spots" | "credit" | "id" | "upnext";
  length: number;
  label: string;
  detail: string;
}

const lengthWords = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * "Every break, in air order", drawn to scale for a break of the rule's length: the opening
 * bumpers, the spots and the credit in the station's order, the closing bumpers, the station ID;
 * then between programs (outside the break). Parts that never air are left out; a bumper role
 * with nothing to air is left out too. Up next goes where its cadence puts it (S20).
 */
export function recipeOf(rule: BreakRule, items: Bumper[], at: Date): { inBreak: RecipePart[]; between: RecipePart[] } {
  const seq = sequencesOf(rule);
  const cadence = cadenceOf(rule);
  const upNextOwn = !!rule.cadence?.upNext;
  const upNextOn = upNextCadence(rule).every !== "never";
  const home = upNextHome(seq);
  const roles = (p: SequencePosition): BumperRole[] => {
    const base = seq[p].every === "never" ? [] : seq[p].roles;
    if (!upNextOwn) return base;
    // S20: its own cadence. The position's `every` governs only the other roles.
    const rest = base.filter((r) => r !== "up_next");
    if (p !== home || !upNextOn) return rest;
    const order = seq[p].roles;
    const i = order.indexOf("up_next");
    const j = i < 0 ? -1 : rest.findIndex((r) => order.slice(i + 1).includes(r));
    return j < 0 ? [...rest, "up_next"] : [...rest.slice(0, j), "up_next", ...rest.slice(j)];
  };
  const bumpers = (p: SequencePosition) => {
    let upNext = false;
    return roles(p).flatMap((r): RecipePart[] => {
      if (r === "up_next" && upNext) return [];
      const ms = roleLength(items, r, at);
      if (!ms) return [];
      if (r === "up_next") upNext = true;
      return [{ kind: r === "up_next" ? "upnext" : "bumper", length: ms, label: r === "up_next" ? "Up next" : "Bumper", detail: lengthWords(ms) }];
    });
  };
  const open = bumpers("open");
  const close = bumpers("close");
  const credit: RecipePart[] = cadence.underwriting.every === "never" ? [] : [{ kind: "credit", length: FIXED_MS.UND, label: "Credit", detail: lengthWords(FIXED_MS.UND) }];
  const sid: RecipePart = { kind: "id", length: FIXED_MS.SID, label: "ID", detail: lengthWords(FIXED_MS.SID) };
  const fixed = [...open, ...credit, ...close, sid].reduce((s, p) => s + p.length, 0);
  const spotMs = Math.max(0, rule.lengthMs - fixed);
  const spots: RecipePart[] = cadence.spots.every === "never" || !spotMs ? [] : [{ kind: "spots", length: spotMs, label: "Spots", detail: `up to ${lengthWords(spotMs)}` }];
  const middle = fillOrder(rule.fillOrder).flatMap((c) => (c === "SPT" ? spots : c === "UND" ? credit : []));
  // Up next once: a break position before between programs.
  const inBreak = [...open, ...middle, ...close, sid];
  const between = bumpers("between").filter((p) => p.kind !== "upnext" || !inBreak.some((x) => x.kind === "upnext"));
  return { inBreak, between };
}

// ---- When breaks come (A247, 2026-10-04) ----

/**
 * "Breaks come", as one choice: after every program, after every N programs (`everyPrograms`),
 * every N minutes, at set times each hour (`clockMinutes`, which the API keeps under
 * `every_n_minutes`), never. Inside long programs (`longPrograms`) is a switch beside it.
 */
export type Timing = "program" | "programs" | "minutes" | "clock" | "none";

/** The N choices for after every N programs (the API takes 2 to 12). */
export const EVERY_PROGRAMS = [2, 3, 4, 5, 6];
/** Every N minutes: 5 to 60, by 5. */
export const EVERY_MINUTES = Array.from({ length: 12 }, (_, i) => (i + 1) * 5);
/** The clock's chips: :00 to :55, by 5. */
export const CLOCK_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
/** At most this many clock times an hour (the API's limit). */
export const MAX_CLOCK_TIMES = 6;
/** Inside long programs: longer than, and every. */
export const LONG_OVER_MINUTES = [30, 45, 60, 90];
export const LONG_EVERY_MINUTES = [10, 15, 20, 25, 30, 40, 45, 50, 60];
/** The clock's times when they're first chosen: the top and bottom of the hour. */
export const DEFAULT_CLOCK = [0, 30];
/** Inside long programs when it's switched on: over 45 minutes, every 30. */
export const DEFAULT_LONG = { overMs: 45 * 60_000, everyMs: 30 * 60_000 };
/** Less program than this between two breaks and the later one is skipped (the API's `MIN_RUN_MS`). */
export const MIN_RUN_MINUTES = 5;

/** The rule's choice for "Breaks come". */
export function timingOf(rule: Pick<BreakRule, "mode" | "everyPrograms" | "clockMinutes">): Timing {
  if (rule.mode === "after_every_program") return rule.everyPrograms ? "programs" : "program";
  if (rule.mode === "every_n_minutes") return rule.clockMinutes?.length ? "clock" : "minutes";
  return "none";
}

/** Inside long programs applies (every N minutes already breaks inside every program). */
export function longApplies(rule: Pick<BreakRule, "mode" | "everyPrograms" | "clockMinutes">): boolean {
  return timingOf(rule) !== "minutes";
}

/** The rule with "Breaks come" changed: N, minutes and clock times kept from before where they were set. */
export function withTiming(rule: BreakRule, timing: Timing): BreakRule {
  const minutes = rule.mode === "every_n_minutes" && !rule.clockMinutes?.length ? (rule.everyMinutes ?? 30) : 30;
  const clock = rule.clockMinutes?.length ? rule.clockMinutes : DEFAULT_CLOCK;
  const base = { ...rule, everyPrograms: null, clockMinutes: null };
  switch (timing) {
    case "program":
      return { ...base, mode: "after_every_program", everyMinutes: null };
    case "programs":
      return { ...base, mode: "after_every_program", everyMinutes: null, everyPrograms: rule.everyPrograms ?? 2 };
    case "minutes":
      // Every N minutes breaks inside every program: inside long programs doesn't apply.
      return { ...base, mode: "every_n_minutes", everyMinutes: minutes, longPrograms: null };
    case "clock":
      return withClock({ ...base, mode: "every_n_minutes" }, clock);
    case "none":
      return { ...base, mode: "none", everyMinutes: null };
  }
}

/** The rule with its clock times (sorted); the minutes apps from before show follow (60 over how many). None chosen: as it was. */
export function withClock(rule: BreakRule, minutes: readonly number[]): BreakRule {
  const list = [...new Set(minutes)].sort((a, b) => a - b);
  if (!list.length) return rule;
  return { ...rule, mode: "every_n_minutes", clockMinutes: list, everyMinutes: Math.round(60 / list.length) };
}

/** How far apart clock times must be, in minutes: 10, or the break's length and five minutes of program. */
export function clockGapMinutes(lengthMs: number): number {
  return Math.max(10, Math.ceil(lengthMs / 60_000 + MIN_RUN_MINUTES));
}

/** What's wrong with the clock times (the API's own words), or null. */
export function clockProblem(rule: Pick<BreakRule, "lengthMs" | "clockMinutes">): string | null {
  const list = rule.clockMinutes ?? [];
  if (list.length > MAX_CLOCK_TIMES) return `Choose ${MAX_CLOCK_TIMES} times an hour at most.`;
  const need = clockGapMinutes(rule.lengthMs);
  const close = list.length > 1 && list.some((m, i) => ((list[(i + 1) % list.length]! - m + 60) % 60 || 60) < need);
  return close ? `Leave at least ${need} minutes between break times.` : null;
}

/** ":15", ":05". */
export const clockMinute = (m: number) => `:${String(m).padStart(2, "0")}`;

/** ":15 and :45", ":00, :20 and :40". */
export function clockWords(minutes: readonly number[]): string {
  const said = minutes.map(clockMinute);
  return said.length < 2 ? (said[0] ?? "") : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

/** "2nd", "3rd", "4th". */
export function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
}

/** "Breaks come" in the Log's words: "after every 2 programs", "at :15 and :45 each hour". */
export function timingWords(rule: Pick<BreakRule, "mode" | "everyMinutes" | "everyPrograms" | "clockMinutes">): string {
  switch (timingOf(rule)) {
    case "program":
      return "after every program";
    case "programs":
      return `after every ${rule.everyPrograms} programs`;
    case "minutes":
      return `every ${rule.everyMinutes ?? 30} minutes`;
    case "clock":
      return `at ${clockWords(rule.clockMinutes ?? [])} each hour`;
    case "none":
      return "when they're cued from the booth";
  }
}

/** Inside long programs, in a sentence: "Programs over 45 minutes also break every 30 minutes inside." */
export function longWords(rule: Pick<BreakRule, "mode" | "everyPrograms" | "clockMinutes" | "longPrograms">): string | null {
  const long = rule.longPrograms;
  if (!long || !longApplies(rule)) return null;
  return `Programs over ${Math.round(long.overMs / 60_000)} minutes also break every ${Math.round(long.everyMs / 60_000)} minutes inside.`;
}
