import { useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { onRovingKey } from "./roving";

export interface Choice<V extends string = string> {
  value: V;
  /** The bold line: "Repeat from your library", "Barter", "Card". */
  title: ReactNode;
  /** The line under it. */
  helper?: ReactNode;
  /** At the end of the row: a price in mono ("$2.50 an airing"), a fee ("No fee", "$7.55"). */
  end?: ReactNode;
  /** A small line under the fee, in the text face ("Stripe's fee, at cost"). Method rows only. */
  endNote?: ReactNode;
  disabled?: boolean;
}

export interface ChoiceListProps<V extends string = string> {
  options: ReadonlyArray<Choice<V>>;
  /** The chosen value, or null when nothing is chosen yet. */
  value: V | null;
  onChange?: (value: V) => void;
  /** The question, for screen readers ("How should this gap be filled?"). */
  label: string;
  /**
   * option: ruled rows with a radio and a helper line (.opt). term: the same with a mono price at
   * the end (.termopt, deal terms). method: bordered boxes with a fee at the end (.meth, funding).
   */
  variant?: "option" | "term" | "method";
  className?: string;
}

/** Radio rows with a title and helper line (role="radiogroup"). Arrow keys move the choice. */
export function ChoiceList<V extends string = string>({ options, value, onChange, label, variant = "option", className }: ChoiceListProps<V>) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : options.findIndex((o) => !o.disabled);
  const choose = (o: Choice<V>) => {
    if (!o.disabled && o.value !== value) onChange?.(o.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx("oc-choices", `oc-choices--${variant}`, className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <div
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={on}
            aria-disabled={o.disabled || undefined}
            tabIndex={i === tabStop && !o.disabled ? 0 : -1}
            className={cx("oc-choice", on && "oc-choice--sel", o.disabled && "oc-choice--disabled")}
            onClick={() => choose(o)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                choose(o);
                return;
              }
              const next = onRovingKey(e, i, options.length, (j) => !!options[j]?.disabled, (j) => refs.current[j]?.focus());
              if (next !== null) onChange?.(options[next]!.value);
            }}
          >
            <span className="oc-choice__rad" aria-hidden="true" />
            <div className="oc-choice__words">
              <b>{o.title}</b>
              {o.helper && <small>{o.helper}</small>}
            </div>
            {(o.end || o.endNote) && (
              <span className="oc-choice__end">
                {o.end}
                {o.endNote && <small>{o.endNote}</small>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
