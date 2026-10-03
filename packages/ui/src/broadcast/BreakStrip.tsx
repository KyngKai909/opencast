import { cx } from "../lib/cx";
import { duration } from "../lib/format";

/**
 * A246: what fills a break, by kind (the schedule reference's seven colours, as tokens): the
 * station's bumpers, spots, the maker's barter time, the thank-you credit, the station ID, open
 * time and up next.
 */
export type BreakKind = "bumper" | "spots" | "barter" | "credit" | "id" | "open" | "upnext";

/** Each kind in words, as the strip's labels and its picture's name read. */
export const BREAK_KIND_WORDS: Record<BreakKind, string> = {
  bumper: "Bumper",
  spots: "Spots",
  barter: "Barter",
  credit: "Credit",
  id: "ID",
  open: "Open",
  upnext: "Up next"
};

export interface BreakStripPart {
  kind: BreakKind;
  /** Milliseconds. */
  length: number;
  /** The words on the part (strip only): "REEL's barter", "0:30 open". Left out, none. */
  label?: string;
}

export interface BreakStripProps {
  /** The break, part by part, in air order, drawn to length. */
  parts: BreakStripPart[];
  /** strip: the pane's 40px strip with words. bar: the rundown row's thin fill bar. */
  variant?: "strip" | "bar";
  /** The picture's name; left out, each part's kind and length ("Bumper :05, Open :30"). */
  label?: string;
  className?: string;
}

/** The class that colours a kind: the strip's parts, and a list's swatches beside them. */
export function breakKindClass(kind: BreakKind): string {
  return `oc-brk--${kind}`;
}

/** A break drawn to length by what fills it (A246; the schedule reference's .strip and .bfill). */
export function BreakStrip({ parts, variant = "strip", label, className }: BreakStripProps) {
  const shown = parts.filter((p) => p.length > 0);
  const words = label ?? shown.map((p) => `${BREAK_KIND_WORDS[p.kind]} ${duration(p.length)}`).join(", ");
  return (
    <div className={cx("oc-brkstrip", variant === "bar" && "oc-brkstrip--bar", className)} role="img" aria-label={words}>
      {shown.map((p, i) => (
        <span key={i} className={breakKindClass(p.kind)} style={{ flex: p.length }}>
          {variant === "strip" ? p.label : null}
        </span>
      ))}
    </div>
  );
}
