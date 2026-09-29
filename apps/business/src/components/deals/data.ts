// The area's reads and writes, each through the contract endpoint, and the refreshes a write needs
// (the balance moves with a hold).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ledgerApi, spotsApi, type EndpointDef } from "@opencast/contracts";
import { ApiError, call, type CallArgs } from "../../api/client";
import { useApi } from "../../api/hooks";
import type { BusinessState } from "../../business/BusinessContext";

export function useSponsorships(b: BusinessState, opts: { refetchInterval?: number } = {}) {
  return useApi(spotsApi.listBusinessSponsorships, { params: { businessId: b.id } }, { enabled: b.can("advertise"), retry: false, ...opts });
}

export function useTargets(b: BusinessState) {
  return useApi(spotsApi.listSponsorTargets, { params: { businessId: b.id } }, { enabled: b.can("advertise"), retry: false });
}

export function useOrders(b: BusinessState, opts: { refetchInterval?: number } = {}) {
  return useApi(spotsApi.listBusinessOrders, { params: { businessId: b.id } }, { enabled: b.can("advertise"), retry: false, ...opts });
}

export function useOrder(b: BusinessState, orderId: string | undefined) {
  return useApi(spotsApi.getOrder, { params: { orderId: orderId ?? "" } }, { enabled: b.can("advertise") && !!orderId, retry: false });
}

/** The makers, with each one's history with this business (P18). */
export function useMakers(b: BusinessState, marketId: string | undefined) {
  return useApi(spotsApi.listMakers, { query: { marketId, businessId: b.id } }, { retry: false });
}

export function useBalance(b: BusinessState) {
  return useApi(ledgerApi.getBalance, { params: { businessId: b.id } });
}

export function useProfile(b: BusinessState) {
  return useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { staleTime: 60_000 });
}

/** Everything a sponsorship or order write can change: the lists, the order, the balance, the spots. */
const TOUCHES: EndpointDef[] = [
  spotsApi.listBusinessSponsorships,
  spotsApi.listSponsorTargets,
  spotsApi.listBusinessOrders,
  spotsApi.getOrder,
  spotsApi.listSpots,
  ledgerApi.getBalance,
  ledgerApi.listMovements
];

/** A write, then a refresh of what it touches. */
export function useWrite<E extends EndpointDef>(endpoint: E) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CallArgs) => call(endpoint, args),
    onSettled: () => Promise.all(TOUCHES.map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })))
  });
}

/** Refresh everything the area reads (after a write made outside useWrite). */
export function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all(TOUCHES.map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
}

/** The API's message, or the plain fallback. */
export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Try again.";
}
