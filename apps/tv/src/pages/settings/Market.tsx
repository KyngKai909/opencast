// Changing market on the TV ("/market"; not drawn: from the menu's "Your market", and About this
// TV). The open markets in the menu rail's place, focus on the current one; OK chooses. The choice
// is kept on this TV, and on the account when signed in. A new market means a new dial, so the
// TV tunes its first station and goes to the picture.

import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi } from "@opencast/contracts";
import { usePlayerEngine, type PlayerEngine } from "@opencast/player";
import { cx } from "@opencast/ui";
import { DialX, MarketsX, type MarketX } from "../../api/ext";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { marketChoices } from "../../components/settings/market";
import { invalidateMe } from "../../components/settings/useTvSettings";
import { useCommandLayer } from "../../tv/commands";
import { useMarketSlug } from "../../tv/data";
import { setDevice, useDevice } from "../../tv/device";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { useTvMode } from "../../tv/TvApp";
import "./Market.css";

export default function Market() {
  // On a Cast receiver or an iPhone's second screen, the market comes from the phone.
  if (useTvMode() !== "tv") return <Navigate to="/" replace />;
  return <MarketScreen />;
}

function MarketScreen() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/menu";
  const qc = useQueryClient();
  const engine = usePlayerEngine();
  const signedIn = !!useDevice().token;
  const current = useMarketSlug();
  const markets = useApi(stationsApi.listMarkets, {}, { schema: MarketsX, staleTime: 5 * 60_000 });
  const { list, focus } = marketChoices(markets.data ?? [], current);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useCommandLayer((c) => {
    if (c.type !== "back") return false;
    navigate(from, { replace: true });
    return true;
  });

  // Focus starts on the market this TV is in, once the list is here.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !list.length) return;
    focused.current = true;
    const t = setTimeout(() => focusKey(`tvs-market-${list[focus]!.slug}`), 0);
    return () => clearTimeout(t);
  }, [list, focus]);

  const choose = async (m: MarketX) => {
    if (busy.current) return;
    if (m.slug === current) return navigate(from, { replace: true });
    busy.current = true;
    setError(null);
    try {
      if (signedIn) await call(accountsApi.updateMe, { body: { marketId: m.id } });
      setDevice({ marketSlug: m.slug });
      if (signedIn) await invalidateMe(qc);
      const dial = await call(stationsApi.getDial, { params: { marketSlug: m.slug }, query: { band: "tv" } }, DialX);
      const first = dial.rows[0];
      if (first) tuneWhenReady(engine, first.station.id);
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  };

  const rail = useTvFocusable({ focusKey: "tvs-markets", isFocusBoundary: true, trackChildren: true });

  return (
    <div className="tvs-market">
      <FocusContext.Provider value={rail.focusKey}>
        <nav ref={rail.ref} className="tvs-market__rail" aria-labelledby="tvs-market-title">
          <h2 className="tvs-market__title" id="tvs-market-title">
            Your market
          </h2>
          {markets.isLoading && [0, 1, 2].map((i) => <div key={i} className="tvs-market__wait" />)}
          {markets.isError && (
            <p className="tvs-market__note" role="alert">
              {markets.error.message}
            </p>
          )}
          {markets.data && !list.length && <p className="tvs-market__note">No markets are open yet.</p>}
          {list.map((m) => (
            <MarketItem key={m.id} m={m} on={m.slug === current} onSelect={() => void choose(m)} />
          ))}
          {error && (
            <p className="tvs-market__note tvs-market__note--error" role="alert">
              {error}
            </p>
          )}
          <p className="tvs-market__foot">OK to choose, Back to close</p>
        </nav>
      </FocusContext.Provider>
    </div>
  );
}

/**
 * Tunes as soon as the player has the new dial (the app hands it over once its own query for the
 * new market answers), giving up after five seconds.
 */
function tuneWhenReady(engine: PlayerEngine, stationId: string, tries = 20) {
  const s = engine.getState();
  if (s.currentId === stationId || s.pendingId === stationId || tries <= 0) return;
  void engine.tune(stationId, { input: "app", via: "dial" });
  setTimeout(() => tuneWhenReady(engine, stationId, tries - 1), 250);
}

function MarketItem({ m, on, onSelect }: { m: MarketX; on: boolean; onSelect: () => void }) {
  const f = useTvFocusable({ focusKey: `tvs-market-${m.slug}`, onSelect });
  const n = m.stationCount;
  return (
    <div
      ref={f.ref}
      tabIndex={-1}
      role="button"
      aria-current={on ? "true" : undefined}
      className={cx("tvs-market__item", on && "tvs-market__item--on", f.focused && "tvs-market__item--focus")}
      onClick={() => (f.focusSelf(), onSelect())}
    >
      {m.name}
      {n !== undefined && <small>{n === 1 ? "1 station" : `${n} stations`}</small>}
    </div>
  );
}
