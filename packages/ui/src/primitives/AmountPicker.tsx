import { useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { money } from "../lib/format";
import { onRovingKey } from "./roving";
import { Field } from "./Field";

/** The picker's value: an amount in micros, or "other" when the person types their own. */
export type AmountChoice = number | "other";

export interface AmountPickerProps {
  /** The amounts offered, in micros (1 dollar = 1,000,000). Usually three, with Other as the fourth. */
  amounts: ReadonlyArray<number>;
  /** The chosen amount, "other", or null for none yet. */
  value: AmountChoice | null;
  onChange?: (value: AmountChoice) => void;
  /** The question, for screen readers ("How much a month", "How much"). */
  label: string;
  /** text: the pledge picker (.amts, 52px, the text face). mono: business amounts (.amts2, 48px, mono). */
  variant?: "text" | "mono";
  /** Offer "Other", which shows a mono field for a typed amount. On by default. */
  other?: boolean;
  /** What's typed in the Other field, as the person typed it ("12.50"). */
  otherValue?: string;
  onOtherChange?: (text: string) => void;
  /** The Other field's label. */
  otherLabel?: string;
  /** What's wrong with the typed amount (below $1.00…). */
  otherError?: ReactNode;
  className?: string;
}

/**
 * Amounts in a row of equal buttons, the chosen one in ink (role="radiogroup"; arrow keys move the
 * choice). "Other" opens a mono field underneath.
 */
export function AmountPicker({
  amounts,
  value,
  onChange,
  label,
  variant = "text",
  other = true,
  otherValue = "",
  onOtherChange,
  otherLabel = "Other amount",
  otherError,
  className
}: AmountPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const choices: AmountChoice[] = [...amounts, ...(other ? (["other"] as const) : [])];
  const selected = value === null ? -1 : choices.indexOf(value);
  const tabStop = selected >= 0 ? selected : 0;
  return (
    <div className={cx("oc-amounts", `oc-amounts--${variant}`, className)}>
      <div role="radiogroup" aria-label={label} className="oc-amounts__row" style={{ gridTemplateColumns: `repeat(${choices.length}, 1fr)` }}>
        {choices.map((c, i) => (
          <button
            key={String(c)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={c === value}
            tabIndex={i === tabStop ? 0 : -1}
            className={cx("oc-amounts__amt", c === value && "oc-amounts__amt--sel")}
            onClick={() => c !== value && onChange?.(c)}
            onKeyDown={(e) => {
              const next = onRovingKey(e, i, choices.length, () => false, (j) => refs.current[j]?.focus());
              if (next !== null) onChange?.(choices[next]!);
            }}
          >
            {c === "other" ? "Other" : money(c, { trimCents: true })}
          </button>
        ))}
      </div>
      {value === "other" && (
        <Field
          className="oc-amounts__other"
          label={otherLabel}
          mono
          inputMode="decimal"
          placeholder={money(0)}
          value={otherValue}
          onChange={(e) => onOtherChange?.(e.target.value)}
          error={otherError}
        />
      )}
    </div>
  );
}
