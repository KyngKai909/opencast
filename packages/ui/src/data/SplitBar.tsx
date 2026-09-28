import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface SplitPart {
  label: ReactNode;
  /** A count ("38" airings) or a share; shown in mono as given by `value`, measured by `amount`. */
  amount: number;
  /** What to show on the right. Defaults to the amount. */
  value?: ReactNode;
}

export interface SplitBarProps {
  parts: SplitPart[];
  /**
   * rows: one row per part, with its label, a bar and the count (the daypart split, biz results .dp).
   * stacked: one bar split into parts in ink, ink-70, ink-50 and line ("Watching on", earnings .split-bar).
   */
  variant?: "rows" | "stacked";
  /** The stacked bar's spoken summary. Rows speak for themselves. */
  label?: string;
  className?: string;
}

/** Each part's share of the whole, in whole percent. */
export function splitShares(parts: Array<{ amount: number }>): number[] {
  const total = parts.reduce((s, p) => s + Math.max(0, p.amount), 0);
  return parts.map((p) => (total > 0 ? Math.round((Math.max(0, p.amount) / total) * 100) : 0));
}

const STACK = ["ink", "ink-70", "ink-50", "line"];

/** How a whole divides: airings by time of day as rows of bars, or where people watch as one stacked bar. */
export function SplitBar({ parts, variant = "rows", label, className }: SplitBarProps) {
  const shares = splitShares(parts);
  if (variant === "stacked") {
    return (
      <div className={cx("oc-splitbar", className)} role="img" aria-label={label}>
        {parts.map((p, i) => (
          <i key={i} className={`oc-splitbar__part--${STACK[i % STACK.length]}`} style={{ width: `${shares[i]}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className={cx("oc-split", className)}>
      {parts.map((p, i) => (
        <div key={i} className="oc-split__row">
          <span>{p.label}</span>
          <span className="oc-split__bar" aria-hidden="true">
            <i style={{ width: `${shares[i]}%` }} />
          </span>
          <span className="oc-split__m">{p.value ?? p.amount.toLocaleString("en-US")}</span>
        </div>
      ))}
    </div>
  );
}
