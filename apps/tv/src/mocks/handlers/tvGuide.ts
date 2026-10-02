// Mock endpoints for the TV guide. The listings, programs, stations and reminders are the shared
// handlers' (guide.ts, station.ts, me.ts); this file adds the guide's other states for checking
// them on screen: `?guideState=loading|error|empty` in TV mode's address (mock only). Anything
// else passes through to the shared handlers.

import { delay, http, type HttpHandler } from "msw";
import { stationsApi } from "@opencast/contracts";
import { GuideX } from "../../api/ext";
import { fail, path, reply } from "../respond";
import { marketOf } from "../view";

export type GuideState = "loading" | "error" | "empty" | null;

/** The state asked for in the address, if any. */
export function guideStateFrom(search: string): GuideState {
  const v = new URLSearchParams(search).get("guideState");
  return v === "loading" || v === "error" || v === "empty" ? v : null;
}

export const tvGuideHandlers: HttpHandler[] = [
  http.get(path(stationsApi.getGuide), async ({ params, request }) => {
    const state = guideStateFrom(globalThis.location?.search ?? "");
    if (!state) return undefined;
    if (state === "loading") {
      await delay("infinite");
      return undefined;
    }
    if (state === "error") return fail(503, "unavailable", "The guide isn't available right now. Try again in a minute.");
    const q = new URL(request.url).searchParams;
    const market = marketOf(String(params.marketSlug));
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    return reply(GuideX, { market, from: q.get("from") ?? "", to: q.get("to") ?? "", rows: [] });
  })
];
