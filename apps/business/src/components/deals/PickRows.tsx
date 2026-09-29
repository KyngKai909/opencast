// Choosing one thing to sponsor, or who makes a spot (sponsorships 02.1 .pick, production orders
// 02.1 .maker): bordered rows with a radio, the station's colour, two lines and a price at the end.
// A radio group: arrow keys move the choice, Space and Enter choose.

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "./PickRows.css";

export interface PickOption {
  value: string;
  /** The station's colour; null draws it in ink (Opencast Studio). */
  colour: string | null;
  title: ReactNode;
  line: ReactNode;
  /** At the end, in mono ("$75", "From $100"). */
  end?: ReactNode;
  /** Under the end, in the text face ("minimum a month"). */
  endNote?: ReactNode;
  disabled?: boolean;
}

export function PickRows({ options, value, onChange, label }: { options: PickOption[]; value: string | null; onChange: (v: string) => void; label: string }) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : options.findIndex((o) => !o.disabled);
  const move = (from: number, step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const j = (from + step * i + options.length) % options.length;
      if (!options[j]!.disabled) {
        refs.current[j]?.focus();
        onChange(options[j]!.value);
        return;
      }
    }
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const o = options[i]!;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!o.disabled) onChange(o.value);
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(i, -1);
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className="bz-pick">
      {options.map((o, i) => (
        <div
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="radio"
          aria-checked={o.value === value}
          aria-disabled={o.disabled || undefined}
          tabIndex={i === tabStop && !o.disabled ? 0 : -1}
          className={["bz-pick__row", o.value === value && "bz-pick__row--sel", o.disabled && "bz-pick__row--disabled"].filter(Boolean).join(" ")}
          onClick={() => !o.disabled && onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span className="bz-pick__rad" aria-hidden="true" />
          <span className="bz-pick__sw" style={{ background: o.colour ?? "var(--ink)" }} aria-hidden="true" />
          <span className="bz-pick__words">
            <b>{o.title}</b>
            <small>{o.line}</small>
          </span>
          {(o.end != null || o.endNote != null) && (
            <span className="bz-pick__end">
              {o.end}
              {o.endNote != null && <small>{o.endNote}</small>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
