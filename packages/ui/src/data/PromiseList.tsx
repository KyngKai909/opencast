import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface PromiseLine {
  /** The first words, in ink and 600 ("It sits in your balance."). */
  lead: ReactNode;
  /** The rest of the line, quieter ("Nothing is spent by adding it."). */
  rest?: ReactNode;
}

export interface PromiseListProps {
  /** The heading ("What happens to your money"). Some frames have none. */
  title?: ReactNode;
  /** The heading's level on the page. Default 3. */
  headingLevel?: 2 | 3 | 4;
  lines: PromiseLine[];
  /** Accessible name when there's no heading. */
  label?: string;
  className?: string;
}

/**
 * The numbered promise (.promise): what happens to the money, one ruled line per step, numbered in
 * mono, under a 2px ink rule. Used where money is added or held (funding 02.1, orders 04.1).
 */
export function PromiseList({ title, headingLevel = 3, lines, label, className }: PromiseListProps) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className={cx("oc-promise", className)}>
      {title && <H className="oc-promise__title">{title}</H>}
      <ol className="oc-promise__list" role="list" aria-label={title ? undefined : label}>
        {lines.map((l, i) => (
          <li key={i} className="oc-promise__line">
            <div>
              <b>{l.lead}</b>
              {l.rest != null && <> {l.rest}</>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
