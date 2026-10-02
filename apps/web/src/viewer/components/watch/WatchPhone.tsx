// Tuned in, phone (home 04.1, 04.2): the full player fills the screen. A vertical swipe on the
// picture flips the dial; a radio-band station has no picture, so its frequency and colour take
// the space, and its neighbours stay in the band.

import { useRef } from "react";
import { useNavigate } from "react-router";
import { Button, IconButton, Ident, Tally, clock } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { MARKET_TZ } from "../../../lib/clock";
import type { DialRowX } from "../../api/ext";
import { useChannels } from "../../data/viewer";
import type { WatchData } from "./useWatch";
import { AirPlayLine } from "./AirPlay";
import { Picture } from "./Picture";
import { NotForMe } from "./NotForMe";
import { Actions, NowTitle, SharedAiring, Tonight } from "./parts";
import { callSignOf, bandHint, neighbourOf, stationSlug } from "./logic";
import { useOverlayParams } from "./overlay";
import { WatchOnSheet } from "../remote/WatchOnSheet";
import { useCastSession } from "../../cast/session";
import { watchOnOffered } from "../../cast/useCast";

/**
 * The full player's own top bar: minimise, the hint, the cast button (tv 06.2: "Watch on", lit while
 * a TV plays) where this build can cast or mirror, share. Reads the player itself (the shell renders it).
 */
export function WatchTop() {
  const [s] = usePlayer();
  const channels = useChannels();
  const navigate = useNavigate();
  const { open } = useOverlayParams();
  const row = channels.find((c) => c.station.id === (s.pendingId ?? s.currentId));
  const radio = row?.station.band === "radio";
  const cast = useCastSession();
  const onTv = cast.status === "casting" || cast.status === "mirroring";
  return (
    <header className="oc-viewer-phone__top vw-wph__top">
      <IconButton icon="down" label="Minimise player" bare onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))} />
      <span className="vw-wph__topline">{radio ? "Radio band" : "Swipe the picture to change channel"}</span>
      {watchOnOffered() && (
        <IconButton icon="cast" label={onTv ? `Watching on ${cast.target.name}` : "Cast"} bare aria-pressed={onTv} className={onTv ? "vw-wph__cast vw-wph__cast--on" : "vw-wph__cast"} onClick={() => open({ sheet: "watch-on" })} />
      )}
      <IconButton
        icon="share"
        label="Share"
        bare
        disabled={!row}
        onClick={() => row && open({ modal: "share", station: stationSlug(row.station), ...(row.now?.logEntryId ? { airing: row.now.logEntryId } : {}) }, ["airing"])}
      />
      <WatchOnSheet />
    </header>
  );
}

export function WatchPhone({ w }: { w: WatchData }) {
  const s = w.state;
  const row = w.row;
  const litAtOpen = useRef(w.playing);
  const from = s.pendingId ?? s.currentId;
  const onChannel = w.channels.find((c) => c.station.id === from);
  const lit = w.playing && !!onChannel?.onAir;
  const radio = row?.station.band === "radio";
  const down: DialRowX | null = neighbourOf(w.channels, from, "down", !w.engine.canPlayDash());
  const up: DialRowX | null = neighbourOf(w.channels, from, "up", !w.engine.canPlayDash());
  const paused = s.status === "paused";
  const step = (dir: "up" | "down") => w.engine.handle({ type: "channel", dir });
  // Paused, or playing on from a pause (the lock screen, the space bar): the one way to seek.
  const live = s.behindLive ? (
    <Button size="sm" className="vw-wph__live" onClick={() => w.engine.backToLive()}>
      Back to live
    </Button>
  ) : null;

  if (radio && row) {
    const now = w.now;
    const hint = bandHint(w.channels, from);
    return (
      <div className="vw-wph vw-wph--radio">
        <Picture w={w} className="vw-wph__radio" />
        <div className="vw-wph__pad">
          <AirPlayLine w={w} className="vw-airplay--phone" />
          <SharedAiring w={w} />
          <h2 className="vw-w-title vw-w-title--phone vw-wph__rtitle">{now?.title ?? "Off air"}</h2>
          {now && (
            <div className="vw-w-meta">
              {now.episodeTitle && <span>Now: {now.episodeTitle}</span>}
              <span className="oc-mono">until {clock(now.endsAt, { timeZone: MARKET_TZ })}</span>
            </div>
          )}
          <NotForMe w={w} className="vw-nfm--phone" />
          <div className="vw-wph__controls">
            <IconButton icon="down" label={down ? `Down to ${down.station.channel}` : "Channel down"} className="vw-wph__step" onClick={() => step("down")} disabled={!down} />
            <IconButton icon={paused ? "play" : "pause"} label={paused ? "Play" : "Pause"} className="vw-wph__play" onClick={() => w.engine.togglePlay()} />
            <IconButton icon="up" label={up ? `Up to ${up.station.channel}` : "Channel up"} className="vw-wph__step" onClick={() => step("up")} disabled={!up} />
          </div>
          {live}
          {hint && <p className="vw-wph__hint">{hint.split(/(\d+\.\d)/).map((part, i) => (/^\d+\.\d$/.test(part) ? <span key={i} className="oc-mono">{part}</span> : part))}</p>}
          <Actions w={w} />
        </div>
      </div>
    );
  }

  return (
    <div className="vw-wph">
      <Picture w={w} swipe className="vw-wph__pic">
        {/* The swipe's keyboard and screen-reader way: shown when focused. */}
        <div className="vw-wph__sr">
          <button type="button" onClick={() => step("up")} disabled={!up}>
            {up ? `Channel up to ${up.station.channel}` : "Channel up"}
          </button>
          <button type="button" onClick={() => step("down")} disabled={!down}>
            {down ? `Channel down to ${down.station.channel}` : "Channel down"}
          </button>
        </div>
      </Picture>
      <div className="vw-wph__pad">
        <AirPlayLine w={w} className="vw-airplay--phone" />
        <div className="vw-wph__id">
          {row && <Ident variant="block-sm" channel={row.station.channel ?? ""} callSign={callSignOf(row.station)} name={row.station.name} />}
          {live}
          <Tally state={lit ? "lit" : "unlit"} flicker={!litAtOpen.current} className="vw-wph__tally" />
        </div>
        <SharedAiring w={w} />
        <NowTitle w={w} size="phone" />
        <NotForMe w={w} className="vw-nfm--phone" />
        <Actions w={w} className="vw-wph__acts" />
        <Tonight w={w} before={0} />
      </div>
    </div>
  );
}
