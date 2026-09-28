import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export type TagVariant =
  | "plain"    /* outlined, ink-70 */
  | "live"     /* red text and border, with the dot: the only red that isn't the tally */
  | "next"     /* standby fill: "Next at 9:30" */
  | "listed"   /* dashed: a city stream Opencast lists but doesn't restream */
  | "off"      /* dashed, ink-50: "Off air" */
  | "standby"  /* amber outline: waiting, committed, needs attention */
  | "solid";   /* ink fill: done, "Yours", a selected state */

export interface TagProps {
  variant?: TagVariant;
  /** On a picture (a player or title card): the scrim ground, the same on both themes. */
  onPicture?: boolean;
  /** The dot before the words. On by default for live. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

/** A small sign: Live, Listed, Next, states. Words, never colour alone. */
export function Tag({ variant = "plain", onPicture, dot, children, className }: TagProps) {
  const showDot = dot ?? variant === "live";
  return (
    <span className={cx("oc-tag", `oc-tag--${variant}`, onPicture && "oc-tag--on-picture", className)}>
      {showDot && <span className="oc-tag__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
