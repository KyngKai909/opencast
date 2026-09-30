import { deskApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

// Network desk Settings, Storage maintenance (added 2026-09-29): admins only.
export function maintenanceRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { maintenance } = services;

  r.handle(api.getStorageMaintenance, ({ user, query }) => maintenance.state(user, query.check));
  r.handle(api.startStorageRun, ({ user, body }) => maintenance.start(user, body));
  r.handle(api.getStorageRun, ({ user, params }) => maintenance.run(user, params.runId));
  r.handle(api.storageRunReport, ({ user, params }) => maintenance.report(user, params.runId));
}
