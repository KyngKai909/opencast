// Which market the desk is looking at: the one in the address, else the last one looked at, else
// the first open market. Remembered on this device only.

import { useParams } from "react-router";
import { stationsApi, type Market } from "@opencast/contracts";
import { useApi } from "../../api/hooks";

const KEY = "oc-desk-market";
export const DEFAULT_MARKET = "inland-empire";

export function rememberedMarket(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_MARKET;
  } catch {
    return DEFAULT_MARKET;
  }
}

export function rememberMarket(slug: string) {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    /* private window */
  }
}

export interface MarketState {
  slug: string;
  market: Market | undefined;
  markets: Market[];
  loading: boolean;
}

export function useMarket(): MarketState {
  const params = useParams();
  const slug = params.marketSlug ?? rememberedMarket();
  const markets = useApi(stationsApi.listMarkets, {}, { staleTime: 5 * 60_000 });
  const list = markets.data ?? [];
  return { slug, market: list.find((m) => m.slug === slug), markets: list, loading: markets.isLoading };
}
