// The rail's counts (inventory, master control conventions): Library = items; Listings = airings needing a description; Translators = how many platforms are connected;
// Rights = open claims; Sponsors = new requests (sponsorships 03.1); Spot market = new
// production-order requests (production-orders 03.1). Listings and Rights are amber
// (the reference's rail marks them warn). A246: Breaks left the rail for the Schedule, and its
// open-time count went with it (the Schedule's rail item has none, as the reference draws it). Each comes from its area's endpoint; until an area's mock answers, its
// badge just doesn't show.

import { libraryApi, platformsApi, spotsApi, trustApi } from "@opencast/contracts";
import type { ShellItems, ControlPage } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import type { StationState } from "../station/StationContext";

export function useRailBadges(s: StationState): ShellItems<ControlPage> {
  const on = !s.studio && s.can("programming");
  const params = { stationId: s.id };
  const library = useApi(libraryApi.getLibrary, { params, query: {} }, { enabled: on, retry: false });
  const platforms = useApi(platformsApi.listPlatforms, { params }, { enabled: on, retry: false });
  const connected = platforms.data?.platforms.length ?? 0;
  const claims = useApi(trustApi.listClaims, { params }, { enabled: on, retry: false });
  const money = !s.studio && s.can("spots");
  const sponsorships = useApi(spotsApi.listStationSponsorships, { params }, { enabled: money, retry: false });
  const orders = useApi(spotsApi.listMakerOrders, { params }, { enabled: money, retry: false });
  const newSponsors = sponsorships.data?.sponsorships.filter((x) => x.state === "requested").length ?? 0;
  const newOrders = orders.data?.filter((o) => o.state === "asked").length ?? 0;
  const needDescription = library.data?.programs.filter((p) => p.listingStatus === "needs_description").length ?? 0;
  const openClaims = claims.data?.standing.openClaims ?? 0;
  return {
    library: library.data ? { count: String(library.data.items.length), countLabel: `${library.data.items.length} items` } : {},
    listings: needDescription ? { count: String(needDescription), countLabel: `${needDescription} need a description`, warn: true } : {},
    translators: connected ? { count: String(connected), countLabel: `${connected} ${connected === 1 ? "platform" : "platforms"} connected` } : {},
    sponsors: newSponsors ? { count: String(newSponsors), countLabel: `${newSponsors} new ${newSponsors === 1 ? "request" : "requests"}` } : {},
    "spot-market": newOrders ? { count: String(newOrders), countLabel: `${newOrders} new production ${newOrders === 1 ? "order" : "orders"}` } : {},
    rights: openClaims ? { count: String(openClaims), countLabel: `${openClaims} open ${openClaims === 1 ? "claim" : "claims"}`, warn: true } : {}
  };
}
