import { cx } from "../lib/cx";

export interface LiveTextProps {
  /** The word. "Live" everywhere the frames use it. */
  children?: string;
  className?: string;
}

/**
 * "Live" in red text: how rows, schedules and the guide say a program is live. Never the tally,
 * which only the player lights.
 */
export function LiveText({ children = "Live", className }: LiveTextProps) {
  return <span className={cx("oc-live-text", className)}>{children}</span>;
}
