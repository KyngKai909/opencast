import { cx } from "@opencast/ui";
import type { NumberEntry } from "../numberEntry";
import { noStationText } from "../numberEntry";

/**
 * Tune by number: "12" with the ".1" filled in and the station it will tune to. A number with no
 * station says so and names the nearest two; the channel stays where it is.
 */
export function NumberPanel({ entry, size }: { entry: NumberEntry; size: "web" | "tv" }) {
  const nearest = entry.nearest.map((c) => `${c.station.channel} ${c.station.callSign ?? ""}`.trim()).join(", ");
  return (
    <div className={cx("oc-numpad", `oc-numpad--${size}`)} role="status" aria-live="assertive">
      <div className="oc-numpad__num oc-mono" aria-label={entry.match ? `Channel ${entry.match.station.channel}` : `Channel ${entry.typed}`}>
        {entry.shown.typed}
        {entry.shown.filled && <em>{entry.shown.filled}</em>}
        <span className="oc-numpad__caret" aria-hidden="true" />
      </div>
      {entry.match ? (
        <div className="oc-numpad__who">
          <b>{entry.match.station.callSign}</b>, {entry.match.station.name}
        </div>
      ) : entry.typed.length >= 2 || entry.nearest.length ? (
        <div className="oc-numpad__who">
          <b>{noStationText(entry)}</b>
          {nearest && <div className="oc-numpad__near">Nearest: {nearest}</div>}
        </div>
      ) : null}
    </div>
  );
}
