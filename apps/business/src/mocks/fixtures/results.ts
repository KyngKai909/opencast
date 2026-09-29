// Where it aired, for the mock (biz-results 01 to 05; biz-settings 05.1): Orange Street Coffee's
// as-run history, codes and customers, and its monthly statements.
//
// September is the frames' month, and it adds up to the shared balance: 118 airings for $248.90
// (the balance's "Spent in September"), five spot-and-station lines as the statement draws them
// (Fall menu on BEAT $110.27, CIVC $81.84, SAZN $27.81; Pumpkin latte on BEAT $17.70, SAZN
// $11.28), 62, 31 and 25 airings on BEAT, CIVC and SAZN, 38 in the afternoon and 80 in the
// evening, two airings cut short ($1.86 returned), and the week of September 20 to 26 at 31
// airings for $64.02. The five newest airings are the ones the airings frame (02.1) draws. 37
// customers used a code (ORANGE10 31: 24 through Clear Pay, 7 marked in the app; PUMPKIN 6), 8 of
// them marked today; ORANGE10 was scanned 214 times and saved 61 times.
//
// Every airing's cost is its tuned-in times its rate, to the cent, and short airings pay for what
// aired: so the tuned-in figures follow from the money. The frames' tuned-in figures (31,101 added
// up; 258, 330 and 195 on average) can't: they price Pumpkin latte at Fall menu's $8.00 per 1,000,
// where its own rate is $5.00 (biz-spots 01.1, and 188 tuned in for $0.94 on the airings frame).
// Money wins, so the added-up figure here is about 33,400 (reported at the Phase 5 STOP).
//
// August is Summer cold brew (96 airings, $240.40) and Council Watch's month ($50.00): the
// statement settings 03.1 lists. It starts at $166.00 and ends at $175.60, where September starts.
//
// What happens in the mock after it starts is read from the shared db: an airing the Spots area's
// mock airs (a `move()` with kind "aired") shows up in results, airings and the statement. Spots
// can call `recordAiring()` here to air one with its full as-run entry (program, tuned in, a
// short airing); a bare "aired" movement is read from its label and detail ("Aired on BEAT 12.1",
// ":30 spot, 262 tuned in, $8.00 per 1,000"). Scans, saves and redemptions made in the mock are
// kept in this file's own saved state.

import type { Movement, Spot, StationIdent } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { MARKET_TZ, now } from "../../lib/clock";
import { balanceOf, dbBusiness, getDb, move } from "../db";
import { OSC_ID, seedBalances, seedBusinesses } from "./businesses";
import { uid } from "./people";
import * as settingsFixture from "./settings";
import { STATIONS, stationByRef } from "./stations";
import { at } from "./time";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const CENT = 10_000;
const DAY = 86_400_000;
const KEY = "oc-mock-spots-results";
export const RESULTS_VERSION = 1;

export const SPOT_IDS = { fall: uid(64001), pumpkin: uid(64002), colton: uid(64003), summer: uid(64004) };
const station = (callSign: string) => STATIONS.find((s) => s.callSign === callSign)!;
const BEAT = station("BEAT");
const CIVC = station("CIVC");
const SAZN = station("SAZN");

/** S1: what kind of station each is ("Music", "Public affairs", "Food"), as the results table says. */
export const STATION_KIND: Record<string, string> = { [BEAT.id]: "Music", [CIVC.id]: "Public affairs", [SAZN.id]: "Food" };

/** The statements' ids: the same as the receipts list in Settings (biz-settings 03.1). */
export const STATEMENT_IDS = { september: uid(66001), august: uid(66002) };

// ---------------------------------------------------------------- records

export type Daypart = "mornings" | "afternoons" | "evenings" | "late_night";

/** One airing from the as-run log. */
export interface AsRun {
  id: string;
  businessId: string;
  spotId: string;
  stationId: string;
  startedAt: string;
  lengthSec: number;
  airedSec: number;
  tunedIn: number;
  rate: { kind: "per_thousand" | "per_airing"; micros: number };
  costMicros: number;
  programContext: string | null;
  shortReason: string | null;
  /** QR scans in the hour after it aired (from the seed; the mock's own scans are added on top). */
  scans: number;
  /** The movement it spent money through, once the mock has aired it. */
  movementId?: string;
}

export interface CodeUse {
  id: string;
  businessId: string;
  code: string;
  spotId: string;
  /** The airing it's counted for: the station and time of day it's credited to. */
  airingId: string | null;
  stationId: string | null;
  at: string;
  how: "clear_pay" | "marked" | "online";
  customerRef: string;
}

export interface CodeSave {
  id: string;
  code: string;
  stationId: string | null;
  at: string;
  customerRef: string;
}

export interface CodeScan {
  id: string;
  code: string;
  stationId: string | null;
  airingId: string | null;
  at: string;
}

export interface HeldAiring {
  airingId: string;
  spotId: string;
  stationId: string;
  scheduledAt: string;
  heldMicros: number;
}

/** What the mock adds after it starts, kept across reloads. */
export interface ResultsState {
  version: number;
  airings: AsRun[];
  uses: CodeUse[];
  saves: CodeSave[];
  scans: CodeScan[];
}

// ---------------------------------------------------------------- the seed

/** A small seeded random, so the history is the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What an airing costs: tuned in times the rate (per 1,000, or per airing), for what aired, to the cent. */
export function airingCost(rate: AsRun["rate"], tunedIn: number, airedSec: number, lengthSec: number): number {
  const full = rate.kind === "per_thousand" ? (tunedIn * rate.micros) / 1000 : rate.micros;
  return Math.round((full * Math.min(airedSec, lengthSec)) / lengthSec / CENT) * CENT;
}

/** "262 × $8.00 ÷ 1,000 = $2.10": the working on the airing, as stations see it on their statements. */
export function working(a: Pick<AsRun, "rate" | "tunedIn" | "airedSec" | "lengthSec" | "costMicros">): string {
  const part = a.airedSec < a.lengthSec ? `, for :${String(a.airedSec).padStart(2, "0")} of :${a.lengthSec}` : "";
  const base = a.rate.kind === "per_thousand" ? `${a.tunedIn.toLocaleString("en-US")} × ${money(a.rate.micros)} ÷ 1,000` : `${money(a.rate.micros)} an airing`;
  return `${base}${part} = ${money(a.costMicros)}`;
}

const SLOTS: Record<string, Record<"afternoons" | "evenings", string[]>> = {
  [BEAT.id]: { afternoons: ["13:28:30", "14:28:30", "15:28:30", "16:28:30"], evenings: ["18:58:30", "19:28:30", "19:58:30", "20:28:30", "20:58:30", "21:28:30", "22:28:30"] },
  [CIVC.id]: { afternoons: ["12:30:00", "14:00:00", "15:30:00"], evenings: ["18:10:00", "19:40:00", "20:40:00", "21:10:00"] },
  [SAZN.id]: { afternoons: ["13:29:00", "15:59:00"], evenings: ["17:29:00", "18:29:00", "19:29:00", "20:59:00"] }
};

