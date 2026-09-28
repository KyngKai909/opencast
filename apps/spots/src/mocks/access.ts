// Role checks for mock handlers: the person's role on a business, or the 403 to return.

import { can, type Ability } from "../business/abilities";
import { membership } from "./db";
import { fail } from "./respond";
import type { MockPerson } from "./fixtures/people";

export function roleOn(businessId: string, p: MockPerson, ability: Ability, message = "You can't do that on this business.") {
  const m = membership(businessId, p.id);
  if (!m) return fail(404, "not_found", "That business wasn't found.");
  if (!can(m.role, ability)) return fail(403, "forbidden", message);
  return m;
}
