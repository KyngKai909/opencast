// The Spots pages' reads and writes: every spot read goes through SpotX (the contract's spot, with
// older hand pauses read as waiting for you), and every write refreshes what changes with a spot:
// the list, the spot, the balance and movements (the shell's "Available"), and the Results area's
// reads.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ledgerApi, spotsApi, type EndpointDef } from "@opencast/contracts";
import { call, type CallArgs } from "../../api/client";
import { useApi } from "../../api/hooks";
import { mockSpotAction, SPOT_READERS, SpotsX, SpotX, type MockSpotAction } from "../../api/ext/spots";

const READERS: EndpointDef[] = [...SPOT_READERS, ledgerApi.getBalance, ledgerApi.listMovements];

export function useSpots(businessId: string, enabled = true) {
  return useApi(spotsApi.listSpots, { params: { businessId } }, { schema: SpotsX, enabled });
}

export function useSpot(spotId: string | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useApi(spotsApi.getSpot, { params: { spotId: spotId ?? "" } }, { schema: SpotX, enabled: !!spotId, retry: false, ...opts });
}

export function useBalance(businessId: string, enabled = true) {
  return useApi(ledgerApi.getBalance, { params: { businessId } }, { enabled });
}

/** A write that answers with the spot (SpotX), then refreshes everything a spot shows up in. */
export function useSpotWrite<E extends EndpointDef>(endpoint: E) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CallArgs) => call(endpoint, args, SpotX),
    onSuccess: (spot) => {
      qc.setQueriesData({ queryKey: [spotsApi.getSpot.method, spotsApi.getSpot.path, { spotId: spot.id }] }, (old) => (old ? spot : old));
      for (const e of READERS) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
    }
  });
}

/** Mock mode only: what review and stations do (see api/ext/spots.ts). */
export function useMockAction() {
  const w = useSpotWrite(mockSpotAction);
  return { ...w, act: (spotId: string, action: MockSpotAction) => w.mutateAsync({ params: { spotId, action } }) };
}

/** The API's words for what went wrong. */
export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";
}

/** Files chosen this visit, by spot: "Shrink to fit" sends the same file again with scaleToFit (P2). */
export const chosenFiles = new Map<string, File>();
