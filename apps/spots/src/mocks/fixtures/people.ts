// Who can sign in to the mock (the sign-in email picks the person). The team frame
// (biz-settings 02.1): Jess Lin owns Orange Street Coffee; Tomás Rivera manages it (the Colton
// opening); Ana K. is the bookkeeper (viewer); Devon M. is from Inland Creative, the agency that
// makes their posters (manager), and also manages Cypress Dental. Anyone else is someone new, with
// no business yet. Memberships live in the mock db (db.members).

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export interface MockPerson {
  id: string;
  email: string;
  displayName: string | null;
  initials: string;
}

export const PEOPLE: MockPerson[] = [
  { id: uid(21), email: "jess@orangestreet.example", displayName: "Jess Lin", initials: "JL" },
  { id: uid(22), email: "tomas@orangestreet.example", displayName: "Tomás Rivera", initials: "TR" },
  { id: uid(23), email: "ana@ledgerline.example", displayName: "Ana K.", initials: "AK" },
  { id: uid(24), email: "devon@inlandcreative.example", displayName: "Devon M.", initials: "DM" }
];

/** Anyone can sign in to the mock: unknown addresses are someone new. */
export function personByEmail(email: string): MockPerson {
  const e = email.trim().toLowerCase();
  const known = PEOPLE.find((p) => p.email === e);
  if (known) return known;
  let h = 7;
  for (const c of e) h = (h * 31 + c.charCodeAt(0)) % 99999;
  return { id: uid(20000 + h), email: e, displayName: null, initials: e.slice(0, 1).toUpperCase() };
}

export const JESS = PEOPLE[0];
export const TOMAS = PEOPLE[1];
export const ANA = PEOPLE[2];
export const DEVON = PEOPLE[3];
