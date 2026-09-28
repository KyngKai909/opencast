import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

export interface ShellStepsProps {
  /** The steps, in order ("Your station", "Library"…). */
  steps: string[];
  /** The step on screen, from 1. Steps before it are done; steps after it are to come. */
  current: number;
  /** The line under the steps ("Each step saves as you go…"). */
  hint?: ReactNode;
  /** The list's name for screen readers. */
  label?: string;
  className?: string;
}

/** The setup rail in place of the page rail: numbered steps, done (a check), current (signal ring) and to come. */
export function ShellSteps({ steps, current, hint, label, className }: ShellStepsProps) {
  return (
    <nav className={cx("oc-shell-steps", className)} aria-label={label}>
      <ol className="oc-shell-steps__list">
        {steps.map((s, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "next";
          return (
            <li key={s} className={cx("oc-shell-steps__step", `oc-shell-steps__step--${state}`)} aria-current={state === "current" ? "step" : undefined}>
              <span className="oc-shell-steps__n" aria-hidden={state === "done" ? true : undefined}>
                {state === "done" ? <Icon name="check" size={13} /> : n}
              </span>
              {s}
              {state === "done" && <span className="oc-sr-only">, done</span>}
            </li>
          );
        })}
      </ol>
      {hint && <div className="oc-shell-steps__hint">{hint}</div>}
    </nav>
  );
}
