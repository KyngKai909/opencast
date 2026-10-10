// The guide (home 05.1 web, 05.2 phone): `/guide`. Stations down the side in channel order, half
// hours across the top, the now line. Three hours at a time on the web (Earlier, Later); the phone
// scrolls sideways through six hours from the hour before now, opening with the now line in view.
// `?band=radio`, `?filter=presets`, `?from=<time>`, and a cell's listing at `?listing=<airing>`.
//
// On phones and tablets (A245; swipe home 06) the guide matches the swipe: your presets first, then
// the rest of the band in channel order, the station you're watching tinted, and a station's column
// tunes it in (and opens Watch on it). Below the grid come the old home's sections (carried widely,
// coming up live, the radio band), and a thin market's note sits at the top, so nothing the home had
// is lost. On a tablet on its side the live picture stays beside the guide instead of the mini player.

import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import { Button, GuideGrid, Segmented, type GuideStation } from "@opencast/ui";
import { orderIds, usePlayer } from "@opencast/player";
import { GuideX } from "../api/ext";
import { useApi } from "../../api/hooks";
import { useDial, useMarketSlug, usePresets } from "../data/viewer";
import { useIsPhone, useLandscape, useShellOptions, useViewerLayout } from "../layout/shell";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { useNowPlaying, useTune } from "../player/PlayerRoot";
import { GuideListing } from "../components/guide/Listing";
import { GUIDE_PHONE_SPAN_MS, GUIDE_STEP_MS, findListing, gridRows, guideDate, guideHeading, guideWindow, inSwipeOrder, stepWindow } from "../components/guide/logic";
import { useSwipeOrders } from "../components/swipe/useSwipeOrder";
import { SideWatch } from "../components/swipe/SideWatch";
import { CarriedWidely, ComingUpLive, RadioBlock } from "../components/home/Sections";
import { ThinMarket, useShowNearby } from "../components/home/ThinMarket";
import { isThin } from "../components/home/logic";
import { watchPath } from "../components/station/actions";
import "../components/guide/guide.css";
import "./Home.css";

type Band = "tv" | "radio";

function useGuideParams() {
  const [params, setParams] = useSearchParams();
  const band: Band = params.get("band") === "radio" ? "radio" : "tv";
  const presetsOnly = params.get("filter") === "presets";
  const set = (patch: Record<string, string | null>, replace = false) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
        return p;
      },
      { replace }
    );
  return { params, band, presetsOnly, set };
}

/** The phone's own top bar: "Tonight" and the band. */
function GuideTop() {
  const { band, set } = useGuideParams();
  const now = useNow(60_000);
  return (
    <header className="oc-viewer-phone__top vw-guide__ptop">
      <h1 className="vw-guide__ph">{guideHeading(guideWindow(now, null, GUIDE_PHONE_SPAN_MS).from, now, MARKET_TZ)}</h1>
      <Segmented
        label="Band"
        value={band}
        onChange={(v) => set({ band: v === "tv" ? null : v, listing: null })}
        options={[
          { value: "tv", label: "TV" },
          { value: "radio", label: "Radio" }
        ]}
      />
    </header>
  );
}

