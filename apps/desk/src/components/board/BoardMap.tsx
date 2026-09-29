// The dial as a map (network-desk 01.1 .dialmap, .radiomap): every main channel in a band as a slot,
// coloured by what's there. An independent station is its colour with the call sign in white; a
// claimable station a dashed signal border; a listed city stream a dashed line; the catalog station
// ink; a waitlist hold hatched; open a hairline. The selected slot has the standby ring. One Tab
// stop per map; the arrow keys move across and down the grid.

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { cx } from "@opencast/ui";
import type { SlotX } from "../../api/ext";
import { slotCallSign, slotKey, slotLabel, slotNumber } from "./board";
import "./BoardMap.css";

const LOOK: Record<SlotX["state"], string> = { station: "st", claimable: "cl", listed: "li", catalog: "ho", held: "rs", open: "open" };

export interface BoardMapProps {
  band: "tv" | "radio";
  slots: SlotX[];
  /** 17 across for TV, 20 for radio, as drawn. */
  columns: number;
  selected: string | null;
  onSelect: (key: string) => void;
  label: string;
}

export function BoardMap({ band, slots, columns, selected, onSelect, label }: BoardMapProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const keys = slots.map((s) => slotKey(s, band));
  const tabStop = Math.max(0, selected ? keys.indexOf(selected) : 0);
  const move = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[e.key];
    const target = e.key === "Home" ? 0 : e.key === "End" ? slots.length - 1 : step !== undefined ? i + step : null;
    if (target === null || target < 0 || target >= slots.length) return;
    e.preventDefault();
    refs.current[target]?.focus();
  };
  return (
    <div className="nd-map" role="group" aria-label={label} style={{ "--nd-map-cols": columns } as CSSProperties}>
      {slots.map((s, i) => {
        const key = keys[i]!;
        const cs = slotCallSign(s);
        const colour = s.state === "station" ? (s.stations[0]?.colour ?? undefined) : undefined;
        return (
          <button
            key={key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className={cx("nd-slot", `nd-slot--${LOOK[s.state]}`, key === selected && "nd-slot--sel")}
            style={colour ? ({ "--nd-slot-colour": colour } as CSSProperties) : undefined}
            aria-label={slotLabel(s, band)}
            aria-pressed={key === selected}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onSelect(key)}
            onKeyDown={(e) => move(e, i)}
          >
            <span className="nd-slot__n">{slotNumber(s, band)}</span>
            {cs && <b className="nd-slot__cs">{cs}</b>}
          </button>
        );
      })}
    </div>
  );
}