const PROGRAMS: Record<string, Record<"afternoons" | "evenings", string[]>> = {
  [BEAT.id]: { afternoons: ["Study Beats", "Crate Talk"], evenings: ["Crate Session 02", "Beat Tape Live", "Late Crate", "Crate Talk"] },
  [CIVC.id]: { afternoons: ["Inland Report", "the planning commission"], evenings: ["the town hall", "Council Watch", "Inland Report"] },
  [SAZN.id]: { afternoons: ["Sazón en casa", "Mercado Kitchen"], evenings: ["Tamales for forty", "Mercado Kitchen", "Sazón en casa"] }
};

const RATES: Record<string, AsRun["rate"]> = {
  [SPOT_IDS.fall]: { kind: "per_thousand", micros: $(8) },
  [SPOT_IDS.pumpkin]: { kind: "per_thousand", micros: $(5) },
  [SPOT_IDS.summer]: { kind: "per_thousand", micros: $(8) }
};
const LENGTH: Record<string, number> = { [SPOT_IDS.fall]: 30, [SPOT_IDS.pumpkin]: 15, [SPOT_IDS.summer]: 30 };

/** Which part of the day an airing is in, by the market's clock. */
export function daypartOf(iso: string): Daypart {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: MARKET_TZ }).format(new Date(iso)));
  if (h >= 5 && h < 12) return "mornings";
  if (h >= 12 && h < 17) return "afternoons";
  if (h >= 17 && h < 23) return "evenings";
  return "late_night";
}

/** The market's date of a moment: "2026-09-26". */
export function marketDate(t: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

interface Fixed {
  day: number;
  time: string;
  tunedIn: number;
  context: string;
  airedSec?: number;
  shortReason?: string;
  scans?: number;
}

interface GroupSpec {
  spotId: string;
  station: StationIdent;
  /** Market days relative to the reference Saturday (0), inclusive. */
  from: number;
  to: number;
  count: number;
  afternoons: number;
  totalMicros: number;
  fixed?: Fixed[];
}

// September before the week of the 20th (days −25 to −7), the week itself (−6 to 0), and August.
const GROUPS: GroupSpec[] = [
  // Fall menu on BEAT: 50 airings, $110.27. One cut short on September 12.
  { spotId: SPOT_IDS.fall, station: BEAT, from: -25, to: -7, count: 37, afternoons: 12, totalMicros: $(82.07), fixed: [{ day: -14, time: "21:28:30", tunedIn: 425, airedSec: 21, context: "After Beat Tape Live", shortReason: "Beat Tape Live ran long" }] },
  {
    spotId: SPOT_IDS.fall,
    station: BEAT,
    from: -6,
    to: -1,
    count: 13,
    afternoons: 4,
    totalMicros: $(28.2),
    fixed: [
      { day: 0, time: "20:28:30", tunedIn: 262, context: "Before Saturday Reel", scans: 4 },
      { day: 0, time: "19:58:30", tunedIn: 241, context: "During Crate Session 02" }
    ]
  },
  // Fall menu on CIVC: 31 airings, $81.84. The town hall ran over on Friday.
  { spotId: SPOT_IDS.fall, station: CIVC, from: -25, to: -7, count: 23, afternoons: 6, totalMicros: $(60.94) },
  {
    spotId: SPOT_IDS.fall,
    station: CIVC,
    from: -6,
    to: -1,
    count: 8,
    afternoons: 2,
    totalMicros: $(20.9),
    fixed: [
      { day: -1, time: "21:59:48", tunedIn: 175, airedSec: 12, context: "After the town hall", shortReason: "The town hall ran over" },
      { day: -1, time: "19:40:00", tunedIn: 410, context: "During the town hall" }
    ]
  },
  // Fall menu on SAZN: 13 airings, $27.81.
  { spotId: SPOT_IDS.fall, station: SAZN, from: -25, to: -7, count: 10, afternoons: 4, totalMicros: $(21.51) },
  { spotId: SPOT_IDS.fall, station: SAZN, from: -6, to: -1, count: 3, afternoons: 1, totalMicros: $(6.3) },
  // Pumpkin latte on BEAT: 12 airings, $17.70.
  { spotId: SPOT_IDS.pumpkin, station: BEAT, from: -25, to: -7, count: 8, afternoons: 3, totalMicros: $(11.9) },
  { spotId: SPOT_IDS.pumpkin, station: BEAT, from: -6, to: -1, count: 4, afternoons: 2, totalMicros: $(5.8) },
  // Pumpkin latte on SAZN: 12 airings, $11.28.
  { spotId: SPOT_IDS.pumpkin, station: SAZN, from: -25, to: -7, count: 9, afternoons: 3, totalMicros: $(8.46) },
  { spotId: SPOT_IDS.pumpkin, station: SAZN, from: -6, to: -1, count: 3, afternoons: 1, totalMicros: $(2.82), fixed: [{ day: 0, time: "18:29:00", tunedIn: 188, context: "During Tamales for forty" }] },
  // August: Summer cold brew, 96 airings, $240.40.
  { spotId: SPOT_IDS.summer, station: BEAT, from: -56, to: -26, count: 40, afternoons: 13, totalMicros: $(98.6) },
  { spotId: SPOT_IDS.summer, station: CIVC, from: -56, to: -26, count: 30, afternoons: 10, totalMicros: $(85.2) },
  { spotId: SPOT_IDS.summer, station: SAZN, from: -56, to: -26, count: 26, afternoons: 9, totalMicros: $(56.6) }
];

const dayTime = (day: number, time: string) => at(`${day >= 0 ? "+" : ""}${day} ${time}`);

interface Draft extends Omit<AsRun, "id" | "scans"> {
  fixed: boolean;
  scans?: number;
}

function shuffle<T>(list: T[], r: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Sets the tuned-in figures so the drafts cost exactly `target` in total, starting near `mean`. */
function fitTunedIn(drafts: Draft[], target: number, r: () => number) {
  const free = drafts.filter((d) => !d.fixed);
  const fixedCost = drafts.filter((d) => d.fixed).reduce((s, d) => s + d.costMicros, 0);
  const goal = target - fixedCost;
  const cost = (d: Draft) => airingCost(d.rate, d.tunedIn, d.airedSec, d.lengthSec);
  const perViewer = free[0] ? airingCost(free[0].rate, 1000, free[0].lengthSec, free[0].lengthSec) / 1000 : 1;
  const mean = free.length ? goal / free.length / perViewer : 0;
  for (const d of free) d.tunedIn = Math.max(40, Math.round(mean * (daypartOf(d.startedAt) === "evenings" ? 1.08 : 0.84) * (0.8 + r() * 0.4)));
  let sum = free.reduce((s, d) => s + cost(d), 0);
  const scale = sum > 0 ? goal / sum : 1;
  for (const d of free) d.tunedIn = Math.max(40, Math.round(d.tunedIn * scale));
  sum = free.reduce((s, d) => s + cost(d), 0);
  let i = 0;
  for (let guard = 0; sum !== goal && guard < 200_000 && free.length; guard++) {
    const d = free[i++ % free.length]!;
    const before = cost(d);
    d.tunedIn += sum < goal ? 1 : -1;
    sum += cost(d) - before;
  }
  for (const d of drafts) d.costMicros = cost(d);
}

/** Splits `total` over `weights` in whole numbers (largest remainder). */
export function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length]![1]]! += 1;
  return out;
}

