// The frame master control, the studio, the business app and the desk share: a 56px header with
// the lockup and the app's name, a 200px rail, and the main area. Internal: the shells use it.

import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Lockup } from "../icons/Icon";

export interface ShellFrameProps {
  /** The header (a ShellHead). */
  head: ReactNode;
  /** The rail (a ShellRail or ShellSteps). */
  rail: ReactNode;
  /** No padding in the main area, for layouts that fill it (settings). */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Header, rail and main, filling its container. */
export function ShellFrame({ head, rail, flush, children, className }: ShellFrameProps) {
  return (
    <div className={cx("oc-shell", className)}>
      {head}
      <div className="oc-shell__body">
        {rail}
        <main className={cx("oc-shell__main", flush && "oc-shell__main--flush")}>{children}</main>
      </div>
    </div>
  );
}

export interface ShellHeadProps {
  /** The app's name beside the lockup ("Master control", "For business", "Network desk"). */
  app: string;
  /** control: on the ground, 18px gaps. business: raised, 16px gaps. desk: raised, 18px gaps. */
  variant?: "control" | "business" | "desk";
  /** A link for the lockup (the app's home). */
  homeHref?: string;
  children?: ReactNode;
  className?: string;
}

/** The header: lockup, a divider and the app's name, then the shell's own parts. */
export function ShellHead({ app, variant = "control", homeHref, children, className }: ShellHeadProps) {
  const lockup = <Lockup size="phone" />;
  return (
    <header className={cx("oc-shell-head", `oc-shell-head--${variant}`, className)}>
      <span className="oc-shell-head__lock">
        {homeHref ? (
          <a className="oc-shell-head__home" href={homeHref}>
            {lockup}
          </a>
        ) : (
          lockup
        )}
        <span className="oc-shell-head__div" aria-hidden="true" />
        <b className="oc-shell-head__app">{app}</b>
      </span>
      {children}
    </header>
  );
}

/** The part of a header pushed to the right (shared-mid .mc-end, .biz-head .end, .nd-head .end). */
export function ShellHeadEnd({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cx("oc-shell-head__end", className)}>{children}</div>;
}
