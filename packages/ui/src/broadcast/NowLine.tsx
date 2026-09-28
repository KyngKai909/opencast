import { cx } from "../lib/cx";
import type { TimeInput } from "../lib/format";
import { fraction, ms, shortClock } from "./time";

export interface NowLineProps {
  /** The current time. */
  at: TimeInput;
  /** The window the line is drawn across. Outside it, there's no line. */
  from: TimeInput;
  to: TimeInput;
  timeZone?: string;
  /** web: the label sits in the head row (the app guide). compact: above the grid (the style guide). */
  variant?: "web" | "compact";
  className?: string;
}

/**
 * The line for the current time across a guide. It's placed after the station column
 * (--oc-guide-stc) at the time's share of the window.
 */
export function NowLine({ at, from, to, timeZone, variant = "web", className }: NowLineProps) {
  const t = ms(at);
  if (t < ms(from) || t > ms(to)) return null;
  const f = fraction(at, from, to);
  return (
    <div
      className={cx("oc-now-line", variant === "compact" && "oc-now-line--compact", className)}
      style={{ left: `calc(var(--oc-guide-stc) + (100% - var(--oc-guide-stc)) * ${f})` }}
      aria-hidden="true"
    >
      <span>{shortClock(at, timeZone)}</span>
    </div>
  );
}
