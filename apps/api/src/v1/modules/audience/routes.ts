import { audienceApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { badRequest } from "../../errors.js";
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
  // Watch data (added 2026-09-29, follow-up Phase 1).
  r.handle(api.programWatchData, async ({ user, params, query }) => {
    // The maker's own programs, added up across every station that aired them: never another
    // station's audience per airing.
    await services.accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) throw badRequest("Ask for up to a year.");
    return services.audience.watch.forMaker(params.stationId, from, to);
  });
  r.handle(api.voteNotForMe, async ({ params, body }) => {
    // Taken whether or not the player shows the control (features.not_for_me); never tied to the person.
    const { status } = await services.audience.watch.vote({ stationId: params.stationId, sessionId: body.sessionId });
    return { ok: true as const, status };
  });
}