function seedAirings(): AsRun[] {
  const r = rng(2609);
  const used = new Set<string>();
  const drafts: Draft[] = [];
  for (const g of GROUPS) {
    const rate = RATES[g.spotId]!;
    const lengthSec = LENGTH[g.spotId]!;
    const group: Draft[] = [];
    const make = (day: number, time: string, o: Partial<Draft> = {}): Draft => {
      used.add(`${g.station.id}|${day}|${time}`);
      return { businessId: OSC_ID, spotId: g.spotId, stationId: g.station.id, startedAt: dayTime(day, time), lengthSec, airedSec: lengthSec, tunedIn: 0, rate, costMicros: 0, programContext: null, shortReason: null, fixed: false, ...o };
    };
    for (const f of g.fixed ?? []) {
      const d = make(f.day, f.time, { fixed: true, tunedIn: f.tunedIn, airedSec: f.airedSec ?? lengthSec, programContext: f.context, shortReason: f.shortReason ?? null, scans: f.scans });
      d.costMicros = airingCost(rate, d.tunedIn, d.airedSec, d.lengthSec);
      group.push(d);
    }
    const n = g.count - group.length;
    const inWeek = g.from === -6;
    const lastDay = g.to;
    const days = lastDay - g.from + 1;
    const fixedAfternoons = group.filter((d) => daypartOf(d.startedAt) === "afternoons").length;
    const parts = shuffle([...Array(Math.max(0, g.afternoons - fixedAfternoons)).fill("afternoons"), ...Array(Math.max(0, n - g.afternoons + fixedAfternoons)).fill("evenings")] as Array<"afternoons" | "evenings">, r);
    for (let i = 0; i < n; i++) {
      const part = parts[i]!;
      let day = g.from + Math.min(days - 1, Math.floor(((i + r() * 0.9) * days) / n));
      let placed: Draft | null = null;
      for (let tries = 0; tries < days * 2 && !placed; tries++) {
        // Friday of the frames' week: nothing between the town hall and the airings drawn (02.1).
        const slots = shuffle(SLOTS[g.station.id]![part], r).filter((s) => !(inWeek && day === -1 && s >= "19:40"));
        const slot = slots.find((s) => !used.has(`${g.station.id}|${day}|${s}`));
        if (slot) {
          const programs = PROGRAMS[g.station.id]![part];
          const prefix = ["Before", "During", "After"][Math.floor(r() * 3)]!;
          placed = make(day, slot, { programContext: `${prefix} ${programs[Math.floor(r() * programs.length)]}` });
        } else day = day >= lastDay ? g.from : day + 1;
      }
      if (placed) group.push(placed);
    }
    fitTunedIn(group, g.totalMicros, r);
    drafts.push(...group);
  }
  drafts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  // Scans in the hour after each airing: ORANGE10 214 in September, PUMPKIN 52.
  for (const [spotId, total] of [
    [SPOT_IDS.fall, 214],
    [SPOT_IDS.pumpkin, 52]
  ] as const) {
    const list = drafts.filter((d) => d.spotId === spotId);
    const pinned = list.filter((d) => d.scans !== undefined);
    const rest = list.filter((d) => d.scans === undefined);
    const shares = apportion(
      rest.map((d) => d.tunedIn),
      total - pinned.reduce((s, d) => s + (d.scans ?? 0), 0)
    );
    rest.forEach((d, i) => (d.scans = shares[i]));
  }
  return drafts.map((d, i) => {
    const { fixed: _fixed, scans, ...rest } = d;
    return { ...rest, id: uid(700001 + i), scans: scans ?? 0 };
  });
}

/** A use to seed: which code, credited to which station and part of the day, and when it was used. */
interface UseSpec {
  code: "ORANGE10" | "PUMPKIN";
  station: StationIdent;
  how: CodeUse["how"];
  part: "afternoons" | "evenings";
  /** Today at this time, or a day in September before the week, or a day of the week. */
  today?: string;
  day?: number;
}

function useSpecs(): UseSpec[] {
  const list: UseSpec[] = [];
  const add = (n: number, s: UseSpec) => {
    for (let i = 0; i < n; i++) list.push({ ...s });
  };
  // Marked at the counter today: 8.
  ["09:10", "10:05", "11:30"].forEach((t) => list.push({ code: "ORANGE10", station: BEAT, how: "marked", part: "evenings", today: t }));
  list.push({ code: "ORANGE10", station: CIVC, how: "marked", part: "evenings", today: "12:40" });
  list.push({ code: "ORANGE10", station: SAZN, how: "marked", part: "evenings", today: "14:15" });
  ["15:50", "17:20"].forEach((t) => list.push({ code: "PUMPKIN", station: BEAT, how: "marked", part: "evenings", today: t }));
  list.push({ code: "PUMPKIN", station: SAZN, how: "marked", part: "evenings", today: "19:05" });
  // Earlier in the week: 3, through Clear Pay.
  list.push({ code: "ORANGE10", station: BEAT, how: "clear_pay", part: "evenings", day: -3 });
  list.push({ code: "ORANGE10", station: CIVC, how: "clear_pay", part: "evenings", day: -4 });
  list.push({ code: "ORANGE10", station: CIVC, how: "clear_pay", part: "evenings", day: -2 });
  // Before the week: ORANGE10 on BEAT 14 (2 marked), CIVC 6, SAZN 3; PUMPKIN on BEAT 1, SAZN 2.
  // Seven of them credited to afternoon airings.
  add(2, { code: "ORANGE10", station: BEAT, how: "marked", part: "evenings" });
  add(4, { code: "ORANGE10", station: BEAT, how: "clear_pay", part: "afternoons" });
  add(8, { code: "ORANGE10", station: BEAT, how: "clear_pay", part: "evenings" });
  add(2, { code: "ORANGE10", station: CIVC, how: "clear_pay", part: "afternoons" });
  add(4, { code: "ORANGE10", station: CIVC, how: "clear_pay", part: "evenings" });
  add(1, { code: "ORANGE10", station: SAZN, how: "clear_pay", part: "afternoons" });
  add(2, { code: "ORANGE10", station: SAZN, how: "clear_pay", part: "evenings" });
  add(1, { code: "PUMPKIN", station: BEAT, how: "clear_pay", part: "evenings" });
  add(2, { code: "PUMPKIN", station: SAZN, how: "clear_pay", part: "evenings" });
  return list;
}

