// Approvals waiting out their Undo (offering 05.2): the list shows "Approved NITE" and counts the
// new carrier while the toast is up, before decideRequest is sent.

import { useSyncExternalStore } from "react";

let approving = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function markApproving(requestId: string, on: boolean) {
  const next = new Set(approving);
  if (on) next.add(requestId);
  else next.delete(requestId);
  approving = next;
  emit();
}

export function useApproving(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => approving
  );
}
