import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Slate, Tag, clock as clockText, cx } from "@opencast/ui";
import type { Hint } from "../input/types";
import { CAPTION_SCALE } from "../engine/PlayerEngine";
import { usePlayer, usePlayerDock } from "./context";
import { Banner } from "./Banner";
import { NumberPanel } from "./NumberPanel";
import { RadioScreen } from "./RadioScreen";
import { Overlays } from "./Overlays";

export interface PlayerSurfaceProps {
  /** web: inside a page (the tuned-in page, the phone's full player). tv: the ten-foot screen. */
  size?: "web" | "tv";
  timeZone?: string;
  /** The hint row on the banner (TV): from the input adapter in use. */
  hints?: Hint[];
  /** TV: the hint row's "Back, Last channel" (off once the key hints have hidden themselves after a week of use). */
  lastChannelHint?: boolean;
  /** The time to show (the banner's clock and progress). Defaults to the device's clock. */
  clock?: () => Date;
  /**
   * The station's graphics from its playlist (bug, lower thirds, codes). On by default; "bug" for
   * the bug alone, sized for the TV guide's window (tv 03.1); false for none.
   */
  overlays?: boolean | "bug";
  className?: string;
}

const deviceClock = () => new Date();

function useClock(clock: () => Date, ms = 1000): Date {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const t = setInterval(() => setNow(clock()), ms);
    return () => clearInterval(t);
  }, [clock, ms]);
  return now;
}

/** The picture and everything drawn over it. Needs a PlayerProvider above it. */
export function PlayerSurface({ size = "web", timeZone, hints, lastChannelHint = true, clock = deviceClock, overlays = true, className }: PlayerSurfaceProps) {
  const [s, engine] = usePlayer();
  const stage = useRef<HTMLDivElement>(null);
  const now = useClock(clock);

  const root = useRef<HTMLDivElement>(null);
  const [codeLift, setCodeLift] = useState<number | null>(null);

  const dock = usePlayerDock();
  useEffect(() => {
    if (stage.current) engine.attach(stage.current);
    // Leaving the page hands the videos back to the dock: the sound carries on.
    return () => {
      if (dock) engine.attach(dock);
    };
  }, [engine, dock]);

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
  const captionSize = CAPTION_SCALE[s.captionSize];
  // Off air: when it's back, from its stream's sign-off tag, else the dial's planned off air (G9:
  // the row's `backAt`, or its off air airing's).
  const backAt =
    current && s.status === "off_air"
      ? ((s.offAir?.stationId === current.station.id ? s.offAir.backAt : null) ?? current.backAt ?? (current.now?.kind === "off_air" ? (current.now.backAt ?? current.now.endsAt) : null))
      : null;
  const ident = current ? [current.station.callSign, current.station.channel].filter(Boolean).join("\u00a0") || current.station.name : "";

  // Where the graphics are, measured after each render (and when the picture resizes): a spot's
  // code sits above the banner while it's up, and captions lift clear of a lower third or a code.
  const measure = useRef(() => {});
  measure.current = () => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const banner = el.querySelector(".oc-banner");
    const code = el.querySelector(".oc-ovl__code");
    const lift = box.height && banner && code ? Math.round(box.bottom - banner.getBoundingClientRect().top) : null;
    setCodeLift((was) => (was === lift ? was : lift));
    const tops = Array.from(el.querySelectorAll(".oc-ovl .oc-l3, .oc-ovl__code"), (n) => n.getBoundingClientRect().top);
    engine.setGraphicsLift(box.height && tops.length ? ((box.bottom - Math.min(...tops)) / box.height) * 100 + 2 : null);
  };
  useLayoutEffect(() => measure.current());
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => engine.setGraphicsLift(null), [engine]);

  return (
    <div
      ref={root}
      className={cx("oc-player", `oc-player--${size}`, className)}
      data-status={s.status}
      data-tv={size === "tv" ? "" : undefined}
      style={{ ["--oc-cue" as string]: `${captionSize * 100}cqw` }}
      aria-busy={s.pendingId !== null}
    >
      <div ref={stage} className="oc-player__stage" />

      {overlays && !isRadio && (
        <Overlays
          channel={current}
          size={size}
          only={overlays === "bug" ? "bug" : undefined}
          codeLift={codeLift}
          onScreen={s.onScreen?.stationId === s.currentId ? s.onScreen : null}
          showing={(s.status === "playing" || s.status === "paused") && !!current}
          banner={!!bannerFor && !s.entry}
        />
      )}

      {current && isRadio && s.status !== "off_air" && <RadioScreen channel={current} size={size} playing={s.status === "playing"} onAirHere={onAirHere} tally={!bannerFor || !!s.entry} levels={levelsFor} />}

      {current && s.status === "off_air" && (
        <div className="oc-player__cover">
          <Slate kind="off-air" callSign={current.station.callSign ?? undefined} name={current.station.name} size={size === "tv" ? "tv" : "screen"}>
            {backAt ? (
              <>
                {`${ident} signs on again at `}
                <span className="oc-mono">{clockText(backAt, { timeZone })}</span>.
              </>
            ) : null}
          </Slate>
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
          backTo={last && size === "tv" && lastChannelHint ? `Last channel, ${[last.station.callSign, last.station.channel].filter(Boolean).join(" ")}` : null}
          onAirHere={onAirHere && bannerFor.station.id === s.currentId}
        />
      )}
    </div>
  );
}
