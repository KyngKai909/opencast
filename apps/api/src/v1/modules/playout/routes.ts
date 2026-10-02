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
  // Previews (added 2026-09-29): a short-cache playlist over a file's prepared segments, for the
  // catalog, spot review, the spot market and order deliveries. Public, like the segments it lists:
  // it's found only through a preview URL, and a file locked by a claim or taken down has none.
  r.router.get("/previews/:key/:file", async (req, res, next) => {
    try {
      const match = /^([a-z0-9]+)\.m3u8$/.exec(req.params.file);
      const found = match ? await playout.previewPlaylist(req.params.key, match[1]) : null;
      res.set({ "access-control-allow-origin": "*" });
      if (!found) return void res.status(404).set({ "cache-control": "no-cache" }).json({ error: { code: "not_found", message: "There's no preview of that yet." } });
      res.set({ "content-type": "application/vnd.apple.mpegurl", "cache-control": `public, max-age=${found.maxAge}` }).send(found.body);
    } catch (error) {
      next(error);
    }
  });
}
