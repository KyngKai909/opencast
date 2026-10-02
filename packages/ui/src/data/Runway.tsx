import { cx } from "../lib/cx";
import { money } from "../lib/format";

export interface RunwayProps {
  /** What the business spends a day at this month's pace, in micros. */
  perDay: number;
  /** How many days of airings what's available covers, rounded down. */
  days: number;
  /** Whether auto top-up is on. */
  autoTopUp: boolean;
  className?: string;
}

/** "about 44 days", "about 1 day". */
export function runwayDays(days: number): string {
  const n = Math.max(0, Math.floor(days));
  return `about ${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * The runway line under the balance (.runway): warnings are in days, not dollars.
 * "At this month's pace, about $9.20 a day, what's available covers about 44 days of airings."
 */
export function Runway({ perDay, days, autoTopUp, className }: RunwayProps) {
  return (
    <p className={cx("oc-runway", className)}>
      At this month's pace, about {money(perDay)} a day, what's available covers <b>{runwayDays(days)}</b> of airings.{" "}
      {autoTopUp ? "Auto top-up is on." : "Auto top-up is off."}
    </p>
  );
}
