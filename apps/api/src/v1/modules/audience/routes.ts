import { audienceApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { HEARTBEAT_MS } from "./service.js";

export function audienceRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  r.handle(api.heartbeat, async ({ body }) => {
    await services.audience.heartbeat(body);
    return { ok: true as const, nextInMs: HEARTBEAT_MS };
  });
  r.handle(api.getAudience, async ({ user, params, query }) => {
    // Stations see their own numbers only; operators too, hosts not.
    await services.accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return services.audience.report(params.stationId, new Date(query.from), new Date(query.to));
  });
}
