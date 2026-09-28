import { Tally, cx } from "@opencast/ui";
import type { Channel } from "../types";

/**
 * A radio station on a screen: it has no picture, so its colour fills the screen and the
 * frequency is set huge, with a level meter that moves with the sound (tv 05.1). The whole block
 * drifts a few pixels a minute so an all-night station doesn't burn into an OLED.
 */
export function RadioScreen({ channel: c, playing, onAirHere, tally = true }: { channel: Channel; playing: boolean; onAirHere: boolean; /** Hidden while the banner (which carries the tally) is up: one tally per view. */ tally?: boolean }) {
  const now = c.now?.title;
  const sub = [c.station.name, now].filter(Boolean).join(", ");
  return (
    <div className={cx("oc-radio", playing && "oc-radio--playing")} style={{ background: c.station.colour ?? "#33507A" }}>
      <div className="oc-radio__drift">
        <div className="oc-radio__f oc-mono">{c.station.channel}</div>
        <div className="oc-radio__cs oc-cs">{c.station.callSign}</div>
        {sub && <div className="oc-radio__sub">{sub}</div>}
        <div className="oc-radio__meter" aria-hidden="true">
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
