// What the real-API harness's pieces agree on: ports, where the run's state lives, and its shape.
// Used by playwright.real.config.ts, the global setup and teardown, the API server and lib/real.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(E2E_DIR, "..");
/** The run's state (git-ignored): the throwaway signing key, the database's name, the seed's ids. */
export const STATE_DIR = path.join(E2E_DIR, ".real");
export const STATE_FILE = path.join(STATE_DIR, "state.json");

/** The API on its own port, beside the dev API (:8787). */
export const API_PORT = 8788;
export const API_BASE = `http://localhost:${API_PORT}`;

/** Each app in real mode, on its own port (the mock servers keep 5174–5183). */
/** The Opencast app (apps/web: the viewer, /control, /desk) on 5274, the others beside it. */
export const REAL_PORTS = { web: 5274, tv: 5275, business: 5281, site: 5283 } as const;
export type RealApp = keyof typeof REAL_PORTS;
export const WORKSPACES: Record<RealApp, string> = { web: "apps/web", tv: "apps/tv", business: "apps/business", site: "apps/site" };
export const appUrl = (app: RealApp) => `http://localhost:${REAL_PORTS[app]}`;

/** The Privy app id the API checks tokens against. Never a real Privy app. */
export const PRIVY_APP_ID = "opencast-e2e";
export const ADMIN_DATABASE_URL = process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
export const REDIS_BASE_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:63799";

/** Everyone the seed signs in. Each signs in as `did:privy:<key>`, with the email `<key>@example.com`. */
export const PEOPLE = {
  kai: { name: "Kai M.", does: "owns BEAT (Inland Beat, 12.1); Marcus operates it" },
  marcus: { name: "Marcus Reyes", does: "operates BEAT" },
  jess: { name: "Jess Park", does: "owns REEL (Saturday Reel, 24.1); offers Saturday Reel for carriage" },
  maya: { name: "Maya Ortiz", does: "owns Orange Street Coffee: $60 funded by card, two spots listed" },
  omar: { name: "Omar Haddad", does: "owns Redlands Bikes: $150 funded by card, one spot in review" },
  sam: { name: "Sam T.", does: "a viewer in the Inland Empire: two presets, pledges $10 a month to REEL" },
  dee: { name: "Dee A.", does: "an Opencast admin (Network desk)" },
  lupe: { name: "Lupe Ortiz", does: "the creator behind Tía Lupe's Kitchen (claimable, not yet on air)" }
} as const;
export type Person = keyof typeof PEOPLE;
export const emailOf = (person: string) => `${person.toLowerCase()}@example.com`;
export const didOf = (person: string) => `did:privy:${person.toLowerCase()}`;

/** The seed's ids (e2e/real/seed.ts). */
export interface Seed {
  markets: { inlandEmpire: string; losAngeles: string; highDesert: string };
  users: Record<Person, string>;
  stations: Record<"civc" | "beat" | "sazn" | "reel" | "nite" | "crat" | "mojv", { id: string; callSign: string; channel: string; name: string }>;
  programs: Record<"lateCrate" | "beatTapeLive" | "saturdayReel" | "councilMeeting" | "homeCooking" | "nightDesk", string>;
  /** Saturday Reel's carriage offer (Jess), open to any station. */
  offers: { saturdayReel: string };
  businesses: { orange: string; bikes: string };
  spots: { fallMenu: string; nightOwl: string; rideSeason: string };
  creators: { lupe: string; crate: string };
  recipes: { food: string };
}

export interface RunState {
  run: string;
  database: string;
  apiBase: string;
  redisUrl: string;
  /** The private half of the run's ES256 key (JWK): tests sign Privy-style tokens with it. */
  privateJwk: Record<string, unknown>;
  seed: Seed;
  /** The API server's pid, so teardown can stop it. */
  apiPid?: number;
}

export function readState(): RunState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunState;
  } catch {
    throw new Error(`No real-API run state at ${STATE_FILE}. Run through playwright.real.config.ts (npm run e2e:real), or start one with npm run real:up -w @opencast/e2e.`);
  }
}
