import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";

export type TallyState = "lit" | "unlit" | "standby";

export interface TallyProps {
  /** Lit only when something is really going out, or really on this screen. */
  state: TallyState;
  /** Where it sits: on the ground (unlit reads ink-50) or on a picture or screen (on-screen-70). */
  on?: "ground" | "picture";
  /** sm: app headers and players (24px). md: the style guide's sign (26px). lg: master control's sign-on (44px). tv: ten feet. */
  size?: "sm" | "md" | "lg" | "tv";
  /** The words. Defaults: "ON AIR", or "STAND BY" on standby. Unlit can say "OFF AIR". */
  children?: string;
  /**
   * Switch on with the single flicker when it first lights. Set false where the sign is already
   * known to be lit (returning to a page), so a remount doesn't replay it.
   */
  flicker?: boolean;
  className?: string;
}

/**
 * The tally light. It's on or it's off: when it lights it switches on once with a single
 * flicker (1.6 s), then holds. It never blinks or pulses. With reduced motion it just appears lit.
 */
export function Tally({ state, on = "ground", size = "sm", children, flicker = true, className }: TallyProps) {
  const lit = state === "lit";
  const wasLit = useRef<boolean | null>(null);
  const [switching, setSwitching] = useState(false);

  useLayoutEffect(() => {
    // Only the unlit → lit transition plays the switch-on; a re-render never replays it.
    if (lit && wasLit.current !== true && flicker) setSwitching(true);
    if (!lit) setSwitching(false);
    wasLit.current = lit;
  }, [lit, flicker]);

  const words = children ?? (state === "standby" ? "STAND BY" : "ON AIR");
  const spoken = state === "lit" ? "On air" : state === "standby" ? "Stand by" : words === "OFF AIR" ? "Off air" : "Not on air";
  return (
    <span
      className={cx(
        "oc-tally",
        `oc-tally--${size}`,
        on === "picture" && "oc-tally--on-picture",
        lit && "oc-tally--lit",
        state === "standby" && "oc-tally--standby",
        switching && "oc-tally--switching",
        className
      )}
      role="img"
      aria-label={spoken}
      onAnimationEnd={() => setSwitching(false)}
    >
      <span aria-hidden="true">{words}</span>
    </span>
  );
}