const CODE_SPOT: Record<string, string> = { ORANGE10: SPOT_IDS.fall, PUMPKIN: SPOT_IDS.pumpkin };

function seedCodes(airings: AsRun[]): { uses: CodeUse[]; saves: CodeSave[] } {
  const r = rng(1026);
  const uses: CodeUse[] = [];
  const saves: CodeSave[] = [];
  const taken = new Set<string>();
  let n = 0;
  for (const s of useSpecs()) {
    const spotId = CODE_SPOT[s.code]!;
    const eligible = airings.filter((a) => a.spotId === spotId && a.stationId === s.station.id && daypartOf(a.startedAt) === s.part);
    let airing: AsRun | undefined;
    let useAt: string;
    if (s.today || s.day !== undefined) {
      useAt = s.today ? at(`+0 ${s.today}`) : dayTime(s.day!, `${10 + Math.floor(r() * 8)}:${String(Math.floor(r() * 60)).padStart(2, "0")}`);
      const t = Date.parse(useAt);
      airing = eligible.filter((a) => Date.parse(a.startedAt) < t && t - Date.parse(a.startedAt) <= 7 * DAY).pop();
    } else {
      // Before the week: an airing from September 1 to 18, used a day or two later.
      const pool = eligible.filter((a) => a.startedAt >= dayTime(-25, "00:00") && a.startedAt < dayTime(-9, "00:00") && !taken.has(a.id));
      airing = pool[Math.floor(r() * pool.length)] ?? eligible[0];
      const after = Date.parse(airing!.startedAt) + (1 + Math.floor(r() * 2)) * DAY;
      const d = new Date(after);
      useAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17 + Math.floor(r() * 8), Math.floor(r() * 60))).toISOString();
    }
    if (airing) taken.add(airing.id);
    const ref = `customer-${++n}`;
    uses.push({ id: uid(720000 + n), businessId: OSC_ID, code: s.code, spotId, airingId: airing?.id ?? null, stationId: airing?.stationId ?? s.station.id, at: useAt, how: s.how, customerRef: ref });
    // Most customers saved the offer first, a few minutes after the airing.
    if (airing && (s.code === "ORANGE10" ? n % 5 !== 0 : n % 2 === 0)) {
      saves.push({ id: uid(730000 + saves.length + 1), code: s.code, stationId: airing.stationId, at: new Date(Date.parse(airing.startedAt) + 3 * 60_000).toISOString(), customerRef: ref });
    }
  }
  // Everyone else who saved an offer and hasn't used it yet: ORANGE10 61 saves in all, PUMPKIN 14.
  for (const [code, total] of [
    ["ORANGE10", 61],
    ["PUMPKIN", 14]
  ] as const) {
    const spotId = CODE_SPOT[code]!;
    const pool = airings.filter((a) => a.spotId === spotId && a.startedAt < dayTime(0, "18:00"));
    let k = 0;
    while (saves.filter((s) => s.code === code).length < total - (code === "ORANGE10" ? 1 : 0)) {
      const a = pool[Math.floor(r() * pool.length)]!;
      saves.push({ id: uid(730000 + saves.length + 1), code, stationId: a.stationId, at: new Date(Date.parse(a.startedAt) + (2 + Math.floor(r() * 30)) * 60_000).toISOString(), customerRef: `saver-${code}-${++k}` });
    }
  }
  // The customer at the counter in the redeem frame (05.1): saved ORANGE10 from BEAT tonight.
  saves.push({ id: uid(730000 + saves.length + 1), code: "ORANGE10", stationId: BEAT.id, at: dayTime(0, "20:32:30"), customerRef: "saver-counter" });
  saves.sort((a, b) => a.at.localeCompare(b.at));
  return { uses, saves };
}

/** The 41 airings stations have scheduled, holding $14.20 (biz-funding 03.1): 9 tonight for $4.60. */
function seedHeld(): HeldAiring[] {
  const list: HeldAiring[] = [];
  const add = (spotId: string, s: StationIdent, day: number, time: string, dollars: number) =>
    list.push({ airingId: uid(710001 + list.length), spotId, stationId: s.id, scheduledAt: dayTime(day, time), heldMicros: $(dollars) });
  ["20:58:30", "21:58:30", "22:58:30"].forEach((t) => add(SPOT_IDS.pumpkin, BEAT, 0, t, 0.51));
  ["20:59:00", "21:29:00", "21:59:00"].forEach((t) => add(SPOT_IDS.pumpkin, SAZN, 0, t, 0.51));
  add(SPOT_IDS.fall, BEAT, 0, "21:28:30", 0.51);
  add(SPOT_IDS.fall, BEAT, 0, "22:28:30", 0.51);
  add(SPOT_IDS.fall, SAZN, 0, "22:29:00", 0.52);
  // Sunday to Tuesday: 32 more at $0.30.
  const plan: Array<[string, StationIdent, string[]]> = [
    [SPOT_IDS.fall, BEAT, ["14:28:30", "19:28:30", "20:28:30", "21:28:30"]],
    [SPOT_IDS.fall, CIVC, ["14:00:00", "19:40:00", "21:10:00"]],
    [SPOT_IDS.fall, SAZN, ["18:29:00", "19:29:00"]]
  ];
  for (const day of [1, 2, 3]) for (const [spotId, s, times] of plan) for (const t of times) add(spotId, s, day, t, 0.3);
  add(SPOT_IDS.pumpkin, BEAT, 1, "19:58:30", 0.3);
  add(SPOT_IDS.pumpkin, SAZN, 1, "17:29:00", 0.3);
  add(SPOT_IDS.pumpkin, BEAT, 2, "19:58:30", 0.3);
  add(SPOT_IDS.pumpkin, SAZN, 2, "17:29:00", 0.3);
  add(SPOT_IDS.pumpkin, BEAT, 3, "19:58:30", 0.3);
  return list;
}

export interface Seed {
  airings: AsRun[];
  uses: CodeUse[];
  saves: CodeSave[];
  held: HeldAiring[];
}

let seedCache: Seed | null = null;

/** The history from before the mock started. Orange Street Coffee's only: other businesses start empty. */
export function resultsSeed(): Seed {
  if (seedCache) return seedCache;
  const airings = seedAirings();
  const { uses, saves } = seedCodes(airings);
  seedCache = { airings, uses, saves, held: seedHeld() };
  return seedCache;
}

// ---------------------------------------------------------------- saved state

let state: ResultsState | null = null;

function fresh(): ResultsState {
  return { version: RESULTS_VERSION, airings: [], uses: [], saves: [], scans: [] };
}

export function resultsState(): ResultsState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as ResultsState) : null;
    state = saved && saved.version === RESULTS_VERSION ? saved : fresh();
  } catch {
    state = fresh();
  }
  return state;
}

