// The mock API's changeable state: the person, their presets, reminders, pledges and settings.
// Kept in localStorage so a reload keeps what you did; "Reset mock data" in the console:
// localStorage.removeItem("oc-mock-db").

import type { ViewerSettings } from "@opencast/contracts";
import { now } from "../lib/clock";
import { AIRINGS } from "./fixtures/schedule";
import { stationByRef, uid } from "./fixtures/stations";

export interface DbPreset { stationId: string; key: number | null; position: number }
export interface DbReminder { id: string; airingId: string; switchMeOver: boolean; createdAt: string }
export interface DbPledge { id: string; stationId: string; cadence: "monthly" | "once"; amountMicros: number; creditOnAir: boolean; startedAt: string; endsAfter: string | null; card: string; receipts: number }
export interface DbTv { id: string; name: string; kind: "tv_app" | "cast" | "airplay"; lastUsed: string; castingNow: boolean }

export interface Db {
  me: { id: string; displayName: string | null; email: string; marketSlug: string | null; settings: ViewerSettings };
  presets: DbPreset[];
  reminders: DbReminder[];
  pledges: DbPledge[];
  tvs: DbTv[];
  prefs: Record<string, { push: boolean; email: boolean }>;
}

const KEY = "oc-mock-db";
const id = (s: string) => stationByRef(s)!.ident.id;
const airing = (station: string, title: string) => AIRINGS.find((a) => a.stationId === id(station) && a.title.startsWith(title))!.id;

function seed(): Db {
  const t = now().toISOString();
  return {
    // Kai M., signed in, in the Inland Empire (the reference's person).
    me: { id: uid(1), displayName: "Kai M.", email: "kai@example.com", marketSlug: "inland-empire", settings: { watching: { captions: "off", captionSize: "medium", startOn: "dial", mutedPreviews: true, mobileQuality: "auto", backgroundPlay: true }, market: { showNearby: true }, appearance: { ground: "system", reducedMotion: false }, privacy: { keepWatchHistory: true }, tvs: { lockScreenRemote: true, othersOnWifiCanChange: true } } },
    presets: [
      { stationId: id("BEAT"), key: 1, position: 0 },
      { stationId: id("CIVC"), key: 2, position: 1 },
      { stationId: id("NITE"), key: 3, position: 2 },
      { stationId: id("REEL"), key: 4, position: 3 },
      { stationId: id("CRAT"), key: 5, position: 4 }
    ],
    reminders: [
      { id: uid(501), airingId: airing("BEAT", "Beat Tape Live"), switchMeOver: true, createdAt: t },
      { id: uid(502), airingId: airing("RDLS", "City Council, regular"), switchMeOver: false, createdAt: t },
      { id: uid(503), airingId: airing("CIVC", "Co-op town hall"), switchMeOver: false, createdAt: t }
    ],
    pledges: [
      { id: uid(601), stationId: id("BEAT"), cadence: "monthly", amountMicros: 10_000_000, creditOnAir: true, startedAt: "2026-06-01T19:00:00Z", endsAfter: null, card: "Visa ending 4417", receipts: 4 },
      { id: uid(602), stationId: id("CIVC"), cadence: "monthly", amountMicros: 5_000_000, creditOnAir: false, startedAt: "2026-08-12T19:00:00Z", endsAfter: null, card: "Visa ending 4417", receipts: 2 },
      { id: uid(603), stationId: id("REEL"), cadence: "once", amountMicros: 25_000_000, creditOnAir: false, startedAt: "2026-07-04T19:00:00Z", endsAfter: null, card: "Visa ending 4417", receipts: 1 }
    ],
    tvs: [
      { id: uid(701), name: "Living room TV", kind: "cast", lastUsed: t, castingNow: false },
      { id: uid(702), name: "Den TV", kind: "tv_app", lastUsed: "2026-09-25T04:10:00Z", castingNow: false }
    ],
    prefs: { reminder: { push: true, email: false }, switch_over: { push: true, email: false } }
  };
}

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    db = raw ? (JSON.parse(raw) as Db) : seed();
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
