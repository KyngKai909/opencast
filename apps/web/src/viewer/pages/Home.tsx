// Home is a dial, not a feed (viewer/opencast-home.html 01, 02, 08.2): the live hero and the
// presets, your market's stations in channel order, programs carried widely, what's coming up
// live and the radio band. A thin market says plainly that it's small. First visit is the market
// picker (components/overlays/MarketPicker.tsx), over this page. That's the web's home: on phones
// and tablets the home is the picture (A245, the swipe home), and these sections live in Guide.

import { useState } from "react";
import { useDial, useMarkets, useMarketSlug, usePresets } from "../data/viewer";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { SwipeStart } from "../components/swipe/SwipeHome";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { Hero } from "../components/home/Hero";
import { HomePresets } from "../components/home/HomePresets";
import { MarketDial } from "../components/home/MarketDial";
import { CarriedWidely, ComingUpLive, RadioBlock } from "../components/home/Sections";
import { ThinMarket, useShowNearby } from "../components/home/ThinMarket";
import { CHIP_ALL, isThin, pickHero } from "../components/home/logic";
import "./Home.css";

function errorText(e: unknown): string | null {
  return e ? ((e as Error).message ?? "Something went wrong. Try again.") : null;
}

export default function HomePage() {
  return useIsPhone() ? <SwipeStart /> : <DialHome />;
}

function DialHome() {
  useShellOptions({});
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
    const thinPage = <ThinMarket marketName={marketName} tv={tv.data} radio={radio.data} phone={false} showNearby={showNearby} now={now} timeZone={timeZone} />;
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

  const dial = <MarketDial marketName={marketName} rows={tv.data?.rows} error={errorText(tv.error)} phone={false} chip={chip} onChip={setChip} at={now} timeZone={timeZone} />;

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
