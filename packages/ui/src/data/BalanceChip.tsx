import { cx } from "../lib/cx";
import { money } from "../lib/format";

export interface BalanceChipProps {
  /** Micros. */
  amount: number;
  /** The word before it. Default "Available". */
  label?: string;
  className?: string;
}

/** The balance in the business header (.bal-chip): "Available $412.50", the amount in mono. */
export function BalanceChip({ amount, label = "Available", className }: BalanceChipProps) {
  return (
    <span className={cx("oc-bal-chip", className)}>
      {label} <b>{money(amount)}</b>
    </span>
  );
}
