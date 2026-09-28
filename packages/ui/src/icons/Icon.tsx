import { cx } from "../lib/cx";
import { ICONS, MARKS, type IconName } from "./glyphs";

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
      dangerouslySetInnerHTML={{ __html: g.body }}
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
      dangerouslySetInnerHTML={{ __html: g.body }}
    />
  );
}

/** The lockup: the mark and "opencast", as in every app header. */
export function Lockup({ size = "app", className }: { size?: "app" | "phone" | "site" | "hero"; className?: string }) {
  return (
    <span className={cx("oc-lockup", `oc-lockup--${size}`, className)} aria-label="Opencast">
      <Mark variant="outline" />
      <span aria-hidden="true">opencast</span>
    </span>
  );
}
