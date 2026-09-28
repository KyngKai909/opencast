import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";
import { money } from "../lib/format";
import { Icon } from "../icons/Icon";
import { ShellFrame, ShellHead, ShellHeadEnd } from "./ShellFrame";
import { ShellRail, buildRail, type ShellItems, type ShellRailSpec } from "./ShellRail";
import { ShellAvatar } from "./ShellAvatar";

/** The business app's pages, in rail order. */
export type BusinessPage = "spots" | "sponsorships" | "made-for-you" | "where-it-aired" | "balance" | "settings";

/** The business rail (biz-spots 01.1 and every business frame). */
export const BUSINESS_RAIL = [
  {
    label: "Advertising",
    items: [
      { id: "spots", label: "Spots" },
      { id: "sponsorships", label: "Sponsorships" },
      { id: "made-for-you", label: "Made for you" }
    ]
  },
  {
    label: "Results",
    items: [
      { id: "where-it-aired", label: "Where it aired" },
      { id: "balance", label: "Balance" }
    ]
  },
  { label: "Business", items: [{ id: "settings", label: "Settings" }] }
] as const satisfies ShellRailSpec<BusinessPage>;

/** The business on screen. */
export interface ShellBusiness {
  /** "Orange Street Coffee". */
  name: string;
  /** The letters on its logo square ("OSC"). */
  initials: string;
  /** The logo square's colour (#rrggbb), carrying white letters. */
  colour: string;
}

export interface BusinessShellProps {
  business: ShellBusiness;
  /** Opens the business switcher. */
  onSwitchBusiness?: () => void;
  /** The available balance, in micros. Shown as "Available $412.50". */
  available: number;
  /** The person signed in. */
  user: { initials: string; name: string; href?: string; onClick?: () => void };
  /** The page on screen. */
  active: BusinessPage;
  /** Per page: href or onClick, count, warn, disabled. */
  items?: ShellItems<BusinessPage>;
  /** Builds each page's href, when items don't give one. */
  linkTo?: (page: BusinessPage) => string;
  /** Main area without padding (settings). */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Opencast for business: raised header with the business switcher, available balance and avatar; the rail; main. */
export function BusinessShell({ business, onSwitchBusiness, available, user, active, items, linkTo, flush, children, className }: BusinessShellProps) {
  return (
    <ShellFrame
      className={cx("oc-business-shell", className)}
      flush={flush}
      head={
        <ShellHead app="For business" variant="business">
          <button type="button" className="oc-business-shell__switch" onClick={onSwitchBusiness} aria-haspopup="menu" title="Switch business">
            <span className="oc-business-shell__logo" style={{ "--oc-business": business.colour } as CSSProperties} aria-hidden="true">
              {business.initials}
            </span>
            {business.name}
            <Icon name="down" size={15} />
          </button>
          <ShellHeadEnd>
            <span className="oc-business-shell__balance">
              Available <b className="oc-business-shell__amount">{money(available)}</b>
            </span>
            <ShellAvatar {...user} />
          </ShellHeadEnd>
        </ShellHead>
      }
      rail={<ShellRail groups={buildRail(BUSINESS_RAIL, items, linkTo)} active={active} label="For business" />}
    >
      {children}
    </ShellFrame>
  );
}
