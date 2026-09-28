import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "../primitives/Button";
import { ShellFrame, ShellHead, ShellHeadEnd } from "./ShellFrame";
import { ShellSteps } from "./ShellSteps";

/** Getting started, 1 to 3 (biz-funding 01.1, 02.1). */
export const BUSINESS_SETUP_STEPS = ["Your business", "Fund your balance", "Your first spot"] as const;

export interface BusinessSetupShellProps {
  /** The step on screen, from 1. Earlier steps show as done. */
  step: number;
  /** "Finish later". */
  onFinishLater?: () => void;
  /** The steps, if they ever differ. */
  steps?: readonly string[];
  /** The line under the steps. */
  hint?: ReactNode;
  /** Main area without padding. */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Opencast for business while getting started: "Getting started, step N of 3", Finish later, and the step rail. */
export function BusinessSetupShell({
  step,
  onFinishLater,
  steps = BUSINESS_SETUP_STEPS,
  hint = "Nothing is spent until a station airs your spot.",
  flush,
  children,
  className
}: BusinessSetupShellProps) {
  return (
    <ShellFrame
      className={cx("oc-business-setup", className)}
      flush={flush}
      head={
        <ShellHead app="For business" variant="business">
          <span className="oc-shell-head__note">
            Getting started, step {step} of {steps.length}
          </span>
          <ShellHeadEnd>
            <Button size="sm" onClick={onFinishLater}>
              Finish later
            </Button>
          </ShellHeadEnd>
        </ShellHead>
      }
      rail={<ShellSteps steps={[...steps]} current={step} hint={hint} label="Getting started" />}
    >
      {children}
    </ShellFrame>
  );
}
