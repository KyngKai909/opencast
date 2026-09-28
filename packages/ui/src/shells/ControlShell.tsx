import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, type TimeInput } from "../lib/format";
import { Tally } from "../primitives/Tally";
import { Button } from "../primitives/Button";
import { ShellFrame, ShellHead } from "./ShellFrame";
import { ShellRail, buildRail, type ShellItems, type ShellRailSpec } from "./ShellRail";
import { StationSwitch, type ControlStation } from "./StationSwitch";
import { useNow } from "./useNow";

/** Master control's pages, in rail order. */
export type ControlPage =
  | "monitor"
  | "audience"
  | "program-log"
  | "live-sources"
  | "breaks"
  | "market"
  | "library"
  | "listings"
  | "spot-market"
  | "sponsors"
  | "earnings"
  | "translators"
  | "rights"
  | "settings";

/** The rail is the same on every screen (apps prompt, Phase 4). */
export const CONTROL_RAIL = [
  {
    label: "On air",
    items: [
      { id: "monitor", label: "Monitor" },
      { id: "audience", label: "Audience" },
      { id: "program-log", label: "Program log" },
      { id: "live-sources", label: "Live sources" },
      { id: "breaks", label: "Breaks" }
    ]
  },
  { label: "Market", items: [{ id: "market", label: "Syndication market" }] },
  {
    label: "Programming",
    items: [
      { id: "library", label: "Library" },
      { id: "listings", label: "Listings" }
    ]
  },
  {
    label: "Money",
    items: [
      { id: "spot-market", label: "Spot market" },
      { id: "sponsors", label: "Sponsors" },
      { id: "earnings", label: "Earnings" }
    ]
  },
  {
    label: "Station",
    items: [
      { id: "translators", label: "Translators" },
      { id: "rights", label: "Rights" },
      { id: "settings", label: "Settings" }
    ]
  }
] as const satisfies ShellRailSpec<ControlPage>;

export interface ControlShellProps {
  /** The station on screen, shown in the switcher. */
  station: ControlStation;
  /** Opens the station switcher. */
  onSwitchStation?: () => void;
  /** The page on screen. */
  active: ControlPage;
  /** Per page: href or onClick, count, warn (amber), countLabel, and disabled with the reason (a host's rail). */
  items?: ShellItems<ControlPage>;
  /** Builds each page's href, when items don't give one. */
  linkTo?: (page: ControlPage) => string;
  /** The time for the clock. Leave it out for the live clock, ticking each second. */
  now?: TimeInput;
  /** The station's time zone for the clock. */
  timeZone?: string;
  /** Lights the tally. Only when the station is really going out. */
  onAir: boolean;
  /** Play the tally's switch-on when it lights. False where it's already known to be lit (a remount). */
  flicker?: boolean;
  /** Shows Sign off beside the lit tally. Leave it out for people who can't sign off. */
  onSignOff?: () => void;
  /** Main area without padding (settings, full-bleed pages). */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Master control: header with station switcher, 12-hour clock with seconds, tally and Sign off; the fixed rail; main. */
export function ControlShell({ station, onSwitchStation, active, items, linkTo, now, timeZone, onAir, flicker, onSignOff, flush, children, className }: ControlShellProps) {
  const time = useNow(now);
  const at = time instanceof Date ? time : new Date(time);
  return (
    <ShellFrame
      className={cx("oc-control-shell", className)}
      flush={flush}
      head={
        <ShellHead app="Master control">
          <StationSwitch station={station} onClick={onSwitchStation} />
          <time className="oc-control-shell__clock" dateTime={at.toISOString()}>
            {clock(at, { seconds: true, timeZone })}
          </time>
          <div className="oc-control-shell__end">
            <Tally state={onAir ? "lit" : "unlit"} flicker={flicker} />
            {onAir && onSignOff && (
              <Button size="sm" onClick={onSignOff}>
                Sign off
              </Button>
            )}
          </div>
        </ShellHead>
      }
      rail={<ShellRail groups={buildRail(CONTROL_RAIL, items, linkTo)} active={active} label="Master control" />}
    >
      {children}
    </ShellFrame>
  );
}
