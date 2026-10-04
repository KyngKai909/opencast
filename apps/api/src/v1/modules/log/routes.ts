import { logApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { HttpError } from "../../errors.js";

export function logRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
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
  // Edit mode (added 2026-09-29): a batch of changes, checked (a dry run) or published at once.
  r.handle(api.applyLogChanges, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.changes.apply(params.stationId, user.id, body);
  });
  r.handle(api.listLogChanges, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return { changes: await log.changes.history(params.stationId, query.limit) };
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

  // Day templates and off air hours (added 2026-09-29).
  r.handle(api.listTemplates, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return { templates: await log.templates.list(params.stationId) };
  });
  r.handle(api.getTemplate, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.templates.get(params.stationId, params.templateId);
  });
  r.handle(api.createTemplate, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.templates.create(params.stationId, body);
  });
  r.handle(api.updateTemplate, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.templates.update(params.stationId, params.templateId, body);
  });
  r.handle(api.removeTemplate, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    await log.templates.get(params.stationId, params.templateId);
    return { removed: await log.templates.remove(params.stationId, params.templateId) };
  });
  // A246: "Reset to template" for one edited date.
  r.handle(api.resetTemplateDate, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.templates.resetDate(params.stationId, params.templateId, params.date);
  });
  r.handle(api.getOffAirHours, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.offAirHours(params.stationId);
  });
  r.handle(api.setOffAirHours, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    const hours = await log.setOffAirHours(params.stationId, body.rules);
    // Playout reads the new hours at its next plan.
    await services.playout.replan(params.stationId);
    return hours;
  });

  // G7: undo a "Repeat this day".
  r.handle(api.removeRepeat, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return { removed: await log.removeRepeat(params.stationId, params.repeatId) };
  });

  /** Owners, operators, and the block's own hosts. */
  async function canRunBlock(user: Parameters<typeof accounts.requireStation>[0], stationId: string, entryId: string) {
    const role = await accounts.requireStation(user, stationId, ["owner", "operator", "host"]);
    const entry = await log.liveEntry(stationId, entryId);
    if (role === "host" && !(await stations.isHost(user.id, stationId, entry.programId))) {
      throw new HttpError(403, "not_your_block", "Hosts run their own live blocks.");
    }
    return entry;
  }

  // G3: end a live block early; playout hands back to the log at once.
  r.handle(api.endEarly, async ({ user, params }) => {
    await canRunBlock(user, params.stationId, params.entryId);
    const ended = await log.endEarly(params.stationId, params.entryId);
    await services.playout.endLive(params.stationId, user.id);
    return ended;
  });
  r.handle(api.getLiveBlock, async ({ user, params }) => {
    const entry = await canRunBlock(user, params.stationId, params.entryId);
    const now = deps.clock.now();
    const onNow = entry.startsAt <= now && entry.endsAt > now;
    const status = onNow ? (await services.playout.statusFor([params.stationId])).get(params.stationId) : undefined;
    return {
      entryId: entry.id,
      endedEarlyAt: entry.endedEarlyAt?.toISOString() ?? null,
      startsAt: entry.startsAt.toISOString(),
      endsAt: entry.endsAt.toISOString(),
      signal: status?.onAir ? (status.standingBy ? ("standby" as const) : ("receiving" as const)) : null
    };
  });

  // G5: listings per airing.
  r.handle(api.listListings, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.listings(params.stationId, new Date(query.from), new Date(query.to));
  });
  r.handle(api.updateListing, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return log.updateListing(params.stationId, params.entryId, body);
  });
}
