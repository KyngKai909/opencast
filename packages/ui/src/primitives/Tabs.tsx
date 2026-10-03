import { useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { onRovingKey } from "./roving";

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  /** A count after the label, in mono standby: what's waiting there ("1" new request). */
  count?: number;
  /** What a screen reader hears for the count ("1 waiting"). Defaults to the number. */
  countLabel?: string;
  /** The id of the panel this tab shows. */
  controls?: string;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  items: ReadonlyArray<TabItem<V>>;
  value: V;
  onChange?: (value: V) => void;
  /** The list's name for screen readers ("Market", "Day"). */
  label: string;
  /** underline: the reference's .tabs (Browse, Offered by BEAT…). days: the program log's day buttons (.days). pill: the Schedule's tabs (.sch-tabs, A246). */
  variant?: "underline" | "days" | "pill";
  className?: string;
}

/** Tabs (role="tablist"). Arrow keys, Home and End move between them and show the one they land on. */
export function Tabs<V extends string = string>({ items, value, onChange, label, variant = "underline", className }: TabsProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = items.findIndex((t) => t.value === value);
  const tabStop = selected >= 0 ? selected : items.findIndex((t) => !t.disabled);
  return (
    <div role="tablist" aria-label={label} className={cx("oc-tabs", `oc-tabs--${variant}`, className)}>
      {items.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          aria-controls={t.controls}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={t.disabled}
          className={cx("oc-tabs__tab", t.value === value && "oc-tabs__tab--on")}
          onClick={() => t.value !== value && onChange?.(t.value)}
          onKeyDown={(e) => {
            const next = onRovingKey(e, i, items.length, (j) => !!items[j]?.disabled, (j) => refs.current[j]?.focus());
            if (next !== null) onChange?.(items[next]!.value);
          }}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="oc-tabs__count" aria-label={t.countLabel}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
