// accounts: who's signed in and their businesses (the switcher, roles). Shared, foundation-owned:
// the team endpoints are the Settings area's, in settings.ts.

import { http, type HttpHandler } from "msw";
import { accountsApi, Me } from "@opencast/contracts";
import { getDb, saveDb } from "../db";
import { MARKET } from "../fixtures/stations";
import { needsUser, path, reply } from "../respond";
import { now } from "../../lib/clock";

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
      settings: {},
      clear: db.clearLinks?.[p.id] ?? null
    });
  }),

  // Connect Clear. Mock mode has no Clear: linking succeeds at once. The access Clear shares is
  // "full" unless localStorage "oc-mock-clear-access" says "read_only" (to see that state).
  http.post(path(accountsApi.linkClear), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    let access: "full" | "read_only" = "full";
    try {
      if (localStorage.getItem("oc-mock-clear-access") === "read_only") access = "read_only";
    } catch {
      /* private window */
    }
    let h = 0x1f2e3d;
    for (const c of p.email) h = (h * 33 + c.charCodeAt(0)) >>> 0;
    const address = `0x${(h.toString(16) + "c1ea7").repeat(6).slice(0, 40)}`;
    db.clearLinks ??= {};
    db.clearLinks[p.id] = { address, access, linkedAt: now().toISOString() };
    saveDb();
    return reply(accountsApi.linkClear.response, db.clearLinks[p.id]);
  }),

  http.delete(path(accountsApi.unlinkClear), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    if (db.clearLinks) delete db.clearLinks[p.id];
    saveDb();
    return reply(accountsApi.unlinkClear.response, { ok: true });
  })
];
