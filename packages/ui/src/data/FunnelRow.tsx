import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Lines } from "./Lines";

/** The bar's fill: from the widest step (line) to the one that counts most (ink). */
export type FunnelTone = "line" | "ink-70" | "ink";

export interface FunnelRowProps {
  title: ReactNode;
  detail?: ReactNode;
  count: number;
  /** The bar's length, 0 to 100. */
  percent: number;
  tone?: FunnelTone;
  className?: string;
}

/** One step of the funnel (.fn): two lines, a bar, the count in mono. */
export function FunnelRow({ title, detail, count, percent, tone = "ink", className }: FunnelRowProps) {
  return (
    <div className={cx("oc-funnel__row", className)}>
      <Lines title={title} detail={detail} />
      <span className="oc-funnel__bar" aria-hidden="true">
        <i className={`oc-funnel__fill--${tone}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </span>
      <span className="oc-funnel__count">{count.toLocaleString("en-US")}</span>
    </div>
  );
}

export interface FunnelStep {
  title: ReactNode;
  detail?: ReactNode;
  count: number;
  tone?: FunnelTone;
}

export interface FunnelProps {
  steps: FunnelStep[];
  className?: string;
}

const TONES: FunnelTone[] = ["line", "ink-70", "ink"];

/** Each step's bar as a share of the largest step. */
export function funnelPercents(steps: Array<{ count: number }>): number[] {
  const max = Math.max(0, ...steps.map((s) => s.count));
  return steps.map((s) => (max > 0 ? Math.round((s.count / max) * 100) : 0));
}

/**
 * Scans, saves and uses of a code (biz results .funnel): a 2px ink rule, then one row per step, each
 * bar measured against the largest. Businesses see only their own numbers.
 */
export function Funnel({ steps, className }: FunnelProps) {
  const percents = funnelPercents(steps);
  return (
    <div className={cx("oc-funnel", className)}>
      {steps.map((s, i) => (
        <FunnelRow
          key={i}
          title={s.title}
          detail={s.detail}
          count={s.count}
          percent={percents[i]}
          tone={s.tone ?? TONES[Math.min(TONES.length - 1, Math.round((i / Math.max(1, steps.length - 1)) * (TONES.length - 1)))]}
        />
      ))}
    </div>
  );
}