export function saveResults() {
  try {
    localStorage.setItem(KEY, JSON.stringify(resultsState()));
  } catch {
    // Private windows: this visit only.
  }
}

export function resetResults() {
  state = fresh();
  saveResults();
}

let seq = 0;
function newId(): string {
  return `00000000-0000-4000-b000-${String(Date.now() % 1e9).padStart(9, "0")}${String(++seq % 1000).padStart(3, "0")}`;
}

// ---------------------------------------------------------------- airings the mock adds

/**
 * Airs a spot with its full as-run entry: spends through the shared db's `move()` (kind "aired")
 * and records the airing, so results, airings and the statement show it. For the Spots area's
 * mock ("air one"); a bare `move()` with kind "aired" is read too, from its label and detail.
 */
export function recordAiring(
  businessId: string,
  o: { spotId: string; stationId: string; tunedIn: number; airedSec?: number; startedAt?: string; programContext?: string | null; shortReason?: string | null }
): AsRun {
  const spot = getDb().spots.find((s) => s.id === o.spotId);
  const s = STATIONS.find((x) => x.id === o.stationId);
  if (!spot || !s) throw new Error("recordAiring: no such spot or station");
  const rate = { kind: spot.rate.kind, micros: spot.rate.micros };
  const airedSec = Math.min(o.airedSec ?? spot.lengthSec, spot.lengthSec);
  const costMicros = airingCost(rate, o.tunedIn, airedSec, spot.lengthSec);
  const startedAt = o.startedAt ?? now().toISOString();
  const rateWords = rate.kind === "per_thousand" ? `, ${money(rate.micros)} per 1,000` : `, ${money(rate.micros)} an airing`;
  const m = move(businessId, {
    kind: "aired",
    label: `Aired on ${s.callSign} ${s.channel}`,
    amountMicros: -costMicros,
    detail: `:${spot.lengthSec} spot, ${o.tunedIn.toLocaleString("en-US")} tuned in${rateWords}${airedSec < spot.lengthSec ? `. Aired :${String(airedSec).padStart(2, "0")} of :${spot.lengthSec}` : ""}`,
    at: startedAt
  });
  const a: AsRun = { id: newId(), businessId, spotId: spot.id, stationId: s.id, startedAt, lengthSec: spot.lengthSec, airedSec, tunedIn: o.tunedIn, rate, costMicros, programContext: o.programContext ?? null, shortReason: o.shortReason ?? null, scans: 0, movementId: m.id };
  resultsState().airings.push(a);
  saveResults();
  return a;
}

/** Movements the shared seed wrote (every later one is `move()`'s, with its own id pattern). */
export function isSeedMovement(m: Movement): boolean {
  return m.id.startsWith("00000000-0000-4000-8000-");
}

/** Which spot an "aired" movement was for: named in its words, or the one of that length on air. */
function spotForMovement(m: Movement, spots: Spot[]): Spot | undefined {
  const words = `${m.label} ${m.detail ?? ""}`;
  const named = spots.find((s) => words.includes(s.title));
  if (named) return named;
  const len = Number(/:(\d+) spot/.exec(words)?.[1] ?? 0);
  let fits = spots.filter((s) => s.lengthSec === len && s.state !== "draft" && s.state !== "in_review");
  // "$8.00 per 1,000" or "$4.00 an airing": the rate tells two spots of one length apart.
  const rate = /\$([\d,.]+) (per 1,000|an airing)/.exec(words);
  if (rate) {
    const kind = rate[2] === "per 1,000" ? "per_thousand" : "per_airing";
    const micros = Math.round(Number(rate[1]!.replace(/,/g, "")) * 1_000_000);
    const same = fits.filter((s) => s.rate.kind === kind && s.rate.micros === micros);
    if (same.length) fits = same;
  }
  return fits.find((s) => s.state === "in_rotation") ?? fits.find((s) => s.state !== "ended") ?? fits[0];
}

/** An airing read from a bare "aired" movement (no as-run entry): its station, spot, tuned in and cost. */
export function airingFromMovement(m: Movement, spots: Spot[]): AsRun | null {
  const cs = /Aired on ([A-Z0-9]{2,6})/.exec(m.label)?.[1];
  const s = cs ? stationByRef(cs) : undefined;
  const spot = spotForMovement(m, spots);
  if (!s || !spot) return null;
  const words = m.detail ?? "";
  const tunedIn = Number(/([\d,]+) tuned in/.exec(words)?.[1]?.replace(/,/g, "") ?? 0);
  const short = /Aired :(\d+) of :(\d+)/.exec(words);
  const airedSec = short ? Number(short[1]) : spot.lengthSec;
  return {
    id: m.id,
    businessId: spot.businessId,
    spotId: spot.id,
    stationId: s.id,
    startedAt: m.at,
    lengthSec: spot.lengthSec,
    airedSec,
    tunedIn,
    rate: { kind: spot.rate.kind, micros: spot.rate.micros },
    costMicros: -m.amountMicros,
    programContext: null,
    shortReason: null,
    scans: 0,
    movementId: m.id
  };
}

