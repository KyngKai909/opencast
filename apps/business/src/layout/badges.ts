// The rail's counts: Spots = spots listed or running (biz-spots 01.1 draws "3": the live ones,
// not the ended one). Other counts, if an area needs one, are added here.

import { spotsApi } from "@opencast/contracts";
import type { BusinessPage, ShellItems } from "@opencast/ui";
import { useApi } from "../api/hooks";
import type { BusinessState } from "../business/BusinessContext";

export function useRailBadges(b: BusinessState): ShellItems<BusinessPage> {
  const spots = useApi(spotsApi.listSpots, { params: { businessId: b.id } }, { enabled: b.can("advertise"), retry: false });
  const live = spots.data?.filter((s) => s.state !== "ended" && s.state !== "draft").length ?? 0;
  return {
    spots: live ? { count: String(live), countLabel: `${live} spots` } : {}
  };
}
