import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Tally, type TallyState } from "../primitives/Tally";

export interface ControlPhoneShellProps {
  /** The station: channel ("12.1") and call sign ("BEAT"). */
  station: { channel: string; callSign: string };
  /** The quiet line after the call sign: "Master control", "Go live", "24:10 in". */
  context?: ReactNode;
  /** The tally at the right: lit on air, standby before a live block, unlit off air. */
  tally: TallyState;
  /** Play the tally's switch-on when it lights. False where it's already known to be lit (a remount). */
  flicker?: boolean;
  /** Opens the station switcher sheet (tapping the call sign). */
  onSwitchStation?: () => void;
  /** The actions pinned under the page (Cue a break, Sign off: both ghost). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Master control on the phone: the top bar (channel, call sign, context, tally), the scrolling page, and pinned actions. */
export function ControlPhoneShell({ station, context = "Master control", tally, flicker, onSwitchStation, actions, children, className }: ControlPhoneShellProps) {
  const ident = (
    <>
      <span className="oc-control-phone__ch oc-ch">{station.channel}</span>
      <span className="oc-control-phone__cs oc-cs">{station.callSign}</span>
    </>
  );
  return (
    <div className={cx("oc-control-phone", className)}>
      <header className="oc-control-phone__top">
        {onSwitchStation ? (
          <button type="button" className="oc-control-phone__switch" onClick={onSwitchStation} aria-haspopup="dialog" title="Switch station">
            {ident}
          </button>
        ) : (
          ident
        )}
        {context && <span className="oc-control-phone__context">{context}</span>}
        <Tally state={tally} flicker={flicker} className="oc-control-phone__tally" />
      </header>
      <main className="oc-control-phone__main">{children}</main>
      {actions && <div className="oc-control-phone__actions">{actions}</div>}
    </div>
  );
}
