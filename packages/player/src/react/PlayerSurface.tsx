import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Kbd, Slate, Tag, clock as clockText, cx } from "@opencast/ui";
import type { Hint } from "../input/types";
import { CAPTION_SCALE } from "../engine/PlayerEngine";
import { usePlayer, usePlayerDock } from "./context";
import { Banner } from "./Banner";
import { NumberPanel } from "./NumberPanel";
import { RadioScreen } from "./RadioScreen";
import { Overlays, visibleGraphics } from "./Overlays";
import { StandbyScreen, TuningLayer } from "./Tuning";
import { tuningStyle } from "../tuning/constants";

export interface PlayerSurfaceProps {
  /** web: inside a page (the tuned-in page, the phone's full player). tv: the ten-foot screen. */
  size?: "web" | "tv";
  timeZone?: string;
  /** The hint row on the banner (TV): from the input adapter in use. */
  hints?: Hint[];
  /** TV: the hint row's "Back, Last channel" (off once the key hints have hidden themselves after a week of use). */
  lastChannelHint?: boolean;
  /** TV with a remote on the picture: the Back to live chip says "Hold OK" (holding OK goes back to live). */
  holdOkHint?: boolean;
  /** The time to show (the banner's clock and progress). Defaults to the device's clock. */
  clock?: () => Date;
  /**
   * The station's graphics from its playlist (bug, lower thirds, codes). On by default; "bug" for
   * the bug alone, sized for the TV guide's window (tv 03.1); false for none.
   */
  overlays?: boolean | "bug";
  /**
   * The swipe home (A245): the picture fills its box instead of keeping 16:9 ("cover" crops to fill
   * a phone's screen, "contain" letterboxes), and the page draws its own paused mark and Back to live.
   */
  fill?: "cover" | "contain";
  /** The paused tag and Back to live over the picture (default); off where the page draws its own. */
  pausedControls?: boolean;
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
export function PlayerSurface({ size = "web", timeZone, hints, lastChannelHint = true, holdOkHint = false, clock = deviceClock, overlays = true, fill, pausedControls = true, className }: PlayerSurfaceProps) {
  const [s, engine] = usePlayer();
  const stage = useRef<HTMLDivElement>(null);
  const now = useClock(clock);

  const root = useRef<HTMLDivElement>(null);
  const [codeLift, setCodeLift] = useState<number | null>(null);

  const dock = usePlayerDock();

  // Sound refused until the viewer does something: the first click, tap or key anywhere turns it
  // on (browsers count any of them), not only the "Tap for sound" button, which a TV's overlays or
  // a remote can't reach.
  useEffect(() => {
    if (!s.mutedByBrowser) return;
    const on = () => engine.setMuted(false);
    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", on, opts);
    window.addEventListener("keydown", on, opts);
    return () => {
      window.removeEventListener("pointerdown", on, opts);
      window.removeEventListener("keydown", on, opts);
    };
  }, [s.mutedByBrowser, engine]);
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
  // Changing channel: where it's going (the corner number, "Tuning in", the needle).
  const tuning = s.tuning;
  const target = tuning ? s.channels.find((c) => c.station.id === tuning.stationId) : undefined;
  const sweeping = tuning?.look === "sweep" && !!target;
  const radioShown = sweeping ? (current && isRadio && s.status !== "off_air" && s.status !== "standby" ? current : target) : current && isRadio && s.status !== "off_air" && s.status !== "standby" ? current : undefined;
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

  const bannerUp = !!bannerFor && !s.entry;
  const graphics = {
    onScreen: s.onScreen?.stationId === s.currentId ? s.onScreen : null,
    showing: (s.status === "playing" || s.status === "paused") && !!current,
    banner: bannerUp
  };
  // Paused and Back to live sit top left; a bug drawn there moves them to the top right.
  const bugTopLeft = !!overlays && !isRadio && visibleGraphics(graphics, overlays === "bug" ? "bug" : undefined).bug?.position === "top_left";
  // Playing behind live on the TV: a small chip, since a remote can't reach a button. Not in the
  // guide's window, and not while the banner (whose hint row says it) or number entry is up. On
  // the web the controls under the picture have the button.
  const liveChip = size === "tv" && s.behindLive && s.status === "playing" && !s.pendingId && overlays !== "bug" && !bannerUp && !s.entry;

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
      className={cx("oc-player", `oc-player--${size}`, fill && "oc-player--fill", className)}
      data-fit={fill}
      data-status={s.status}
      data-tv={size === "tv" ? "" : undefined}
      data-tune={tuning?.look}
      style={{ ...tuningStyle, ["--oc-cue" as string]: `${captionSize * 100}cqw` }}
      aria-busy={s.pendingId !== null}
    >
      <div ref={stage} className="oc-player__stage" />

      {overlays && !isRadio && (
        <Overlays
          channel={current}
          size={size}
          only={overlays === "bug" ? "bug" : undefined}
          codeLift={codeLift}
          timeZone={timeZone}
          {...graphics}
        />
      )}

      {radioShown && (
        <RadioScreen
          channel={radioShown}
          size={size}
          playing={s.status === "playing"}
          onAirHere={onAirHere && !sweeping}
          tally={!bannerFor || !!s.entry}
          levels={levelsFor}
          tuning={sweeping && target ? { to: target, phase: tuning!.phase, sweep: tuning!.sweep } : null}
        />
      )}

      {current && s.status === "standby" && <StandbyScreen channel={current} size={size} />}

      {current && s.status === "unplayable" && (
        // A DASH stream link on a device that can't play DASH (A201): what it is, and where it plays.
        <div className="oc-player__cover" data-testid="unplayable">
          <Slate kind="off-air" title="Not on this device" size={size === "tv" ? "tv" : "screen"}>
            {`${ident}'s stream is in a format this device can't play. Watch it on a computer or a TV.`}
          </Slate>
        </div>
      )}

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

      {tuning && !sweeping && target && <TuningLayer tuning={tuning} channel={target} size={size} entry={!!s.entry} />}

      {pausedControls && s.status === "paused" && s.paused && (
        <div className="oc-player__paused" data-side={bugTopLeft ? "right" : undefined}>
          <Tag onPicture>Paused</Tag>
          {/* Always offered; after the 30-minute hold, play goes back to live too. */}
          <Button variant="primary" size={size === "tv" ? "lg" : "sm"} onClick={() => engine.backToLive()}>
            Back to live
          </Button>
        </div>
      )}

      {liveChip && (
        <button type="button" className="oc-player__live" data-side={bugTopLeft ? "right" : undefined} onClick={() => engine.backToLive()}>
          {holdOkHint && (
            <span className="oc-player__live-key" aria-hidden="true">
              Hold <Kbd size="tv">OK</Kbd>
            </span>
          )}
          Back to live
        </button>
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

      {bannerFor && bannerUp && (
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
