// Everyone in the one mock world (`npm run dev:mock`): the sign-in email picks the person, and the
// same person is the same in every area.
//
//   kai@example.com       Kai M.: the viewer's reference person (You, presets, pledges), and owns
//                         BEAT 12.1 in master control (and operates HALL)
//   marcus@example.com    Marcus Reyes: operates BEAT, hosts Crate Talk
//   jen@example.com       Jen Park: hosts Beat Tape Live on BEAT
//   sam@example.com       Sam T.: runs the studio Inland Sound Lab
//   dee@opencast.example  Dee A.: on the Opencast team (Network desk)
//   sam@opencast.example  Sam K.: on the Opencast team
//
// Anyone else signs in as someone new, with no station yet and not on the team. Station roles live
// in master control's mock db (control/mocks/db.ts, members), so invites and ownership changes stick.

export interface MockPerson {
  id: string;
  email: string;
  displayName: string | null;
  initials: string;
  /** On the Opencast team: Network desk opens (Me.isAdmin). */
  isAdmin: boolean;
}

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const KAI: MockPerson = { id: uid(1), email: "kai@example.com", displayName: "Kai M.", initials: "KM", isAdmin: false };
export const MARCUS: MockPerson = { id: uid(2), email: "marcus@example.com", displayName: "Marcus Reyes", initials: "MR", isAdmin: false };
export const JEN: MockPerson = { id: uid(3), email: "jen@example.com", displayName: "Jen Park", initials: "JP", isAdmin: false };
export const SAM: MockPerson = { id: uid(4), email: "sam@example.com", displayName: "Sam T.", initials: "ST", isAdmin: false };
export const DEE: MockPerson = { id: uid(900), email: "dee@opencast.example", displayName: "Dee A.", initials: "DA", isAdmin: true };
export const SAM_K: MockPerson = { id: uid(901), email: "sam@opencast.example", displayName: "Sam K.", initials: "SK", isAdmin: true };

export const PEOPLE: MockPerson[] = [KAI, MARCUS, JEN, SAM, DEE, SAM_K];

/** The Opencast team (A6), for the desk's "Run by". */
export function team(): MockPerson[] {
  return PEOPLE.filter((p) => p.isAdmin);
}

/** Anyone can sign in to the mock: unknown addresses are someone new, with a stable id from the address. */
export function personByEmail(email: string): MockPerson {
  const e = email.trim().toLowerCase();
  const known = PEOPLE.find((p) => p.email === e);
  if (known) return known;
  let h = 7;
  for (const c of e) h = (h * 31 + c.charCodeAt(0)) % 99999;
  return { id: uid(10000 + h), email: e, displayName: null, initials: e.slice(0, 1).toUpperCase(), isAdmin: false };
}
