import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface SparkbarsProps {
  /** One bar per step, in order (a program's minutes: how many tuned away in each). */
  values: number[];
  /**
   * The sentence under the bars, and their text alternative: it says what the bars show ("Most
   * left around 9:24 pm"). The bars themselves are decoration.
   */
  caption: ReactNode;
  /** The step to draw in full ink (the busiest one, by default). */
  mark?: number | null;
  className?: string;
}

/** The busiest step: the first with the highest value, or null when every value is 0. */
export function sparkPeak(values: number[]): number | null {
  let at: number | null = null;
  values.forEach((v, i) => {
    if (v > 0 && (at === null || v > values[at]!)) at = i;
  });
  return at;
}

const H = 20;

/**
 * A small bar strip (added 2026-09-29 for watch data): minute-by-minute tune-aways under a
 * program row. Bars in ink-50, the busiest in ink, a hairline tick for an empty step so the strip
 * keeps the program's length; the caption under it carries the meaning.
 */
export function Sparkbars({ values, caption, mark, className }: SparkbarsProps) {
  const top = Math.max(1, ...values);
  const peak = mark === undefined ? sparkPeak(values) : mark;
  const n = Math.max(1, values.length);
  return (
    <figure className={cx("oc-sparkbars", className)}>
      <svg className="oc-sparkbars__bars" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(2, (v / top) * H) : 0.75;
          return <rect key={i} x={i + 0.15} y={H - h} width={0.7} height={h} className={i === peak ? "oc-sparkbars__peak" : v > 0 ? undefined : "oc-sparkbars__none"} />;
        })}
      </svg>
      <figcaption className="oc-sparkbars__cap">{caption}</figcaption>
    </figure>
  );
}