/** Every airing of a business: the seed's, and what the mock has aired since. */
export function airingsOf(businessId: string): AsRun[] {
  const d = getDb();
  const spots = d.spots.filter((s) => s.businessId === businessId);
  const seed = businessId === OSC_ID ? resultsSeed().airings : [];
  const recorded = resultsState().airings.filter((a) => a.businessId === businessId);
  const linked = new Set(recorded.map((a) => a.movementId));
  const fromMovements = (d.movements[businessId] ?? [])
    .filter((m) => m.kind === "aired" && !isSeedMovement(m) && !linked.has(m.id))
    .map((m) => airingFromMovement(m, spots))
    .filter((a): a is AsRun => !!a);
  return [...seed, ...recorded, ...fromMovements].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function usesOf(businessId: string): CodeUse[] {
  const seed = businessId === OSC_ID ? resultsSeed().uses : [];
  return [...seed, ...resultsState().uses.filter((u) => u.businessId === businessId)];
}

/** Saves of a code (codes are one business's each). */
export function savesOf(code: string): CodeSave[] {
  return [...resultsSeed().saves.filter((s) => s.code === code), ...resultsState().saves.filter((s) => s.code === code)].sort((a, b) => a.at.localeCompare(b.at));
}

export function heldOf(businessId: string): HeldAiring[] {
  return businessId === OSC_ID ? resultsSeed().held : [];
}

/** The mock's own scans in the hour after an airing (the seed's are on the airing). */
export function extraScans(airing: AsRun): number {
  const t = Date.parse(airing.startedAt);
  return resultsState().scans.filter((s) => s.airingId === airing.id || (s.airingId === null && s.stationId === airing.stationId && Date.parse(s.at) >= t && Date.parse(s.at) - t < 3600e3)).length;
}

// ---------------------------------------------------------------- codes

/** The spot a code belongs to, in any business. */
export function spotForCode(code: string): Spot | undefined {
  const c = code.trim().toUpperCase();
  return getDb().spots.find((s) => s.code?.code.toUpperCase() === c);
}

/** P4: once per customer, and how long a saved offer keeps (14 days: saved Saturday, "Until October 10"). */
export const CODE_RULES = { oncePerCustomer: true, savedForDays: 14 };

/** P20: which counters are connected (the Settings area's connections; Clear Pay on for Orange Street). */
export function connectionsOf(businessId: string): { clearPay: boolean; checkout: string | null } {
  try {
    const c = settingsFixture.settingsState().connections[businessId];
    if (c) return { clearPay: c.clearPay, checkout: c.checkout };
  } catch {
    // The Settings area's state isn't there: fall back to the frames'.
  }
  return { clearPay: businessId === OSC_ID, checkout: null };
}

/** P12: the Redeem tool, as the business set it (Settings, Connections); on unless it's online. */
export function redeemOn(businessId: string): boolean {
  const b = dbBusiness(businessId);
  return b?.redeemOn ?? b?.customersWhere !== "online";
}

export function redeemedToday(businessId: string, at: Date = now()): number {
  const today = marketDate(at);
  return usesOf(businessId).filter((u) => u.how === "marked" && marketDate(u.at) === today).length;
}

export interface CodeCheck {
  valid: boolean;
  firstUse: boolean;
  countsAsCustomer: boolean;
  savedFrom: StationIdent | null;
  savedAt: string | null;
  offer: string | null;
  spotTitle: string | null;
  code: string;
  message: string;
  /** Who is at the counter: the customer the code was saved by, when it's known. */
  customerRef: string | null;
  airing: AsRun | null;
}

const weekday = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: MARKET_TZ }).format(new Date(iso));
const longDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: MARKET_TZ }).format(new Date(iso));

/**
 * Checks a code at the counter: one of this business's, still running, the customer's first use,
 * and where it was saved. Without a customer (a typed code), the customer is taken to be the one
 * who saved it most recently and hasn't used it (open question: the API has no way to tell).
 */
export function checkCode(businessId: string, rawCode: string, customerRef: string | undefined, at: Date = now()): CodeCheck {
  const code = rawCode.trim().toUpperCase();
  const spot = spotForCode(code);
  const base = { code, firstUse: false, countsAsCustomer: false, savedFrom: null, savedAt: null, offer: null, spotTitle: null, customerRef: customerRef ?? null, airing: null };
  if (!spot || spot.businessId !== businessId || !spot.code) return { ...base, valid: false, message: `${code} isn't one of your codes. Check it with the customer.` };
  const offer = spot.code.offer;
  const uses = usesOf(businessId).filter((u) => u.code === code);
  const saves = savesOf(code).filter((s) => Date.parse(s.at) <= at.getTime());
  const usedRefs = new Set(uses.map((u) => u.customerRef));
  const save = customerRef ? saves.filter((s) => s.customerRef === customerRef).pop() : saves.filter((s) => !usedRefs.has(s.customerRef)).pop();
  const who = customerRef ?? save?.customerRef ?? null;
  const common = { ...base, offer, spotTitle: spot.title, customerRef: who };
  if (spot.state === "ended" && spot.endsOn && marketDate(at) > spot.endsOn) return { ...common, valid: false, message: `${code} ended on ${longDate(`${spot.endsOn}T19:00:00Z`)}.` };
  if (save && Date.parse(save.at) + CODE_RULES.savedForDays * DAY < at.getTime()) return { ...common, valid: false, message: `This saved offer ran out on ${longDate(new Date(Date.parse(save.at) + CODE_RULES.savedForDays * DAY).toISOString())}.` };
  const before = who ? uses.find((u) => u.customerRef === who) : undefined;
  if (before && CODE_RULES.oncePerCustomer) return { ...common, valid: false, firstUse: false, message: `This customer used ${code} on ${weekday(before.at)}, ${longDate(before.at)}. It's once per customer.` };
  // Counts as a customer when an airing of the spot ran within the window before now.
  const window = spot.code.windowDays * DAY;
  const recent = airingsOf(businessId).filter((a) => a.spotId === spot.id && Date.parse(a.startedAt) <= at.getTime() && at.getTime() - Date.parse(a.startedAt) <= window);
  const airing = recent.filter((a) => a.stationId === save?.stationId).pop() ?? recent.pop() ?? null;
  const savedFrom = save?.stationId ? (STATIONS.find((s) => s.id === save.stationId) ?? null) : null;
  const parts = [`${code} is good.`, "First use for this customer."];
  if (savedFrom && save) parts.push(`Saved from ${savedFrom.callSign} ${savedFrom.channel} on ${weekday(save.at)}.`);
  if (!airing) parts.push(`It won't count as a customer: no airing in the last ${spot.code.windowDays} days.`);
  return { ...common, valid: true, firstUse: true, countsAsCustomer: !!airing, savedFrom, savedAt: save?.at ?? null, message: parts.join(" "), airing };
}

/** Marks a code used at the counter (after the same check). */
export function redeem(businessId: string, rawCode: string, customerRef: string | undefined, at: Date = now()): CodeCheck {
  const c = checkCode(businessId, rawCode, customerRef, at);
  if (!c.valid) return c;
  const spot = spotForCode(c.code)!;
  resultsState().uses.push({
    id: newId(),
    businessId,
    code: c.code,
    spotId: spot.id,
    airingId: c.countsAsCustomer ? (c.airing?.id ?? null) : null,
    stationId: c.countsAsCustomer ? (c.airing?.stationId ?? c.savedFrom?.id ?? null) : null,
    at: at.toISOString(),
    how: "marked",
    customerRef: c.customerRef ?? `counter-${newId()}`
  });
  saveResults();
  return c;
}

/** A viewer scanned a code's QR (from the page the QR opens). */
export function recordScan(code: string, stationId: string | null, airingId: string | null) {
  resultsState().scans.push({ id: newId(), code: code.toUpperCase(), stationId, airingId, at: now().toISOString() });
  saveResults();
}

/** A viewer saved the offer to their phone. */
export function recordSave(code: string, stationId: string | null, customerRef: string | null): CodeSave {
  const s: CodeSave = { id: newId(), code: code.toUpperCase(), stationId, at: now().toISOString(), customerRef: customerRef ?? `saver-${newId()}` };
  resultsState().saves.push(s);
  saveResults();
  return s;
}

// ---------------------------------------------------------------- statements

export interface StatementLine {
  group: "balance" | "spent";
  kind: "added" | "aired" | "returned" | "fees" | "sponsorship" | "order" | "withdrawn" | "refund" | "spot_station";
  label: string;
  detail: string | null;
  amountMicros: number;
  airings?: number;
  includedAbove?: boolean;
}

