import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface DialProps {
  /** DialRows, in channel order: the same order every time. */
  children: ReactNode;
  /** Show the web dial's column heads (Ch., Station, On now, Next). */
  header?: boolean;
  /** What the list is, for screen readers: "Inland Empire, TV band". */
  label?: string;
  className?: string;
}

/** The web dial's column heads (.dial-h). */
export function DialHeader({ className }: { className?: string }) {
  return (
    <div className={cx("oc-dial-h", className)} aria-hidden="true">
      <span />
      <span>Ch.</span>
      <span>Station</span>
      <span>On now</span>
      <span>Next</span>
    </div>
  );
}

/** The dial: a ruled list of DialRows under a line, with the column heads on the web. */
export function Dial({ children, header, label, className }: DialProps) {
  return (
    <div className={className}>
      {header && <DialHeader />}
      <div className={cx("oc-dial")} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
