import { logApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function logRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { log, accounts, stations } = services;
  const staff = ["owner", "operator"] as const;

  r.handle(api.getLog, async ({ user, params, query }) => {
    const role = await accounts.requireStation(user, params.stationId, ["owner", "operator", "host"]);
    const view = await log.log(params.stationId, new Date(query.from), new Date(query.to));
    if (role !== "host") return view;
    // Hosts see their own live blocks only.
    const mine = await Promise.all(view.entries.map((e) => stations.isHost(user.id, params.stationId, e.programId)));
    return { ...view, entries: view.entries.filter((e, i) => e.kind === "live" && mine[i]), breaks: [], gaps: [] };
  });
  r.handle(api.addEntry, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.add(params.stationId, user.id, body);
  });
  r.handle(api.updateEntry, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.update(params.stationId, params.entryId, body);
  });
  r.handle(api.removeEntry, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    await log.remove(params.stationId, params.entryId);
    return { ok: true as const };
  });
  r.handle(api.repeatDay, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.repeatDay(params.stationId, body);
  });
  r.handle(api.fillGap, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.fill(params.stationId, user.id, body);
  });
  r.handle(api.getDeadAir, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.deadAir(params.stationId);
  });
}
