// The On air area's reads, with the proposed fields (api/ext/onair.ts), and what a change to the
// log refreshes: the log, dead air, the Monitor, sign-on checks and the rail's Breaks badge.

import { libraryApi, logApi, playoutApi, spotsApi, type EndpointDef } from "@opencast/contracts";
import { useApi } from "../../api/hooks";
import { PlayoutStatusG2, ProgramLogOnAir, SignOnChecksG6 } from "../../api/ext/onair";

/** Everything that reads the log. */
export const LOG_READS: EndpointDef[] = [logApi.getLog, logApi.getDeadAir, playoutApi.getStatus, playoutApi.getSignOnChecks, spotsApi.getAvails, libraryApi.getLibrary];

export function useLog(stationId: string, from: string, to: string, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useApi(logApi.getLog, { params: { stationId }, query: { from, to } }, { schema: ProgramLogOnAir, staleTime: 0, placeholderData: (prev) => prev, ...opts });
}

export function useDeadAir(stationId: string, opts: { enabled?: boolean } = {}) {
  return useApi(logApi.getDeadAir, { params: { stationId } }, { staleTime: 0, refetchInterval: 30_000, ...opts });
}

export function usePlayout(stationId: string, opts: { enabled?: boolean } = {}) {
  return useApi(playoutApi.getStatus, { params: { stationId } }, { schema: PlayoutStatusG2, staleTime: 0, refetchInterval: 15_000, ...opts });
}

export function useSignOnChecks(stationId: string) {
  return useApi(playoutApi.getSignOnChecks, { params: { stationId } }, { schema: SignOnChecksG6, staleTime: 0 });
}
