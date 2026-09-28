import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

export interface PhoneBackBarProps {
  /** The screen's name ("Notifications", "Check your email"). */
  title: ReactNode;
  /** Goes back. Without it (and without backHref) there's no arrow: a top-level screen. */
  onBack?: () => void;
  /** Goes back by link. */
  backHref?: string;
  /** Something at the right end (a quiet word, a button). */
  end?: ReactNode;
  className?: string;
}

/** The phone's back bar in place of the top bar: a back arrow and the screen's name, ruled underneath (shared-mid .p-back). */
export function PhoneBackBar({ title, onBack, backHref, end, className }: PhoneBackBarProps) {
  const hasBack = onBack !== undefined || backHref !== undefined;
  return (
    <header className={cx("oc-phone-back", !hasBack && "oc-phone-back--top", className)}>
      {backHref !== undefined ? (
        <a className="oc-icon-btn oc-icon-btn--bare" href={backHref} onClick={onBack} aria-label="Back" title="Back">
          <Icon name="back2" />
        </a>
      ) : onBack ? (
        <button type="button" className="oc-icon-btn oc-icon-btn--bare" onClick={onBack} aria-label="Back" title="Back">
          <Icon name="back2" />
        </button>
      ) : null}
      <h1 className="oc-phone-back__title">{title}</h1>
      {end && <div className="oc-phone-back__end">{end}</div>}
    </header>
  );
}
