// Signing this TV out: from Settings (the API ends the session too), or because the account did it
// from "Your TVs" (the relay's `signed_out`, or a 401 `tv_signed_out` on any call). Either way the
// TV forgets the session and the account's data; the device token stays, so the TV is still itself.

import { tvApi } from "@opencast/contracts";
import { call } from "../api/client";
import { setDevice } from "./device";
import { queryClient } from "./queryClient";

const listeners = new Set<() => void>();

/** Called whenever this TV signs out (the relay starts a new session). */
export function onSignOut(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forgets the session here: the token, who it was, and anything read as them. */
export function signOutLocally() {
  setDevice({ token: null, signedInAs: null });
  queryClient.removeQueries({ predicate: (q) => String(q.queryKey[1] ?? "").startsWith("/me") });
  listeners.forEach((l) => l());
}

/** Settings' "Sign out of this TV": the API ends the session, and the TV signs out whatever it says. */
export async function signOutThisTv() {
  await call(tvApi.signOutThisTv).catch(() => undefined);
  signOutLocally();
}
