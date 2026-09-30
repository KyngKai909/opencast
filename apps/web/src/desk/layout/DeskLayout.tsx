// Network desk's frame: DeskShell (the raised header with the amber Internal sign, "Opencast team"
// and the avatar; the fixed rail with its mono counts) around every page. The rail's counts:
// Creator pipeline, the yeses not set up yet (the board's figure); External sources, sources not on
// the dial yet; Held earnings, the total held; Reserved call signs, the market's reservations.

import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { accountsApi, networkApi, waitlistApi } from "@opencast/contracts";
import { DeskShell, money, type DeskPage, type ShellItems } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { initialsOf } from "../auth/gate";
import { useInAppLinks } from "./links";
import { rememberMarket, useMarket } from "./market";
import { DESK, deskPath } from "../../areas";

/** The page a path is on. */
export function pageOf(pathname: string): DeskPage {
  const parts = pathname.slice(pathname.startsWith(DESK) ? DESK.length : 0).split("/").filter(Boolean);
  if (parts[0] === "markets") {
    const area = parts[2];
    if (area === "pipeline") return "creator-pipeline";
    if (area === "listed") return "listed-sources";
    if (area === "catalog") return "catalog";
    return "market-board";
  }
  const direct: Record<string, DeskPage> = {
    "held-earnings": "held-earnings",
    "rights-claims": "rights-claims",
    "reserved-call-signs": "reserved-call-signs",
    "catalog-sponsors": "catalog-sponsors",
    settings: "settings"
  };
  return direct[parts[0] ?? ""] ?? "market-board";
}

/** "$227": the rail's amount, in whole dollars. */
export function railAmount(micros: number): string {
  return money(Math.round(micros / 1_000_000) * 1_000_000, { trimCents: true });
}

export function DeskLayout() {
  useInAppLinks();
  const loc = useLocation();
  const { slug, market } = useMarket();
  useEffect(() => {
    if (market) rememberMarket(market.slug);
  }, [market]);
  const me = useApi(accountsApi.getMe);
  const creators = useApi(networkApi.listCreators, { query: { marketId: market?.id } }, { enabled: !!market });
  const listed = useApi(networkApi.listListedSources, { query: { marketId: market?.id } }, { enabled: !!market });
  const held = useApi(networkApi.heldEarnings, {});
  const reserved = useApi(waitlistApi.listReservations, { query: { marketId: market?.id } }, { enabled: !!market });

  const yeses = creators.data?.filter((c) => c.stage === "said_yes" && !c.station).length;
  // External stations off the dial: waiting for their evidence, held by a rule, or hidden while down (Phase 6).
  const notListed = listed.data?.filter((l) => (l.onDial ?? l.listingState === "listed") === false).length;
  const items: ShellItems<DeskPage> = {
    "creator-pipeline": yeses ? { count: String(yeses), countLabel: `${yeses} ${yeses === 1 ? "yes" : "yeses"} to set up` } : {},
    "listed-sources": notListed ? { count: String(notListed), countLabel: `${notListed} not on the dial` } : {},
    "held-earnings": held.data ? { count: railAmount(held.data.totalHeldMicros), countLabel: `${money(held.data.totalHeldMicros)} held` } : {},
    "reserved-call-signs": reserved.data?.length ? { count: String(reserved.data.length), countLabel: `${reserved.data.length} reserved` } : {}
  };
  const linkTo = (p: DeskPage) =>
    deskPath(
      {
        "market-board": `/markets/${slug}/board`,
        "creator-pipeline": `/markets/${slug}/pipeline`,
        "listed-sources": `/markets/${slug}/listed`,
        catalog: `/markets/${slug}/catalog`,
        "held-earnings": "/held-earnings",
        "rights-claims": "/rights-claims",
        "reserved-call-signs": "/reserved-call-signs",
        "catalog-sponsors": "/catalog-sponsors",
        settings: "/settings"
      }[p]
    );
  const name = me.data?.displayName ?? me.data?.email ?? "You";
  return (
    <DeskShell user={{ initials: initialsOf(me.data?.displayName, me.data?.email), name: `${name}: settings`, href: deskPath("/settings") }} active={pageOf(loc.pathname)} items={items} linkTo={linkTo}>
      <Outlet />
    </DeskShell>
  );
}
