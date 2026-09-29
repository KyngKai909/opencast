// Fields master control's screens need that the contracts don't have yet, as optional
// extensions of the contract schemas. Each names its request in docs/contract-requests.md.
// The mocks fill them in; against the real API they're absent until the request lands, and the
// screens hide what depends on them. When a request lands in @opencast/contracts, delete its
// extension here. Each area keeps its own in api/ext/<area>.ts.

import { ApiError } from "./client";

/**
 * A proposed endpoint (api/ext/*) the API doesn't answer yet: it says 404. The screen leaves out
 * what needs it, rather than showing an error.
 */
export function notYet(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}
