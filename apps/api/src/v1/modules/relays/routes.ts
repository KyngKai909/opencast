// Relays (added 2026-09-30, follow-up Phase 3): the Translators page's setting. Owners and
// operators see and change it (like translators); the cost comes from the Station account.
import { relayApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function relaysRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { relays, accounts } = services;

  r.handle(api.getRelay, async ({ user, params }) => {
    const role = await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return relays.view(params.stationId, user, role === "owner");
  });
  r.handle(api.updateRelay, async ({ user, params, body }) => {
    const role = await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return relays.update(params.stationId, user, body, role === "owner");
  });
  r.handle(api.listRelayRestarts, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return relays.restarts(params.stationId, query.limit);
  });
  r.handle(api.dismissPaidPromotionReminder, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    await relays.dismissPaidPromotionReminder(params.stationId, params.platformId);
    return { ok: true as const };
  });
}
