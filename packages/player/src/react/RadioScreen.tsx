import { useEffect, useRef } from "react";
import { Tally, cx } from "@opencast/ui";
import type { Channel } from "../types";

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
  size = "tv"
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
  const sub =
    size === "tv"
      ? `${[c.station.name, c.now?.title].filter(Boolean).join(", ")}${c.now?.episodeTitle ? `. Now: ${c.now.episodeTitle}` : ""}`
      : [c.station.name, c.station.homeCity].filter(Boolean).join(", ");
  return (
    <div className={cx("oc-radio", playing && "oc-radio--playing")} style={{ background: c.station.colour ?? "#33507A" }}>
      <div className="oc-radio__drift">
        <div className="oc-radio__f oc-mono">{c.station.channel}</div>
        <div className="oc-radio__cs oc-cs">{c.station.callSign}</div>
        {sub && <div className="oc-radio__sub">{sub}</div>}
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
