import { playoutApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function playoutRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { playout, accounts } = services;
  const staff = ["owner", "operator"] as const;

  r.handle(api.getSignOnChecks, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return playout.checks(params.stationId);
  });
  r.handle(api.signOn, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return playout.signOn(params.stationId);
  });
  r.handle(api.signOff, async ({ user, params, body }) => {
    // Signing off for good is the owner's; signing off for now is operators' too.
    await accounts.requireStation(user, params.stationId, body.permanently ? ["owner"] : [...staff]);
    return playout.signOff(params.stationId, body.permanently);
  });
  r.handle(api.cueBreak, async ({ user, params }) => {
    await playout.cueBreak(user, params.stationId);
    return { ok: true as const };
  });
  r.handle(api.getStatus, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator", "host"]);
    return playout.status(params.stationId);
  });
  r.handle(api.getAsRun, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return playout.asRun(params.stationId, new Date(query.from), new Date(query.to));
  });
}
