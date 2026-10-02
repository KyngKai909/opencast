// The one answer to "who am I" (accounts.getMe) in the one mock world, with what every area needs:
// the viewer's profile (name, market, settings: viewer/mocks/db.ts), master control's station roles
// and Clear link (control/mocks/db.ts), and whether the desk opens (isAdmin, people.ts).

import { http, type HttpHandler } from "msw";
import { accountsApi, Me } from "@opencast/contracts";
import { getDb as controlDb } from "../control/mocks/db";
import { profileOf } from "../viewer/mocks/db";
import { marketOf } from "../viewer/mocks/view";
import type { MockPerson } from "./people";
import { isAdminNow, rolesOf } from "../desk/mocks/settingsDb";
import { needsUser, path, reply } from "./respond";

export function meView(p: MockPerson): Me {
  const prof = profileOf(p);
  const c = controlDb();
  const memberships = c.members
    .filter((m) => m.personId === p.id)
    .flatMap((m) => {
      const st = c.stations.find((s) => s.ident.id === m.stationId);
      return st ? [{ kind: "station" as const, station: st.ident, role: m.role }] : [];
    });
  return {
    id: p.id,
    displayName: prof.displayName,
    email: p.email,
    market: prof.marketSlug ? marketOf(prof.marketSlug) : null,
    isAdmin: isAdminNow(p),
    identities: [{ kind: "email", value: p.email, verifiedAt: "2026-06-01T19:00:00.000Z" }],
    memberships,
    settings: prof.settings,
    clear: c.clearLinks?.[p.id] ?? null,
    // Network desk roles (added 2026-09-29): Settings, Team in the desk's mock.
    deskRoles: rolesOf(p)
  };
}

export const meHandler: HttpHandler = http.get(path(accountsApi.getMe), ({ request }) => {
  const p = needsUser(request);
  if (p instanceof Response) return p;
  return reply(Me, meView(p));
});
