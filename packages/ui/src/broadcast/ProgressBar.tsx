import { cx } from "../lib/cx";
import { clockRange, type TimeInput } from "../lib/format";
import { fraction, shortClock, shortSpan, timeLeft } from "./time";

export interface ProgressBarProps {
  /** When the program started and ends. */
  start: TimeInput;
  end: TimeInput;
  /** The current time. */
  now: TimeInput;
  timeZone?: string;
  /**
   * sm: the phone remote's now playing (.pr-now). tv: the TV banner (.prog, ten feet).
   * text: the station page's line, "8:30 – 9:00 pm, 18 min left", with no bar.
   */
  size?: "sm" | "tv" | "text";
  /** Say the time left after the bar. The phone remote leaves it off. */
  showLeft?: boolean;
  className?: string;
}

/**
 * How far into the program you are: the start and end at each end, and the time left. A broadcast
 * has no seeking, so this is never a scrub bar.
 */
export function ProgressBar({ start, end, now, timeZone, size = "sm", showLeft = true, className }: ProgressBarProps) {
  const left = timeLeft(now, end);
  if (size === "text") {
    return (
      <span className={cx("oc-prog-text", className)}>
        <span className="oc-mono">{clockRange(start, end, { timeZone, separator: "–" })}</span>, {left}
      </span>
    );
  }
  const pct = Math.round(fraction(now, start, end) * 100);
  return (
    <div
      className={cx("oc-prog", size === "tv" && "oc-prog--tv", className)}
      role="progressbar"
      aria-label="How far into the program"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${shortSpan(start, end, timeZone)}, ${left}`}
    >
      <span className="oc-mono">{shortClock(start, timeZone)}</span>
      <span className="oc-prog__bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="oc-mono">{shortClock(end, timeZone)}</span>
      {showLeft && <span>{left}</span>}
    </div>
  );
}
