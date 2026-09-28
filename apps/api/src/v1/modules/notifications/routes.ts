import { notificationsApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function notificationsRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { notifications, accounts } = services;

  async function checkScope(user: Parameters<typeof accounts.requireStation>[0], scope: "viewer" | "station" | "business", scopeId: string | null | undefined) {
    if (scope === "station" && scopeId) await accounts.requireStation(user, scopeId, ["owner", "operator", "host"]);
    if (scope === "business" && scopeId) await accounts.requireBusiness(user, scopeId, ["owner", "manager", "viewer"]);
  }

  r.handle(api.listNotices, ({ user, query }) => notifications.list(user.id, query));
  r.handle(api.markRead, async ({ user, body }) => {
    await notifications.markRead(user.id, body);
    return { ok: true as const };
  });
  r.handle(api.getPrefs, async ({ user, query }) => {
    await checkScope(user, query.scope, query.scopeId);
    return notifications.prefs(user.id, { kind: query.scope, id: query.scopeId ?? null });
  });
  r.handle(api.setPrefs, async ({ user, body }) => {
    await checkScope(user, body.scope, body.scopeId);
    return notifications.setPrefs(user.id, { kind: body.scope, id: body.scopeId }, body.prefs);
  });
}
