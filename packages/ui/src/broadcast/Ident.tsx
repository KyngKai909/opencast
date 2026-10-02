import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { stationStyle } from "./time";

export type IdentVariant =
  | "guide"     /* the style guide's ident: channel, call sign, name */
  | "block"     /* the tuned-in rail (.stn-block) */
  | "block-sm"  /* the phone's full player */
  | "inline"    /* master control on the phone (.pm-top): "12.1 BEAT" on one line */
  | "switch";   /* the station switcher's contents: colour, channel, call sign */

export interface IdentProps {
  /** Where it sits on the dial: "12.1", or a frequency on the radio band, "88.4". */
  channel: string;
  /** Who it is: "BEAT". */
  callSign: string;
  /** The station's name, and anything after it ("Inland Beat, Redlands"). Not shown inline or in the switch. */
  name?: ReactNode;
  /** The station colour, for the switch's swatch. */
  colour?: string;
  variant?: IdentVariant;
  className?: string;
}

/** Channel number, call sign and name, always in that order (style guide, Station ident). */
export function Ident({ channel, callSign, name, colour, variant = "guide", className }: IdentProps) {
  const showName = name != null && variant !== "inline" && variant !== "switch";
  return (
    <span className={cx("oc-ident", `oc-ident--${variant}`, className)} style={variant === "switch" ? stationStyle(colour) : undefined}>
      {variant === "switch" && <span className="oc-ident__sw" aria-hidden="true" />}
      <span className="oc-ident__ch oc-ch">{channel}</span>
      <span className="oc-ident__cs oc-cs">{callSign}</span>
      {showName && <span className="oc-ident__nm">{name}</span>}
    </span>
  );
}
