import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { stationColourPasses } from "../lib/contrast";
import { IconButton } from "../primitives/Button";
import { stationStyle } from "./time";

export type StationBandVariant =
  | "modal"   /* the station preview's header (.stn-band) */
  | "page"    /* the station page's header (.st-band), with actions */
  | "phone";  /* the station page on the phone (.ph-band) */

export interface StationBandProps {
  /** "12.1", or "88.4" on the radio band. */
  channel: string;
  callSign: string;
  /** The station colour. It must hold 4.5:1 against white; a failing colour is marked data-contrast="fails". */
  colour: string;
  /** The name line: "Inland Civic", or the page's one-line description. */
  name?: ReactNode;
  /** A second line under the name in the modal: "Redlands, Inland Empire". */
  place?: ReactNode;
  variant?: StationBandVariant;
  /** The page's buttons (white and outline, so they pass on any station colour). */
  actions?: ReactNode;
  /** Shows the white close button (modal). */
  onClose?: () => void;
  /** Rounded corners, as the setup preview's station card draws it. */
  rounded?: boolean;
  className?: string;
}

/** The station's colour with its channel and call sign in white, like the station's own ID card. */
export function StationBand({ channel, callSign, colour, name, place, variant = "modal", actions, onClose, rounded, className }: StationBandProps) {
  const passes = stationColourPasses(colour);
  const classes = cx("oc-band", `oc-band--${variant}`, rounded && "oc-band--rounded", className);
  const common = { className: classes, style: stationStyle(colour), "data-contrast": passes ? undefined : "fails" };
  if (variant === "phone") {
    return (
      <div {...common}>
        <div>
          <span className="oc-band__ch oc-ch">{channel}</span>
          <span className="oc-band__cs oc-cs">{callSign}</span>
        </div>
        {name != null && <div className="oc-band__nm">{name}</div>}
      </div>
    );
  }
  if (variant === "page") {
    return (
      <div {...common}>
        <span className="oc-band__ch oc-ch">{channel}</span>
        <span className="oc-band__cs oc-cs">{callSign}</span>
        {actions ? <div className="oc-band__acts">{actions}</div> : <span />}
        {name != null && <span className="oc-band__nm">{name}</span>}
      </div>
    );
  }
  return (
    <div {...common}>
      <span className="oc-band__ch oc-ch">{channel}</span>
      <span className="oc-band__cs oc-cs">{callSign}</span>
      {(name != null || place != null) && (
        <span className="oc-band__nm">
          {name}
          {name != null && place != null && <br />}
          {place}
        </span>
      )}
      {onClose && <IconButton icon="x" label="Close" className="oc-band__x" onClick={onClose} />}
    </div>
  );
}
