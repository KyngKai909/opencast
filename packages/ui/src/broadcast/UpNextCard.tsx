import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface UpNextCardProps {
  /** "Up next", or "Next at 9:00 pm" (in the market's time zone). */
  kicker: ReactNode;
  /** The next program's title, as the guide has it: "Saturday Reel". */
  title: ReactNode;
  /** A second line: the episode title, or (later) the block it's in. */
  detail?: ReactNode;
  className?: string;
}

/**
 * A243: the title over an up-next bumper, drawn by the player (never burned in), in the lower
 * third's place and safe area. Place it inside a PictureFrame (or the player's overlays).
 */
export function UpNextCard({ kicker, title, detail, className }: UpNextCardProps) {
  return (
    <div className={cx("oc-upnext", className)} role="note" aria-label={[kicker, title, detail].filter((x) => typeof x === "string").join(", ") || undefined}>
      <span className="oc-upnext__k">{kicker}</span>
      <br />
      <span className="oc-upnext__t">{title}</span>
      {detail != null && (
        <>
          <br />
          <span className="oc-upnext__d">{detail}</span>
        </>
      )}
    </div>
  );
}
