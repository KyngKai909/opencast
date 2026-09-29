// The Spots area's mock state and rules: what the API would know about each spot beyond the
// contract (its still, the stations it's in rotation on, its pause and its return, its pace), the
// stations a spot can be matched to, the checks an upload gets, and what airing a spot does to the
// budget and the balance. The spots themselves live in the shared db (db.spots); money moves only
// through move(), so the shell's "Available", the Balance page and the runway agree.
//
// Illustrations from biz-spots: Fall menu in rotation on BEAT, CIVC and SAZN, spending about $11.70
// a day (so "$200 more is about 17 days"); the targeting list's seven stations (LUPE 33.1 joins the
// market on Monday); what each station does when Fall menu pauses (BEAT's backup rotation, another
// spot on CIVC, station ID on SAZN).

import type { Business, Spot, SpotBackStory, SpotPauseStory, SpotStill, StationIdent, Targeting, TargetMatch, UploadCheck } from "@opencast/contracts";
import type { SpotX } from "../../api/ext/spots";
import type { FilledWith } from "../../api/types";
import { now } from "../../lib/clock";
import { balanceOf, getDb, move, saveDb } from "../db";
import { uid } from "./people";
import { STATIONS } from "./stations";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const CENT = 10_000;
const cents = (micros: number) => Math.round(micros / CENT) * CENT;

// ---- Stations, as targeting sees them ----

export { LUPE } from "./stations";
import { LUPE } from "./stations";

const REDLANDS = { lat: 34.0556, lon: -117.1825 };

interface StationFacts {
  station: StationIdent;
  /** The kind of station, as the targeting chips name it. Radio stations are "Radio band". */
  category: string;
  lat: number;
  lon: number;
  /** Tuned in per airing, low and high, lately. */
  tunedIn: [number, number];
  /** Joins the market on this date (in the market's zone), or null. */
  joinsOn?: () => Date;
}

const byCall = (cs: string) => STATIONS.find((s) => s.callSign === cs)!;
// Placed north of Orange Street at the distances the targeting frame gives.
const north = (miles: number) => ({ lat: REDLANDS.lat + miles / 69.05, lon: REDLANDS.lon });

/** Next Monday at midnight in the market (the mock clock's Saturday: two days on). */
function nextMonday(): Date {
  const t = now();
  const day = new Date(t.getTime() - 7 * 3600e3).getUTCDay();
  const add = (8 - day) % 7 || 7;
  const d = new Date(t.getTime() - 7 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 7));
}

export const STATION_FACTS: StationFacts[] = [
  { station: byCall("CIVC"), category: "Public affairs", ...north(0.8), tunedIn: [190, 400] },
  { station: byCall("BEAT"), category: "Music", ...north(1.2), tunedIn: [175, 330] },
  { station: byCall("SAZN"), category: "Food", ...north(6.1), tunedIn: [210, 380] },
  { station: byCall("REEL"), category: "Classic", ...north(4.4), tunedIn: [180, 300] },
  { station: LUPE, category: "Food", ...north(8.9), tunedIn: [200, 412], joinsOn: nextMonday },
  { station: byCall("PREP"), category: "Sports", ...north(11.4), tunedIn: [150, 260] },
  { station: byCall("NITE"), category: "Radio band", ...north(9.6), tunedIn: [60, 140] },
  { station: byCall("HALL"), category: "Radio band", ...north(26.5), tunedIn: [40, 90] },
  { station: byCall("VOZE"), category: "Radio band", ...north(29.2), tunedIn: [80, 160] }
];

/** The kinds of station the targeting chips offer, in the frame's order. */
export const STATION_KINDS = ["Music", "Public affairs", "Food", "Classic", "Sports"] as const;

/** How far targeting looks (the slider's end). Stations farther than this aren't named. */
export const FARTHEST_MILES = 25;

function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)) * 10) / 10;
}

function factsFor(id: string): StationFacts | undefined {
  return STATION_FACTS.find((f) => f.station.id === id);
}

export function stationById(id: string): StationIdent | undefined {
  return factsFor(id)?.station ?? STATIONS.find((s) => s.id === id);
}

const channelOrder = (s: StationIdent) => Number.parseFloat(s.channel ?? "999");

function weekdayOf(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }).format(d);
}

/** What an airing costs at a rate: per 1,000 tuned in, or flat. Rounded to the cent. */
export function airingCost(rate: Spot["rate"], tunedIn: number): number {
  return rate.kind === "per_airing" ? rate.micros : cents((tunedIn * rate.micros) / 1000);
}

