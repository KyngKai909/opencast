// The spot market as master control sees it (master-control C, SP; biz-funding 05; biz-spots 05),
// sponsorships (sponsorships 03, 04) and production orders sent to BEAT (production-orders 03, 06).
// The Spots area owns this file. Its own state is kept in localStorage under its own key; what it
// changes in the shared evening (the spots in tonight's breaks) goes through getDb()/saveDb().
//
// The log does the placing (C3 note): spots go into a rotation, and each upcoming break's open
// time is filled from it, in rotation order, within the station's cap on spot time per hour, the
// same spot at most twice an hour, and each spot's daily limit. With spots in the rotation, time
// they can't fill goes to the backup rotation; a paused spot's time goes to the backup rotation
// too (biz-spots 05). With nothing in the rotation, open time airs the station ID and bumpers.

import type { ProductionOrder, Rotation, Spot, SponsorshipSetting, SpotState, StationIdent } from "@opencast/contracts";
import type { DbBreak, DbFill } from "./evening";
import { PROGRAM_IDS } from "./library";
import { BEAT, HALL, LAB, stationByRef, uid } from "./stations";
import { MIN, OFFSET_HOURS, SEC, at } from "./time";

// ---- The rule the placing follows (station-settings 02.1: "3:00", "2 an hour") ----

export interface PlaceRule {
  spotMsPerHour: number;
  sameSpotPerHour: number;
}
export const DEFAULT_RULE: PlaceRule = { spotMsPerHour: 3 * MIN, sameSpotPerHour: 2 };
/** Blocked in station-settings 02.1 until the Station area's break rule says otherwise. */
export const DEFAULT_BLOCKED = ["Alcohol", "Gambling", "Political"];

/** The note a backup spot carries in a break (the rundown's source line). */
export const BACKUP_NOTE = "Backup rotation";

export interface PlaceSpot {
  id: string;
  business: string;
  title: string;
  lengthMs: number;
  upToPerDay: number | null;
  paused: boolean;
}

const hourOf = (iso: string) => iso.slice(0, 13);
const dayOf = (iso: string) => new Date(Date.parse(iso) - OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);
const key = (f: { spotId?: string | null; business?: string | null }) => f.spotId ?? `biz:${f.business ?? ""}`;
const tail = (id: string) => id.slice(-6);

/** Time in a break nothing of the station's fills yet (the producer's barter share excluded). */
export function freeMs(b: DbBreak): number {
  const producer = b.fills.filter((f) => f.kind === "producer").reduce((a, f) => a + f.lengthMs, 0);
  const station = b.fills.filter((f) => f.kind !== "producer" && f.kind !== "open").reduce((a, f) => a + f.lengthMs, 0);
  return Math.max(0, b.lengthMs - Math.max(producer, b.producerShareMs) - station);
}

/**
 * Places the rotation in a station's upcoming breaks (after `nowIso`), replacing whatever the
 * rotations placed before. Aired breaks stay as they aired, and count toward the hour's cap.
 * Returns new breaks; the input is not changed.
 */
