import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Bug } from "./Bug";
import { LowerThird } from "./LowerThird";

export interface PictureFrameProps {
  /** The picture: a <video>, an <img>, or a PicturePlaceholder. It fills the frame. */
  children?: ReactNode;
  /** The station's bug, bottom right: whoever is airing it, not whoever made it. */
  bug?: { callSign: string; channel: string };
  /** The lower third: who is speaking. */
  lowerThird?: { name: ReactNode; title?: ReactNode };
  /** Top left, on the picture: tags such as Live or "Preview, muted" (use Tag with onPicture). */
  corner?: ReactNode;
  /** Top right, on the picture: a tally on a monitor, a close button. */
  topRight?: ReactNode;
  /** Square corners, for a picture that runs edge to edge (the phone's full player). */
  square?: boolean;
  /** Fill the parent instead of keeping 16:9 (full-screen TV). */
  fill?: boolean;
  /** Ten-foot sizes for the bug and lower third (TV mode). */
  tv?: boolean;
  /** What the picture is, for screen readers, when the picture itself can't say. */
  label?: string;
  className?: string;
}

/**
 * The picture: the only box in Opencast. Bug and lower third are sized in container units, so
 * they scale with the frame the way they do on air.
 */
export function PictureFrame({ children, bug, lowerThird, corner, topRight, square, fill, tv, label, className }: PictureFrameProps) {
  return (
    <div
      className={cx("oc-pic", square && "oc-pic--square", fill && "oc-pic--fill", tv && "oc-pic--tv", className)}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children != null && <div className="oc-pic__picture">{children}</div>}
      {corner != null && <div className="oc-pic__corner">{corner}</div>}
      {topRight != null && <div className="oc-pic__tr">{topRight}</div>}
      {lowerThird && <LowerThird name={lowerThird.name} title={lowerThird.title} />}
      {bug && <Bug callSign={bug.callSign} channel={bug.channel} />}
    </div>
  );
}
