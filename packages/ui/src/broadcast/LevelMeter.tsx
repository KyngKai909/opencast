import { cx } from "../lib/cx";

export interface LevelMeterProps {
  /** Bar heights from 0 to 1, left to right. They move with the sound. */
  levels: number[];
  /** sm: the style guide's no-picture state (22px). md: the phone's radio panel (36px). tv: the TV's radio screen (80px). */
  size?: "sm" | "md" | "tv";
  /** screen: on a dark screen. station: white on a station's colour. */
  on?: "screen" | "station";
  className?: string;
}

/** The level meter: the only moving thing on a radio screen. Decorative; the sound is the content. */
export function LevelMeter({ levels, size = "sm", on = "screen", className }: LevelMeterProps) {
  return (
    <div className={cx("oc-meter", `oc-meter--${size}`, `oc-meter--on-${on}`, className)} aria-hidden="true">
      {levels.map((l, i) => (
        <i key={i} style={{ height: `${Math.round(Math.min(1, Math.max(0, l)) * 100)}%` }} />
      ))}
    </div>
  );
}
