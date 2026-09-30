// Tuned in, web (home 03.1): the picture, the dial controls under it, what's on, and beside it the
// station: its ident, save / pledge / share, tonight with the tally edge, and the member line.

import { useRef } from "react";
import { Button, IconButton, Ident, Tally } from "@opencast/ui";
import type { WatchData } from "./useWatch";
import { AirPlayButton, AirPlayLine } from "./AirPlay";
import { Picture } from "./Picture";
import { NotForMe } from "./NotForMe";
import { Actions, MembersLine, NowTitle, SharedAiring, Tonight } from "./parts";
import { callSignOf, neighbourOf } from "./logic";

export function WatchWeb({ w }: { w: WatchData }) {
  const s = w.state;
  const row = w.row;
  const pic = useRef<HTMLDivElement>(null);
  // Lit already when the page opens (the player bar had it): no second switch-on.
  const litAtOpen = useRef(w.playing);
  const from = s.pendingId ?? s.currentId;
  const down = neighbourOf(w.channels, from, "down");
  const up = neighbourOf(w.channels, from, "up");
  const onChannel = w.channels.find((c) => c.station.id === from);
  const lit = w.playing && !!onChannel?.onAir;
  const paused = s.status === "paused";

  const fullScreen = () => {
    const el = pic.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="vw-watch">
      <div className="vw-watch__left">
        <div ref={pic}>
          <Picture w={w} className="vw-watch__pic" />
        </div>
        <div className="vw-watch__bar">
          <Tally state={lit ? "lit" : "unlit"} flicker={!litAtOpen.current} />
          <IconButton icon={paused ? "play" : "pause"} label={paused ? "Play" : "Pause"} onClick={() => w.engine.togglePlay()} disabled={s.status !== "playing" && !paused} />
          {/* Paused, or playing on from a pause: the one way to seek (no scrub bar). */}
          {s.behindLive && (
            <Button size="sm" className="vw-watch__live" onClick={() => w.engine.backToLive()}>
              Back to live
            </Button>
          )}
          <div className="vw-watch__tune">
            <IconButton icon="down" label={down ? `Channel down to ${down.station.channel}` : "Channel down"} onClick={() => w.engine.handle({ type: "channel", dir: "down" })} disabled={!down} />
            <span className="vw-watch__ch oc-mono" aria-live="polite" aria-label={onChannel ? `Channel ${onChannel.station.channel}` : undefined}>
              {onChannel?.station.channel ?? ""}
            </span>
            <IconButton icon="up" label={up ? `Channel up to ${up.station.channel}` : "Channel up"} onClick={() => w.engine.handle({ type: "channel", dir: "up" })} disabled={!up} />
          </div>
          <span className="vw-watch__hint">Arrow keys change channel</span>
          <div className="vw-watch__right">
            <NotForMe w={w} />
            <AirPlayButton w={w} />
            <IconButton icon="vol" label={s.muted ? "Unmute" : "Mute"} aria-pressed={s.muted} bare onClick={() => w.engine.setMuted(!s.muted)} />
            <IconButton icon="expand" label="Full screen" bare onClick={fullScreen} />
          </div>
        </div>
        <AirPlayLine w={w} />
        <SharedAiring w={w} />
        <NowTitle w={w} />
        {/* Tonight's episode when it's described (G5), else the program's own description. */}
        {w.now && (w.now.episodeDescription ?? w.program.data?.description) && <p className="vw-w-desc">{w.now.episodeDescription ?? w.program.data?.description}</p>}
      </div>
      <aside className="vw-watch__rail" aria-label={row ? `${row.station.name}` : undefined}>
        {row && (
          <Ident
            variant="block"
            channel={row.station.channel ?? ""}
            callSign={callSignOf(row.station)}
            name={[row.station.name, row.station.homeCity].filter(Boolean).join(", ")}
          />
        )}
        <Actions w={w} />
        <Tonight w={w} before={1} />
        <MembersLine w={w} className="vw-watch__members" />
      </aside>
    </div>
  );
}
