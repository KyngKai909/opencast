import { cx } from "../lib/cx";

export interface BugProps {
  /** The airing station's call sign. */
  callSign: string;
  channel: string;
  className?: string;
}

/**
 * The bug: bottom right on the picture, the station you're watching, in the station's own
 * graphics. Place it inside a PictureFrame (it sizes itself in the frame's container units).
 */
export function Bug({ callSign, channel, className }: BugProps) {
  return (
    <div className={cx("oc-bug", className)} aria-hidden="true">
      <span className="oc-bug__cs oc-cs">{callSign}</span>
      <span className="oc-bug__ch oc-ch">{channel}</span>
    </div>
  );
}
