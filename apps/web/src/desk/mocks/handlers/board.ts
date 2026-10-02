// The board: markets, and each band's slots and stats.
import { http, type HttpHandler } from "msw";
import { networkApi, stationsApi } from "@opencast/contracts";
import { advance, boardView, getDb, marketBySlug } from "../db";
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
  })
  // The waitlist's reservations and call sign checks are in reserved.ts (2026-09-29).
];