/**
 * Which stations would see a spot in their market, and why a nearby one wouldn't: a kind or the
 * radio band not chosen, left out by name, too far, or not in the market yet.
 */
export function matchStations(business: Business, rate: Spot["rate"], t: Partial<Targeting>): TargetMatch[] {
  const online = business.customersWhere === "online";
  const within = t.withinMiles ?? 10;
  const places = business.locations.filter((l) => !t.locationIds?.length || t.locationIds.includes(l.id));
  const kinds = t.stationCategories ?? [];
  const radio = (t.bands ?? ["tv"]).includes("radio");
  const out: TargetMatch[] = [];
  for (const f of STATION_FACTS) {
    const d = online || !places.length ? null : Math.min(...places.map((p) => miles({ lat: p.latitude, lon: p.longitude }, f)));
    if (d !== null && d > FARTHEST_MILES) continue;
    const isRadio = f.station.band === "radio";
    let reason: string | null = null;
    if (isRadio ? !radio : kinds.length > 0 && !kinds.includes(f.category)) reason = "not chosen";
    else if (t.excludedStationIds?.includes(f.station.id)) reason = "left out";
    else if (d !== null && d > within) reason = `farther than ${within} mi`;
    const joins = f.joinsOn?.();
    const later = joins && joins.getTime() > now().getTime();
    const included = reason === null;
    if (included && later) reason = `From ${weekdayOf(joins)}`;
    out.push({
      station: f.station,
      category: f.category,
      miles: d,
      included,
      reason,
      estimatedCostPerAiringMicros: included ? { low: airingCost(rate, f.tunedIn[0]), high: airingCost(rate, f.tunedIn[1]) } : null
    });
  }
  return [...out.filter((m) => m.included).sort((a, b) => channelOrder(a.station) - channelOrder(b.station)), ...out.filter((m) => !m.included).sort((a, b) => channelOrder(a.station) - channelOrder(b.station))];
}

// ---- Upload checks ----

const PHONE_BOX = { x: 0.785, y: 0.917, w: 0.2, h: 0.063 };
const CODE_BOX = { x: 0.06, y: 0.7, w: 0.36, h: 0.165 };
const lengthWords = (sec: number) => `:${String(sec).padStart(2, "0")}`;

/**
 * What the mock finds in every upload (biz-spots 02.1): length, picture and captions fine, loudness
 * levelled, a phone number outside title safe (fixed by shrinking to fit), and the code added.
 */
export function uploadChecks(lengthSec: number, code: string | null, scaled: boolean): UploadCheck[] {
  const len = lengthWords(lengthSec);
  const checks: UploadCheck[] = [
    { check: "length", result: "fine", label: `Length ${len}.0`, detail: { note: `Exactly a ${len} spot` } },
    { check: "picture", result: "fine", label: "Picture 1920 by 1080", detail: { note: "Airs full screen on TV and web" } },
    { check: "captions", result: "fine", label: "Captions", detail: { note: "Generated from the voiceover. You can edit them" } },
    { check: "loudness", result: "fixed", label: "Loudness levelled", detail: { note: "It was much louder than programs. We brought it to broadcast level so it won't jump out" } },
    scaled
      ? { check: "safe_area", result: "fixed", label: "Shrunk to fit", detail: { note: "The whole spot is slightly smaller, so everything is inside title safe", text: "(909) 555-0142" } }
      : {
          check: "safe_area",
          result: "for_you",
          label: "Phone number outside title safe",
          detail: { note: "Some TVs will cut it off. Upload a new cut, or we can shrink the whole spot slightly to fit", box: PHONE_BOX, text: "(909) 555-0142" }
        }
  ];
  if (code)
    checks.push({
      check: "code",
      result: "fine",
      label: `Code ${code} added`,
      detail: { note: "With a QR, bottom left, for the last :10", placement: "bottom_left", box: CODE_BOX, fromMs: (lengthSec - 10) * 1000, toMs: lengthSec * 1000 }
    });
  return checks;
}

