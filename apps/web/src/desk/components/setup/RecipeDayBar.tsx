// A recipe's 24 hours (network-desk 04.1 .day24, .hours): one bar from 6 am to 6 am in each
// block's colour, the creator's blocks in the station's colour, the carried program in its
// station's, the catalog in its own; the hours under it in mono. Screen readers get the blocks as
// a list of times.

import type { CSSProperties } from "react";
import type { RecipeX } from "../../api/ext";
import { blockLabel, clockOfMinutes, daySegments } from "./recipe";
import "./RecipeDayBar.css";

export interface RecipeDayBarProps {
  recipe: RecipeX;
  /** The creator's short name, for "Lupe's kitchen". */
  creatorShort: string;
  /** The station's colour, for the creator's own blocks. */
  stationColour: string | null;
  startHour?: number;
}

export function RecipeDayBar({ recipe, creatorShort, stationColour, startHour = 6 }: RecipeDayBarProps) {
  const segs = daySegments(recipe, startHour);
  const colourOf = (s: (typeof segs)[number]) =>
    s.block.source === "creator" || s.block.source === "repeats" ? stationColour : s.block.source === "carried" ? (s.block.carried?.station.colour ?? null) : (s.block.colour ?? null);
  const ticks = [0, 6, 12, 18, 24].map((h) => clockOfMinutes((startHour + h) * 60).replace(":00", ""));
  return (
    <div className="nd-day">
      <div className="nd-day__bar" aria-hidden="true">
        {segs.map((s) => (
          <i key={`${s.block.start}-${s.block.source}`} style={{ flex: s.minutes, "--nd-block": colourOf(s) ?? undefined } as CSSProperties} className={colourOf(s) ? undefined : "nd-day__plain"}>
            {blockLabel(s.block, creatorShort)}
          </i>
        ))}
      </div>
      <div className="nd-day__hours" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
      <ul className="oc-sr-only">
        {segs.map((s) => (
          <li key={`${s.block.start}-${s.block.source}`}>
            {clockOfMinutes((startHour * 60 + s.from) % 1440)} to {clockOfMinutes((startHour * 60 + s.from + s.minutes) % 1440)}: {blockLabel(s.block, creatorShort)}
          </li>
        ))}
      </ul>
    </div>
  );
}
