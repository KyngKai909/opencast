import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";
import { money } from "../lib/format";

export type StatDot = "ink" | "standby" | "line";

export interface Stat {
  /** The number as it should read ("312", "71%", "Good"). Use `amount` for money. */
  value?: ReactNode;
  /** Money in micros, written with money(). Ignored when `value` is given. */
  amount?: number;
  /** The caption line under the number ("Tuned in now"). */
  caption: ReactNode;
  /** A small square before the number that matches a BalanceBar segment: ink available, standby held, line spent. */
  dot?: StatDot;
  /** The red live dot before a number counted right now ("Tuned in now"). Stations' own numbers only. */
  live?: boolean;
  /** Undecided money: reads $0.00 with "Not set yet" in standby. It stays visible so the row keeps its shape. */
  notSetYet?: boolean;
}

export interface StatRowProps {
  stats: Stat[];
  /**
   * xl: the balance (32px, biz funding .bal3). lg: the audience (30px, earnings .big4).
   * md: results and rights standing (28px, .sum4, .standing). sm: the desk and the claim page (26px, .cov).
   */
  size?: "xl" | "lg" | "md" | "sm";
  className?: string;
}

/**
 * The ruled number group: a 2px ink rule on top, mono numbers side by side, each with a caption,
 * split by hairlines. Amounts go through money(); undecided ones read "Not set yet" at $0.00.
 */
export function StatRow({ stats, size = "xl", className }: StatRowProps) {
  const style = { "--oc-stats-n": stats.length } as CSSProperties;
  return (
    <div className={cx("oc-stats", `oc-stats--${size}`, className)} style={style}>
      {stats.map((s, i) => {
        const value = s.value ?? (s.notSetYet ? money(0) : s.amount !== undefined ? money(s.amount) : null);
        return (
          <div key={i} className={cx("oc-stats__item", s.notSetYet && "oc-stats__item--open")}>
            <span className="oc-stats__value">
              {s.live && <span className="oc-stats__live" aria-hidden="true" />}
              {s.dot && <span className={cx("oc-stats__dot", `oc-stats__dot--${s.dot}`)} aria-hidden="true" />}
              {value}
            </span>
            <small className="oc-stats__caption">
              {s.caption}
              {s.notSetYet && <span className="oc-stats__open">Not set yet</span>}
            </small>
          </div>
        );
      })}
    </div>
  );
}
