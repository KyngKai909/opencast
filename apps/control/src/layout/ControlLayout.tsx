// Master control's frame for a station's pages (`/:callSign/...`): the control shell on the web
// (header with the switcher, the clock, the tally and Sign off; the fixed rail), the phone shell
// under 768px, and the studio shell for a studio. Hosts see their own live blocks: every other
// page sends them there, and the rail's other items are disabled with the reason.

import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { playoutApi } from "@opencast/contracts";
import { ControlPhoneShell, ControlShell, StudioShell, type ControlPage, type ShellItems, type StudioPage } from "@opencast/ui";
import { useApi } from "../api/hooks";
import StationSwitcher from "../components/overlays/StationSwitcher";
import SignOff from "../components/overlays/SignOff";
import { now, STATION_TZ, useNow } from "../lib/clock";
import { HOST_REASON, PAGE_ABILITY } from "../station/abilities";
import { StationProvider, useResolvedStation, useStation } from "../station/StationContext";
import { useRailBadges } from "./badges";
import { useInAppLinks } from "./links";
import { useIsPhone, useShellState } from "./shell";
import { NotYours, Quiet } from "../pages/common";

/** The first path segment after the station, to the rail's page. */
const SEGMENT_PAGE: Record<string, ControlPage> = {
  monitor: "monitor",
  audience: "audience",
  log: "program-log",
  "live-sources": "live-sources",
  live: "live-sources",
  breaks: "breaks",
  market: "market",
  library: "library",
  listings: "listings",
  "spot-market": "spot-market",
  sponsors: "sponsors",
  earnings: "earnings",
  translators: "translators",
  rights: "rights",
  settings: "settings"
};

const PAGE_SEGMENT: Record<ControlPage, string> = {
  monitor: "monitor",
  audience: "audience",
  "program-log": "log",
  "live-sources": "live-sources",
  breaks: "breaks",
  market: "market",
  library: "library",
  listings: "listings",
  "spot-market": "spot-market",
  sponsors: "sponsors",
  earnings: "earnings",
  translators: "translators",
  rights: "rights",
  settings: "settings"
};

const STUDIO_SEGMENT: Record<StudioPage, string> = {
  programs: "programs",
  library: "library",
  carriers: "carriers",
  market: "market",
  "spot-rotation": "spot-rotation",
  earnings: "earnings",
  rights: "rights",
  settings: "settings"
};

function segmentOf(pathname: string): string {
  return pathname.split("/").filter(Boolean)[1] ?? "";
}

export function ControlLayout() {
  useInAppLinks();
  const { state, loading } = useResolvedStation();
  if (loading) return <Quiet />;
  if (!state) return <NotYours />;
  return (
    <StationProvider value={state}>
      <Frame />
    </StationProvider>
  );
}

function Frame() {
  const s = useStation();
  const phone = useIsPhone();
  const opts = useShellState();
  const loc = useLocation();
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const segment = segmentOf(loc.pathname);
  const status = useApi(playoutApi.getStatus, { params: { stationId: s.id } }, { enabled: !s.studio, refetchInterval: 15_000 });
  const badges = useRailBadges(s);
  useNow(1000);

  const openSwitcher = () => setParams((p) => (p.set("switch", "1"), p));
  const overlays = (
    <>
      <StationSwitcher />
      <SignOff />
    </>
  );

  if (s.studio) {
    const active = (Object.keys(STUDIO_SEGMENT) as StudioPage[]).find((p) => STUDIO_SEGMENT[p] === segment) ?? "programs";
    return (
      <StudioShell studio={{ name: s.station.name, colour: s.station.colour ?? "#1D6A70" }} onSwitchStation={openSwitcher} active={active} linkTo={(p) => `${s.base}/${STUDIO_SEGMENT[p]}`} flush={opts.flush}>
        <Outlet />
        {overlays}
      </StudioShell>
    );
  }

  // A host goes live on their own blocks and sees nothing else.
  if (s.role === "host" && segment !== "live") return <Navigate to={`${s.base}/live`} replace />;
  const active = SEGMENT_PAGE[segment] ?? "monitor";
  const items: ShellItems<ControlPage> = Object.fromEntries(
    (Object.keys(PAGE_SEGMENT) as ControlPage[]).map((p) => [p, { ...badges[p], ...(s.can(PAGE_ABILITY[p]) ? {} : { disabled: HOST_REASON, count: undefined }) }])
  );
  if (s.role === "host") items["live-sources"] = { href: `${s.base}/live` };
  const onAir = !!status.data?.onAir;
  const station = { channel: s.station.channel ?? "", callSign: s.station.callSign ?? s.station.name, colour: s.station.colour ?? "#8C3B7A" };

  if (phone) {
    return (
      <ControlPhoneShell station={station} context={opts.context} tally={opts.tally ?? (onAir ? "lit" : "unlit")} flicker={false} onSwitchStation={openSwitcher} actions={opts.actions}>
        <Outlet />
        {overlays}
      </ControlPhoneShell>
    );
  }
  return (
    <ControlShell
      station={station}
      onSwitchStation={openSwitcher}
      active={active}
      items={items}
      linkTo={(p) => `${s.base}/${PAGE_SEGMENT[p]}`}
      now={now()}
      timeZone={STATION_TZ}
      onAir={onAir}
      flicker={false}
      onSignOff={s.can("manage") ? () => navigate({ search: "?modal=sign-off" }) : undefined}
      flush={opts.flush}
    >
      <Outlet />
      {overlays}
    </ControlShell>
  );
}
