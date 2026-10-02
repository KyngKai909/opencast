import { useRef, type KeyboardEvent } from "react";
import { cx } from "../lib/cx";

export interface ChannelOption {
  /** "12", or a frequency on the radio band. */
  value: string;
  /** Another station has it: struck through, can't be chosen. */
  taken?: boolean;
}

export interface ChannelPickerProps {
  options: ChannelOption[];
  value?: string;
  onChange?: (value: string) => void;
  /** Buttons per row. The reference draws ten. */
  columns?: number;
  /** For screen readers: "Channel". */
  label?: string;
  className?: string;
}

/** Channels from `first` to `last` as options, with the taken ones marked. */
export function channelOptions(first: number, last: number, taken: number[] = []): ChannelOption[] {
  const out: ChannelOption[] = [];
  for (let n = first; n <= last; n++) out.push({ value: String(n), taken: taken.includes(n) });
  return out;
}

/**
 * The open channels in a market, taken ones struck through (master control A1). A radio group:
 * the arrow keys move between free channels, skipping taken ones.
 */
export function ChannelPicker({ options, value, onChange, columns = 10, label = "Channel", className }: ChannelPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const free = options.map((o, i) => (o.taken ? -1 : i)).filter((i) => i >= 0);
  const selected = options.findIndex((o) => o.value === value && !o.taken);
  const focusable = selected >= 0 ? selected : free[0];

  const move = (from: number, delta: number) => {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i += delta;
      if (i < 0 || i >= options.length) return;
      if (!options[i].taken) {
        onChange?.(options[i].value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  const onKey = (i: number) => (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (e.key in map) move(i, map[e.key]);
    else if (e.key === "Home" && free.length) move(free[0] - 1, 1);
    else if (e.key === "End" && free.length) move(free[free.length - 1] + 1, -1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={cx("oc-chgrid", className)} role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {options.map((o, i) => {
        const sel = i === selected;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={sel}
            aria-disabled={o.taken || undefined}
            aria-label={o.taken ? `${o.value}, taken` : o.value}
            tabIndex={i === focusable ? 0 : -1}
            className={cx("oc-cn", sel && "oc-cn--sel", o.taken && "oc-cn--taken")}
            onClick={() => !o.taken && onChange?.(o.value)}
            onKeyDown={onKey(i)}
          >
            {o.value}
          </button>
        );
      })}
    </div>
  );
}
