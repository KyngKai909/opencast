import { cx } from "../lib/cx";

/** The colour bars: the only decoration a no-picture state gets (style guide, When there's no picture). */
export function ColourBars({ className }: { className?: string }) {
  return (
    <div className={cx("oc-bars", className)} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
