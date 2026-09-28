// The avatar circle in the shells' headers (core .avatar). Internal: the primitives' Avatar is the
// general one; this is the header's, so the shells don't depend on it.

import { cx } from "../lib/cx";
import type { ShellLink } from "./ShellRail";

export interface ShellAvatarProps extends ShellLink {
  /** Two letters ("KM"). */
  initials: string;
  /** The person's name, for screen readers ("Kai M."). */
  name: string;
  /** Ringed in ink: the person's own page (You) is on screen. */
  current?: boolean;
  className?: string;
}

/** A 34px initials circle; a link or button when it goes somewhere. */
export function ShellAvatar({ initials, name, current, href, onClick, className }: ShellAvatarProps) {
  const classes = cx("oc-shell-avatar", current && "oc-shell-avatar--current", className);
  const face = <span aria-hidden="true">{initials}</span>;
  if (href !== undefined)
    return (
      <a className={classes} href={href} onClick={onClick} aria-label={name} aria-current={current ? "page" : undefined}>
        {face}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className={classes} onClick={onClick} aria-label={name}>
        {face}
      </button>
    );
  return (
    <span className={classes} role="img" aria-label={name}>
      {face}
    </span>
  );
}
