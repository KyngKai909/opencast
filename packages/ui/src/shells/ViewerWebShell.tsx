import { useEffect, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, Lockup } from "../icons/Icon";
import { Button } from "../primitives/Button";
import type { ShellLink } from "./ShellRail";
import { ShellAvatar } from "./ShellAvatar";
import { MarketButton } from "./MarketButton";
import { Menu, type MenuItem } from "../primitives/Menu";

/** The viewer's web sections, in nav order. "you" is the avatar's page, with no nav item. */
export type ViewerSection = "dial" | "guide" | "radio" | "presets";

/** The header nav (home 01.1). */
export const VIEWER_NAV: ReadonlyArray<{ id: ViewerSection; label: string }> = [
  { id: "dial", label: "Dial" },
  { id: "guide", label: "Guide" },
  { id: "radio", label: "Radio" },
  { id: "presets", label: "Presets" }
];

/** Whether a key press should open search: "/" outside a text field, with no modifier. */
export function isSearchKey(event: KeyboardEvent): boolean {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return false;
  const t = event.target as HTMLElement | null;
  if (!t || typeof t.closest !== "function") return true;
  return !t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

export interface ViewerWebShellProps {
  /** The section on screen; "you" rings the avatar; null for none (a station page). */
  active?: ViewerSection | "you" | null;
  /** Per section: href or onClick. */
  links?: Partial<Record<ViewerSection, ShellLink>>;
  /** Builds each section's href, when links don't give one. */
  linkTo?: (section: ViewerSection) => string;
  /** The lockup's link (the dial). */
  homeHref?: string;
  /** The market: its name, and what opens the picker. */
  market: { name: string; onClick?: () => void };
  /** Opens search: the search box, and the "/" key from anywhere outside a text field. */
  onSearch?: () => void;
  /**
   * The person signed in. Without it the header shows Sign in. With `menu` (the Opencast app's
   * other areas: "Master control" for people with a station role, "Network desk" for admins), the
   * avatar opens it; otherwise it's a link to their page.
   */
  user?: { initials: string; name: string; href?: string; onClick?: () => void; menu?: ReadonlyArray<MenuItem> };
  /** Where Sign in goes. */
  signIn?: ShellLink;
  /** The player bar (a PlayerBar), pinned under the page. */
  player?: ReactNode;
  /** Pads the page as the frames do (24px 28px 36px). Off for pages that draw to the edges. */
  padded?: boolean;
  children?: ReactNode;
  className?: string;
}

/** The viewer app on the web: header (lockup, nav, search with "/", market, avatar or Sign in), the page, and the player bar. */
export function ViewerWebShell({ active = null, links, linkTo, homeHref, market, onSearch, user, signIn, player, padded = true, children, className }: ViewerWebShellProps) {
  useEffect(() => {
    if (!onSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchKey(e)) return;
      e.preventDefault();
      onSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSearch]);

  return (
    <div className={cx("oc-viewer-web", className)}>
      <header className="oc-viewer-web__head">
        {homeHref !== undefined ? (
          <a className="oc-viewer-web__home" href={homeHref}>
            <Lockup size="app" />
          </a>
        ) : (
          <Lockup size="app" />
        )}
        <nav className="oc-viewer-web__nav">
          {VIEWER_NAV.map((n) => {
            const link = { href: linkTo?.(n.id), ...links?.[n.id] };
            const on = active === n.id;
            const classes = cx("oc-viewer-web__nav-item", on && "oc-viewer-web__nav-item--on");
            return link.href !== undefined ? (
              <a key={n.id} className={classes} href={link.href} onClick={link.onClick} aria-current={on ? "page" : undefined}>
                {n.label}
              </a>
            ) : (
              <button key={n.id} type="button" className={classes} onClick={link.onClick} aria-current={on ? "page" : undefined}>
                {n.label}
              </button>
            );
          })}
        </nav>
        <button type="button" className="oc-viewer-web__search" onClick={onSearch} aria-keyshortcuts="/">
          <Icon name="search" />
          Search stations and programs
          <kbd className="oc-viewer-web__kbd">/</kbd>
        </button>
        <MarketButton name={market.name} onClick={market.onClick} />
        {user?.menu?.length ? (
          <Menu
            items={user.menu}
            label={user.name}
            className="oc-viewer-web__me"
            trigger={{ content: <span aria-hidden="true">{user.initials}</span>, className: cx("oc-shell-avatar", active === "you" && "oc-shell-avatar--current") }}
          />
        ) : user ? (
          <ShellAvatar initials={user.initials} name={user.name} href={user.href} onClick={user.onClick} current={active === "you"} />
        ) : signIn?.href !== undefined ? (
          <Button size="sm" href={signIn.href} onClick={signIn.onClick}>
            Sign in
          </Button>
        ) : (
          <Button size="sm" onClick={signIn?.onClick}>
            Sign in
          </Button>
        )}
      </header>
      <main className="oc-viewer-web__main">{padded ? <div className="oc-viewer-web__pad">{children}</div> : children}</main>
      {player}
    </div>
  );
}
