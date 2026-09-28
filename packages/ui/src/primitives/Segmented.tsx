import { useRef } from "react";
import { cx } from "../lib/cx";
import { onRovingKey } from "./roving";

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string = string> {
  options: ReadonlyArray<SegmentedOption<V>>;
  /** The chosen value. */
  value: V;
  onChange?: (value: V) => void;
  /** The group's name for screen readers ("Band", "Captions"). */
  label: string;
  /** md: 32px, 13px (the reference's .seg). sm: 30px, 12.5px (settings rows, .seg.sm). compact: 32px, 12px (inside a table row, .tr-row .seg). */
  size?: "md" | "sm" | "compact";
  /** Full width, the segments sharing it equally (the pledge's Monthly / Once). */
  block?: boolean;
  className?: string;
}

/** A segmented control: one choice of two to four, the chosen one in ink. Arrow keys move the choice. */
export function Segmented<V extends string = string>({ options, value, onChange, label, size = "md", block, className }: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : options.findIndex((o) => !o.disabled);
  return (
    <div role="radiogroup" aria-label={label} className={cx("oc-seg", size !== "md" && `oc-seg--${size}`, block && "oc-seg--block", className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={o.disabled}
          className="oc-seg__btn"
          onClick={() => o.value !== value && onChange?.(o.value)}
          onKeyDown={(e) => {
            const next = onRovingKey(e, i, options.length, (j) => !!options[j]?.disabled, (j) => refs.current[j]?.focus());
            if (next !== null) onChange?.(options[next]!.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
