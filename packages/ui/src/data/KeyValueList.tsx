import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { money } from "../lib/format";
import { Lines } from "./Lines";

/** A label on the left, its value on the right (.kv). */
export interface KeyValuePair {
  label: ReactNode;
  value: ReactNode;
}

/** Two lines on the left, an amount, a value or actions on the right (.row2). */
export interface KeyValueRow {
  title: ReactNode;
  detail?: ReactNode;
  /** Money in micros, in mono on the right. Negative amounts read in ink-70 with a true minus. */
  amount?: number;
  /** Prefix money coming in with "+" (.m.pos). */
  sign?: boolean;
  /** Read the amount quietly (ink-70), as money going out or not counted in (.m.neg). */
  quiet?: boolean;
  /** Any other right-hand value in mono ("44%", "7 days", "31 customers"). */
  value?: ReactNode;
  /** Buttons or a toggle on the right, instead of a value (.row2 .end). */
  actions?: ReactNode;
  /** Undecided money: "Not set yet" in standby after the title, at $0.00. */
  notSetYet?: boolean;
  /** The total at the foot: a 2px ink rule above, larger type (.row2.total). */
  total?: boolean;
}

/** A health line: label, then a quiet mono value; `good` puts the steady dot before the label (.hl-row). */
export interface HealthRow {
  label: ReactNode;
  value: ReactNode;
  good?: boolean;
  /** Set the value in the text face instead of mono (a sentence, not a reading). */
  textValue?: boolean;
  /** Needs attention: the value in standby, 600 weight. */
  attention?: boolean;
}

export type KeyValueListProps =
  | { variant?: "pairs"; items: KeyValuePair[]; className?: string }
  | { variant: "rows"; items: KeyValueRow[]; className?: string }
  | { variant: "health"; items: HealthRow[]; className?: string };

function rowValue(r: KeyValueRow) {
  if (r.actions) return <span className="oc-kvrows__end">{r.actions}</span>;
  if (r.notSetYet) return <span className="oc-kvrows__m oc-kvrows__m--quiet">{money(0)}</span>;
  if (r.amount !== undefined) {
    const quiet = r.quiet || r.amount < 0;
    return <span className={cx("oc-kvrows__m", quiet && "oc-kvrows__m--quiet")}>{money(r.amount, { sign: r.sign })}</span>;
  }
  if (r.value !== undefined) return <span className={cx("oc-kvrows__m", r.quiet && "oc-kvrows__m--quiet")}>{r.value}</span>;
  return null;
}

/**
 * Ruled lists of facts. `pairs`: label left, value right (.kv). `rows`: two lines left and an
 * amount, value or actions right (.row2), with a total row. `health`: master control's "Right now" lines.
 * Amounts are mono and right-aligned; undecided ones stay visible at $0.00 reading "Not set yet".
 */
export function KeyValueList(props: KeyValueListProps) {
  if (props.variant === "rows") {
    return (
      <dl className={cx("oc-kvrows", props.className)}>
        {props.items.map((r, i) => (
          <div key={i} className={cx("oc-kvrows__row", r.total && "oc-kvrows__row--total")}>
            <dt>
              <Lines title={r.title} detail={r.detail} notSetYet={r.notSetYet} />
            </dt>
            <dd>{rowValue(r)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (props.variant === "health") {
    return (
      <dl className={cx("oc-health", props.className)}>
        {props.items.map((r, i) => (
          <div key={i} className="oc-health__row">
            <dt className={cx(r.good && "oc-health__good")}>{r.label}</dt>
            <dd className={cx("oc-health__value", r.textValue && "oc-health__value--text", r.attention && "oc-health__value--attention")}>{r.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cx("oc-kv", props.className)}>
      {props.items.map((p, i) => (
        <div key={i} className="oc-kv__row">
          <dt className="oc-kv__key">{p.label}</dt>
          <dd className="oc-kv__value">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}
