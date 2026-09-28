import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface LowerThirdProps {
  /** Who is speaking: "Dana Whitfield". */
  name: ReactNode;
  /** What they are: "Chair, Planning Commission". */
  title?: ReactNode;
  className?: string;
}

/** The lower third: names who is speaking. Place it inside a PictureFrame. */
export function LowerThird({ name, title, className }: LowerThirdProps) {
  return (
    <div className={cx("oc-l3", className)}>
      <span className="oc-l3__nm">{name}</span>
      {title != null && (
        <>
          <br />
          <span className="oc-l3__tt">{title}</span>
        </>
      )}
    </div>
  );
}
