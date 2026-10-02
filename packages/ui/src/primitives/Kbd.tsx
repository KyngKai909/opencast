import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface KbdProps {
  /** The key: "/", "Esc", "1". */
  children: ReactNode;
  /** app: the small key in the search box. tv: the ten-foot key in TV hints ("OK", "Back"). */
  size?: "app" | "tv";
  className?: string;
}

/** A key on the keyboard or the remote, as a small outlined sign. */
export function Kbd({ children, size = "app", className }: KbdProps) {
  return <kbd className={cx("oc-kbd", size === "tv" && "oc-kbd--tv", className)}>{children}</kbd>;
}
