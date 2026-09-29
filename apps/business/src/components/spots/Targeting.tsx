// Who a spot is for (biz-spots 03.1): the distance slider, the stations it matches (named, with the
// ones left out and why), and the row stations will see in their market.

import type { CSSProperties } from "react";
import type { TargetMatch } from "@opencast/contracts";
import { money, TitleCard } from "@opencast/ui";
import type { SpotX } from "../../api/ext/spots";
import { matchLine, plural } from "./format";
import "./Targeting.css";

/** The kinds of station (one list for now; contract request S17), and the radio band (P8). */
export const KINDS = ["Music", "Public affairs", "Food", "Classic", "Sports"] as const;
export const RADIO = "Radio band";

export const DAYPARTS = [
  { value: "mornings", label: "Mornings" },
  { value: "afternoons", label: "Afternoons" },
  { value: "evenings", label: "Evenings, 6 to 11 pm" },
  { value: "late_night", label: "Late night" }
] as const;
export type Daypart = (typeof DAYPARTS)[number]["value"];

export const MILES = { min: 1, max: 25 } as const;

/** "Within": 1 to 25 miles of the business (.slider, .sl-l). */
export function DistanceSlider({ value, onChange, place }: { value: number; onChange: (n: number) => void; place: string }) {
  const share = (value - MILES.min) / (MILES.max - MILES.min);
  return (
    <div className="bz-slider" style={{ "--bz-slider-at": share } as CSSProperties}>
      <label className="bz-slider__label" htmlFor="bz-within">
        Within
      </label>
      <input
        id="bz-within"
        className="bz-slider__input"
        type="range"
        min={MILES.min}
        max={MILES.max}
        step={1}
        value={value}
        aria-valuetext={`${value} mi of ${place}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="bz-slider__ends" aria-hidden="true">
        <span>{MILES.min} mi</span>
        <span className="bz-slider__now">
          {value} mi of {place}
        </span>
        <span>{MILES.max} mi</span>
      </div>
    </div>
  );
}

/** "5 stations will see it", every station named: the ones left out quieter, with why. */
export function MatchList({ stations, summary, loading }: { stations: TargetMatch[]; summary: string; loading?: boolean }) {
  const n = stations.filter((s) => s.included).length;
  return (
    <section className="bz-match" aria-labelledby="bz-match-h" aria-busy={loading || undefined}>
      <h2 className="bz-match__h" id="bz-match-h">
        {n === 0 ? "No stations will see it yet" : `${plural(n, "station", "stations")} will see it`}
      </h2>
      <span className="bz-match__sub">{n === 0 ? "Try a wider distance, or more kinds of station" : summary}</span>
      <ul className="bz-match__list">
        {stations.map((m) => (
          <li key={m.station.id} className={`bz-match__row${m.included ? "" : " bz-match__row--out"}`}>
            <span className="oc-ch bz-match__ch">{m.station.channel}</span>
            <span className="oc-cs bz-match__cs">{m.station.callSign ?? m.station.name}</span>
            <small>
              {matchLine(m)}
              {!m.included && <span className="oc-sr-only">. Won't see it</span>}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How stations will see it: the market's row, as stations see it (.syn-row). */
export function MarketPreview({ spot, business, days, rate }: { spot: SpotX; business: { name: string; line: string }; days: number | null; rate: SpotX["rate"] }) {
  const len = spot.lengthSec >= 60 ? "1:00" : `:${spot.lengthSec}`;
  return (
    <div className="bz-mrow">
      <TitleCard colour={spot.still?.colour ?? "#525C73"} title={spot.still?.label ?? spot.title} decorative className="bz-mrow__tc" />
      <div className="bz-mrow__words">
        <b>{business.name}</b>
        <small>{business.line}</small>
        <small className="bz-mrow__quiet">
          {len}, code on screen{days ? `. About ${plural(days, "day", "days")}` : ""}
        </small>
      </div>
      <div className="bz-mrow__terms">
        <em>{money(rate.micros)}</em>
        {rate.kind === "per_thousand" ? "per 1,000" : "an airing"}
      </div>
    </div>
  );
}
