// The board: markets, each band's slots and stats, the waitlist's reservations and call signs.
import { http, type HttpHandler } from "msw";
import { networkApi, stationsApi, waitlistApi } from "@opencast/contracts";
import { advance, boardView, callSignTaken, getDb, marketBySlug } from "../db";
import { fail, needsAdmin, path, reply } from "../respond";

export const boardHandlers: HttpHandler[] = [
  http.get(path(stationsApi.listMarkets), () => reply(stationsApi.listMarkets.response, getDb().markets)),

  http.get(path(networkApi.getBoard), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const market = marketBySlug(String(params.marketSlug));
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    advance();
    const band = new URL(request.url).searchParams.get("band") === "radio" ? "radio" : "tv";
    return reply(networkApi.getBoard.response, boardView(market, band));
  }),

  http.get(path(waitlistApi.listReservations), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const marketId = new URL(request.url).searchParams.get("marketId");
    const d = getDb();
    return reply(
      waitlistApi.listReservations.response,
      d.reservations
        .filter((r) => !marketId || r.marketId === marketId)
        .map((r) => ({ id: r.id, callSign: r.callSign, email: r.email, market: d.markets.find((m) => m.id === r.marketId) ?? null, channel: r.channel, heldUntil: r.heldUntil, createdAt: r.createdAt }))
    );
  }),

  http.get(path(waitlistApi.checkCallSign), ({ params }) => {
    const callSign = String(params.callSign).toUpperCase();
    const valid = /^[A-Z]{3,5}$/.test(callSign);
    return reply(waitlistApi.checkCallSign.response, { callSign, valid, available: valid && !callSignTaken(callSign) });
  })
];
