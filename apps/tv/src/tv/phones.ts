// The phones that can drive this TV (Remote and phones): from listRemotePhones when the section
// opens, then from the relay's `phones` events and removals as they happen.

import { useSyncExternalStore } from "react";
import type { RemotePhone } from "@opencast/contracts";

let phones: RemotePhone[] | null = null;
const listeners = new Set<() => void>();

export function setPhones(next: RemotePhone[] | null) {
  phones = next;
  listeners.forEach((l) => l());
}

export function getPhones(): RemotePhone[] | null {
  return phones;
}

export function usePhones(): RemotePhone[] | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => phones,
    () => phones
  );
}
