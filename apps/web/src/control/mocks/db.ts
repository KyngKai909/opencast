// The mock API's shared, changeable state: the stations' setup and status, who's on which team,
// tonight's log and breaks, the library, live sources. Kept in localStorage so a reload keeps
// what you did; "Reset mock data" in the console: localStorage.removeItem("oc-mock-control-db").
//
// This is the one model every area reads and writes (a break filled from the spot market shows
// in the log and on the monitor). An area's own data (market offers, spots, sponsorships,
// earnings, claims…) lives in its own mocks/fixtures/<area>.ts, and may keep its own saved state.

import type { ClearLink, Folder, LibraryItem, LiveSource, Program, StationIdent, StationSetup } from "@opencast/contracts";
import { snapSpan, snapTime } from "@opencast/ui";
import { seedEvening, seedLiveSources, type DbBreak, type DbLogEntry } from "./fixtures/evening";
import { seedLibrary } from "./fixtures/library";
import { seedOffAirRules, type DbOffAirRule } from "./fixtures/offair";
import { JEN, KAI, MARCUS, SAM } from "./fixtures/people";
import { BEAT, CRAT, HALL, LAB, STATIONS, TAPE } from "./fixtures/stations";
import { seedTemplates, type DbTemplate } from "./fixtures/templates";
import { at } from "./fixtures/time";

export interface DbMember {
  stationId: string;
  personId: string;
  role: "owner" | "operator" | "host";
  /** What a host hosts: "Beat Tape Live", "Hosts Crate Talk" (the team list's line). */
  hosts: string | null;
  /** The live blocks (program ids) a host may go live on. */
  hostProgramIds: string[];
  lastInAt: string | null;
}

export interface DbStation {
  ident: StationIdent;
  setup: Omit<StationSetup, "station">;
  /** Playout: going out now, since when. */
  onAir: boolean;
  onAirSince: string | null;
  /** The station on X.1 whose call sign this one shares (A229, mocks/family.ts), or null. */
  sharesWith?: string | null;
}

export interface Db {
  /** Bumped when the seed changes shape, so an old saved mock is replaced. */
  version: number;
  stations: DbStation[];
  members: DbMember[];
  log: DbLogEntry[];
  breaks: DbBreak[];
  library: { items: LibraryItem[]; folders: Folder[]; programs: Program[] };
  liveSources: LiveSource[];
  /** Linked Clear accounts, by person id (Connect Clear). */
  clearLinks: Record<string, ClearLink>;
  /** Day templates (G8): "Repeat this day", with the dates made from each. */
  templates: DbTemplate[];
  /** Off air hours (G9), per station. */
  offAirRules: DbOffAirRule[];
  /**
   * The live area's week of entries (fixtures/live.ts) went on the log: once. Taken off after
   * (an edit, "Reset to template"), they stay off. Left out by a db saved before A246's Phase 4:
   * the entries it has are kept as they are.
   */
  liveWeekSeeded?: boolean;
}

// 6: the log's times on 4-second segment boundaries (prepare once, then assemble).
// 7: 12.2 BEAT Beat Tapes, sharing 12.1 BEAT's call sign (A229).
export const DB_VERSION = 7;
const KEY = "oc-mock-control-db";

function setup(ident: StationIdent, o: Partial<DbStation["setup"]> = {}): DbStation["setup"] {
  return {
    description: null,
    status: "on_air",
    firstSignedOnAt: at("-14 18:00"),
    fixed: true,
    bug: { mode: "call_sign_and_channel", position: "bottom_right", opacity: 78 },
    logoUrl: null,
    category: null,
    studioLocation: { latitude: 34.0556, longitude: -117.1825 },
    legalName: null,
    legalContact: null,
    pledgesTaxDeductible: null,
    memberCreditStyle: "voice",
    orders: { takesOrders: false, turnaround: null, fromMicros: null },
    ...o,
    ...(ident.kind === "studio" ? { status: "on_air" as const, fixed: true } : {})
  } as DbStation["setup"];
}