/** Opencast picks each spot's code: the business's first word and a number, unique to it. */
export function codeFor(business: Business, taken: string[]): string {
  const base = (business.name.split(/\s+/)[0] ?? "SPOT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "SPOT";
  for (let n = 10; ; n++) if (!taken.includes(`${base}${n}`)) return `${base}${n}`;
}

// ---- The mock's own state per spot ----

export interface SpotMock {
  still: SpotStill;
  /** Station ids with the spot in rotation (P5). */
  rotation: string[];
  pause: SpotPauseStory | null;
  back: SpotBackStory | null;
  pace: number | null;
  /** Review passes on its own at this time (ms since 1970), in mock mode. */
  reviewReadyAt: number | null;
  /** Airings so far, for the tuned-in numbers the mock makes up. */
  aired: number;
  /** Shrunk to fit title safe. */
  scaled: boolean;
  /** P8: the bands targeting asks for (radio is a chip under kinds of station). */
  bands?: ("tv" | "radio")[];
  /** The spot's state when this was last saved: if the shared db moved on without us (reset, or
   * another area changed it), this entry starts over rather than tell an old story. */
  seenState?: Spot["state"];
}

interface Store {
  version: number;
  spots: Record<string, SpotMock>;
  nextId: number;
}

const KEY = "oc-mock-spots-spots-v1";
const VERSION = 1;

/** Review takes this long in mock mode, from submitting (or use the mock control to pass it at once). */
export const REVIEW_MS = 20_000;

const PALETTE = ["#6B4A2B", "#9A5412", "#2E6B5A", "#33507A", "#56508A"];

/** The spots' own title cards, as the frames draw them. */
const STILLS: Record<string, Omit<SpotStill, "stillUrl">> = {
  "Fall menu": { colour: "#6B4A2B", label: "Fall menu", headline: "Fall at Orange Street", line: "Pumpkin bread, cider, and the big mugs are back." },
  "Pumpkin latte": { colour: "#9A5412", label: "Pumpkin latte", headline: "Pumpkin latte", line: "Back for the fall at Orange Street." },
  "Now open in Colton": { colour: "#6B4A2B", label: "Colton opening", headline: "Now open in Colton", line: "Orange Street Coffee, on Washington Street." },
  "Summer cold brew": { colour: "#525C73", label: "Summer", headline: "Summer cold brew", line: "Cold brew on tap all summer." }
};

const [CIVC, BEAT, SAZN] = ["CIVC", "BEAT", "SAZN"].map(byCall);

function seedStore(): Store {
  const base = (title: string, extra: Partial<SpotMock> = {}): SpotMock => ({
    still: { stillUrl: null, ...STILLS[title]! },
    rotation: [],
    pause: null,
    back: null,
    pace: null,
    reviewReadyAt: null,
    aired: 0,
    scaled: true,
    ...extra
  });
  return {
    version: VERSION,
    nextId: 1,
    spots: {
      [uid(64001)]: base("Fall menu", { rotation: [BEAT.id, CIVC.id, SAZN.id], pace: $(11.7), aired: 76 }),
      [uid(64002)]: base("Pumpkin latte", { rotation: [BEAT.id, SAZN.id], pace: $(4), aired: 12 }),
      [uid(64003)]: base("Now open in Colton"),
      [uid(64004)]: base("Summer cold brew", { pace: null, aired: 104 })
    }
  };
}

let store: Store | null = null;

function getStore(): Store {
  if (store) return store;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Store) : null;
    store = saved && saved.version === VERSION ? saved : seedStore();
  } catch {
    store = seedStore();
  }
  return store;
}

export function saveSpots() {
  const st = getStore();
  for (const s of getDb().spots) if (st.spots[s.id]) st.spots[s.id]!.seenState = s.state;
  saveDb();
  try {
    localStorage.setItem(KEY, JSON.stringify(getStore()));
  } catch {
    // Private windows: state for this visit only.
  }
}

/** Tests start over. */
export function resetSpotsMock() {
  store = seedStore();
}

export function mockOf(s: Spot): SpotMock {
  const st = getStore();
  const had = st.spots[s.id];
  if (had?.seenState && had.seenState !== s.state) {
    const fresh = seedStore().spots[s.id];
    st.spots[s.id] = fresh ? { ...fresh, seenState: s.state } : { ...had, rotation: [], pause: null, back: null, reviewReadyAt: null, seenState: s.state };
  }
  st.spots[s.id] ??= {
    still: { stillUrl: null, colour: PALETTE[Object.keys(st.spots).length % PALETTE.length]!, label: s.title, headline: s.title, line: null },
    rotation: [],
    pause: null,
    back: null,
    pace: null,
    reviewReadyAt: null,
    aired: 0,
    scaled: false
  };
  return st.spots[s.id]!;
}

export function newSpotId(): string {
  const st = getStore();
  const taken = new Set(getDb().spots.map((s) => s.id));
  let id: string;
  do id = uid(64100 + st.nextId++);
  while (taken.has(id));
  return id;
}