export function placeRotation(breaks: DbBreak[], nowIso: string, main: PlaceSpot[], backup: PlaceSpot[], rule: PlaceRule = DEFAULT_RULE): DbBreak[] {
  const sorted = [...breaks].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const hourMs = new Map<string, number>();
  const perHour = new Map<string, number>();
  const perDay = new Map<string, number>();
  const count = (f: { spotId?: string | null; business?: string | null; lengthMs: number }, at: string) => {
    const h = hourOf(at);
    hourMs.set(h, (hourMs.get(h) ?? 0) + f.lengthMs);
    for (const k of new Set([key(f), `biz:${f.business ?? ""}`])) {
      perHour.set(`${h}|${k}`, (perHour.get(`${h}|${k}`) ?? 0) + 1);
      perDay.set(`${dayOf(at)}|${k}`, (perDay.get(`${dayOf(at)}|${k}`) ?? 0) + 1);
    }
  };
  const fits = (s: PlaceSpot, at: string, room: number, capped: boolean) => {
    const h = hourOf(at);
    const same = Math.max(perHour.get(`${h}|${s.id}`) ?? 0, perHour.get(`${h}|biz:${s.business}`) ?? 0);
    const day = Math.max(perDay.get(`${dayOf(at)}|${s.id}`) ?? 0, perDay.get(`${dayOf(at)}|biz:${s.business}`) ?? 0);
    return (
      s.lengthMs <= room &&
      (!capped || (hourMs.get(h) ?? 0) + s.lengthMs <= rule.spotMsPerHour) &&
      same < rule.sameSpotPerHour &&
      (s.upToPerDay === null || day < s.upToPerDay)
    );
  };

  let mainAt = 0;
  let backupAt = 0;
  /** The next spot of `list` (from `from`) that fits, or null. */
  const pick = (list: PlaceSpot[], from: number, at: string, room: number, capped: boolean, skipPaused: boolean) => {
    for (let i = 0; i < list.length; i++) {
      const j = (from + i) % list.length;
      const s = list[j];
      if (skipPaused && s.paused) continue;
      if (fits(s, at, room, capped)) return { s, next: j + 1 };
    }
    return null;
  };

  return sorted.map((b) => {
    if (b.startsAt <= nowIso) {
      for (const f of b.fills) if (f.kind === "spot") count(f, b.startsAt);
      return b;
    }
    const kept = b.fills.filter((f) => f.kind !== "spot");
    const base = { ...b, fills: kept };
    // The break rule's cadence leaves spots out of it: nothing is placed.
    if (b.noSpots) return base;
    let room = freeMs(base);
    const placed: DbFill[] = [];
    const seen = new Map<string, number>();
    const fill = (s: PlaceSpot, lengthMs: number, rotation: "main" | "backup"): DbFill => {
      const n = (seen.get(`${rotation}${s.id}`) ?? 0) + 1;
      seen.set(`${rotation}${s.id}`, n);
      return {
        id: `${rotation === "main" ? "spt" : "bak"}-${tail(b.id)}-${tail(s.id)}-${n}`,
        kind: "spot",
        title: s.title,
        lengthMs,
        spotId: s.id,
        business: s.business,
        note: rotation === "backup" ? BACKUP_NOTE : null
      };
    };
    // The rotation, in order. A paused spot keeps its place; its time goes to the backup rotation.
    for (;;) {
      const p = pick(main, mainAt, b.startsAt, room, true, false);
      if (!p) break;
      mainAt = p.next;
      room -= p.s.lengthMs;
      if (!p.s.paused) {
        const f = fill(p.s, p.s.lengthMs, "main");
        placed.push(f);
        count(f, b.startsAt);
        continue;
      }
      // Counted as if it aired, so the backups in its place don't add to the cap.
      count({ spotId: p.s.id, business: p.s.business, lengthMs: p.s.lengthMs }, b.startsAt);
      let gap = p.s.lengthMs;
      for (;;) {
        const q = pick(backup, backupAt, b.startsAt, gap, false, true);
        if (!q) break;
        backupAt = q.next;
        gap -= q.s.lengthMs;
        const f = fill(q.s, q.s.lengthMs, "backup");
        placed.push(f);
        const h = hourOf(b.startsAt);
        perHour.set(`${h}|${q.s.id}`, (perHour.get(`${h}|${q.s.id}`) ?? 0) + 1);
        perDay.set(`${dayOf(b.startsAt)}|${q.s.id}`, (perDay.get(`${dayOf(b.startsAt)}|${q.s.id}`) ?? 0) + 1);
      }
      // What the backups couldn't fill stays open.
    }
    // Then the backup rotation fills what the rotation couldn't, within the cap.
    if (main.length > 0) {
      for (;;) {
        const q = pick(backup, backupAt, b.startsAt, room, true, true);
        if (!q) break;
        backupAt = q.next;
        room -= q.s.lengthMs;
        const f = fill(q.s, q.s.lengthMs, "backup");
        placed.push(f);
        count(f, b.startsAt);
      }
    }
    const producer = kept.filter((f) => f.kind === "producer");
    const rest = kept.filter((f) => f.kind !== "producer");
    return { ...base, fills: [...producer, ...placed, ...rest] };
  });
}

// ---- Businesses and their listed spots ----

export interface FxBusiness {
  id: string;
  name: string;
  shortName: string;
  /** What the business does: "Coffee and food". */
  category: string;
  city: string | null;
  online: boolean;
  colour: string;
  /** "Council Watch on CIVC" */
  sponsorsElsewhere: string[];
}

