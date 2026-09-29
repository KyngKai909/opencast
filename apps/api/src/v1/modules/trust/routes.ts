import { trustApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function trustRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { trust, accounts } = services;
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
  r.handle(api.resolveClaim, ({ params, body }) => trust.resolve(params.claimId, body.outcome));
  // B6: the file behind an answer.
  r.handle(api.attachToClaim, async ({ user, params, file }) => {
    await accounts.requireStation(user, await trust.stationOfClaim(params.claimId), [...staff]);
    return trust.attach(params.claimId, user.id, file);
  });
}
