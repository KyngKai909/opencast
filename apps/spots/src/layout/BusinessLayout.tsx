// The business app's frame for a business's pages (`/:businessId/...`): the business shell on the
// web (the switcher, "Available $412.50", the avatar, the rail) and a plain phone bar under
// 768px. A viewer's rail keeps only results, the balance and settings open.

import { Outlet, useLocation, useSearchParams } from "react-router";
import { ledgerApi, spotsApi } from "@opencast/contracts";
import { BusinessShell, type BusinessPage, type ShellItems } from "@opencast/ui";
import { useApi } from "../api/hooks";
import BusinessSwitcher from "../components/overlays/BusinessSwitcher";
import { BusinessX } from "../api/ext";
import { logoOf } from "../business/logo";
import { PAGE_ABILITY, VIEWER_REASON } from "../business/abilities";
import { BusinessProvider, useBusiness, useMe, useResolvedBusiness } from "../business/BusinessContext";
import { NotYours, Quiet } from "../pages/common";
import { useRailBadges } from "./badges";
import { useInAppLinks } from "./links";
import { PhoneBar } from "./PhoneBar";
import { useIsPhone, useShellState } from "./shell";

/** The first path segment after the business, to the rail's page. */
const SEGMENT_PAGE: Record<string, BusinessPage> = {
  spots: "spots",
  sponsorships: "sponsorships",
  orders: "made-for-you",
  results: "where-it-aired",
  redeem: "where-it-aired",
  balance: "balance",
  settings: "settings"
};

const PAGE_SEGMENT: Record<BusinessPage, string> = {
  spots: "spots",
  sponsorships: "sponsorships",
  "made-for-you": "orders",
  "where-it-aired": "results",
  balance: "balance",
  settings: "settings"
};

export function BusinessLayout() {
  useInAppLinks();
  const { state, loading } = useResolvedBusiness();
  if (loading) return <Quiet />;
  if (!state) return <NotYours />;
  return (
    <BusinessProvider value={state}>
      <Frame />
    </BusinessProvider>
  );
}

function Frame() {
  const b = useBusiness();
  const phone = useIsPhone();
  const opts = useShellState();
  const loc = useLocation();
  const [, setParams] = useSearchParams();
  const me = useMe();
  const balance = useApi(ledgerApi.getBalance, { params: { businessId: b.id } }, { refetchInterval: 30_000 });
  const badges = useRailBadges(b);
  const segment = loc.pathname.split("/").filter(Boolean)[1] ?? "";
  const active = SEGMENT_PAGE[segment] ?? "spots";
  const items: ShellItems<BusinessPage> = Object.fromEntries(
    (Object.keys(PAGE_SEGMENT) as BusinessPage[]).map((p) => [p, { ...badges[p], ...(b.can(PAGE_ABILITY[p]) ? {} : { disabled: VIEWER_REASON, count: undefined }) }])
  );
  const linkTo = (p: BusinessPage) => `${b.base}/${PAGE_SEGMENT[p]}`;
  const profile = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { schema: BusinessX, staleTime: 60_000 });
  const logo = logoOf(profile.data, b.business.name);
  const openSwitcher = () => setParams((p) => (p.set("switch", "1"), p));
  const name = me.data?.displayName ?? me.data?.email ?? "You";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  if (phone) {
    return (
      <div className="bz-phone">
        <PhoneBar initials={logo.initials} colour={logo.colour} name={b.business.name} title={opts.title} items={items} linkTo={linkTo} active={active} onSwitch={openSwitcher} />
        <main className={opts.flush ? "bz-phone-main bz-phone-main--flush" : "bz-phone-main"}>
          <Outlet />
        </main>
        <BusinessSwitcher />
      </div>
    );
  }
  return (
    <BusinessShell
      business={{ name: b.business.name, initials: logo.initials, colour: logo.colour }}
      onSwitchBusiness={openSwitcher}
      available={balance.data?.availableMicros ?? 0}
      user={{ initials, name, href: `${b.base}/settings/team` }}
      active={active}
      items={items}
      linkTo={linkTo}
      flush={opts.flush}
    >
      <Outlet />
      <BusinessSwitcher />
    </BusinessShell>
  );
}
