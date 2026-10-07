import { analyticsApi, audienceApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { badRequest } from "../../errors.js";
import { clientIp, isPrivateAddress } from "../../geo.js";
import { HEARTBEAT_MS } from "./service.js";

export function audienceRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
  r.handle(api.heartbeat, async ({ body, user, req }) => {
    // The tuned-in session stays anonymous: the person (if signed in) only feeds their own watch
    // history (A2), kept by accounts while their setting is on, never linked to the session.
    // Where the viewer is, asked only when their session starts (2026-09-30): their chosen market when
    // signed in, else a coarse location from the connection (GEOIP_URL). Only the market is kept.
    const place = async () => {
      if (user) {
        const market = (await services.accounts.me(user.id)).market;
        if (market) return market.id;
      }
      const ip = clientIp(req);
      if (!ip || isPrivateAddress(ip) || !deps.geo.configured) return null;
      const found = await deps.geo.lookup(ip);
      if (found?.zip) {
        const market = await services.network.marketForZip(found.zip);
        if (market) return market.id;
      }
      return found?.point ? ((await services.network.marketNear(found.point)).market?.id ?? null) : null;
    };
    const { offAirUntil } = await services.audience.heartbeat(body, { place });
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
    // A251: the player's id stands for its session on this station (its own, or the one made for it).
    const sessionId = (await services.audience.sessionOn(body.sessionId, params.stationId)) ?? body.sessionId;
    const { status } = await services.audience.watch.vote({ stationId: params.stationId, sessionId });
    return { ok: true as const, status };
  });

  // A251 (2026-10-06): the Network desk's analytics; admins, and market leads for their market.
  r.handle(analyticsApi.overview, ({ user, query }) => services.audience.analytics.overview(user, query));
  r.handle(analyticsApi.stations, ({ user, query }) => services.audience.analytics.stations(user, query));
}
