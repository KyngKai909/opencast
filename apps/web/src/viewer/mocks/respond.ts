// The viewer's mock handlers answer through the app's shared helpers (src/mocks/respond.ts). The
// viewer's lists (presets, reminders, pledges, TVs) are the reference's, whoever is signed in: its
// handlers only ask whether someone is.

import { MOCK_TOKEN } from "../../auth/mockToken";
import { fail, path, personOf, reply } from "../../mocks/respond";

export { fail, MOCK_TOKEN, path, personOf, reply };

/** Null when the request carries the mock sign-in; otherwise the 401 to return. */
export function needsUser(request: Request) {
  return personOf(request) ? null : fail(401, "unauthorized", "Sign in to do that.");
}