export interface FxSpot {
  id: string;
  businessId: string;
  title: string;
  lengthSec: 15 | 30 | 60;
  /** The market's category ("Food"). */
  category: string;
  onScreen: string | null;
  /** The line on the spot's still. */
  line: string | null;
  rate: { kind: "per_thousand" | "per_airing"; micros: number };
  upToPerDay: number | null;
  listedUntil: string | null;
  runway: { kind: "days"; days: number } | { kind: "tops_up" };
  /** Miles from BEAT's studio (the market is one city's worth of stations). */
  miles: number | null;
  state: SpotState;
  pause: { reason: "budget_spent" | "balance"; pausedAt: string; heldTonightMs: Record<string, number>; filledBy: Record<string, string[]> } | null;
  back: { reason: "raised_budget" | "added_money"; backAt: string } | null;
  /** Stations it was in rotation on when it paused: they get "It's back". */
  backFor: string[];
  customers: Record<string, number>;
  budgetMicros: number;
  createdAt: string;
}

export interface FxSponsorship {
  id: string;
  businessId: string;
  stationId: string;
  program: { id: string; title: string } | null;
  monthlyMicros: number;
  creditText: string;
  state: "requested" | "approved" | "credited" | "lapsed" | "declined" | "ended";
  declineReason: "not_right_fit" | "full" | "amount" | null;
  startsOn: string;
  renewsOn: string | null;
  createdAt: string;
}

export type FxSetting = SponsorshipSetting & { format: string | null };

export type FxOrder = ProductionOrder & { makerToldWhenListed: boolean };

export interface SpotsState {
  version: number;
  businesses: FxBusiness[];
  spots: FxSpot[];
  rotations: Record<string, { main: string[]; backup: string[] }>;
  sponsorships: FxSponsorship[];
  settings: Record<string, FxSetting[]>;
  members: Record<string, { creditName: string; members: number; named: number }>;
  orders: FxOrder[];
}

export const SPOTS_VERSION = 1;
const KEY = "oc-mock-control-spots";

/** A date on the base day's calendar, `days` from it: "2026-10-01". */
export function dateOn(days: number): string {
  return at(`${days >= 0 ? "+" : ""}${days} 12:00`).slice(0, 10);
}

export const BIZ = {
  orange: uid(510001),
  tire: uid(510002),
  dental: uid(510003),
  hardware: uid(510004),
  farmers: uid(510005),
  barber: uid(510006),
  brewing: uid(510007),
  clear: uid(510008)
};

export const SPOT_IDS = {
  fallMenu: uid(520001),
  tire: uid(520002),
  dental: uid(520003),
  hardware: uid(520004),
  farmers: uid(520005),
  barber: uid(520006),
  brewing: uid(520007),
  walkIns: uid(520008)
};

export const ORDER_IDS = { giftCards: uid(530001), fallMenu: uid(530002), walkIns: uid(530003), newPatients: uid(530004) };
export const SPONSORSHIP_IDS = { orange: uid(540001), hardware: uid(540002), clear: uid(540003) };

