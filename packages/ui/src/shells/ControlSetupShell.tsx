import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "../primitives/Button";
import { ShellFrame, ShellHead, ShellHeadEnd } from "./ShellFrame";
import { ShellSteps } from "./ShellSteps";

/** Signing on a new station, A1 to A5 (master control, flow A). */
export const CONTROL_SETUP_STEPS = ["Your station", "Library", "Program log", "Translators", "Sign on"] as const;

export interface ControlSetupShellProps {
  /** The step on screen, 1 to 5. Earlier steps show as done. */
  step: number;
  /** "Save and finish later". Each step already saves; this leaves setup. */
  onFinishLater?: () => void;
  /** The steps, if they ever differ from A1–A5. */
  steps?: readonly string[];
  /** The line under the steps. */
  hint?: ReactNode;
  /** Main area without padding. */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Master control while a new station is set up: "New station, step N of 5", Save and finish later, and the step rail. */
export function ControlSetupShell({
  step,
  onFinishLater,
  steps = CONTROL_SETUP_STEPS,
  hint = "Each step saves as you go. Nothing is public until you sign on.",
  flush,
  children,
  className
}: ControlSetupShellProps) {
  return (
    <ShellFrame
      className={cx("oc-control-setup", className)}
      flush={flush}
      head={
        <ShellHead app="Master control">
          <span className="oc-shell-head__note">
            New station, step {step} of {steps.length}
          </span>
          <ShellHeadEnd>
            <Button size="sm" onClick={onFinishLater}>
              Save and finish later
            </Button>
          </ShellHeadEnd>
        </ShellHead>
      }
      rail={<ShellSteps steps={[...steps]} current={step} hint={hint} label="Setup" />}
    >
      {children}
    </ShellFrame>
  );
}
