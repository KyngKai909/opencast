import { useId } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import { LOG_CODE_WORDS, type LogCodeName } from "./LogCode";

export type SelectableCode = Exclude<LogCodeName, "OPEN">;

export interface CodeSelectProps {
  value: SelectableCode;
  onChange?: (code: SelectableCode) => void;
  /** The codes on offer. Defaults to all five. */
  codes?: SelectableCode[];
  /** Its accessible name: "Type" (the library's column head). */
  label?: string;
  disabled?: boolean;
  className?: string;
}

const ALL: SelectableCode[] = ["PGM", "SPT", "UND", "BMP", "SID"];

/** Picks a library item's log code (master control A2 .typesel), drawn in that code's style. */
export function CodeSelect({ value, onChange, codes = ALL, label = "Type", disabled, className }: CodeSelectProps) {
  const id = useId();
  return (
    <span className={cx("oc-code-select", `oc-code-select--${value.toLowerCase()}`, className)}>
      <select
        id={id}
        className="oc-code-select__input"
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value as SelectableCode)}
      >
        {codes.map((c) => (
          <option key={c} value={c}>
            {c} ({LOG_CODE_WORDS[c]})
          </option>
        ))}
      </select>
      <span className="oc-code-select__shown" aria-hidden="true">
        {value}
        <Icon name="down" size={12} />
      </span>
    </span>
  );
}
