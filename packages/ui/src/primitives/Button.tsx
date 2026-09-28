import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/glyphs";

export type ButtonVariant =
  | "primary"   /* signal fill: one per view */
  | "ghost"     /* outlined */
  | "text"      /* signal-coloured words */
  | "ink"       /* ink fill: sign on, and anything that changes what goes out to viewers */
  | "on-station"   /* white, filled, on a station's colour */
  | "line-station"; /* white outline on a station's colour */

interface Common {
  variant?: ButtonVariant;
  /** sm is 34px, md 44px, lg 56px (master control's sign-on). */
  size?: "sm" | "md" | "lg";
  /** Full width. */
  block?: boolean;
  /** A state that's already true (a set preset): outlined in ink. */
  set?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
  children?: ReactNode;
  className?: string;
}

export type ButtonProps = Common &
  (({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>) | ({ href: string } & AnchorHTMLAttributes<HTMLAnchorElement>));

/** A button, or a link that looks like one when given `href`. Verb first, sentence case. */
export function Button({ variant = "ghost", size = "md", block, set, icon, iconAfter, children, className, ...rest }: ButtonProps) {
  const classes = cx("oc-btn", `oc-btn--${variant}`, size !== "md" && `oc-btn--${size}`, block && "oc-btn--block", set && "oc-btn--set", className);
  const body = (
    <>
      {icon && <Icon name={icon} />}
      {children}
      {iconAfter && <Icon name={iconAfter} />}
    </>
  );
  if ("href" in rest && rest.href !== undefined) {
    return (
      <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {body}
      </a>
    );
  }
  const { type = "button", ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={classes} {...buttonRest}>
      {body}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: every icon button has a label. */
  label: string;
  /** No border (the reference's .bare). */
  bare?: boolean;
  size?: "sm" | "md";
}

/** A square icon button (40px). Its label is its accessible name and tooltip. */
export function IconButton({ icon, label, bare, size = "md", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx("oc-icon-btn", bare && "oc-icon-btn--bare", size === "sm" && "oc-icon-btn--sm", className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
