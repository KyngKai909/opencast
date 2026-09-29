// Who can sign in to the mock desk. Dee A. is on the Opencast team (the frames' avatar "DA");
// anyone else signs in but isn't, and sees the "this desk is for the Opencast team" page.
import { U } from "./ids";

export interface MockPerson {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
}

export const DEE: MockPerson = { id: U(900), email: "dee@opencast.example", displayName: "Dee A.", isAdmin: true };
export const SAM: MockPerson = { id: U(901), email: "sam@opencast.example", displayName: "Sam K.", isAdmin: true };
const TEAM = [DEE, SAM];

/** The Opencast team (A6), for "Run by". */
export function team(): MockPerson[] {
  return TEAM;
}

export function personByEmail(email: string): MockPerson {
  const e = email.trim().toLowerCase();
  const known = TEAM.find((p) => p.email === e);
  if (known) return known;
  // Anyone else: a signed-in person who isn't on the team. A stable id from the address.
  let h = 7;
  for (const c of e) h = (h * 31 + c.charCodeAt(0)) % 1_000_000;
  return { id: U(700_000 + h), email: e, displayName: null, isAdmin: false };
}
