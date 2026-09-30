import { useEffect, useLayoutEffect, useRef } from "react";
import { Tally, cx } from "@opencast/ui";
import type { TuningPhase } from "../tuning/change";
import { bandPercent, type Sweep } from "../tuning/sweep";
import { SWEEP_EASING } from "../tuning/constants";
import type { Channel } from "../types";

/** Tuning along the radio band: the station it's going to, and the needle's sweep. */
export interface RadioTuning {
  to: Channel;
  phase: TuningPhase;
  sweep: Sweep | null;
}

/**
 * The band and its needle while tuning: the needle travels the real distance between the two
 * frequencies in 400 ms, eased (Web Animations, on the compositor), starting from wherever it is.
 */
function Needle({ sweep, clearing }: { sweep: Sweep | null; clearing: boolean }) {
  const needle = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = needle.current;
    if (!el || !sweep) return;
    const to = `translateX(${bandPercent(sweep.to)}%)`;
    el.style.transform = to;
    if (sweep.ms <= 0 || typeof el.animate !== "function") return;
    // From where it was when pressed (a press mid-sweep starts from wherever the needle had got to).
    const from = `translateX(${bandPercent(sweep.from)}%)`;
    const a = el.animate([{ transform: from }, { transform: to }], { duration: sweep.ms, easing: `cubic-bezier(${SWEEP_EASING.join(",")})`, fill: "none" });
    return () => a.cancel();
  }, [sweep]);
  return (
    <div className={cx("oc-radio__band", clearing && "is-clearing")} aria-hidden="true" data-testid="radio-band">
      <span ref={needle} className="oc-radio__needle-track">
        <i className="oc-radio__needle" />
      </span>
    </div>
  );
}

/**
 * A radio station on a screen: it has no picture, so its colour fills the screen and the
 * frequency is set huge, with a level meter that moves with the sound (tv 05.1). The whole block
 * drifts a few pixels a minute so an all-night station doesn't burn into an OLED.
 */
export function RadioScreen({
  channel: c,
  playing,
  onAirHere,
  tally = true,
  levels,
  size = "tv",
  tuning = null
}: {
  channel: Channel;
  /** tv (05.1): "Night Desk, Radio dramas from the 1940s. Now: The Hollow Door, part 2". web (04.2): "Night Desk, Riverside". */
  size?: "web" | "tv";
  playing: boolean;
  onAirHere: boolean;
  /** Hidden while the banner (which carries the tally) is up: one tally per view. */
  tally?: boolean;
  /** Real sound levels (the engine's audioLevels); null where they can't be measured. */
  levels?: (bars: number) => number[] | null;
  /**
   * Tuning along the band: the new station's frequency and call sign show at once over the old
   * station's colour (the colour changes once, when the sound arrives: never a flash per press),
   * the needle sweeps, and after 800 ms without sound, "Tuning in".
   */
  tuning?: RadioTuning | null;
}) {
  const meter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!levels || !playing) return;
    let raf = 0;
    const tick = () => {
      const el = meter.current;
      const v = levels(14);
      if (el) {
        // Measured: set each bar from the sound. Not measurable here: the bars keep their rhythm.
        el.classList.toggle("oc-radio__meter--measured", v !== null);
        if (v) el.querySelectorAll("i").forEach((bar, i) => ((bar as HTMLElement).style.height = `${Math.round(8 + v[i] * 92)}%`));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levels, playing]);
  const shown = tuning?.to ?? c;
  const sub =
    size === "tv"
      ? `${[shown.station.name, shown.now?.title].filter(Boolean).join(", ")}${shown.now?.episodeTitle ? `. Now: ${shown.now.episodeTitle}` : ""}`
      : [shown.station.name, shown.station.homeCity].filter(Boolean).join(", ");
  const clearing = tuning?.phase === "clearing";
  return (
    <div className={cx("oc-radio", playing && !tuning && "oc-radio--playing", tuning && "oc-radio--tuning", clearing && "is-clearing")} style={{ background: c.station.colour ?? "#33507A" }} data-phase={tuning?.phase}>
      <div className="oc-radio__drift">
        {tuning && <Needle sweep={tuning.sweep} clearing={clearing} />}
        <div className="oc-radio__f oc-mono">{shown.station.channel}</div>
        <div className="oc-radio__cs oc-cs">{shown.station.callSign}</div>
        {sub && <div className="oc-radio__sub">{sub}</div>}
        {tuning?.phase === "tuning_in" && <div className="oc-radio__hold">Tuning in</div>}
        <div ref={meter} className="oc-radio__meter" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ ["--i" as string]: i }} />
          ))}
        </div>
      </div>
      {tally && (
        <div className="oc-radio__tally">
          <Tally state={onAirHere ? "lit" : "unlit"} size="tv" on="picture" flicker={false} />
        </div>
      )}
    </div>
  );
}
