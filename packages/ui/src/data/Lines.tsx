import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface LinesProps {
  /** The first line, in 600 weight: what the row is ("Spots", "Budget reached"). */
  title: ReactNode;
  /** The second line, smaller and quieter: the detail ("212 airings from 5 businesses"). */
  detail?: ReactNode;
  /** An undecided money line: says "Not set yet" in standby after the title. It stays visible at $0.00. */
  notSetYet?: boolean;
  className?: string;
}

/**
 * The two lines most data rows lead with: a title and a quieter detail under it (the reference's
 * `b` + `small`). Tables, key-value rows, timelines and checks all use it.
 */
export function Lines({ title, detail, notSetYet, className }: LinesProps) {
  return (
    <span className={cx("oc-lines", className)}>
      <span className="oc-lines__title">
        {title}
        {notSetYet && <span className="oc-lines__open">Not set yet</span>}
      </span>
      {detail != null && detail !== false && <span className="oc-lines__detail">{detail}</span>}
    </span>
  );
}
