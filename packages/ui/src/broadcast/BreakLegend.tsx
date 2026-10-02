import { cx } from "../lib/cx";
import { breakPartWords, type BreakPartKind } from "./BreakBar";

export interface BreakLegendProps {
  /** Which parts to name, in order. C1 shows filled, barter and open; C3 adds "Just added". */
  kinds?: BreakPartKind[];
  /** Whose barter time it is: "REEL" gives "REEL's, under barter". */
  barterOwner?: string;
  className?: string;
}

/** The break bar's legend (master control C1, C3 .legend). */
export function BreakLegend({ kinds = ["filled", "barter", "open"], barterOwner, className }: BreakLegendProps) {
  return (
    <div className={cx("oc-legend", className)}>
      {kinds.map((k) => (
        <span key={k}>
          <i className={`oc-legend__${k}`} aria-hidden="true" />
          {breakPartWords(k, barterOwner)}
        </span>
      ))}
    </div>
  );
}
