// stations, shared by every area: a station's setup (identity, status, bug), read and changed.
// Foundation-owned: ask for changes. Setup and sign-on add their endpoints in onair.ts; live
// sources in live.ts; translators and the break rule in station.ts.

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { dbStation, saveDb } from "../db";
import { fail, needsUser, path, reply } from "../respond";

export const stationsHandlers = [
  http.get(path(stationsApi.getSetup), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    return reply(stationsApi.getSetup.response, { station: st.ident, ...st.setup });
  }),

  http.patch(path(stationsApi.updateSetup), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    const body = (await request.json()) as Record<string, unknown>;
    // Call sign, channel, band and market are fixed after the first sign-on.
    const { name, colour, callSign, band, ...rest } = body as { name?: string; colour?: string; callSign?: string; band?: "tv" | "radio" };
    if (st.setup.fixed && (callSign !== undefined || band !== undefined)) return fail(409, "fixed", "Call sign, channel, band and market are fixed after the first sign-on.");
    st.ident = { ...st.ident, ...(name !== undefined ? { name } : {}), ...(colour !== undefined ? { colour } : {}), ...(callSign !== undefined ? { callSign, handle: callSign.toLowerCase() } : {}), ...(band !== undefined ? { band } : {}) };
    st.setup = { ...st.setup, ...(rest as Partial<typeof st.setup>) };
    saveDb();
    return reply(stationsApi.updateSetup.response, { station: st.ident, ...st.setup });
  })
];
