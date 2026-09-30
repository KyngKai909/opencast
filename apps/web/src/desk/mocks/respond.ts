// The desk's mock handlers answer through the app's shared helpers (src/mocks/respond.ts). Most desk
// endpoints are `auth: "admin"`: needsAdmin answers 401 signed out and 403 for anyone who isn't
// on the Opencast team. Settings and the catalog shelf are `auth: "desk"` (added 2026-09-29):
// needsDesk lets in anyone with a desk role (admin, rights reviewer, market lead).
import type { MockPerson } from "../../mocks/people";
import { fail, personOf } from "../../mocks/respond";
import { isAdminNow, mayRights, onTeam } from "./settingsDb";

export { bodyOf, fail, needsAdmin, needsUser, path, personOf, reply } from "../../mocks/respond";

/** Someone on the Opencast team (any desk role), or the 401 or 403 to return. */
export function needsDesk(request: Request): MockPerson | Response {
  const p = personOf(request);
  if (!p) return fail(401, "unauthorized", "Sign in to do that.");
  if (!onTeam(p)) return fail(403, "forbidden", "Network desk is for the Opencast team.");
  return p;
}

/** The 403 an action needs, or null: `admin`, or `rights` (a rights reviewer or admin). */
export function lacks(p: MockPerson, need: "admin" | "rights"): Response | null {
  if (need === "admin" ? isAdminNow(p) : mayRights(p)) return null;
  return fail(403, "desk_role", need === "admin" ? "Only an admin can change that." : "Only a rights reviewer or an admin can do that.");
}
