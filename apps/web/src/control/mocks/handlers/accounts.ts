// accounts: who's signed in and their memberships (the station switcher, roles). The team
// endpoints (station-settings 03) are the Station area's to add here.

import { http } from "msw";
import { accountsApi } from "@opencast/contracts";
import { meHandler } from "../../../mocks/me";
import { getDb, saveDb } from "../db";
import { needsUser, path, reply } from "../respond";
import { now } from "../../../lib/clock";

export const accountsHandlers = [
  // Who am I, with the memberships the station switcher and roles read: the one answer for every
  // area (src/mocks/me.ts).
  meHandler,

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
