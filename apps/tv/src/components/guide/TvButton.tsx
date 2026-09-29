// A ten-foot button (opencast-tv.css .tv-btn): 78px tall, 30px words, a detail on the right. OK
// presses the focused one; a pointer click works too.

import { cx } from "@opencast/ui";
import { useTvFocusable } from "../../tv/focus";
import "./TvButton.css";

export interface TvButtonProps {
  focusKey: string;
  label: string;
  detail?: string | null;
  primary?: boolean;
  onSelect: () => void;
  /** Busy: OK does nothing until it's done. */
  busy?: boolean;
}

export function TvButton({ focusKey, label, detail, primary, onSelect, busy }: TvButtonProps) {
  const run = () => {
    if (!busy) onSelect();
  };
  const { ref, focused } = useTvFocusable<HTMLButtonElement>({ focusKey, onSelect: run });
  return (
    <button ref={ref} type="button" tabIndex={-1} aria-busy={busy || undefined} className={cx("tvg-btn", primary && "tvg-btn--primary", focused && "tv-focus")} onClick={run}>
      <span>{label}</span>
      {detail && <small>{detail}</small>}
    </button>
  );
}
