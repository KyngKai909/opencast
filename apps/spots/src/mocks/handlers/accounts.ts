// accounts: who's signed in and their businesses (the switcher, roles). Shared, foundation-owned:
// the team endpoints are the Settings area's, in settings.ts.

import { http, type HttpHandler } from "msw";
import { accountsApi, Me } from "@opencast/contracts";
import { getDb } from "../db";
import { MARKET } from "../fixtures/stations";
import { needsUser, path, reply } from "../respond";

export const accountsHandlers: HttpHandler[] = [
  http.get(path(accountsApi.getMe), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    const memberships = db.members
      .filter((m) => m.personId === p.id)
      .map((m) => ({ kind: "business" as const, business: { id: m.businessId, name: db.businesses.find((b) => b.id === m.businessId)!.name }, role: m.role }));
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
