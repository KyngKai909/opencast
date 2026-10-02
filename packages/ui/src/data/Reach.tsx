import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ReachProps {
  /** The headline ("Every station can carry coffee and food"). */
  title: ReactNode;
  /** Stations that can carry the category. */
  reached: number;
  /** Stations in the market. */
  total: number;
  /** The sentence under the bar, with the numbers in words ("8 of 8 stations in the Inland Empire. …"). */
  detail: ReactNode;
  className?: string;
}

/**
 * Category reach (biz funding .reach): how many of the market's stations can carry this kind of
 * business, as a bar and a sentence. The sentence carries the numbers; the bar is decoration.
 */
export function Reach({ title, reached, total, detail, className }: ReachProps) {
  const pct = total > 0 ? Math.round((Math.min(reached, total) / total) * 100) : 0;
  return (
    <div className={cx("oc-reach", className)}>
      <b className="oc-reach__title">{title}</b>
      <div className="oc-reach__bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="oc-reach__detail">{detail}</span>
    </div>
  );
}
