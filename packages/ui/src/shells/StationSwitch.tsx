// The station switcher in master control's header (shared-mid .stn-switch): the station's colour,
// channel and call sign, or a studio's name and "Studio". Internal to the control shells.

import type { CSSProperties } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

/** The station master control is running. */
export interface ControlStation {
  /** "12.1" (use channel() from lib/format). */
  channel: string;
  /** "BEAT". */
  callSign: string;
  /** The station's colour (#rrggbb), 4.5:1 against white. */
  colour: string;
}

/** A studio: a station with no channel. */
export interface ControlStudio {
  /** "Inland Sound Lab". */
  name: string;
  /** The studio's colour (#rrggbb). */
  colour: string;
}

export interface StationSwitchProps {
  station?: ControlStation;
  studio?: ControlStudio;
  /** Opens the switcher menu. */
  onClick?: () => void;
  className?: string;
}

export function StationSwitch({ station, studio, onClick, className }: StationSwitchProps) {
  const colour = station?.colour ?? studio?.colour;
  return (
    <button
      type="button"
      className={cx("oc-stn-switch", className)}
      style={{ "--oc-station": colour } as CSSProperties}
      onClick={onClick}
      aria-haspopup="menu"
      title="Switch station"
    >
      <span className="oc-stn-switch__sw" aria-hidden="true" />
      {station ? (
        <>
          <span className="oc-stn-switch__ch oc-ch">{station.channel}</span>
          <span className="oc-stn-switch__cs oc-cs">{station.callSign}</span>
        </>
      ) : (
        <>
          <span className="oc-stn-switch__cs oc-cs">{studio?.name}</span>
          <span className="oc-stn-switch__kind">Studio</span>
        </>
      )}
      <Icon name="down" size={15} />
    </button>
  );
}
