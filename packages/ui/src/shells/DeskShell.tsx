import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { ShellFrame, ShellHead, ShellHeadEnd } from "./ShellFrame";
import { ShellRail, buildRail, type ShellItems, type ShellRailSpec } from "./ShellRail";
import { ShellAvatar } from "./ShellAvatar";

/** The Network desk's pages, in rail order. */
export type DeskPage =
  | "analytics"
  | "market-board"
  | "creator-pipeline"
  | "listed-sources"
  | "catalog"
  | "held-earnings"
  | "rights-claims"
  | "reserved-call-signs"
  | "catalog-sponsors"
  | "settings";

/** The desk's rail (network-desk 01.1). */
export const DESK_RAIL = [
  // A251 (2026-10-06): Analytics first, under Network (Ref. 12d).
  {
    label: "Network",
    items: [{ id: "analytics", label: "Analytics" }]
  },
  {
    label: "Markets",
    items: [
      { id: "market-board", label: "Market board" },
      { id: "creator-pipeline", label: "Creator pipeline" },
      { id: "listed-sources", label: "External sources" },
      { id: "catalog", label: "Catalog" }
    ]
  },
  {
    label: "Stations",
    items: [
      { id: "held-earnings", label: "Held earnings" },
      { id: "rights-claims", label: "Rights claims" },
      { id: "reserved-call-signs", label: "Reserved call signs" }
    ]
  },
  {
    label: "Opencast",
    items: [
      { id: "catalog-sponsors", label: "Catalog sponsors" },
      { id: "settings", label: "Settings" }
    ]
  }
] as const satisfies ShellRailSpec<DeskPage>;

export interface DeskShellProps {
  /** The Opencast team member signed in. */
  user: { initials: string; name: string; href?: string; onClick?: () => void };
  /** The page on screen. */
  active: DeskPage;
  /** Per page: href or onClick, count (mono: "4", "$227"), warn, disabled. */
  items?: ShellItems<DeskPage>;
  /** Builds each page's href, when items don't give one. */
  linkTo?: (page: DeskPage) => string;
  /** Main area without padding. */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
}

/** The Network desk: raised header with the amber Internal sign, "Opencast team" and avatar; the rail with mono counts; main. */
export function DeskShell({ user, active, items, linkTo, flush, children, className }: DeskShellProps) {
  return (
    <ShellFrame
      className={cx("oc-desk-shell", className)}
      flush={flush}
      head={
        <ShellHead app="Network desk" variant="desk">
          <span className="oc-desk-shell__internal">Internal</span>
          <ShellHeadEnd>
            <span className="oc-shell-head__note">Opencast team</span>
            <ShellAvatar {...user} />
          </ShellHeadEnd>
        </ShellHead>
      }
      rail={<ShellRail groups={buildRail(DESK_RAIL, items, linkTo)} active={active} label="Network desk" />}
    >
      {children}
    </ShellFrame>
  );
}