export default function GuidePage() {
  const phone = useIsPhone();
  // A tablet on its side keeps the live picture beside the guide, in place of the mini player.
  const layout = useViewerLayout();
  const landscape = useLandscape();
  const side = layout === "tablet" && landscape;
  useShellOptions(phone ? { padded: false, top: <GuideTop />, ...(side ? { player: false } : {}) } : {});
  const { params, band, presetsOnly, set } = useGuideParams();
  const now = useNow(30_000);
  const slug = useMarketSlug();
  const span = phone ? GUIDE_PHONE_SPAN_MS : GUIDE_STEP_MS;
  const { from, to } = guideWindow(now, params.get("from"), span);
  const guide = useApi(
    stationsApi.getGuide,
    { params: { marketSlug: slug ?? "" }, query: { band, from: from.toISOString(), to: to.toISOString() } },
    { schema: GuideX, enabled: !!slug, refetchInterval: 60_000, placeholderData: (prev) => prev }
  );
  const { presets } = usePresets();
  const only = useMemo(() => (presetsOnly && !phone ? new Set(presets.map((p) => p.station.id)) : null), [presetsOnly, phone, presets]);
  const orders = useSwipeOrders();
  const np = useNowPlaying();
  const tune = useTune("guide");
  const navigate = useNavigate();
  const [, engine] = usePlayer();
  const rows = useMemo(() => {
    const all = gridRows(guide.data, only);
    return phone ? inSwipeOrder(all, orderIds(orders[band]), band) : all;
  }, [guide.data, only, phone, orders, band]);
  // A station's column tunes it in: Watch opens on it, or the picture beside the guide changes.
  const onTune = (st: GuideStation) => {
    const r = engine.getState().channels.find((c) => c.station.id === st.id);
    if (!r) return;
    void tune(r.station.id);
    if (!side) navigate(watchPath(r.station));
  };
  const listingKey = params.get("listing");
  const listing = findListing(guide.data, listingKey);
  const earlier = stepWindow(now, from, "earlier", span);
  const later = stepWindow(now, from, "later", span);
  const step = (to: Date | null) => to && set({ from: to.toISOString(), listing: null });

  const grid = guide.isLoading ? (
    <div className="vw-guide__quiet" aria-busy="true" aria-label="Loading the guide">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} />
      ))}
    </div>
  ) : guide.isError ? (
    <p className="vw-guide__msg">{guide.error.message}</p>
  ) : !slug ? null : rows.length === 0 ? (
    <p className="vw-guide__msg">{presetsOnly ? `None of your presets are on the ${band === "tv" ? "TV" : "radio"} band.` : `No stations on the ${band === "tv" ? "TV" : "radio"} band yet.`}</p>
  ) : (
    <GuideGrid
      rows={rows}
      from={from}
      to={to}
      now={now}
      timeZone={MARKET_TZ}
      variant={phone ? "phone" : "web"}
      selectedId={listing ? listingKey ?? undefined : undefined}
      onSelect={(p) => set({ listing: p.id })}
      label={`${guideHeading(from, now, MARKET_TZ)}'s guide`}
      {...(phone ? { tunedId: np.row?.station.id ?? null, onTune } : {})}
    />
  );

  if (phone) {
    const body = (
      <>
        <ThinNote />
        {grid}
        <MovedSections now={now} />
      </>
    );
    return (
      <div className="vw-guide vw-guide--phone">
        {side ? (
          <div className="vw-guide__split">
            <SideWatch />
            <div className="vw-guide__main">{body}</div>
          </div>
        ) : (
          body
        )}
        {listing && <GuideListing key={listingKey} airing={listing.airing} station={listing.station} onClose={() => set({ listing: null }, true)} />}
      </div>
    );
  }

  return (
    <div className="vw-guide">
      <div className="vw-guide__tools">
        <h1 className="vw-guide__h">{guideHeading(from, now, MARKET_TZ)}</h1>
        <span className="vw-guide__date">{guideDate(from, MARKET_TZ)}</span>
        <div className="vw-guide__end">
          <Segmented
            label="Stations"
            value={presetsOnly ? "presets" : "all"}
            onChange={(v) => set({ filter: v === "presets" ? "presets" : null, listing: null })}
            options={[
              { value: "all", label: "All stations" },
              { value: "presets", label: "Presets" }
            ]}
          />
          <Segmented
            label="Band"
            value={band}
            onChange={(v) => set({ band: v === "tv" ? null : v, listing: null })}
            options={[
              { value: "tv", label: "TV band" },
              { value: "radio", label: "Radio band" }
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => step(earlier)} disabled={!earlier}>
            Earlier
          </Button>
          <Button variant="ghost" size="sm" onClick={() => step(later)} disabled={!later}>
            Later
          </Button>
        </div>
      </div>
      {grid}
      {listing && <GuideListing key={listingKey} airing={listing.airing} station={listing.station} onClose={() => set({ listing: null }, true)} />}
    </div>
  );
}

/** A thin market's note, at the top of the guide (the web's home has it as its page). */
function ThinNote() {
  const tv = useDial("tv");
  const radio = useDial("radio");
  const showNearby = useShowNearby();
  const now = useNow(60_000);
  const radioSettled = !!radio.data || !!radio.error;
  if (!tv.data || !(tv.data.nearby.length > 0 || (radioSettled && isThin(tv.data, radio.data)))) return null;
  return (
    <div className="vw-guide__thin">
      <ThinMarket note marketName={tv.data.market.name} tv={tv.data} radio={radio.data} phone showNearby={showNearby} now={now} timeZone={tv.data.market.timezone ?? MARKET_TZ} />
    </div>
  );
}

/** The old home's sections, under the guide on phones and tablets: carried widely, coming up live, the radio band. */
function MovedSections({ now }: { now: Date }) {
  const tv = useDial("tv");
  const radio = useDial("radio");
  const timeZone = tv.data?.market.timezone ?? MARKET_TZ;
  return (
    <div className="vw-guide__more">
      <CarriedWidely items={tv.data?.carriedWidely ?? []} phone timeZone={timeZone} />
      <ComingUpLive items={tv.data?.comingUpLive ?? []} phone now={now} timeZone={timeZone} />
      <RadioBlock rows={radio.data?.rows ?? []} now={now} timeZone={timeZone} />
    </div>
  );
}
