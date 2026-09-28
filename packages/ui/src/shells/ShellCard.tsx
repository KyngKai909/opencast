// The small title card in the players (core .tc): the station's colour with the program's name.
// Internal to the shells, so the players don't depend on the broadcast group's TitleCard.

import type { CSSProperties } from "react";
import { cx } from "../lib/cx";

export interface ShellCardProps {
  /** The station's colour (#rrggbb). It carries white text, so it must hold 4.5:1. */
  colour: string;
  /** The words on the card: the program's name, or the frequency on radio. */
  text: string;
  className?: string;
}

/** A 16:9 card in the station's colour, decorative next to the title it repeats. */
export function ShellCard({ colour, text, className }: ShellCardProps) {
  return (
    <div className={cx("oc-shell-card", className)} style={{ "--oc-station": colour } as CSSProperties} aria-hidden="true">
      <span className="oc-shell-card__t">{text}</span>
    </div>
  );
}
