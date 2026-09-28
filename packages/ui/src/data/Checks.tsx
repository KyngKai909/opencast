import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import { Lines } from "./Lines";

/** fine: it passes. fixed: Opencast fixed it by itself and says what it did. attention: it needs you (standby). */
export type CheckState = "fine" | "fixed" | "attention";

export interface Check {
  state: CheckState;
  title: ReactNode;
  detail?: ReactNode;
  /** A way forward on the right: "Set up source", "Shrink to fit", "Watch it". */
  action?: ReactNode;
}

export interface ChecksProps {
  items: Check[];
  /** signon: master control's checks before sign-on (.check-list, .ck). upload: a spot's checks (.chk2). */
  variant?: "signon" | "upload";
  /** The list's accessible name ("Checks"). */
  label: string;
  className?: string;
}

const SPOKEN: Record<"signon" | "upload", Record<CheckState, string>> = {
  signon: { fine: "Ready", fixed: "Ready", attention: "Needs attention" },
  upload: { fine: "Fine", fixed: "Fixed", attention: "For you" }
};

/** The upload summary the frame puts beside "Checks": "4 fine, 1 fixed, 1 for you". Parts at zero are left out. */
export function checksSummary(items: Check[]): string {
  const n = (s: CheckState) => items.filter((i) => i.state === s).length;
  return [
    [n("fine"), "fine"],
    [n("fixed"), "fixed"],
    [n("attention"), "for you"]
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, word]) => `${count} ${word}`)
    .join(", ");
}

/**
 * A list of checks, each with a mark, two lines and a way forward. The mark says the state in words
 * to screen readers: a check in ink when it passes, a signal ring when Opencast fixed it, and
 * standby "!" when it needs you.
 */
export function Checks({ items, variant = "signon", label, className }: ChecksProps) {
  const base = variant === "signon" ? "oc-checks" : "oc-uchecks";
  return (
    <ul className={cx(base, className)} aria-label={label}>
      {items.map((c, i) => (
        <li key={i} className={cx(`${base}__item`, `${base}__item--${c.state}`)}>
          <span className={`${base}__mark`} aria-hidden="true">
            {c.state === "attention" ? "!" : <Icon name="check" size={variant === "signon" ? 14 : 12} />}
          </span>
          <div>
            <span className="oc-sr-only">{SPOKEN[variant][c.state]}: </span>
            <Lines title={c.title} detail={c.detail} />
          </div>
          {variant === "signon" ? <span className={`${base}__action`}>{c.action}</span> : c.action}
        </li>
      ))}
    </ul>
  );
}
