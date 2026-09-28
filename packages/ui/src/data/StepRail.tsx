import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import { Lines } from "./Lines";

export type StepState = "done" | "current" | "todo";

export interface Step {
  label: ReactNode;
  state: StepState;
  /** The list variant only: a second line under the label. */
  detail?: ReactNode;
  /** The list variant only: the action that finishes this step, on the right. */
  action?: ReactNode;
}

export interface StepRailProps {
  steps: Step[];
  /**
   * vertical: the setup rail (.mc-steps) in master control and the business. row: an order's steps
   * across the page (.steps5). list: numbered steps with a detail and an action (the claim page, .steps3).
   */
  variant?: "vertical" | "row" | "list";
  /** The vertical rail's note under the steps ("Each step saves as you go. …"). */
  hint?: ReactNode;
  /** The steps' accessible name ("Setting up BEAT"). */
  label: string;
  className?: string;
}

/**
 * Where you are in a sequence of steps: done steps show a check (vertical, list) or read quieter (row),
 * the current one is marked in signal (vertical, list) or ink (row), and the rest wait in ink-50.
 */
export function StepRail({ steps, variant = "vertical", hint, label, className }: StepRailProps) {
  const done = <span className="oc-sr-only">Done: </span>;
  if (variant === "row") {
    return (
      <ol className={cx("oc-steprow", className)} aria-label={label}>
        {steps.map((s, i) => (
          <li key={i} className={cx("oc-steprow__step", `oc-steprow__step--${s.state}`)} aria-current={s.state === "current" ? "step" : undefined}>
            <b className="oc-steprow__n">{i + 1}</b>
            {s.state === "done" && done}
            {s.label}
          </li>
        ))}
      </ol>
    );
  }
  if (variant === "list") {
    return (
      <ol className={cx("oc-steplist", className)} aria-label={label}>
        {steps.map((s, i) => (
          <li key={i} className={cx("oc-steplist__step", `oc-steplist__step--${s.state}`)} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="oc-steplist__n" aria-hidden={s.state === "done" ? true : undefined}>
              {s.state === "done" ? <Icon name="check" size={13} /> : i + 1}
            </span>
            <div>
              {s.state === "done" && done}
              <Lines title={s.label} detail={s.detail} />
            </div>
            <span className="oc-steplist__action">{s.action}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className={cx("oc-steps", className)}>
      <ol className="oc-steps__list" aria-label={label}>
        {steps.map((s, i) => (
          <li key={i} className={cx("oc-steps__step", `oc-steps__step--${s.state}`)} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="oc-steps__n" aria-hidden={s.state === "done" ? true : undefined}>
              {s.state === "done" ? <Icon name="check" size={13} /> : i + 1}
            </span>
            {s.state === "done" && done}
            {s.label}
          </li>
        ))}
      </ol>
      {hint && <p className="oc-steps__hint">{hint}</p>}
    </div>
  );
}
