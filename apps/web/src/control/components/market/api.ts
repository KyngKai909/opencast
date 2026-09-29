// The market's reads (the offer through api/ext/market.ts for C5's `speech`), and the refresh after
// a change: carrying writes the log, so the log's reads refresh too.

import { useQueryClient } from "@tanstack/react-query";
import { catalogApi, libraryApi, logApi, type EndpointDef } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";
import { OfferDetailX } from "../../api/ext/market";
import type { BrowseQuery } from "../../api/types";

export function useBrowse(query: BrowseQuery, enabled = true) {
  return useApi(catalogApi.browse, { query: { ...query } }, { enabled });
}

export function useOffer(offerId: string | undefined, forStation: string | null) {
  return useApi(catalogApi.getOffer, { params: { offerId: offerId ?? "" }, query: { forStation } }, { schema: OfferDetailX, enabled: !!offerId });
}

export function useRequests(stationId: string, enabled = true) {
  return useApi(catalogApi.listRequests, { params: { stationId } }, { enabled });
}

export function useAgreements(stationId: string, enabled = true) {
  return useApi(catalogApi.listAgreements, { params: { stationId } }, { enabled });
}

export function useLibrary(stationId: string, enabled = true) {
  return useApi(libraryApi.getLibrary, { params: { stationId }, query: {} }, { enabled, retry: false });
}

/** Everything a market change can move: offers, requests, agreements, and the log it writes. */
const TOUCHED: EndpointDef[] = [catalogApi.browse, catalogApi.getOffer, catalogApi.listRequests, catalogApi.listAgreements, logApi.getLog, logApi.getDeadAir];

export function useRefreshMarket() {
  const qc = useQueryClient();
  return () => {
    for (const e of TOUCHED) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
  };
}
