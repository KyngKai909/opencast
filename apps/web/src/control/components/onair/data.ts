// The On air area's reads (G1's break rows, G2's status, G6's watch link, G7's repeats, G8's day
// templates, G9's off air hours), and what a change to the log refreshes: the log, dead air, the
// Monitor, sign-on checks, the templates (a date edited by hand), the off air hours' next time and
// the rail's Breaks badge.

import { libraryApi, logApi, playoutApi, spotsApi, type EndpointDef } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";

/** Everything that reads the log. */
export const LOG_READS: EndpointDef[] = [logApi.getLog, logApi.getDeadAir, playoutApi.getStatus, playoutApi.getSignOnChecks, spotsApi.getAvails, libraryApi.getLibrary, logApi.listTemplates, logApi.getOffAirHours];

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

/** G8: the station's day templates (owners and operators). */
export function useTemplates(stationId: string) {
  return useApi(logApi.listTemplates, { params: { stationId } }, { retry: false });
}

/** G9: the station's off air hours (owners and operators). */
export function useOffAirHours(stationId: string) {
  return useApi(logApi.getOffAirHours, { params: { stationId } }, { retry: false });
}
