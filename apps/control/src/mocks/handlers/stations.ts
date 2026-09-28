// stations, for master control: a station's setup (identity, status) and its live sources.
// Setup and sign-on (/new, /setup) belong to the On air area; identity, breaks rules and
// translators to the Station area; live sources, hosts and speakers to the Live area. Each adds
// its endpoints to its own handler file (handlers/<area>.ts) rather than growing this one.

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { dbStation, getDb } from "../db";
import { fail, needsUser, path, reply } from "../respond";

export const stationsHandlers = [
  http.get(path(stationsApi.getSetup), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    return reply(stationsApi.getSetup.response, { station: st.ident, ...st.setup });
  }),

  http.get(path(stationsApi.listLiveSources), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    return reply(stationsApi.listLiveSources.response, getDb().liveSources);
  })
];
