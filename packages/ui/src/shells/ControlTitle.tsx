import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ControlTitleProps {
  /** The page's name ("Monitor", "Breaks tonight"). */
  title: ReactNode;
  /** One line under it ("On air since 6:00 pm. Break in 1:48."). */
  description?: ReactNode;
  /** Buttons at the right, level with the title's baseline. */
  end?: ReactNode;
  /** The heading level. The page title is the page's first heading, so h1 by default. */
  as?: "h1" | "h2";
  className?: string;
}

/** The page title block of master control, business and desk pages (shared-mid .mc-title). */
export function ControlTitle({ title, description, end, as: H = "h1", className }: ControlTitleProps) {
  return (
    <div className={cx("oc-control-title", className)}>
      <div className="oc-control-title__text">
        <H className="oc-control-title__h">{title}</H>
        {description && <p className="oc-control-title__p">{description}</p>}
      </div>
      {end && <div className="oc-control-title__end">{end}</div>}
    </div>
  );
}