export function seedSpots(): SpotsState {
  const business = (id: string, name: string, shortName: string, category: string, city: string | null, colour: string, sponsorsElsewhere: string[] = []): FxBusiness => ({ id, name, shortName, category, city, online: false, colour, sponsorsElsewhere });
  const businesses = [
    business(BIZ.orange, "Orange Street Coffee", "Orange Street", "Coffee and food", "Redlands", "#5A3A22", ["Council Watch on CIVC"]),
    business(BIZ.tire, "Inland Tire and Wheel", "Inland Tire", "Auto", "Colton", "#1F5E8C"),
    business(BIZ.dental, "Cypress Dental", "Cypress Dental", "Health", "Loma Linda", "#1D6A70"),
    business(BIZ.hardware, "Redlands Hardware", "Redlands Hardware", "Hardware", "Redlands", "#4F5B2A"),
    business(BIZ.farmers, "Citrus Valley Farmers Market", "Citrus Valley", "Farmers market", "Redlands", "#A3402A"),
    business(BIZ.barber, "Juniper Barber Co.", "Juniper Barber", "Barber", "Redlands", "#56508A"),
    business(BIZ.brewing, "Mill Creek Brewing", "Mill Creek", "Brewery", "Mentone", "#7A5B1F"),
    business(BIZ.clear, "Clear, the member-owned co-op", "Clear", "Credit union", "Redlands", "#1F5E8C")
  ];
  const spot = (o: Partial<FxSpot> & Pick<FxSpot, "id" | "businessId" | "title" | "lengthSec" | "category" | "rate" | "miles" | "runway">): FxSpot => ({
    onScreen: null,
    line: null,
    upToPerDay: 6,
    listedUntil: dateOn(35),
    state: "listed",
    pause: null,
    back: null,
    backFor: [],
    customers: {},
    budgetMicros: 300_000_000,
    createdAt: at("-20 10:00"),
    ...o
  });
  const spots: FxSpot[] = [
    spot({ id: SPOT_IDS.fallMenu, businessId: BIZ.orange, title: "Fall menu", lengthSec: 30, category: "Food", onScreen: "A code for 10% off", line: "Open till midnight on Orange St.", rate: { kind: "per_thousand", micros: 8_000_000 }, miles: 1.2, runway: { kind: "days", days: 44 }, customers: { [BEAT.id]: 12 } }),
    spot({ id: SPOT_IDS.tire, businessId: BIZ.tire, title: "Tire season", lengthSec: 30, category: "Auto", line: "Free rotation with four tires", rate: { kind: "per_airing", micros: 4_000_000 }, miles: 3.4, runway: { kind: "tops_up" }, customers: { [BEAT.id]: 3 } }),
    spot({ id: SPOT_IDS.dental, businessId: BIZ.dental, title: "New patients", lengthSec: 30, category: "Health", line: "Saturday appointments", rate: { kind: "per_thousand", micros: 10_000_000 }, miles: 2.1, runway: { kind: "days", days: 6 } }),
    spot({ id: SPOT_IDS.hardware, businessId: BIZ.hardware, title: "Underwriting", lengthSec: 15, category: "Underwriting", line: "Since 1962", rate: { kind: "per_airing", micros: 3_000_000 }, miles: 0.8, runway: { kind: "days", days: 31 } }),
    spot({ id: SPOT_IDS.farmers, businessId: BIZ.farmers, title: "Saturday market", lengthSec: 15, category: "Food", line: "Saturdays, 8 to 1", rate: { kind: "per_airing", micros: 2_000_000 }, miles: 5.0, runway: { kind: "days", days: 12 } }),
    spot({ id: SPOT_IDS.barber, businessId: BIZ.barber, title: "Walk-ins", lengthSec: 60, category: "Services", line: "Walk-ins till 8", rate: { kind: "per_thousand", micros: 6_000_000 }, miles: 1.9, runway: { kind: "days", days: 20 } }),
    // Blocked on BEAT (Alcohol): never in its market.
    spot({ id: SPOT_IDS.brewing, businessId: BIZ.brewing, title: "Taproom nights", lengthSec: 30, category: "Alcohol", line: "Taproom open late", rate: { kind: "per_airing", micros: 5_000_000 }, miles: 4.4, runway: { kind: "days", days: 25 } })
  ];

  const sp = (o: Omit<FxSponsorship, "declineReason" | "renewsOn"> & Partial<Pick<FxSponsorship, "declineReason" | "renewsOn">>): FxSponsorship => ({ declineReason: null, renewsOn: null, ...o });
  const sponsorships: FxSponsorship[] = [
    sp({ id: SPONSORSHIP_IDS.orange, businessId: BIZ.orange, stationId: BEAT.id, program: { id: PROGRAM_IDS.beatTapeLive, title: "Beat Tape Live" }, monthlyMicros: 75_000_000, creditText: "A family coffee house on Orange Street in downtown Redlands, and home of the pumpkin bread.", state: "requested", startsOn: dateOn(5), createdAt: at("15:04") }),
    sp({ id: SPONSORSHIP_IDS.hardware, businessId: BIZ.hardware, stationId: BEAT.id, program: null, monthlyMicros: 100_000_000, creditText: "Tools, paint and advice on State Street since 1962.", state: "credited", startsOn: "2026-06-01", renewsOn: dateOn(5), createdAt: at("-120 10:00") }),
    sp({ id: SPONSORSHIP_IDS.clear, businessId: BIZ.clear, stationId: BEAT.id, program: null, monthlyMicros: 100_000_000, creditText: "Banking owned by the people who use it, in the Inland Empire.", state: "credited", startsOn: "2026-08-01", renewsOn: dateOn(5), createdAt: at("-60 10:00") })
  ];

  const setting = (programId: string | null, title: string, min: number, max: number, format: string | null, o: Partial<FxSetting> = {}): FxSetting => ({ programId, title, minMonthlyMicros: min * 1_000_000, maxSponsors: max, closed: false, sponsors: 0, sponsoredThrough: null, format, ...o });
  const REEL = stationByRef("REEL") as StationIdent;
  const settings: Record<string, FxSetting[]> = {
    [BEAT.id]: [
      setting(null, "All of BEAT", 100, 3, null, { sponsors: 2 }),
      setting(PROGRAM_IDS.beatTapeLive, "Beat Tape Live", 75, 2, "Weekly, live"),
      setting(PROGRAM_IDS.lateCrate, "Late Crate", 50, 2, "Weekly"),
      setting(PROGRAM_IDS.crateTalk, "Crate Talk", 50, 2, "Weekly, live"),
      setting(PROGRAM_IDS.saturdayReel, "Saturday Reel", 0, 0, null, { closed: true, sponsoredThrough: REEL })
    ],
    [HALL.id]: [setting(null, "All of HALL", 50, 3, null)]
  };

  const order = (o: Partial<FxOrder> & Pick<FxOrder, "id" | "business" | "title" | "lengthSec" | "about" | "neededBy" | "state" | "createdAt">): FxOrder => ({
    maker: BEAT,
    mustSay: null,
    quote: null,
    roundsUsed: 0,
    briefFiles: [],
    deliveries: [],
    notes: [],
    deliveredAt: null,
    autoApproveAt: null,
    spotId: null,
    tellMakerWhenListed: false,
    makerToldWhenListed: false,
    ...o
  });
  const file = (n: number, filename: string) => ({ id: uid(531000 + n), url: `/mock-files/${filename}`, filename });
  const orders: FxOrder[] = [
    order({
      id: ORDER_IDS.giftCards,
      business: { id: BIZ.orange, name: "Orange Street Coffee" },
      title: "Holiday gift cards",
      lengthSec: 30,
      about: "Gift cards for the holidays. Warm, a little funny",
      mustSay: "Name, 204 Orange St, gift cards at the counter",
      neededBy: dateOn(55),
      state: "asked",
      briefFiles: [file(1, "logo.svg"), file(2, "storefront-evening.jpg"), file(3, "mugs.mov")],
      createdAt: at("-2 10:14")
    }),
    order({
      id: ORDER_IDS.fallMenu,
      business: { id: BIZ.orange, name: "Orange Street Coffee" },
      title: "Fall menu",
      lengthSec: 30,
      about: "The fall menu: pumpkin bread, the big mugs, open till midnight",
      mustSay: "Name, Orange St, open till midnight",
      neededBy: dateOn(-14),
      state: "approved",
      quote: { priceMicros: 120_000_000, deliverBy: dateOn(-17), roundsIncluded: 1, voicedBy: "Jen Park" },
      deliveries: [{ id: uid(532001), version: 1, url: "/mock-files/fall-menu-v1.mp4", previewUrl: null, createdAt: at("-18 16:00") }],
      deliveredAt: at("-18 16:00"),
      spotId: SPOT_IDS.fallMenu,
      createdAt: at("-24 09:30")
    }),
    order({
      id: ORDER_IDS.walkIns,
      business: { id: BIZ.barber, name: "Juniper Barber Co." },
      title: "Late walk-ins",
      lengthSec: 15,
      about: "Walk-ins till 8 on weeknights",
      neededBy: dateOn(4),
      state: "approved",
      quote: { priceMicros: 90_000_000, deliverBy: dateOn(1), roundsIncluded: 1, voicedBy: "Marcus Reyes" },
      deliveries: [{ id: uid(532002), version: 1, url: "/mock-files/late-walk-ins-v1.mp4", previewUrl: null, createdAt: at("-1 11:00") }],
      deliveredAt: at("-1 11:00"),
      spotId: SPOT_IDS.walkIns,
      createdAt: at("-9 13:00")
    }),
    order({
      id: ORDER_IDS.newPatients,
      business: { id: BIZ.dental, name: "Cypress Dental" },
      title: "Saturday appointments",
      lengthSec: 30,
      about: "Saturday appointments, new patients welcome",
      mustSay: "Name, Loma Linda, Saturdays",
      neededBy: dateOn(12),
      state: "accepted",
      quote: { priceMicros: 150_000_000, deliverBy: dateOn(7), roundsIncluded: 2, voicedBy: "Jen Park" },
      createdAt: at("-5 15:20")
    })
  ];

  return {
    version: SPOTS_VERSION,
    businesses,
    spots,
    rotations: {
      [BEAT.id]: { main: [], backup: [SPOT_IDS.hardware, SPOT_IDS.farmers] },
      [HALL.id]: { main: [], backup: [] },
      [LAB.id]: { main: [SPOT_IDS.farmers], backup: [] }
    },
    sponsorships,
    settings,
    members: { [BEAT.id]: { creditName: "members of Inland Beat", members: 214, named: 38 } },
    orders
  };
}

