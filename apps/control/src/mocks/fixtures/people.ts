// Who can sign in to the mock (the sign-in email picks the person). The team frame
// (station-settings 03.1): Kai M. owns BEAT, Marcus Reyes operates it and hosts Crate Talk, Jen
// Park hosts Beat Tape Live. Kai also operates HALL (the switcher, 04.1). Sam T. runs the studio
// Inland Sound Lab (market 04.1). Anyone else is someone new, with no station yet.
// Memberships live in the mock db (db.members), so invites and ownership changes stick.

import { uid } from "./stations";

export interface MockPerson {
  id: string;
  email: string;
  displayName: string | null;
  initials: string;
}

export const PEOPLE: MockPerson[] = [
  { id: uid(1), email: "kai@example.com", displayName: "Kai M.", initials: "KM" },
  { id: uid(2), email: "marcus@example.com", displayName: "Marcus Reyes", initials: "MR" },
  { id: uid(3), email: "jen@example.com", displayName: "Jen Park", initials: "JP" },
  { id: uid(4), email: "sam@example.com", displayName: "Sam T.", initials: "ST" }
];

/** Anyone can sign in to the mock: unknown addresses are someone new. */
export function personByEmail(email: string): MockPerson {
  const e = email.trim().toLowerCase();
  const known = PEOPLE.find((p) => p.email === e);
  if (known) return known;
  let h = 7;
  for (const c of e) h = (h * 31 + c.charCodeAt(0)) % 99999;
  return { id: uid(10000 + h), email: e, displayName: null, initials: e.slice(0, 1).toUpperCase() };
}

export const KAI = PEOPLE[0];
export const MARCUS = PEOPLE[1];
export const JEN = PEOPLE[2];
export const SAM = PEOPLE[3];
