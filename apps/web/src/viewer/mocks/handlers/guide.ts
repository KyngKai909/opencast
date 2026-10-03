// The guide: every station in a band, for a window of at most 24 hours.

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { GuideX } from "../../api/ext";
import { blockBandsIn, inWindow } from "../fixtures/schedule";
import { syncStreamSignOff } from "../fixtures/signoff";
import { inMarket } from "../fixtures/stations";
import { fail, path, reply } from "../respond";
import { airingX, identX, marketOf } from "../view";
import { offTheDial } from "../external";

export const guideHandlers = [
  http.get(path(stationsApi.getGuide), async ({ params, request }) => {
    await syncStreamSignOff();
    const slug = String(params.marketSlug);
    const market = marketOf(slug);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const q = new URL(request.url).searchParams;
    const band = (q.get("band") ?? "tv") as "tv" | "radio";
    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to) return fail(400, "bad_request", "A guide needs a window.");
    if (Date.parse(to) - Date.parse(from) > 24 * 3600e3) return fail(400, "bad_request", "A guide window is at most 24 hours.");
    // External stations down 5 minutes are off the guide too (follow-up Phase 6).
    const rows = inMarket(slug, band)
      .filter((s) => !offTheDial(s.ident.id))
      .map((s) => {
        const airings = inWindow(s.ident.id, from, to);
        // A244: its programming blocks, as bands.
        const blocks = blockBandsIn(airings);
        return { station: identX(s), airings: airings.map(airingX), ...(blocks.length ? { blocks } : {}) };
      });
    return reply(GuideX, { market, from, to, rows });
  })
];
