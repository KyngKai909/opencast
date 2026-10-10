import { trustApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TOO_BIG } from "./service.js";

export function trustRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { trust, accounts, settings } = services;
  const staff = ["owner", "operator"] as const;

  r.handle(api.fileClaim, ({ body }) => trust.file(body));
  r.handle(api.listClaims, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    const [claims, standing] = await Promise.all([trust.claims(params.stationId), trust.standing(params.stationId)]);
    return { claims, standing };
  });
  r.handle(api.answerClaim, async ({ user, params, body }) => {
    await accounts.requireStation(user, await trust.stationOfClaim(params.claimId), [...staff]);
    return trust.answer(params.claimId, user.id, body);
  });
  r.handle(api.removeClaimedItem, async ({ user, params }) => {
    await accounts.requireStation(user, await trust.stationOfClaim(params.claimId), [...staff]);
    return trust.remove(params.claimId);
  });
  // Network desk (added 2026-09-29): a rights reviewer or an admin records the outcome.
  r.handle(api.resolveClaim, async ({ user, params, body }) => {
    await settings.requireDesk(user, "rights");
    return trust.resolve(params.claimId, body.outcome);
  });
  // Network desk, Rights claims: every station's claims, in the caller's markets.
  r.handle(api.listDeskClaims, ({ user, query }) => trust.deskClaims(user, query.marketId));
  // B6: the file behind an answer.
  r.handle(api.attachToClaim, ({ user, params, file }) => trust.attach(params.claimId, user.id, file), {
    maxBytes: ATTACHMENT_MAX_BYTES,
    tooBig: ATTACHMENT_TOO_BIG,
    authorize: async ({ user, params }) => accounts.requireStation(user, await trust.stationOfClaim(params.claimId), [...staff])
  });
}