export interface MockStatement {
  id: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  openingMicros: number;
  closingMicros: number;
  closingAvailableMicros: number;
  closingHeldMicros: number;
  inProgress: boolean;
  asOf: string;
  finalOn: string | null;
  issuedAt: string;
  lines: StatementLine[];
}

/** What each seeded month held before the mock: opening, what was added, other lines, and the closing split. */
interface MonthBook {
  id: string;
  month: string;
  openingMicros: number;
  added: Array<{ amountMicros: number; detail: string }>;
  other: StatementLine[];
  closingAvailableMicros?: number;
  closingHeldMicros?: number;
}

const BOOKS: Record<string, MonthBook[]> = {
  [OSC_ID]: [
    {
      id: STATEMENT_IDS.august,
      month: "2026-08",
      openingMicros: $(166),
      added: [{ amountMicros: $(300), detail: "Bank transfer through Clear, August 3" }],
      other: [{ group: "balance", kind: "sponsorship", label: "Sponsorships", detail: "Council Watch on CIVC 7.1, August", amountMicros: -$(50) }],
      closingAvailableMicros: $(170.1),
      closingHeldMicros: $(5.5)
    },
    { id: STATEMENT_IDS.september, month: "2026-09", openingMicros: $(175.6), added: [{ amountMicros: $(500), detail: "Bank transfer through Clear, September 1" }], other: [] }
  ]
};

const monthStart = (month: string) => `${month}-01`;
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
const MONTH_NAME = (month: string) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
const dayName = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: MARKET_TZ }).format(new Date(iso));

const FLOW_KINDS = new Set(["aired", "added", "withdrawn", "fee", "sponsorship", "order", "refund"]);

/**
 * A business's monthly statements, newest first: each seeded month as it was, the current month
 * with everything the mock has done since it started, from the shared db's movements. Money moved
 * into and out of held isn't spending; what can't be told apart by kind (a "returned" line can be a
 * short airing's money back, or a hold released) is worked out from the balance itself, so the
 * statement always ends where the balance is.
 */
export function statementsOf(businessId: string, at: Date = now()): MockStatement[] {
  const books = BOOKS[businessId];
  const seeded = seedBusinesses().some((b) => b.id === businessId);
  // A business from the seed with no books (Cypress Dental) has no statements in the mock.
  if (seeded && !books) return [];
  const all = airingsOf(businessId);
  const after = (getDb().movements[businessId] ?? []).filter((m) => !isSeedMovement(m));
  const b = balanceOf(businessId);
  const s0 = seeded ? (seedBalances()[businessId] ?? { availableMicros: 0, heldMicros: 0 }) : { availableMicros: 0, heldMicros: 0 };
  const flowsTotal = b.availableMicros + b.heldMicros - (s0.availableMicros + s0.heldMicros);
  const knownFlows = after.filter((m) => FLOW_KINDS.has(m.kind)).reduce((s, m) => s + m.amountMicros, 0);
  const residual = flowsTotal - knownFlows;
  const nowMonth = marketDate(at).slice(0, 7);

  // Months: the seeded ones, then each month since, up to now; a new business starts with its first movement.
  const months: string[] = books ? books.map((x) => x.month) : [];
  const firstNew = after.length ? marketDate(after[after.length - 1]!.at).slice(0, 7) : null;
  let m = months.length ? nextMonth(months[months.length - 1]!) : firstNew;
  while (m && m <= nowMonth) {
    months.push(m);
    m = nextMonth(m);
  }
  const residualMonth = after.filter((x) => x.kind === "returned").map((x) => marketDate(x.at).slice(0, 7))[0] ?? nowMonth;

  const out: MockStatement[] = [];
  let opening = 0;
  for (const month of months) {
    const book = books?.find((x) => x.month === month);
    if (book) opening = book.openingMicros;
    const inMonth = (iso: string) => marketDate(iso).slice(0, 7) === month;
    const airings = all.filter((a) => inMonth(a.startedAt));
    const moves = after.filter((x) => inMonth(x.at));
    const lines: StatementLine[] = [];
    for (const a of book?.added ?? []) lines.push({ group: "balance", kind: "added", label: "Added", detail: a.detail, amountMicros: a.amountMicros });
    for (const x of moves.filter((x) => x.kind === "added").reverse()) lines.push({ group: "balance", kind: "added", label: "Added", detail: `${x.label}, ${dayName(x.at)}`, amountMicros: x.amountMicros });
    // Short airings with their own as-run entry were charged for what aired: the rest came back.
    const entered = airings.filter((a) => !a.movementId || a.id !== a.movementId);
    const returnedSeed = entered.reduce((s, a) => s + (airingCost(a.rate, a.tunedIn, a.lengthSec, a.lengthSec) - a.costMicros), 0);
    const shortCount = entered.filter((a) => a.airedSec < a.lengthSec).length;
    const returnedAfter = month === residualMonth ? residual : 0;
    const spent = -airings.reduce((s, a) => s + a.costMicros, 0) + returnedAfter;
    lines.push({ group: "balance", kind: "aired", label: "Spent on airings", detail: `${airings.length.toLocaleString("en-US")} ${airings.length === 1 ? "airing" : "airings"}`, amountMicros: spent, airings: airings.length });
    const returned = returnedSeed + returnedAfter;
    lines.push({
      group: "balance",
      kind: "returned",
      label: "Returned from short airings",
      detail: returned > 0 ? `${shortCount || 1} ${shortCount === 1 ? "airing" : "airings"} cut short, included above` : "None this month",
      amountMicros: returned,
      includedAbove: true
    });
    lines.push(...(book?.other ?? []));
    for (const x of moves.filter((x) => x.kind === "sponsorship" || x.kind === "order" || x.kind === "withdrawn" || x.kind === "refund").reverse()) {
      const label = x.kind === "sponsorship" ? "Sponsorships" : x.kind === "order" ? "Made for you" : x.kind === "withdrawn" ? "Taken out" : "Refunds";
      lines.push({ group: "balance", kind: x.kind as StatementLine["kind"], label, detail: [x.label, x.detail].filter(Boolean).join(". "), amountMicros: x.amountMicros });
    }
    const fees = moves.filter((x) => x.kind === "fee").reduce((s, x) => s + x.amountMicros, 0);
    lines.push({ group: "balance", kind: "fees", label: "Fees", detail: fees ? "Card fees, Stripe's at cost" : "None. Bank transfers through Clear are free", amountMicros: fees });

    // Spent, by spot and station: spots by what they spent, then stations.
    const bySpot = new Map<string, AsRun[]>();
    for (const a of airings) bySpot.set(a.spotId, [...(bySpot.get(a.spotId) ?? []), a]);
    const total = (l: AsRun[]) => l.reduce((s, a) => s + a.costMicros, 0);
    const spotOrder = [...bySpot.entries()].sort((x, y) => total(y[1]) - total(x[1]));
    for (const [spotId, list] of spotOrder) {
      const title = getDb().spots.find((s) => s.id === spotId)?.title ?? "A spot";
      const byStation = new Map<string, AsRun[]>();
      for (const a of list) byStation.set(a.stationId, [...(byStation.get(a.stationId) ?? []), a]);
      for (const [stationId, l] of [...byStation.entries()].sort((x, y) => total(y[1]) - total(x[1]))) {
        const s = STATIONS.find((x) => x.id === stationId);
        lines.push({ group: "spent", kind: "spot_station", label: `${title} on ${s?.callSign} ${s?.channel}`, detail: `${l.length} ${l.length === 1 ? "airing" : "airings"}`, amountMicros: total(l), airings: l.length });
      }
    }

    const change = lines.filter((l) => l.group === "balance" && !l.includedAbove).reduce((s, l) => s + l.amountMicros, 0);
    const closing = opening + change;
    const current = month === nowMonth;
    const asOf = current ? marketDate(at) : monthEnd(month);
    out.push({
      id: book?.id ?? `00000000-0000-4000-b660-${month.replace("-", "")}${businessId.replace(/-/g, "").slice(-6)}`,
      month,
      periodStart: monthStart(month),
      periodEnd: monthEnd(month),
      openingMicros: opening,
      closingMicros: closing,
      closingAvailableMicros: current ? b.availableMicros : (book?.closingAvailableMicros ?? closing),
      closingHeldMicros: current ? b.heldMicros : (book?.closingHeldMicros ?? 0),
      inProgress: current,
      asOf,
      finalOn: current ? monthStart(nextMonth(month)) : null,
      issuedAt: current ? at.toISOString() : `${monthStart(nextMonth(month))}T07:05:00.000Z`,
      lines
    });
    opening = closing;
  }
  return out.reverse();
}

