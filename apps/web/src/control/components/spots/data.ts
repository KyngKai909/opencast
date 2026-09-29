// The Spots pages' reads and writes, each through the contract.
// A write refreshes everything that shows its result: the rotations, the market, tonight's breaks
// (the Breaks page, the Program log, the Monitor's rundown, the rail's badge).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type EndpointDef, logApi, playoutApi, spotsApi } from "@opencast/contracts";
import { call, type CallArgs } from "../../../api/client";
import { useApi } from "../../../api/hooks";

export const BREAK_READERS: EndpointDef[] = [spotsApi.getRotations, spotsApi.stationMarket, spotsApi.getAvails, logApi.getLog, playoutApi.getStatus];

export function useMarket(stationId: string, query: { withinMiles?: number; category?: string } = {}, enabled = true) {
  return useApi(spotsApi.stationMarket, { params: { stationId }, query }, { enabled });
}

export function useRotations(stationId: string, enabled = true) {
  return useApi(spotsApi.getRotations, { params: { stationId } }, { enabled });
}

export function useAvails(stationId: string, enabled = true) {
  return useApi(spotsApi.getAvails, { params: { stationId }, query: { hours: 24 } }, { enabled });
}

export function useSponsorships(stationId: string) {
  return useApi(spotsApi.listStationSponsorships, { params: { stationId } });
}

export function useMakerOrders(stationId: string) {
  return useApi(spotsApi.listMakerOrders, { params: { stationId } });
}

export function useOrder(orderId: string | undefined) {
  return useApi(spotsApi.getOrder, { params: { orderId: orderId ?? "" } }, { enabled: !!orderId });
}

/** A write, then a refresh of `invalidates` (by endpoint path, any arguments). */
export function useWrite<E extends EndpointDef>(endpoint: E, invalidates: EndpointDef[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CallArgs) => call(endpoint, args),
    onSuccess: async () => {
      await Promise.all(invalidates.map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
    }
  });
}

/** Sets a rotation; everything that reads tonight's breaks refreshes. */
export function useSetRotation() {
  return useWrite(spotsApi.setRotation, BREAK_READERS);
}

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";
}
