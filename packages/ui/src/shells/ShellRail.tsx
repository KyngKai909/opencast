import { useId, type MouseEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

/** Where a navigation item goes: a link, a handler, or both (a router link calls preventDefault). */
export interface ShellLink {
  /** The page's URL. With it the item is a link. */
  href?: string;
  /** Called on click. Without an href the item is a button. */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/** One item in a shell's rail. */
export interface ShellNavItem extends ShellLink {
  /** Stable id, the page it opens ("monitor", "spots"). */
  id: string;
  /** The words on the rail. */
  label: string;
  /** A count or amount at the end of the row, in mono ("7", "3:30", "$227"). */
  count?: ReactNode;
  /** What the count means, for screen readers ("3:30 of breaks unfilled"). */
  countLabel?: string;
  /** Amber count: something needs attention (standby amber). */
  warn?: boolean;
  /** Present when the item can't be opened, saying why (a host's rail). Shown as its tooltip. */
  disabled?: string;
}

/** A labelled group of rail items ("On air", "Money"). */
export interface ShellNavGroup {
  label: string;
  items: ShellNavItem[];
}

/** Per-page extras a shell takes on top of its fixed rail: links, counts, warnings, disabled reasons. */
export type ShellItems<P extends string> = Partial<Record<P, Omit<ShellNavItem, "id" | "label">>>;

/** A shell's fixed rail, as ids and labels. */
export type ShellRailSpec<P extends string> = ReadonlyArray<{ label: string; items: ReadonlyArray<{ id: P; label: string }> }>;

/** Fills a fixed rail with the app's links, counts and disabled reasons. */
export function buildRail<P extends string>(spec: ShellRailSpec<P>, items?: ShellItems<P>, linkTo?: (page: P) => string): ShellNavGroup[] {
  return spec.map((g) => ({
    label: g.label,
    items: g.items.map((it) => ({ href: linkTo?.(it.id), ...items?.[it.id], id: it.id, label: it.label }))
  }));
}

export interface ShellRailProps {
  groups: ShellNavGroup[];
  /** The id of the page on screen. */
  active?: string | null;
  /** The rail's name for screen readers. */
  label?: string;
  className?: string;
}

/** The 200px rail of master control, the business app and the desk: grouped pages with counts, the active one raised. */
export function ShellRail({ groups, active, label, className }: ShellRailProps) {
  const base = useId();
  return (
    <nav className={cx("oc-shell-rail", className)} aria-label={label}>
      {groups.map((g, gi) => (
        <div key={g.label} className="oc-shell-rail__group" role="group" aria-labelledby={`${base}-${gi}`}>
          <div className="oc-shell-rail__label" id={`${base}-${gi}`}>
            {g.label}
          </div>
          {g.items.map((it) => (
            <RailItem key={it.id} item={it} active={it.id === active} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function RailItem({ item, active }: { item: ShellNavItem; active: boolean }) {
  const body = (
    <>
      {item.label}
      {item.count !== undefined && item.count !== null && (
        <span className={cx("oc-shell-rail__count", item.warn && "oc-shell-rail__count--warn")}>
          {item.count}
          {item.countLabel && <span className="oc-sr-only">, {item.countLabel}</span>}
        </span>
      )}
      {item.disabled && <Icon name="lock" size={13} className="oc-shell-rail__lock" />}
    </>
  );
  const classes = cx("oc-shell-rail__item", active && "oc-shell-rail__item--on", item.disabled && "oc-shell-rail__item--disabled");
  if (item.disabled) {
    // Not a link: it can't be opened. It stays focusable so its reason (the title, read as its
    // description) reaches keyboard and screen-reader users too.
    return (
      <span className={classes} role="link" aria-disabled="true" tabIndex={0} title={item.disabled}>
        {body}
      </span>
    );
  }
  if (item.href !== undefined) {
    return (
      <a className={classes} href={item.href} onClick={item.onClick} aria-current={active ? "page" : undefined}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" className={classes} onClick={item.onClick} aria-current={active ? "page" : undefined}>
      {body}
    </button>
  );
}
