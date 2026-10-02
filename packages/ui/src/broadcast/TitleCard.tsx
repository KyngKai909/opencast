import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { stationStyle } from "./time";

export type TitleCardSize =
  | "md"       /* the base card (.tc) */
  | "lg"       /* carried widely, program pages (.tc.lg) */
  | "dial"     /* the web dial row: the program title, up to three lines */
  | "player"   /* the web player bar (84px) */
  | "row"      /* phone dial rows */
  | "mini"     /* the phone's mini player */
  | "library"; /* master control's library rows */

export interface TitleCardProps {
  /** The station colour: the card is drawn in it, with white words. */
  colour: string;
  /** The top line: a program title, a call sign, or a frequency. */
  title: ReactNode;
  /** The bottom line: "From REEL 24.1". */
  bottom?: ReactNode;
  size?: TitleCardSize;
  /** Hide it from screen readers when the row already says the same words. */
  decorative?: boolean;
  className?: string;
}

/** A card in the station's colour standing in for a picture: title at the top, source at the bottom. */
export function TitleCard({ colour, title, bottom, size = "md", decorative, className }: TitleCardProps) {
  return (
    <div className={cx("oc-tc", size !== "md" && `oc-tc--${size}`, className)} style={stationStyle(colour)} aria-hidden={decorative || undefined}>
      <span className="oc-tc__t">{title}</span>
      {bottom != null && <span className="oc-tc__b">{bottom}</span>}
    </div>
  );
}
