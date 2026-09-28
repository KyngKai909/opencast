// Reading and writing an endpoint's cached answer, whichever schema each screen read it through
// (useApi keys each schema apart, so an endpoint can have several entries).

import type { QueryClient } from "@tanstack/react-query";
import type { EndpointDef } from "@opencast/contracts";
import type { CallArgs } from "../../api/client";
import { keyFor } from "../../api/hooks";

/** The first cached answer for an endpoint and arguments. */
export function getCached<T>(qc: QueryClient, endpoint: EndpointDef, args: CallArgs = {}): T | undefined {
  return qc.getQueriesData<T>({ queryKey: keyFor(endpoint, args) }).find(([, d]) => d !== undefined)?.[1];
}

/** Sets every cached answer for an endpoint and arguments. */
export function setCached<T>(qc: QueryClient, endpoint: EndpointDef, args: CallArgs, data: T | ((old: T | undefined) => T | undefined)) {
  qc.setQueriesData<T>({ queryKey: keyFor(endpoint, args) }, data as never);
}