export function seed(): Db {
  const library = seedLibrary();
  const evening = seedEvening(library.items);
  const { templates, log: weekdays } = seedTemplates(evening.log, library.items);
  // On segment boundaries, as the API answers them (the seed already is; this keeps it so).
  const log = [...weekdays, ...evening.log].map(snapSpan);
  const breaks = evening.breaks.map((b) => ({ ...b, startsAt: snapTime(b.startsAt) }));
  const ours = [BEAT, TAPE, HALL, CRAT, LAB];
  const stations: DbStation[] = STATIONS.filter((s) => ours.includes(s)).map((ident) => ({
    ident,
    setup: setup(ident, {
      ...(ident === TAPE ? { description: "Beat tapes from the Inland Empire's producers, back to back.", category: "Music", firstSignedOnAt: at("-7 18:00"), legalName: "Inland Beat Collective", legalContact: "kai@example.com" } : {}),
      ...(ident === BEAT ? { description: "Music from producers around the Inland Empire, on air around the clock.", category: "Music", firstSignedOnAt: at("-14 18:00"), legalName: "Inland Beat Collective", legalContact: "kai@example.com", orders: { takesOrders: true, turnaround: "About a week", fromMicros: 100_000_000 } } : {}),
      ...(ident === HALL ? { description: "Slow beats for late work.", category: "Music" } : {}),
      // CRAT is run by Opencast until someone claims it (rights 05.1, 05.2).
      ...(ident === CRAT ? { description: "Producers and their tapes.", category: "Music" } : {}),
      ...(ident === LAB ? { description: "A studio. Your programs air on the stations that carry them.", category: "Music", firstSignedOnAt: null } : {})
    }),
    onAir: ident !== LAB,
    onAirSince: ident === LAB ? null : at("18:00"),
    // 12.2 shares 12.1 BEAT's call sign.
    sharesWith: ident === TAPE ? BEAT.id : null
  }));
  return {
    version: DB_VERSION,
    stations,
    members: [
      { stationId: BEAT.id, personId: KAI.id, role: "owner", hosts: null, hostProgramIds: [], lastInAt: at("20:42") },
      { stationId: BEAT.id, personId: MARCUS.id, role: "operator", hosts: "Hosts Crate Talk", hostProgramIds: [], lastInAt: at("16:10") },
      { stationId: BEAT.id, personId: JEN.id, role: "host", hosts: "Beat Tape Live", hostProgramIds: [], lastInAt: at("-7 21:00") },
      // Kai owns 12.2 BEAT too (the same owner runs a family, A229).
      { stationId: TAPE.id, personId: KAI.id, role: "owner", hosts: null, hostProgramIds: [], lastInAt: at("19:30") },
      { stationId: HALL.id, personId: KAI.id, role: "operator", hosts: null, hostProgramIds: [], lastInAt: at("-1 23:00") },
      { stationId: LAB.id, personId: SAM.id, role: "owner", hosts: null, hostProgramIds: [], lastInAt: at("19:00") }
    ].map((m) => ({ ...m, hostProgramIds: m.hosts === "Beat Tape Live" ? [library.programs.find((p) => p.title === "Beat Tape Live")!.id] : m.hosts === "Hosts Crate Talk" ? [library.programs.find((p) => p.title === "Crate Talk")!.id] : [] })) as DbMember[],
    log,
    breaks,
    library,
    liveSources: seedLiveSources(),
    clearLinks: {},
    templates,
    offAirRules: seedOffAirRules()
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

// ---- Lookups every area uses ----

export function dbStation(stationId: string): DbStation | undefined {
  return getDb().stations.find((s) => s.ident.id === stationId);
}

export function membership(stationId: string, personId: string): DbMember | undefined {
  return getDb().members.find((m) => m.stationId === stationId && m.personId === personId);
}

export function stationLog(stationId: string, from?: string, to?: string): DbLogEntry[] {
  return getDb()
    .log.filter((e) => e.stationId === stationId && (!from || e.endsAt > from) && (!to || e.startsAt < to))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function stationBreaks(stationId: string, from?: string, to?: string): DbBreak[] {
  return getDb()
    .breaks.filter((b) => b.stationId === stationId && (!from || b.startsAt >= from) && (!to || b.startsAt < to))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
