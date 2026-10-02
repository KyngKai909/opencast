import { PLATFORM_OAUTH_CALLBACK_PATH, platformsApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function platformsRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
  const { platforms } = services;

  r.handle(api.listPlatforms, async ({ user, params }) => {
    await services.accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return platforms.list(params.stationId);
  });

  r.handle(api.startPlatformSignIn, async ({ user, params, body, req }) => {
    await services.accounts.requireStation(user, params.stationId, ["owner"]);
    // The platform sends the browser back to the API's own public address.
    const apiBase = deps.config.publicBase ?? `${req.protocol}://${req.get("host")}`;
    return platforms.startSignIn({ stationId: params.stationId, provider: params.provider, userId: user.id, returnTo: body.returnTo, apiBase });
  });

  r.handle(api.addManualPlatform, async ({ user, params, body }) => {
    await services.accounts.requireStation(user, params.stationId, ["owner"]);
    return platforms.addManual(params.stationId, user.id, body);
  });

  r.handle(api.removePlatform, async ({ user, params }) => {
    await services.accounts.requireStation(user, params.stationId, ["owner"]);
    await platforms.remove(params.stationId, params.platformId);
    return { ok: true as const };
  });

  // The platform's redirect after signing in: not JSON, the browser goes back to master control.
  // The one-time state says whose sign-in it is; the code is exchanged here and never kept.
  r.router.get(PLATFORM_OAUTH_CALLBACK_PATH, async (req, res, next) => {
    try {
      const one = (v: unknown) => (typeof v === "string" && v.length <= 2048 ? v : null);
      const location = await platforms.finishSignIn({ provider: String(req.params.provider), state: one(req.query.state), code: one(req.query.code), error: one(req.query.error) });
      res.set("cache-control", "no-store").redirect(302, location);
    } catch (error) {
      next(error);
    }
  });
}
