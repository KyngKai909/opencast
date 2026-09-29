// The board's key (network-desk .legend3): one swatch per slot kind, with the contracts' words.
import type { CSSProperties } from "react";
import { SLOT_STATE_LABELS, type SlotState } from "@opencast/contracts";
import "./SlotLegend.css";

const ORDER: SlotState[] = ["station", "claimable", "listed", "catalog", "held", "open"];

/** `stationColour`: a real station's colour for the first swatch (a station fills its slot with its own). */
export function SlotLegend({ stationColour }: { stationColour?: string | null }) {
  return (
    <div className="nd-legend" aria-label="Key">
      {ORDER.map((s) => (
        <span key={s}>
          <i className={`nd-legend__sw nd-legend__sw--${s}`} style={s === "station" && stationColour ? ({ "--nd-legend-colour": stationColour } as CSSProperties) : undefined} aria-hidden="true" />
          {SLOT_STATE_LABELS[s]}
        </span>
      ))}
    </div>
  );
}
