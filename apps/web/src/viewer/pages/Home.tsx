// Home is a dial, not a feed (viewer/opencast-home.html 01, 02, 08.2): the live hero and the
// presets, your market's stations in channel order, programs carried widely, what's coming up
// live and the radio band. A thin market says plainly that it's small. First visit is the market
// picker (components/overlays/MarketPicker.tsx), over this page.

import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { useDial, useMarkets, useMarketSlug, useMe, usePresets } from "../data/viewer";
import { useDevice } from "../device/store";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { Hero } from "../components/home/Hero";
import { HomePresets } from "../components/home/HomePresets";
import { MarketDial } from "../components/home/MarketDial";
import { CarriedWidely, ComingUpLive, RadioBlock } from "../components/home/Sections";
import { ThinMarket } from "../components/home/ThinMarket";
import { CHIP_ALL, isThin, pickHero } from "../components/home/logic";
import "./Home.css";

function useShowNearby(): boolean {
  const auth = useAuth();
  const me = useMe();
  const device = useDevice();
  const s = auth.signedIn ? me.data?.settings.market : device.settings.market;
  return s?.showNearby !== false;
}

function errorText(e: unknown): string | null {
  return e ? ((e as Error).message ?? "Something went wrong. Try again.") : null;
}

export default function HomePage() {
  useShellOptions({});
  const phone = useIsPhone();
  const slug = useMarketSlug();
  const markets = useMarkets();
  const tv = useDial("tv");
  const radio = useDial("radio");
  const { presets } = usePresets();
  const showNearby = useShowNearby();
  const now = useNow(15_000);
  const [chip, setChip] = useState(CHIP_ALL);

  // First visit: the market picker opens over an empty page.
  if (!slug) return <div className="vw-home vw-home--none" />;

  const timeZone = tv.data?.market.timezone ?? MARKET_TZ;
  const marketName = tv.data?.market.name ?? markets.data?.find((m) => m.slug === slug)?.name ?? "";
  const radioSettled = !!radio.data || !!radio.error;
  const thin = !!tv.data && (tv.data.nearby.length > 0 || (radioSettled && isThin(tv.data, radio.data)));
  const preset1 = presets.find((p) => p.key === 1)?.row ?? null;
  const pick = tv.data ? pickHero(tv.data.rows, slug, preset1) : null;
  const hasPresets = presets.some((p) => p.key !== null);

  if (thin && tv.data) {
    const thinPage = <ThinMarket marketName={marketName} tv={tv.data} radio={radio.data} phone={phone} showNearby={showNearby} now={now} timeZone={timeZone} />;
    if (phone)
      return (
        <div className="vw-home vw-home--phone">
          {hasPresets && (
            <section className="vw-sec vw-sec--phone" aria-labelledby="vw-presets-h">
              <div className="vw-sec-h">
                <h3 id="vw-presets-h">Presets</h3>
              </div>
              <HomePresets phone />
            </section>
          )}
          {thinPage}
        </div>
      );
    return (
      <div className={hasPresets ? "vw-home vw-home--thin" : "vw-home"}>
        <div className="vw-home__main">{thinPage}</div>
        {hasPresets && (
          <aside className="vw-home__presets">
            <HomePresets phone={false} />
          </aside>
        )}
      </div>
    );
  }

  const dial = <MarketDial marketName={marketName} rows={tv.data?.rows} error={errorText(tv.error)} phone={phone} chip={chip} onChip={setChip} at={now} timeZone={timeZone} />;

  if (phone) {
    return (
      <div className="vw-home vw-home--phone">
        {pick && <Hero pick={pick} phone timeZone={timeZone} />}
        <section className="vw-sec vw-sec--phone" aria-labelledby="vw-presets-h">
          <div className="vw-sec-h">
            <h3 id="vw-presets-h">Presets</h3>
          </div>
          <HomePresets phone />
        </section>
        {dial}
        <CarriedWidely items={tv.data?.carriedWidely ?? []} phone timeZone={timeZone} />
        <ComingUpLive items={tv.data?.comingUpLive ?? []} phone now={now} timeZone={timeZone} />
      </div>
    );
  }

  return (
    <div className="vw-home">
      <div className="vw-home__top">
        {pick ? (
          <Hero pick={pick} phone={false} timeZone={timeZone} />
        ) : tv.data ? (
          <p className="vw-home__quiet">Nothing is live in {marketName} right now. Your market's stations are below, in channel order.</p>
        ) : (
          <>
            <div className="vw-home__wait-pic" aria-hidden="true" />
            <div />
          </>
        )}
        <div className="vw-home__presets">
          <HomePresets phone={false} />
        </div>
      </div>
      {dial}
      <CarriedWidely items={tv.data?.carriedWidely ?? []} phone={false} timeZone={timeZone} />
      <div className="vw-home__two">
        <ComingUpLive items={tv.data?.comingUpLive ?? []} phone={false} now={now} timeZone={timeZone} />
        <RadioBlock rows={radio.data?.rows ?? []} now={now} timeZone={timeZone} />
      </div>
    </div>
  );
}
