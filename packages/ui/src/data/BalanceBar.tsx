import { cx } from "../lib/cx";
import { money } from "../lib/format";

/** available: ink. held: standby (committed to scheduled airings). spent: line. */
export type BalanceTone = "available" | "held" | "spent";

export interface BalanceSegment {
  tone: BalanceTone;
  /** The word for it ("Available", "Held", "Spent in September"). */
  label: string;
  /** Micros. */
  amount: number;
}

export interface BalanceBarProps {
  segments: BalanceSegment[];
  /** Show the words under the bar. Leave off when a StatRow with matching dots sits above it (biz funding 03.1). */
  legend?: boolean;
  className?: string;
}

/** Each segment's share of the whole, in percent, rounded to a tenth. Empty segments get 0. */
export function balanceShares(segments: BalanceSegment[]): number[] {
  const total = segments.reduce((s, x) => s + Math.max(0, x.amount), 0);
  if (total <= 0) return segments.map(() => 0);
  return segments.map((x) => Math.round((Math.max(0, x.amount) / total) * 1000) / 10);
}

/**
 * The balance as one bar (.balbar): available in ink, held in standby amber, spent in line. The
 * bar is read out as its words and amounts; the optional legend says them on screen.
 */
export function BalanceBar({ segments, legend = false, className }: BalanceBarProps) {
  const shares = balanceShares(segments);
  const spoken = segments.map((s) => `${s.label} ${money(s.amount)}`).join(", ");
  return (
    <div className={cx("oc-balbar-wrap", className)}>
      <div className="oc-balbar" role="img" aria-label={spoken}>
        {segments.map((s, i) => (
          <i key={i} className={cx("oc-balbar__seg", `oc-balbar__seg--${s.tone}`)} style={{ width: `${shares[i]}%` }} />
        ))}
      </div>
      {legend && (
        <div className="oc-balbar__legend" aria-hidden="true">
          {segments.map((s, i) => (
            <span key={i}>
              <i className={`oc-balbar__key--${s.tone}`} />
              {s.label} <span className="oc-balbar__amount">{money(s.amount)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
