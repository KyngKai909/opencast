// The viewer's mock state: people's profiles, and the reference's presets, reminders, pledges, TVs
// and notification settings, which are whoever signs in's (the viewer's flows run as the
// reference's Kai M., whatever the email).
// Kept in localStorage so a reload keeps what you did; "Reset mock data" in the console:
// localStorage.removeItem("oc-mock-db"). Seeded from the You file's frames (viewer/opencast-you.html).

import type { TvPlatform, ViewerSettings } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { AIRINGS } from "./fixtures/schedule";
import { stationByRef, uid } from "./fixtures/stations";
import { KAI, type MockPerson } from "../../mocks/people";

export interface DbPreset { stationId: string; key: number | null; position: number }
export interface DbReminder { id: string; airingId: string; switchMeOver: boolean; createdAt: string }
export interface DbPledge { id: string; stationId: string; cadence: "monthly" | "once"; amountMicros: number; creditOnAir: boolean; startedAt: string; endsAfter: string | null; card: string }
export interface DbTv { id: string; name: string; kind: "tv_app" | "chromecast" | "airplay"; platform: TvPlatform | null; signedIn: boolean; lastUsedAt: string | null; online: boolean; castingNow: boolean }

/** A person's viewer profile: their name, market and settings (Me), by person id (src/mocks/people.ts). */
export interface DbProfile {
  displayName: string | null;
  marketSlug: string | null;
  settings: ViewerSettings;
}

export interface Db {
  /** Bumped when the seed changes shape, so an old saved mock is replaced. */
  version: number;
  /**
   * Each signed-in person's profile. Kai M.'s is the reference's; anyone else's starts the first
   * time they sign in. Stations they run come from master control's mock (control/mocks/db.ts).
   */
  profiles: Record<string, DbProfile>;
  presets: DbPreset[];
  reminders: DbReminder[];
  pledges: DbPledge[];
  tvs: DbTv[];
  prefs: Record<string, { push: boolean; email: boolean }>;
  /** When "Sign out everywhere" was last pressed (A1). */
  signedOutEverywhereAt: string | null;
}

export const DB_VERSION = 5;
/** Den TV, TV mode's tvId in the mock relay (apps/tv's mock device). */
export const DEN_TV_ID = "00000000-0000-4000-8000-0000000c0001";
const KEY = "oc-mock-db";
const id = (s: string) => stationByRef(s)!.ident.id;
const airing = (station: string, title: string) => AIRINGS.find((a) => a.stationId === id(station) && a.title.startsWith(title))!.id;

/** The reference's settings (You 06), for Kai and anyone new. */
function settingsSeed(): ViewerSettings {
  return {
    watching: { captions: "on", captionSize: "medium", startOn: "dial", mutedPreviews: true, mobileQuality: "data_saver", backgroundPlay: true },
    market: { showNearby: true },
    appearance: { ground: "system", reducedMotion: false },
    privacy: { keepWatchHistory: true },
    tvs: { lockScreenRemote: true, othersOnWifiCanChange: true },
    notifications: { emailWhen: "evening_before", leadMinutes: 0, quietHours: true }
  };
}

export function seed(): Db {
  const t = now();
  const daysAgo = (n: number) => new Date(t.getTime() - n * 86400e3).toISOString();
  return {
    version: DB_VERSION,
    // Kai M., signed in, in the Inland Empire (the reference's person).
    profiles: { [KAI.id]: { displayName: KAI.displayName, marketSlug: "inland-empire", settings: settingsSeed() } },
    // You 02.1 and 03.1: all six keys taken, two in More presets.
    presets: [
      { stationId: id("BEAT"), key: 1, position: 0 },
      { stationId: id("CIVC"), key: 2, position: 1 },
      { stationId: id("NITE"), key: 3, position: 2 },
      { stationId: id("REEL"), key: 4, position: 3 },
      { stationId: id("CRAT"), key: 5, position: 4 },
      { stationId: id("HALL"), key: 6, position: 5 },
      { stationId: id("SAZN"), key: null, position: 6 },
      { stationId: id("VOZE"), key: null, position: 7 }
    ],
    reminders: [
      { id: uid(501), airingId: airing("BEAT", "Beat Tape Live"), switchMeOver: true, createdAt: t.toISOString() },
      { id: uid(502), airingId: airing("RDLS", "City Council, regular"), switchMeOver: false, createdAt: t.toISOString() },
      { id: uid(503), airingId: airing("CIVC", "Co-op town hall"), switchMeOver: false, createdAt: t.toISOString() }
    ],
    // You 02.1: $10.00 a month to Inland Beat since June, credited on air; $25.00 once to Inland Civic on August 14.
    pledges: [
      { id: uid(601), stationId: id("BEAT"), cadence: "monthly", amountMicros: 10_000_000, creditOnAir: true, startedAt: "2026-06-14T19:00:00Z", endsAfter: null, card: "Visa ending 4417" },
      { id: uid(602), stationId: id("CIVC"), cadence: "once", amountMicros: 25_000_000, creditOnAir: false, startedAt: "2026-08-14T19:00:00Z", endsAfter: null, card: "Visa ending 4417" }
    ],
    // You 02.1: Your TVs. Den TV is the Opencast app on a Fire TV, on now: TV mode (VITE_TV_URL)
    // answers for it over the mock relay. The server can't know a cast target is casting (B2): the
    // frame's "Casting now" on Living room TV comes from this phone's own session.
    tvs: [
      { id: uid(701), name: "Living room TV", kind: "chromecast", platform: null, signedIn: false, lastUsedAt: t.toISOString(), online: false, castingNow: false },
      { id: DEN_TV_ID, name: "Den TV", kind: "tv_app", platform: "fire_tv", signedIn: true, lastUsedAt: daysAgo(2), online: true, castingNow: false },
      { id: uid(703), name: "Bedroom TV", kind: "airplay", platform: null, signedIn: false, lastUsedAt: daysAgo(4), online: false, castingNow: false }
    ],
    // You 06.3: reminders on this phone, not by email; presets going live on; station news off.
    prefs: { reminder: { push: true, email: false }, switch_over: { push: true, email: false }, preset_live: { push: true, email: false }, station_news: { push: false, email: false } },
    signedOutEverywhereAt: null
  };
}

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Db) : null;
    db = saved && saved.version === DB_VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveDb() {
  try {
    localStorage.setItem(KEY, JSON.stringify(getDb()));
  } catch {
    // Private windows: the mock keeps state for this visit only.
  }
}

export function resetDb() {
  db = seed();
  saveDb();
}

/** A person's profile, started the first time they sign in: their name, the Inland Empire, the reference's settings. */
export function profileOf(p: Pick<MockPerson, "id" | "displayName">): DbProfile {
  const db = getDb();
  let prof = db.profiles[p.id];
  if (!prof) {
    prof = db.profiles[p.id] = { displayName: p.displayName, marketSlug: "inland-empire", settings: settingsSeed() };
    saveDb();
  }
  return prof;
}