/** A still for a new spot: the frame's own for a title it draws, else the spot's colour and words. */
export function stillFor(title: string, businessName: string, n: number): SpotStill {
  const known = STILLS[title];
  if (known) return { stillUrl: null, ...known };
  return { stillUrl: null, colour: PALETTE[n % PALETTE.length]!, label: title, headline: title, line: businessName };
}

/** Review passes by itself in mock mode, REVIEW_MS after submitting. */
export function settle(s: Spot) {
  const m = mockOf(s);
  if (s.state === "in_review" && m.reviewReadyAt !== null && m.reviewReadyAt <= Date.now()) {
    s.state = "listed";
    m.reviewReadyAt = null;
    saveSpots();
  }
}

/** P4: how a code works, as the API sends it (the letters' corner and the last :10; once per customer). */
export function codeOut(code: NonNullable<Spot["code"]>): NonNullable<Spot["code"]> {
  return { pickedBy: "opencast", oncePerCustomer: true, savedForDays: code.windowDays, placement: "bottom_left", showsForLastMs: 10_000, ...code };
}

/** The spot as the API sends it, with the mock's own state (still, rotation, pause, pace). */
export function spotOut(s: Spot): SpotX {
  settle(s);
  const m = mockOf(s);
  const inRotation = s.state === "in_rotation" || s.state === "paused_daily_cap" ? m.rotation.map((id) => stationById(id)).filter((x): x is StationIdent => !!x) : [];
  return {
    ...s,
    code: s.code ? codeOut(s.code) : null,
    targeting: { ...s.targeting, bands: m.bands ?? ["tv"] },
    inRotationOn: inRotation.length,
    still: m.still,
    inRotationStations: inRotation,
    pause: m.pause,
    back: m.back,
    pacePerDayMicros: m.pace
  };
}

// ---- Airing, pausing and coming back ----

/** What each station does with the time when a spot pauses (biz-spots 04.1). */
const FILLS: Record<string, FilledWith> = { BEAT: "backup_rotation", CIVC: "another_spot", SAZN: "station_id" };

function pauseStory(s: Spot, reason: SpotPauseStory["reason"], lastHold: SpotPauseStory["lastHold"]): SpotPauseStory {
  const m = mockOf(s);
  return {
    reason,
    pausedAt: now().toISOString(),
    lastHold,
    held: { airings: lastHold ? 1 : 0, airedAt: null },
    stations: m.rotation
      .map((id) => stationById(id))
      .filter((x): x is StationIdent => !!x)
      .map((station) => ({ station, filledWith: FILLS[station.callSign ?? ""] ?? "backup_rotation", toldWhenBack: true }))
  };
}

function lengthWordsOf(s: Spot) {
  return lengthWords(s.lengthSec);
}

function rateWords(rate: Spot["rate"]): string {
  const d = (rate.micros / 1e6).toFixed(2);
  return rate.kind === "per_thousand" ? `$${d} per 1,000` : `$${d} an airing`;
}

export type AirResult = "aired" | "paused" | "not_in_rotation";

/**
 * One airing, as the mock's stations run it: on the next station in its rotation, with a tuned-in
 * number from that station's range. It spends from the balance through move(). When what's left of
 * the budget can't cover it, what's left is held for that airing and the spot pauses (budget spent);
 * when the day's cap is reached it pauses until midnight; when the balance can't cover it, it
 * pauses (balance).
 */
export function airOnce(s: Spot): AirResult {
  if (s.state !== "in_rotation") return "not_in_rotation";
  const m = mockOf(s);
  if (!m.rotation.length) return "not_in_rotation";
  const station = stationById(m.rotation[m.aired % m.rotation.length]!)!;
  const f = factsFor(station.id);
  const [lo, hi] = f?.tunedIn ?? [150, 300];
  const tunedIn = lo + ((m.aired * 37) % (hi - lo + 1));
  const cost = airingCost(s.rate, tunedIn);
  const left = s.budget.totalMicros - s.budget.usedMicros;
  const where = `${station.callSign} ${station.channel}`;
  if (cost > left) {
    const lastHold = left > 0 ? { amountMicros: left, station } : null;
    if (lastHold) {
      move(s.businessId, { kind: "held", label: `Held for an airing on ${where}`, amountMicros: left, detail: `${s.title}: the last of its budget`, hold: true });
      s.budget.usedMicros = s.budget.totalMicros;
    }
    m.pause = pauseStory(s, "budget_spent", lastHold);
    m.back = null;
    s.state = "paused_budget";
    saveSpots();
    return "paused";
  }
  if (s.budget.dailyCapMicros !== null && s.budget.usedTodayMicros + cost > s.budget.dailyCapMicros) {
    s.state = "paused_daily_cap";
    saveSpots();
    return "paused";
  }
  if (balanceOf(s.businessId).availableMicros < cost) {
    m.pause = pauseStory(s, "balance", null);
    m.back = null;
    s.state = "paused_balance";
    saveSpots();
    return "paused";
  }
  move(s.businessId, { kind: "aired", label: `Aired on ${where}`, amountMicros: -cost, detail: `${lengthWordsOf(s)} spot, ${tunedIn} tuned in, ${rateWords(s.rate)}` });
  s.budget.usedMicros += cost;
  s.budget.usedTodayMicros += cost;
  m.aired += 1;
  m.pace ??= s.budget.dailyCapMicros ?? cost * 5;
  saveSpots();
  return "aired";
}

