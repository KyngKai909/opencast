// The rail's counts (inventory, master control conventions): Breaks = open time in upcoming
// breaks; Library = items; Listings = airings needing a description; Translators = how many;
// Rights = open claims. Each comes from its area's endpoint; until an area's mock answers, its
// badge just doesn't show.

import { libraryApi, spotsApi, stationsApi, trustApi } from "@opencast/contracts";
import { duration, type ShellItems, type ControlPage } from "@opencast/ui";
import { useApi } from "../api/hooks";
import type { StationState } from "../station/StationContext";

export function useRailBadges(s: StationState): ShellItems<ControlPage> {
  const on = !s.studio && s.can("programming");
  const params = { stationId: s.id };
  const avails = useApi(spotsApi.getAvails, { params, query: { hours: 24 } }, { enabled: on, refetchInterval: 60_000, retry: false });
  const library = useApi(libraryApi.getLibrary, { params, query: {} }, { enabled: on, retry: false });
  const translators = useApi(stationsApi.listTranslators, { params }, { enabled: on, retry: false });
  const claims = useApi(trustApi.listClaims, { params }, { enabled: on, retry: false });
  const needDescription = library.data?.programs.filter((p) => p.listingStatus === "needs_description").length ?? 0;
  const open = avails.data?.totalOpenMs ?? 0;
  const openClaims = claims.data?.standing.openClaims ?? 0;
  return {
    breaks: open > 0 ? { count: duration(open), countLabel: `${duration(open)} of breaks open` } : {},
    library: library.data ? { count: String(library.data.items.length), countLabel: `${library.data.items.length} items` } : {},
    listings: needDescription ? { count: String(needDescription), countLabel: `${needDescription} need a description` } : {},
    translators: translators.data?.length ? { count: String(translators.data.length), countLabel: `${translators.data.length} translators` } : {},
    rights: openClaims ? { count: String(openClaims), countLabel: `${openClaims} open ${openClaims === 1 ? "claim" : "claims"}` } : {}
  };
}
