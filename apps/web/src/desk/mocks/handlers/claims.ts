// Rights claims across every station (desk-pages 01): the list, scoped as the API scopes it (admins
// and rights reviewers see every market, a market lead their own), and outcomes recorded by a
// rights reviewer or an admin through trust's resolveClaim.
import { http, type HttpHandler } from "msw";
import { trustApi } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { claimsDb, claimView, deskClaimsView, marketsFor, saveClaims } from "../claimsDb";
import { bodyOf, fail, lacks, needsDesk, path, reply } from "../respond";

export const claimsHandlers: HttpHandler[] = [
  http.get(path(trustApi.listDeskClaims), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const marketId = new URL(request.url).searchParams.get("marketId");
    const allowed = marketsFor(p);
    if (marketId && allowed && !allowed.has(marketId)) return fail(403, "desk_role", "Only this market's lead or an admin can do that.");
    return reply(trustApi.listDeskClaims.response, deskClaimsView(p, marketId));
  }),

  http.post(path(trustApi.resolveClaim), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const c = claimsDb().claims.find((x) => x.id === String(params.claimId));
    if (!c) return fail(404, "not_found", "That claim wasn't found.");
    const body = trustApi.resolveClaim.body.safeParse(await bodyOf(request));
    if (!body.success) return fail(400, "bad_request", "Choose what happened: upheld, withdrawn or restored.");
    if (c.state !== "open" && c.state !== "answered") return fail(409, "not_open", "That claim has been dealt with.");
    const at = now().toISOString();
    c.state = body.data.outcome;
    c.closedAt = at;
    if (body.data.outcome !== "upheld") c.takedowns = c.takedowns.map((t) => ({ ...t, restoredAt: t.restoredAt ?? at }));
    saveClaims();
    return reply(trustApi.resolveClaim.response, claimView(c)!);
  })
];
