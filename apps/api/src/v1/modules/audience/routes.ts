import { audienceApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { HEARTBEAT_MS } from "./service.js";

export function audienceRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
  r.handle(api.heartbeat, async ({ body, user }) => {
    // The tuned-in session stays anonymous: the person (if signed in) only feeds their own watch
    // history (A2), kept by accounts while their setting is on, never linked to the session.
    const { offAirUntil } = await services.audience.heartbeat(body);
    if (offAirUntil) {
      // Off air on a schedule: not counted, not kept in watch history; the next beat can wait until it's back.
      return { ok: true as const, nextInMs: Math.max(HEARTBEAT_MS, Date.parse(offAirUntil) - deps.clock.now().getTime()), offAirUntil };
    }
    if (user && body.playing) await services.accounts.recordWatching(user.id, body.stationId);
    return { ok: true as const, nextInMs: HEARTBEAT_MS };
  });
  r.handle(api.getAudience, async ({ user, params, query }) => {
    // Stations see their own numbers only; operators too, hosts not.
    await services.accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return services.audience.report(params.stationId, new Date(query.from), new Date(query.to));
  });
}
