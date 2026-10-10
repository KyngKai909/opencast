// The radio band (viewer/opencast-station-pages.html 04.1, 05.3): a tuner scale from 88 to 108
// with each station at its frequency and the needle where you're tuned (it sweeps to the next
// station in 400 ms, and the player plays the dial's tuning sound: follow-up Phase 5), then the same
// stations as rows. Clicking a mark or a row tunes in; the arrow keys move along the band. The station you're
// on gets the tally edge and "You're here" (never a lit tally in a list: open question A2). On
// phones and tablets the radio band is the swipe home's Radio (A245): `/radio` opens it on the
// band's first station in the order (or the radio station already playing), and the swipe goes
// through the radio presets, then the band by frequency, with the needle sweep instead of static.

import { useEffect, useMemo, type ReactNode } from "react";
import { Navigate } from "react-router";
import { BandScale, DialRow, LiveText, bandStep, type BandStation } from "@opencast/ui";
import { tuningStyle } from "@opencast/player";
import type { DialRowX } from "../api/ext";
import { useDial, useMarketSlug } from "../data/viewer";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { useNowPlaying, useTune } from "../player/PlayerRoot";
import { radioDetail, stationsText } from "../components/home/logic";
import { dialNow } from "../components/home/MarketDial";
import { useOpenStation } from "../components/home/nav";
import { useSwipeOrders } from "../components/swipe/useSwipeOrder";
import { stationSlug } from "../components/watch/logic";
import "./Radio.css";

function frequencyOf(r: DialRowX): number {
  return parseFloat(r.station.channel ?? "0");
}

function detailOf(r: DialRowX): ReactNode {
  const d = radioDetail(r.onAir ? r.now : null);
  if (!d.live) return d.text ?? undefined;
  return (
    <>
      <LiveText />
      {d.text ? ` ${d.text}` : null}
    </>
  );
}

/** Keys outside a text field or another control's own arrow keys. */
function arrowsAreFree(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (!t || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return false;
  return !t.closest('[role="radiogroup"], [role="tablist"], [role="menu"], [role="listbox"], [role="dialog"], [role="slider"]');
}

export default function RadioPage() {
  return useIsPhone() ? <RadioOnSwipe /> : <RadioBand />;
}

/** Phones and tablets: the swipe home, on the radio band. */
function RadioOnSwipe() {
  useShellOptions({ player: false, padded: false, picture: true });
  const orders = useSwipeOrders();
  const np = useNowPlaying();
  const radio = useDial("radio");
  const playing = np.row?.station.band === "radio" ? np.row : null;
  const to = playing ?? orders.radio.rows[0] ?? null;
  if (to) return <Navigate to={`/watch/${stationSlug(to.station)}`} replace />;
  return (
    <div className="vw-sw vw-sw--empty" aria-busy={!radio.data}>
      {radio.data && <p className="vw-sw__wait">No stations on the radio band here yet.</p>}
    </div>
  );
}

function RadioBand() {
  const phone = useIsPhone();
  const slug = useMarketSlug();
  const radio = useDial("radio");
  const np = useNowPlaying();
  const tune = useTune("dial");
  const openStation = useOpenStation();
  const now = useNow(15_000);
  const rows = useMemo(() => [...(radio.data?.rows ?? [])].sort((a, b) => frequencyOf(a) - frequencyOf(b)), [radio.data]);
  const timeZone = radio.data?.market.timezone ?? MARKET_TZ;
  const count = radio.data ? stationsText(rows.length) : null;

  useShellOptions({
    top:
      phone && count ? (
        <header className="vw-radio__top">
          <h1>Radio band</h1>
          <span>{count}</span>
        </header>
      ) : undefined
  });

  const stations: BandStation[] = rows.map((r) => ({ frequency: frequencyOf(r), callSign: r.station.callSign ?? "", colour: r.station.colour ?? "#33507A" }));
  const tunedRow = rows.find((r) => r.station.id === np.row?.station.id);
  const tuned = tunedRow ? frequencyOf(tunedRow) : undefined;
  const tuneTo = (f: number) => {
    const r = rows.find((x) => Math.abs(frequencyOf(x) - f) < 1e-6);
    if (r) void tune(r.station.id);
  };

  // The arrow keys move along the band from anywhere on the page, wrapping at the ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowRight" && e.key !== "ArrowLeft") || !arrowsAreFree(e)) return;
      const f = bandStep(stations, tuned, e.key === "ArrowRight" ? 1 : -1);
      if (f === undefined) return;
      e.preventDefault();
      tuneTo(f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!slug) return null;

  const body = radio.error ? (
    <p className="vw-radio__msg" role="alert">
      {(radio.error as Error).message}
    </p>
  ) : !radio.data ? (
    <div className="vw-radio__wait" aria-busy="true" aria-label="Radio band" />
  ) : rows.length === 0 ? (
    <p className="vw-radio__msg">No stations on the radio band here yet. Open frequencies run from 88 to 108.</p>
  ) : (
    <>
      <BandScale stations={stations} tuned={tuned} onTune={tuneTo} scroll={phone} className="vw-radio__scale" />
      <div className="vw-radio__rows" role="group" aria-label={`${radio.data.market.name}, radio band`}>
        {rows.map((r) => {
          const s = r.station;
          return (
            <DialRow
              key={s.id}
              variant="band"
              station={{ channel: s.channel ?? "", callSign: s.callSign ?? "", name: s.name, colour: s.colour ?? "#33507A" }}
              now={dialNow(r, r.onAir ? detailOf(r) : undefined)}
              next={r.next ? { at: r.next.startsAt, title: r.next.title, live: r.next.live } : undefined}
              at={now}
              timeZone={timeZone}
              watching={s.id === tunedRow?.station.id}
              onTune={() => void tune(s.id)}
              onOpenStation={() => openStation(s)}
            />
          );
        })}
      </div>
    </>
  );

  return (
    // The player's tuning timings, so the band's needle sweeps to the station as the player tunes it.
    <div className={phone ? "vw-radio vw-radio--phone" : "vw-radio"} style={tuningStyle}>
      {!phone && (
        <div className="vw-radio__h">
          <h1>Radio band</h1>
          {radio.data && (
            <span className="vw-radio__sub">
              {radio.data.market.name}, {count}
            </span>
          )}
          <span className="vw-radio__keys">Arrow keys move along the band</span>
        </div>
      )}
      {body}
    </div>
  );
}
