// The mock API's shared, changeable state: the businesses, who's on which team, each business's
// balance and its movements, and its spots. Kept in localStorage so a reload keeps what you did;
// "Reset mock data" in the console: remove the keys starting "oc-mock-spots-".
//
// This is the one model every area reads and writes: funding adds money, a spot's airings spend
// it, an order or a sponsorship holds it, and the shell's "Available" reads the same balance. An
// area's own data (airings and proof, codes, sponsorships, orders, notification prefs…) lives in
// its own mocks/fixtures/<area>.ts, and may keep its own saved state.

import type { Balance, Business, Movement, Spot } from "@opencast/contracts";
import { CYPRESS_ID, OSC_ID, seedBalances, seedBusinesses, seedMovements, seedSpots } from "./fixtures/businesses";
import { ANA, DEVON, JESS, TOMAS } from "./fixtures/people";
import { at } from "./fixtures/time";
import { now } from "../lib/clock";

export interface DbMember {
  businessId: string;
  personId: string;
  role: "owner" | "manager" | "viewer";
  /** The team list's line under the name: "Manager, Colton opening". */
  note: string | null;
  lastInAt: string | null;
}

export interface Db {
  /** Bumped when the seed changes shape, so an old saved mock is replaced. */
  version: number;
  businesses: Business[];
  members: DbMember[];
  balances: Record<string, Balance>;
  movements: Record<string, Movement[]>;
  spots: Spot[];
}

export const DB_VERSION = 1;
const KEY = "oc-mock-spots-db";

export function seed(): Db {
  return {
    version: DB_VERSION,
    businesses: seedBusinesses(),
    members: [
      { businessId: OSC_ID, personId: JESS.id, role: "owner", note: null, lastInAt: at("20:40") },
      { businessId: OSC_ID, personId: TOMAS.id, role: "manager", note: "Manager, Colton opening", lastInAt: at("-1 17:00") },
      { businessId: OSC_ID, personId: ANA.id, role: "viewer", note: "Bookkeeper, ana@ledgerline.example", lastInAt: at("-5 10:00") },
      { businessId: OSC_ID, personId: DEVON.id, role: "manager", note: "Inland Creative, the agency that makes their posters", lastInAt: at("-2 15:00") },
      { businessId: CYPRESS_ID, personId: DEVON.id, role: "manager", note: "Inland Creative", lastInAt: at("-3 11:00") }
    ],
    balances: seedBalances(),
    movements: seedMovements(),
    spots: seedSpots()
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

// ---- Lookups and money moves every area uses ----

export function dbBusiness(id: string): Business | undefined {
  return getDb().businesses.find((b) => b.id === id);
}

export function membership(businessId: string, personId: string): DbMember | undefined {
  return getDb().members.find((m) => m.businessId === businessId && m.personId === personId);
}

export function balanceOf(businessId: string): Balance {
  const d = getDb();
  d.balances[businessId] ??= { availableMicros: 0, heldMicros: 0, heldAirings: 0, spentThisMonthMicros: 0, spentThisMonthAirings: 0, pacePerDayMicros: 0, runwayDays: null, pendingDeposits: [], fundingSources: [] };
  return d.balances[businessId];
}

function runway(b: Balance): number | null {
  return b.pacePerDayMicros > 0 ? Math.floor(b.availableMicros / b.pacePerDayMicros) : null;
}

let seq = 0;
/**
 * Records a movement and changes the balance to match. `amountMicros` is signed as the business
 * sees it: money in is positive, money out (spent, withdrawn, fees) negative. `hold` moves money
 * from available into held (positive holds, negative releases).
 */
export function move(businessId: string, m: Omit<Movement, "id" | "at"> & { at?: string; hold?: boolean }): Movement {
  const d = getDb();
  const b = balanceOf(businessId);
  const { hold, ...rest } = m;
  const entry: Movement = { id: `00000000-0000-4000-9000-${String(Date.now() % 1e9).padStart(9, "0")}${String(++seq).padStart(3, "0")}`, at: m.at ?? now().toISOString(), ...rest };
  if (hold) {
    b.availableMicros -= m.amountMicros;
    b.heldMicros += m.amountMicros;
  } else {
    b.availableMicros += m.amountMicros;
    if (m.kind === "aired") {
      b.spentThisMonthMicros += -m.amountMicros;
      b.spentThisMonthAirings += 1;
    }
  }
  b.runwayDays = runway(b);
  (d.movements[businessId] ??= []).unshift(entry);
  saveDb();
  return entry;
}
