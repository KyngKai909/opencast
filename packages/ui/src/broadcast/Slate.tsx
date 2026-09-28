import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import type { TimeInput } from "../lib/format";
import { Tally } from "../primitives/Tally";
import { ColourBars } from "./ColourBars";
import { LevelMeter } from "./LevelMeter";
import { minutesText, ms } from "./time";

export type SlateKind =
  | "standby"   /* a lost signal: colour bars, "Please stand by" */
  | "off-air"   /* signed off: says when it's back and offers another station */
  | "dead-air"  /* master control only: the log runs out soon; still on air, so the tally stays lit */
  | "radio";    /* the radio band: the frequency is the picture */

export interface SlateProps {
  kind: SlateKind;
  /** The line under the big words: what's happening and when it will change. */
  children?: ReactNode;
  /** Replaces the big words ("Please stand by", "Off air", "Dead air in 12 min", the radio station's name). */
  title?: ReactNode;
  /** Dead air: when the log runs out, and the time now. */
  deadAirAt?: TimeInput;
  now?: TimeInput;
  /** Radio: the frequency, and the station's call sign and name for the big words. */
  frequency?: string;
  callSign?: string;
  name?: string;
  /** Radio: the level meter's bars. */
  levels?: number[];
  /** screen: the style guide's 16:9 screen. tv: full screen at ten feet, with a way out. */
  size?: "screen" | "tv";
  /** TV: the buttons ("Tune to REEL 24.1", "Open the guide"). */
  actions?: ReactNode;
  className?: string;
}

function bigWords(p: SlateProps): ReactNode {
  if (p.title != null) return p.title;
  if (p.kind === "standby") return "Please stand by";
  if (p.kind === "off-air") return "Off air";
  if (p.kind === "dead-air") return p.deadAirAt != null && p.now != null ? `Dead air in ${minutesText(ms(p.deadAirAt) - ms(p.now))}` : "Dead air";
  return [p.callSign, p.name].filter(Boolean).join(", ");
}

/** A screen without a picture. Stand by is a message, not an apology: say what's happening and when it changes. */
export function Slate(props: SlateProps) {
  const { kind, children, frequency, levels = [], size = "screen", actions, className } = props;
  return (
    <div className={cx("oc-slate", `oc-slate--${kind}`, size === "tv" && "oc-slate--tv", className)} role="status">
      {kind === "standby" && <ColourBars className="oc-slate__bars" />}
      {kind === "dead-air" && <Tally state="lit" on="picture" size="md" flicker={false} className="oc-slate__tally" />}
      {kind === "radio" && frequency != null && <div className="oc-slate__freq">{frequency}</div>}
      <div className="oc-slate__big">{bigWords(props)}</div>
      {children != null && (size === "tv" ? <p className="oc-slate__small">{children}</p> : <div className="oc-slate__small">{children}</div>)}
      {kind === "radio" && levels.length > 0 && <LevelMeter levels={levels} className="oc-slate__meter" />}
      {actions != null && <div className="oc-slate__actions">{actions}</div>}
    </div>
  );
}
