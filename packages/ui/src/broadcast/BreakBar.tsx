import { cx } from "../lib/cx";
import { duration } from "../lib/format";

export type BreakPartKind =
  | "filled"  /* spots, underwriting, ID: sold or scheduled */
  | "added"   /* just added to the rotation: standby amber */
  | "barter"  /* another station's time under barter: hatched, can't be sold */
  | "open";   /* open: airs the station ID and bumpers */

export interface BreakPart {
  kind: BreakPartKind;
  /** Milliseconds. */
  length: number;
}

export interface BreakBarProps {
  /** The break, part by part, drawn to length. */
  parts: BreakPart[];
  /** Whose barter time it is, for the words: "REEL". */
  barterOwner?: string;
  className?: string;
}

/** The words for each part, as the legend says them. */
export function breakPartWords(kind: BreakPartKind, barterOwner?: string): string {
  if (kind === "filled") return "Filled";
  if (kind === "added") return "Just added";
  if (kind === "open") return "Open";
  return barterOwner ? `${barterOwner}'s, under barter` : "Under barter";
}

/** A break drawn to length: filled, just added, someone else's barter time and open (master control C1, C3). */
export function BreakBar({ parts, barterOwner, className }: BreakBarProps) {
  const total = parts.reduce((a, p) => a + p.length, 0) || 1;
  const words = parts.map((p) => `${breakPartWords(p.kind, barterOwner)} ${duration(p.length)}`).join(", ");
  return (
    <div className={cx("oc-brkbar", className)} role="img" aria-label={words}>
      {parts.map((p, i) => (
        <i key={i} className={`oc-brkbar__${p.kind}`} style={{ width: `${(p.length / total) * 100}%` }} />
      ))}
    </div>
  );
}
