import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "role"> {
  /** On or off. */
  checked: boolean;
  /** Called with the new value. */
  onChange?: (checked: boolean) => void;
  /** The switch's name, when the row's words aren't wired with aria-labelledby. */
  label?: string;
}

/** A switch (role="switch"): signal when on, line grey when off. The row around it says what it does. */
export function Toggle({ checked, onChange, label, className, onClick, type = "button", ...rest }: ToggleProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx("oc-toggle", !checked && "oc-toggle--off", className)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onChange?.(!checked);
      }}
      {...rest}
    />
  );
}

export interface ToggleLockProps {
  /** Visible words beside the lock ("Owner only"). Frames that say "Always on" in the row leave this out. */
  children?: ReactNode;
  /** What a screen reader hears. Defaults to "Always on". */
  label?: string;
  className?: string;
}

/**
 * In place of a switch, for alerts that protect what's on air (dead air, spots about to pause):
 * a lock, not a toggle, because they can't be turned off.
 */
export function ToggleLock({ children, label = "Always on", className }: ToggleLockProps) {
  return (
    <span className={cx("oc-toggle-lock", className)} role={children ? undefined : "img"} aria-label={children ? undefined : label}>
      <Icon name="lock" />
      {children}
    </span>
  );
}
