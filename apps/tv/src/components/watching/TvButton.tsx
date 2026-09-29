// A ten-foot button (tv .tv-btn): 78px, 30px type. The primary one is signal-filled and its focus
// ring stands off it (a ground gap, then the ring); the others fill with the raised colour.
// OK presses the focused one; a mouse click works too.

import type { ReactNode } from "react";
import { cx } from "@opencast/ui";
import { useTvFocusable } from "../../tv/focus";
import "./TvButton.css";

export function TvButton({ focusKey, onSelect, variant = "ghost", children, className }: { focusKey: string; onSelect: () => void; variant?: "primary" | "ghost"; children: ReactNode; className?: string }) {
  const { ref, focused } = useTvFocusable<HTMLButtonElement>({ focusKey, onSelect });
  return (
    <button ref={ref} type="button" tabIndex={-1} className={cx("tvw-btn", `tvw-btn--${variant}`, focused && "tv-focus", className)} onClick={onSelect}>
      {children}
    </button>
  );
}
