import { licencesApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

// Programming Phase 6: the Network desk's network licences, and each one's monthly minutes.
export function licencesRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { licences } = services;

  r.handle(api.listLicences, ({ user }) => licences.list(user));
  r.handle(api.getLicence, ({ user, params }) => licences.get(user, params.licenceId));
  r.handle(api.createLicence, ({ user, body }) => licences.create(user, body));
  r.handle(api.updateLicence, ({ user, params, body }) => licences.update(user, params.licenceId, body));
  r.handle(api.licenceMinutes, ({ user, params, query }) => licences.minutes(user, params.licenceId, query.month));
  r.handle(api.licenceMinutesCsv, ({ user, params, query }) => licences.minutesCsv(user, params.licenceId, query.month));
}
