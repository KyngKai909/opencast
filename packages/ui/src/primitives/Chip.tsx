import { useRef, type ButtonHTMLAttributes, type Ref } from "react";
import { cx } from "../lib/cx";
import { onRovingKey } from "./roving";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Chosen: outlined in ink. */
  on?: boolean;
  /** sm is 30px (the wrapping sets in settings and forms); md is 32px. */
  size?: "md" | "sm";
  /** A chosen chip is struck through, for lists of things that are kept out (blocked categories). */
  strike?: boolean;
  children: string;
  ref?: Ref<HTMLButtonElement>;
}

/** A filter or a pick: a small outlined button. On its own it's a toggle (aria-pressed). */
export function Chip({ on = false, size = "md", strike, className, type = "button", children, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={rest.role ? undefined : on}
      className={cx("oc-chip", on && "oc-chip--on", size === "sm" && "oc-chip--sm", strike && "oc-chip--strike", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

interface ChipRowCommon<V extends string> {
  options: ReadonlyArray<ChipOption<V>>;
  /** The group's name for screen readers ("Filter the dial", "Times of day"). */
  label: string;
  /** scroll: one line that scrolls sideways (the dial's filters). wrap: wraps onto more lines (settings and forms). */
  layout?: "scroll" | "wrap";
  size?: "md" | "sm";
  /** Chosen chips are struck through: a list of what's kept out. */
  strike?: boolean;
  className?: string;
}

export type ChipRowProps<V extends string = string> = ChipRowCommon<V> &
  (
    | { multiple?: false; value: V; onChange?: (value: V) => void }
    | { multiple: true; value: ReadonlyArray<V>; onChange?: (value: V[]) => void }
  );

/**
 * A row of chips. Single choice is a radio group (arrow keys move the choice); multiple choice is a
 * group of toggles.
 */
export function ChipRow<V extends string = string>(props: ChipRowProps<V>) {
  const { options, label, layout = "scroll", size = layout === "wrap" ? "sm" : "md", strike, className } = props;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const classes = cx("oc-chips", layout === "wrap" && "oc-chips--wrap", className);
  const setRef = (i: number) => (el: HTMLButtonElement | null) => {
    refs.current[i] = el;
  };

  if (props.multiple) {
    const chosen = new Set(props.value);
    const toggle = (v: V) => {
      const next = options.map((o) => o.value).filter((x) => (x === v ? !chosen.has(x) : chosen.has(x)));
      props.onChange?.(next);
    };
    return (
      <div role="group" aria-label={label} className={classes}>
        {options.map((o, i) => (
          <Chip key={o.value} ref={setRef(i)} on={chosen.has(o.value)} size={size} strike={strike} disabled={o.disabled} onClick={() => toggle(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    );
  }

  const { value, onChange } = props;
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : options.findIndex((o) => !o.disabled);
  return (
    <div role="radiogroup" aria-label={label} className={classes}>
      {options.map((o, i) => (
        <Chip
          key={o.value}
          ref={setRef(i)}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === tabStop ? 0 : -1}
          on={o.value === value}
          size={size}
          strike={strike}
          disabled={o.disabled}
          onClick={() => o.value !== value && onChange?.(o.value)}
          onKeyDown={(e) => {
            const next = onRovingKey(e, i, options.length, (j) => !!options[j]?.disabled, (j) => {
              const el = refs.current[j];
              el?.focus();
              el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            });
            if (next !== null) onChange?.(options[next]!.value);
          }}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
