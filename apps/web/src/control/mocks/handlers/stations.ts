// stations, shared by every area: a station's setup (identity, status, bug), read and changed.
// Foundation-owned: ask for changes. Setup and sign-on add their endpoints in onair.ts; live
// sources in live.ts; translators and the break rule in station.ts.

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { dbStation, saveDb } from "../db";
import { familyHeadOf, familyOf, refreshFamilies, setupView } from "../family";
import { fail, needsUser, path, reply } from "../respond";

export const stationsHandlers = [
  http.get(path(stationsApi.getSetup), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    return reply(stationsApi.getSetup.response, setupView(st));
  }),

  http.patch(path(stationsApi.updateSetup), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    const body = (await request.json()) as Record<string, unknown>;
    // Call sign, channel, band and market are fixed after the first sign-on.
    const { name, colour, callSign, band, ...rest } = body as { name?: string; colour?: string; callSign?: string; band?: "tv" | "radio" };
    // A station sharing X.1's call sign can't leave by renaming once it has signed on (A229).
    if (st.setup.fixed && callSign !== undefined && familyHeadOf(st)) return fail(422, "fixed_after_sign_on", "The call sign is fixed after first sign-on.");
    if (st.setup.fixed && (callSign !== undefined || band !== undefined)) return fail(409, "fixed", "Call sign, channel, band and market are fixed after the first sign-on.");
    // X.1's call sign is its family's: it changes theirs too, until one of them has signed on.
    const family = familyOf(st.ident.id);
    if (callSign !== undefined && callSign !== st.ident.callSign && family.some((m) => m.setup.fixed)) return fail(422, "fixed_after_sign_on", `${[family.find((m) => m.setup.fixed)!.ident.callSign, family.find((m) => m.setup.fixed)!.ident.channel].filter(Boolean).join(" ")} has signed on with this call sign, so it stays.`);
    // Taking its own call sign before its first sign-on: it stops sharing.
    if (callSign !== undefined && familyHeadOf(st) && callSign !== familyHeadOf(st)!.ident.callSign) st.sharesWith = null;
    st.ident = { ...st.ident, ...(name !== undefined ? { name } : {}), ...(colour !== undefined ? { colour } : {}), ...(callSign !== undefined ? { callSign, handle: callSign.toLowerCase() } : {}), ...(band !== undefined ? { band } : {}) };
    st.setup = { ...st.setup, ...(rest as Partial<typeof st.setup>) };
    refreshFamilies();
    saveDb();
    return reply(stationsApi.updateSetup.response, setupView(st));
  })
];
