import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "children"> {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** The bold words: "Credit me on air", "I understand this answer goes to Westside Tapes…". */
  label: ReactNode;
  /** Words that run on after the label, in the quieter colour: `as "Kai M." in BEAT's monthly thank-you`. */
  children?: ReactNode;
  /** A separate line under the label. */
  helper?: ReactNode;
  /** The rule above it (.check sits under a ruled line). On by default. */
  ruled?: boolean;
}

/** A checkbox with its words (the reference's .check .bx). A real input; the box is drawn. */
export function Checkbox({ checked, onChange, label, children, helper, ruled = true, className, disabled, ...input }: CheckboxProps) {
  return (
    <label className={cx("oc-check", ruled && "oc-check--ruled", disabled && "oc-check--disabled", className)}>
      <input
        type="checkbox"
        className="oc-check__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        {...input}
      />
      <span className={cx("oc-check__bx", checked && "oc-check__bx--on")} aria-hidden="true">
        {checked && <Icon name="check" size={14} />}
      </span>
      <span className="oc-check__words">
        <b>{label}</b>
        {children ? <> {children}</> : null}
        {helper && <small>{helper}</small>}
      </span>
    </label>
  );
}
