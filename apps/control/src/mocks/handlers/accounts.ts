// accounts: who's signed in and their memberships (the station switcher, roles). The team
// endpoints (station-settings 03) are the Station area's to add here.

import { http } from "msw";
import { accountsApi, Me } from "@opencast/contracts";
import { getDb } from "../db";
import { MARKET } from "../fixtures/stations";
import { needsUser, path, reply } from "../respond";

export const accountsHandlers = [
  http.get(path(accountsApi.getMe), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    const memberships = db.members
      .filter((m) => m.personId === p.id)
      .map((m) => ({ kind: "station" as const, station: db.stations.find((s) => s.ident.id === m.stationId)!.ident, role: m.role }));
    return reply(Me, {
      id: p.id,
      displayName: p.displayName,
      email: p.email,
      market: { ...MARKET, open: true },
      isAdmin: false,
      identities: [{ kind: "email", value: p.email, verifiedAt: "2026-06-01T19:00:00.000Z" }],
      memberships,
      settings: {}
    });
  })
];
