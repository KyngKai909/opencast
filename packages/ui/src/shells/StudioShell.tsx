import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { ShellBackToWatching, ShellFrame, ShellHead, ShellHeadEnd } from "./ShellFrame";
import { ShellRail, buildRail, type ShellItems, type ShellRailSpec } from "./ShellRail";
import { StationSwitch, type ControlStudio } from "./StationSwitch";

/** A studio's pages, in rail order. */
export type StudioPage = "programs" | "library" | "carriers" | "market" | "spot-rotation" | "earnings" | "rights" | "settings";

/** A studio's rail: no on-air pages (market 04.1). */
export const STUDIO_RAIL = [
  {
    label: "Studio",
    items: [
      { id: "programs", label: "Your programs" },
      { id: "library", label: "Library" },
      { id: "carriers", label: "Carriers" },
      { id: "market", label: "Syndication market" }
    ]
  },
  {
    label: "Money",
    items: [
      { id: "spot-rotation", label: "Spot rotation" },
      { id: "earnings", label: "Earnings" }
    ]
  },
  {
    label: "Studio settings",
    items: [
      { id: "rights", label: "Rights" },
      { id: "settings", label: "Settings" }
    ]
  }
] as const satisfies ShellRailSpec<StudioPage>;

export interface StudioShellProps {
  /** The studio on screen, shown in the switcher with "Studio". */
  studio: ControlStudio;
  /** Opens the switcher. */
  onSwitchStation?: () => void;
  /** The page on screen. */
  active: StudioPage;
  /** Per page: href or onClick, count, warn, disabled. */
  items?: ShellItems<StudioPage>;
  /** Builds each page's href, when items don't give one. */
  linkTo?: (page: StudioPage) => string;
  /** Main area without padding. */
  flush?: boolean;
  /** "Back to watching": where the viewer is, in the Opencast app ("/"). Left out, the header has none. */
  watchHref?: string;
  children?: ReactNode;
  className?: string;
}

/** Master control for a studio (a station with no channel): no clock, no tally, no Sign off. */
export function StudioShell({ studio, onSwitchStation, active, items, linkTo, flush, watchHref, children, className }: StudioShellProps) {
  return (
    <ShellFrame
      className={cx("oc-studio-shell", className)}
      flush={flush}
      head={
        <ShellHead app="Master control">
          <StationSwitch studio={studio} onClick={onSwitchStation} />
          <ShellHeadEnd>
            {watchHref !== undefined && <ShellBackToWatching href={watchHref} />}
            <span className="oc-shell-head__note">Studios don’t broadcast</span>
          </ShellHeadEnd>
        </ShellHead>
      }
      rail={<ShellRail groups={buildRail(STUDIO_RAIL, items, linkTo)} active={active} label="Studio" />}
    >
      {children}
    </ShellFrame>
  );
}
