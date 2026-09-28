import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Slate, Tag, cx } from "@opencast/ui";
import type { Hint } from "../input/types";
import { usePlayer } from "./context";
import { Banner } from "./Banner";
import { NumberPanel } from "./NumberPanel";
import { RadioScreen } from "./RadioScreen";

export interface PlayerSurfaceProps {
  /** web: inside a page (the tuned-in page, the phone's full player). tv: the ten-foot screen. */
  size?: "web" | "tv";
  timeZone?: string;
  /** The hint row on the banner (TV): from the input adapter in use. */
  hints?: Hint[];
  className?: string;
}

function useClock(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The picture and everything drawn over it. Needs a PlayerProvider above it. */
export function PlayerSurface({ size = "web", timeZone, hints, className }: PlayerSurfaceProps) {
  const [s, engine] = usePlayer();
  const stage = useRef<HTMLDivElement>(null);
  const now = useClock();

  useEffect(() => {
    if (stage.current) engine.attach(stage.current);
  }, [engine]);

  useEffect(() => {
    // Fetch the banner's faces now, so the first channel change doesn't flash fallback digits.
    if (typeof document === "undefined" || !document.fonts) return;
    for (const f of ['500 1em "IBM Plex Mono"', '800 1em "Archivo Variable"', '600 1em "Public Sans Variable"']) void document.fonts.load(f).catch(() => {});
  }, []);

  const current = s.channels.find((c) => c.station.id === s.currentId);
  const bannerFor = s.banner ? s.channels.find((c) => c.station.id === s.banner!.stationId) : undefined;
  const last = s.channels.find((c) => c.station.id === s.lastId);
  const isRadio = current?.station.band === "radio";
  const onAirHere = s.status === "playing" && !!current?.onAir && s.pendingId === null;
  const levelsFor = useCallback((bars: number) => engine.audioLevels(bars), [engine]);
  const captionSize = { small: 0.034, medium: 0.042, large: 0.054 }[s.captionSize];

  return (
    <div
      className={cx("oc-player", `oc-player--${size}`, className)}
      data-status={s.status}
      data-tv={size === "tv" ? "" : undefined}
      style={{ ["--oc-cue" as string]: `${captionSize * 100}cqw` }}
      aria-busy={s.pendingId !== null}
    >
      <div ref={stage} className="oc-player__stage" />

      {current && isRadio && s.status !== "off_air" && <RadioScreen channel={current} playing={s.status === "playing"} onAirHere={onAirHere} tally={!bannerFor || !!s.entry} levels={levelsFor} />}

      {current && s.status === "off_air" && (
        <div className="oc-player__cover">
          <Slate kind="off-air" callSign={current.station.callSign ?? undefined} name={current.station.name} size={size === "tv" ? "tv" : "screen"} />
        </div>
      )}

      {current && s.status === "embed" && current.playback && (
        <iframe className="oc-player__embed" src={current.playback.url} title={`${current.station.name}, the city's own player`} allow="autoplay; fullscreen" />
      )}

      {s.pendingId && !s.currentId && <div className="oc-player__cover oc-player__cover--tuning" aria-hidden="true" />}

      {s.status === "paused" && s.paused && (
        <div className="oc-player__paused">
          <Tag onPicture>Paused</Tag>
          {s.paused.expired && (
            <Button variant="primary" size={size === "tv" ? "lg" : "sm"} onClick={() => engine.backToLive()}>
              Back to live
            </Button>
          )}
        </div>
      )}

      {s.mutedByBrowser && (
        <button type="button" className="oc-player__unmute" onClick={() => engine.setMuted(false)}>
          Tap for sound
        </button>
      )}

      {s.sleep?.fading && (
        <div className="oc-player__sleep" role="status">
          <span>Turning off in a minute.</span>
          <Button variant="primary" size="sm" onClick={() => engine.sleep(30)}>
            30 more minutes
          </Button>
        </div>
      )}

      {s.entry && <NumberPanel entry={s.entry} size={size} />}

      {bannerFor && !s.entry && (
        <Banner
          channel={bannerFor}
          size={size}
          now={now}
          timeZone={timeZone}
          hints={hints}
          backTo={last && size === "tv" ? `Last channel, ${[last.station.callSign, last.station.channel].filter(Boolean).join(" ")}` : null}
          onAirHere={onAirHere && bannerFor.station.id === s.currentId}
        />
      )}
    </div>
  );
}
