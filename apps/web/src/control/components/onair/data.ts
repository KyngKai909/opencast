// The On air area's reads (G1's break rows, G2's status, G6's watch link, G7's repeats), and what a
// change to the log refreshes: the log, dead air, the Monitor, sign-on checks and the rail's Breaks badge.

import { libraryApi, logApi, playoutApi, spotsApi, type EndpointDef } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";

/** Everything that reads the log. */
export const LOG_READS: EndpointDef[] = [logApi.getLog, logApi.getDeadAir, playoutApi.getStatus, playoutApi.getSignOnChecks, spotsApi.getAvails, libraryApi.getLibrary];

export function useLog(stationId: string, from: string, to: string, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useApi(logApi.getLog, { params: { stationId }, query: { from, to } }, { staleTime: 0, placeholderData: (prev) => prev, ...opts });
}

export function useDeadAir(stationId: string, opts: { enabled?: boolean } = {}) {
  return useApi(logApi.getDeadAir, { params: { stationId } }, { staleTime: 0, refetchInterval: 30_000, ...opts });
}

export function usePlayout(stationId: string, opts: { enabled?: boolean } = {}) {
  return useApi(playoutApi.getStatus, { params: { stationId } }, { staleTime: 0, refetchInterval: 15_000, ...opts });
}

export function useSignOnChecks(stationId: string) {
  return useApi(playoutApi.getSignOnChecks, { params: { stationId } }, { staleTime: 0 });
}