let state: SpotsState | null = null;

export function getSpots(): SpotsState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as SpotsState) : null;
    state = saved && saved.version === SPOTS_VERSION ? saved : seedSpots();
  } catch {
    state = seedSpots();
  }
  return state;
}

export function saveSpots() {
  try {
    localStorage.setItem(KEY, JSON.stringify(getSpots()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetSpots() {
  state = seedSpots();
  saveSpots();
}

// ---- Lookups ----

export function businessOf(s: FxSpot): FxBusiness {
  return getSpots().businesses.find((b) => b.id === s.businessId)!;
}

export function spotById(id: string): FxSpot | undefined {
  return getSpots().spots.find((s) => s.id === id);
}

export function rotationsOf(stationId: string) {
  const all = getSpots().rotations;
  return (all[stationId] ??= { main: [], backup: [] });
}

export const isPaused = (s: FxSpot) => s.state === "paused_budget" || s.state === "paused_balance" || s.state === "waiting_for_you";
/** Listed in the market (or paused there, still visible to stations that have it). */
export const inMarket = (s: FxSpot) => s.state === "listed" || s.state === "in_rotation" || isPaused(s) || s.state === "paused_daily_cap";

/** The station's word for a spot (MarketSpot.state). */
export function stationState(s: FxSpot, stationId: string): "in_the_market" | "in_rotation" | "paused" | "its_back" {
  const r = rotationsOf(stationId);
  if (isPaused(s)) return "paused";
  if (r.main.includes(s.id) || r.backup.includes(s.id)) return "in_rotation";
  if (s.back && s.backFor.includes(stationId)) return "its_back";
  return "in_the_market";
}

export function toPlaceSpot(s: FxSpot): PlaceSpot {
  return { id: s.id, business: businessOf(s).name, title: businessOf(s).name, lengthMs: s.lengthSec * SEC, upToPerDay: s.upToPerDay, paused: isPaused(s) };
}

/** The rotation as the contract returns it. */
export function rotationOut(stationId: string, kind: "main" | "backup"): Rotation {
  const ids = rotationsOf(stationId)[kind];
  return {
    kind,
    spots: ids
      .map((id) => spotById(id))
      .filter((s): s is FxSpot => !!s)
      .map((s) => ({ spotId: s.id, title: s.title, business: businessOf(s).name, lengthSec: s.lengthSec, paused: isPaused(s) }))
  };
}

/** A spot as the business sees it (pauseSpot and resumeSpot answer with it). */
export function spotOut(s: FxSpot): Spot {
  const all = getSpots().rotations;
  return {
    id: s.id,
    businessId: s.businessId,
    title: s.title,
    lengthSec: s.lengthSec,
    category: s.category,
    state: s.state,
    inRotationOn: Object.values(all).filter((r) => r.main.includes(s.id) || r.backup.includes(s.id)).length,
    rate: { ...s.rate, perAiringMaxMicros: null },
    budget: { totalMicros: s.budgetMicros, dailyCapMicros: null, usedMicros: isPaused(s) ? s.budgetMicros : Math.round(s.budgetMicros / 2), usedTodayMicros: 0 },
    startsOn: null,
    endsOn: s.listedUntil,
    targeting: { withinMiles: 10, locationIds: [], marketIds: [], stationCategories: [], dayparts: [], excludedStationIds: [] },
    code: s.onScreen ? { code: "FALL10", offer: "10% off", windowDays: 7 } : null,
    file: null,
    productionOrderId: getSpots().orders.find((o) => o.spotId === s.id)?.id ?? null,
    createdAt: s.createdAt
  };
}

/** Spot fills of a spot in a set of breaks, by station: how much time it holds tonight. */
export function heldMs(breaks: DbBreak[], spotId: string): number {
  return breaks.flatMap((b) => b.fills).filter((f) => f.kind === "spot" && f.spotId === spotId && f.note !== BACKUP_NOTE).reduce((a, f) => a + f.lengthMs, 0);
}
