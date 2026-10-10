import { cx } from "../lib/cx";
import { ICONS, MARKS, type Glyph, type IconName } from "./glyphs";

/**
 * Each drawing's markup as one object for good: React 19 writes `dangerouslySetInnerHTML` again
 * whenever the object is new, which would replace the shapes on every render, and a press that
 * starts on a shape that's replaced before it ends is never a click (the swipe home's first tap,
 * which turns the sound on and re-renders, found it).
 */
const INNER = new WeakMap<Glyph, { __html: string }>();
function inner(g: Glyph): { __html: string } {
  let html = INNER.get(g);
  if (!html) INNER.set(g, (html = { __html: g.body }));
  return html;
}

export interface IconProps {
  name: IconName;
  /** Pixel size (square). Defaults to 18, as in the reference apps. */
  size?: number;
  /** A label makes the icon meaningful to screen readers; without one it's decorative. */
  label?: string;
  className?: string;
}

/** An icon from the reference set, drawn in currentColor. */
export function Icon({ name, size = 18, label, className }: IconProps) {
  const g = ICONS[name];
  return (
    <svg
      className={cx("oc-i", className)}
      width={size}
      height={size}
      viewBox={g.viewBox}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={inner(g)}
    />
  );
}

export type MarkVariant = "outline" | "outline-mono" | "solid";

/** The mark: a screen with its tally. Outline from 96px up, solid below (style guide, Mark). */
export function Mark({ variant = "outline", size = 30, label, className }: { variant?: MarkVariant; size?: number; label?: string; className?: string }) {
  const g = variant === "solid" ? MARKS["mk-solid"] : variant === "outline-mono" ? MARKS["mk-outline-mono"] : MARKS["mk-outline"];
  return (
    <svg
      className={cx("oc-mark", className)}
      width={size}
      height={(size * 50) / 62}
      viewBox={g.viewBox}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={inner(g)}
    />
  );
}

/** The lockup: the mark and "opencast", as in every app header. */
export function Lockup({ size = "app", className }: { size?: "app" | "phone" | "site" | "hero"; className?: string }) {
  return (
    <span className={cx("oc-lockup", `oc-lockup--${size}`, className)} role="img" aria-label="Opencast">
      <Mark variant="outline" />
      <span aria-hidden="true">opencast</span>
    </span>
  );
}
