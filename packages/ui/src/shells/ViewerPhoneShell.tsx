import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, Lockup } from "../icons/Icon";
import type { IconName } from "../icons/glyphs";
import { IconButton } from "../primitives/Button";
import type { ShellLink } from "./ShellRail";
import { MarketButton } from "./MarketButton";
import { PhoneBackBar } from "./PhoneBackBar";

/** The phone's four tabs. */
export type ViewerTab = "dial" | "guide" | "search" | "you";

/** The tabs, in order, with their icons (home 02.1; swipe home 02: the first is Watch, the picture). */
export const VIEWER_TABS: ReadonlyArray<{ id: ViewerTab; label: string; icon: IconName }> = [
  { id: "dial", label: "Watch", icon: "dial" },
  { id: "guide", label: "Guide", icon: "guide" },
  { id: "search", label: "Search", icon: "search" },
  { id: "you", label: "You", icon: "user" }
];

export interface ViewerPhoneShellProps {
  /** The tab that's selected. The radio band keeps Dial selected. */
  tab?: ViewerTab | null;
  /** Per tab: href or onClick. */
  links?: Partial<Record<ViewerTab, ShellLink>>;
  /** Builds each tab's href, when links don't give one. */
  linkTo?: (tab: ViewerTab) => string;
  /** Shows the four tabs. Screens with a back bar (a settings section, sign-in) hide them. */
  tabs?: boolean;
  /** The market in the top bar. */
  market?: { name: string; onClick?: () => void };
  /** Shows the search button in the top bar. */
  onSearch?: () => void;
  /** The back-bar variant: a back arrow and the screen's name in place of the top bar. */
  back?: { title: ReactNode; onBack?: () => void; href?: string };
  /** Replaces the top bar entirely (the full player's own bar). */
  top?: ReactNode;
  /** The mini player (a MiniPlayer), above the tabs. */
  player?: ReactNode;
  /** Pads the page as the frames do (4px 18px 24px). */
  padded?: boolean;
  /**
   * The swipe home's floating bar (A245; swipe home 08, "Floating bar"): the four tabs in a pill on
   * the left and the round Tune button on its own at the right, over the page, 14 px from the edges
   * and 22 px above the home indicator. The mini player sits above it.
   */
  floating?: boolean;
  /** Floating: the page is the picture (full bleed to the very top, under the status bar, and under the bar). */
  onPicture?: boolean;
  /** Floating: the Tune button (opens the number pad). */
  onTune?: () => void;
  /** Floating: the bar fades with the picture's other buttons (landscape, after 3 seconds). */
  barHidden?: boolean;
  /** Floating: no bar at all (a phone on its side: the tabs go away). */
  noBar?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * The viewer app on the phone: top bar (lockup, market, search) or a back bar, the scrolling page,
 * the mini player and the four tabs. The status bar and home indicator are the phone's own.
 */
export function ViewerPhoneShell({ tab = null, links, linkTo, tabs = true, market, onSearch, back, top, player, padded = true, floating, onPicture, onTune, barHidden, noBar, children, className }: ViewerPhoneShellProps) {
  let bar: ReactNode;
  if (top !== undefined) bar = top;
  else if (back) bar = <PhoneBackBar title={back.title} onBack={back.onBack} backHref={back.href} />;
  else
    bar = (
      <header className="oc-viewer-phone__top">
        <Lockup size="phone" />
        {market && <MarketButton name={market.name} onClick={market.onClick} size="phone" className="oc-viewer-phone__market" />}
        {onSearch && <IconButton icon="search" label="Search" bare onClick={onSearch} className={market ? undefined : "oc-viewer-phone__market"} />}
      </header>
    );
  if (floating) {
    const tabLinks = VIEWER_TABS.map((t) => {
      const link = { href: linkTo?.(t.id), ...links?.[t.id] };
      const on = tab === t.id;
      const classes = cx("oc-viewer-phone__ftab", on && "oc-viewer-phone__ftab--on");
      const body = (
        <>
          <Icon name={t.icon} size={19} />
          {t.label}
        </>
      );
      return link.href !== undefined ? (
        <a key={t.id} className={classes} href={link.href} onClick={link.onClick} aria-current={on ? "page" : undefined}>
          {body}
        </a>
      ) : (
        <button key={t.id} type="button" className={classes} onClick={link.onClick} aria-current={on ? "page" : undefined}>
          {body}
        </button>
      );
    });
    const showBar = tabs && !noBar;
    return (
      <div className={cx("oc-viewer-phone", "oc-viewer-phone--floating", onPicture && "oc-viewer-phone--picture", showBar && "oc-viewer-phone--barred", !!player && "oc-viewer-phone--mini", className)}>
        {!onPicture && bar}
        <main className="oc-viewer-phone__main">{padded ? <div className="oc-viewer-phone__pad">{children}</div> : children}</main>
        {player && <div className="oc-viewer-phone__mini">{player}</div>}
        {showBar && (
          // Hidden with the picture's buttons, it stays out of the way of a tap and of screen readers.
          <div className={cx("oc-viewer-phone__float", barHidden && "oc-viewer-phone__float--hidden")} inert={barHidden || undefined}>
            <nav className="oc-viewer-phone__pill" aria-label="Tabs">
              {tabLinks}
            </nav>
            {onTune && (
              <button type="button" className="oc-viewer-phone__tune" onClick={onTune} aria-label="Tune by number" title="Tune by number">
                <Icon name="keypad" size={22} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cx("oc-viewer-phone", className)}>
      {bar}
      <main className="oc-viewer-phone__main">{padded ? <div className="oc-viewer-phone__pad">{children}</div> : children}</main>
      {player}
      {tabs && (
        <nav className="oc-viewer-phone__tabs">
          {VIEWER_TABS.map((t) => {
            const link = { href: linkTo?.(t.id), ...links?.[t.id] };
            const on = tab === t.id;
            const classes = cx("oc-viewer-phone__tab", on && "oc-viewer-phone__tab--on");
            const body = (
              <>
                <Icon name={t.icon} size={22} />
                {t.label}
              </>
            );
            return link.href !== undefined ? (
              <a key={t.id} className={classes} href={link.href} onClick={link.onClick} aria-current={on ? "page" : undefined}>
                {body}
              </a>
            ) : (
              <button key={t.id} type="button" className={classes} onClick={link.onClick} aria-current={on ? "page" : undefined}>
                {body}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