export function statementTitle(month: string): string {
  return `${MONTH_NAME(month)} statement`;
}

/** The statement's CSV: every line, and each airing under its spot-and-station line with its as-run entry. */
export function statementCsv(businessId: string, st: MockStatement): { filename: string; csv: string } {
  const q = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows: Array<Array<string | number>> = [["Line", "Detail", "Amount", "Aired at", "Station", "Spot", "In", "Aired", "Tuned in", "Working", "As-run entry"]];
  const dollars = (micros: number) => (micros / 1_000_000).toFixed(2);
  rows.push(["Started the month", "", dollars(st.openingMicros), "", "", "", "", "", "", "", ""]);
  for (const l of st.lines.filter((x) => x.group === "balance")) rows.push([l.label, l.detail ?? "", dollars(l.amountMicros), "", "", "", "", "", "", "", ""]);
  rows.push([st.inProgress ? "Balance now" : "Ended the month", "", dollars(st.closingMicros), "", "", "", "", "", "", "", ""]);
  const airings = airingsOf(businessId).filter((a) => marketDate(a.startedAt).slice(0, 7) === st.month);
  for (const l of st.lines.filter((x) => x.group === "spent")) {
    rows.push([l.label, l.detail ?? "", dollars(l.amountMicros), "", "", "", "", "", "", "", ""]);
    for (const a of airings) {
      const s = STATIONS.find((x) => x.id === a.stationId)!;
      const title = getDb().spots.find((x) => x.id === a.spotId)?.title ?? "";
      if (l.label !== `${title} on ${s.callSign} ${s.channel}`) continue;
      rows.push(["", "", dollars(a.costMicros), a.startedAt, `${s.callSign} ${s.channel}`, title, a.programContext ?? "", `:${String(a.airedSec).padStart(2, "0")} of :${a.lengthSec}`, a.tunedIn, working(a), a.id]);
    }
  }
  const name = (dbBusiness(businessId)?.name ?? "business").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { filename: `${name}-statement-${st.month}.csv`, csv: rows.map((r) => r.map(q).join(",")).join("\n") + "\n" };
}

/** A one-page PDF of the statement's lines (Helvetica, plain text), as a data URL. */
export function statementPdf(businessName: string, st: MockStatement): string {
  const lines = [
    `${businessName}, ${statementTitle(st.month)}`,
    st.inProgress ? `${st.periodStart} to ${st.asOf}, so far` : `${st.periodStart} to ${st.periodEnd}`,
    "",
    `Started the month  ${money(st.openingMicros)}`,
    ...st.lines.filter((l) => l.group === "balance").map((l) => `${l.label}${l.detail ? ` (${l.detail})` : ""}  ${money(l.amountMicros, { sign: l.kind === "added" })}`),
    `${st.inProgress ? "Balance now" : "Ended the month"}  ${money(st.closingMicros)}`,
    "",
    "Spent, by spot and station",
    ...st.lines.filter((l) => l.group === "spent").map((l) => `${l.label}, ${l.detail}  ${money(l.amountMicros)}`)
  ];
  const ascii = (s: string) => s.replace(/−/g, "-").replace(/×/g, "x").replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
  const text = ["BT", "/F1 11 Tf", "15 TL", "56 790 Td", ...lines.map((l, i) => `${i ? "T* " : ""}(${ascii(l)}) Tj`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${btoa(pdf)}`;
}

// ---------------------------------------------------------------- the proof frame

const STILLS: Record<string, { colour: string; headline: string }> = {
  [SPOT_IDS.fall]: { colour: "#6B4A2B", headline: "Fall at Orange Street" },
  [SPOT_IDS.pumpkin]: { colour: "#8A4B1C", headline: "Pumpkin latte, all fall" },
  [SPOT_IDS.summer]: { colour: "#2F5670", headline: "Cold brew, all summer" },
  [SPOT_IDS.colton]: { colour: "#3E5C3A", headline: "Now open in Colton" }
};

/**
 * The frame captured during an airing, with the station's bug on it (drawn, for the mock: the
 * spot's title card as the airings frame draws it, and the bug bottom right).
 */
export function proofFrame(spot: { id: string; title: string }, s: StationIdent): string {
  const still = STILLS[spot.id] ?? { colour: "#2A3A40", headline: spot.title };
  const x = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const words = still.headline.split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= 15) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const top = 90 - ((lines.length - 1) * 25) / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="640" height="360">` +
    `<rect width="320" height="180" fill="${still.colour}"/>` +
    lines.map((l, i) => `<text x="29" y="${top + i * 25}" font-family="Archivo, 'Arial Black', Arial, sans-serif" font-weight="800" font-size="25" fill="#fff">${x(l)}</text>`).join("") +
    `<text x="302" y="155" text-anchor="end" font-family="Archivo, Arial, sans-serif" font-weight="800" font-size="10" fill="#fff" fill-opacity=".92">${x(s.callSign ?? "")}</text>` +
    `<text x="302" y="166" text-anchor="end" font-family="'IBM Plex Mono', Menlo, monospace" font-size="6.5" fill="#fff" fill-opacity=".75">${x(s.channel ?? "")}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
