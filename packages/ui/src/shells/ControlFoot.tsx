import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ControlFootProps {
  /** The quiet line at the left ("Saved as you go"). */
  note?: ReactNode;
  /** The buttons at the right (Back, Continue to library). */
  children?: ReactNode;
  className?: string;
}

/** The footer under a page's content: a rule, a quiet note, and the page's next step (shared-mid .mc-foot). */
export function ControlFoot({ note, children, className }: ControlFootProps) {
  return (
    <div className={cx("oc-control-foot", className)}>
      {note && <span className="oc-control-foot__note">{note}</span>}
      {children && <div className="oc-control-foot__end">{children}</div>}
    </div>
  );
}