/** Airs it until it pauses (at most `max` airings). */
export function airUntilPaused(s: Spot, max = 2000): number {
  let n = 0;
  while (n < max && airOnce(s) === "aired") n++;
  return n;
}

/** Back in the market: stations that had it are told, and none of them has it until it adds it again. */
export function comeBack(s: Spot) {
  const m = mockOf(s);
  const why = m.pause?.reason;
  m.back = {
    backAt: now().toISOString(),
    reason: why === "balance" ? "added_money" : why === "by_you" ? "resumed" : "raised_budget",
    told: (m.pause?.stations ?? []).map((x) => x.station)
  };
  m.pause = null;
  m.rotation = [];
  s.state = "listed";
  saveSpots();
}

/** Stations add it: the ones told it's back, or up to three that match it. */
export function stationsAdd(s: Spot, business: Business) {
  const m = mockOf(s);
  const ids = m.back?.told.length ? m.back.told.map((x) => x.id) : matchStations(business, s.rate, { ...s.targeting, bands: m.bands }).filter((x) => x.included && !x.reason).slice(0, 3).map((x) => x.station.id);
  m.rotation = ids;
  m.back = null;
  s.state = ids.length ? "in_rotation" : s.state;
  saveSpots();
}

/** The business pauses it: stations are told and fill the time. */
export function pauseByYou(s: Spot) {
  const m = mockOf(s);
  m.pause = pauseStory(s, "by_you", null);
  m.back = null;
  s.state = "waiting_for_you";
  saveSpots();
}

export function passReview(s: Spot) {
  mockOf(s).reviewReadyAt = null;
  s.state = "listed";
  saveSpots();
}

export function midnight(s: Spot) {
  s.budget.usedTodayMicros = 0;
  if (s.state === "paused_daily_cap") s.state = "in_rotation";
  saveSpots();
}

// ---- The balance: pausing when it runs low, coming back when it's topped up ----
// (Called by the Money area: after a withdrawal, and after every deposit that arrives.)

/** Less than a day of airings left: available under the business's pace per day. */
function underADay(businessId: string): boolean {
  const b = balanceOf(businessId);
  return b.pacePerDayMicros > 0 && b.availableMicros < b.pacePerDayMicros;
}

/**
 * When available is under a day of pace, the business's listed and in-rotation spots pause
 * (paused_balance): out of the market, the stations with them are told, and airings already held
 * still air (holds are left as they are). Returns the ids it paused.
 */
export function pauseForBalance(businessId: string): string[] {
  if (!underADay(businessId)) return [];
  const paused: string[] = [];
  for (const s of getDb().spots) {
    if (s.businessId !== businessId || (s.state !== "listed" && s.state !== "in_rotation")) continue;
    const m = mockOf(s);
    m.pause = pauseStory(s, "balance", null);
    m.back = null;
    m.reviewReadyAt = null;
    s.state = "paused_balance";
    paused.push(s.id);
  }
  if (paused.length) saveSpots();
  return paused;
}

/**
 * Once available covers at least a day of pace again, spots paused for the balance come back to
 * the market by themselves: the stations that had them are told it's back ("It's back", with Add
 * it back), and none is put back in a rotation by itself. A spot whose budget is also spent stays
 * paused. Returns the ids it resumed.
 */
export function resumeAfterTopUp(businessId: string): string[] {
  const b = balanceOf(businessId);
  if (underADay(businessId) || b.availableMicros <= 0) return [];
  const resumed: string[] = [];
  for (const s of getDb().spots) {
    if (s.businessId !== businessId || s.state !== "paused_balance") continue;
    if (s.budget.usedMicros >= s.budget.totalMicros) continue;
    comeBack(s);
    resumed.push(s.id);
  }
  return resumed;
}
