import { cx } from "../lib/cx";
import { stationColourPasses } from "../lib/contrast";
import { Tally, type TallyState } from "../primitives/Tally";
import { LevelMeter } from "./LevelMeter";
import { stationStyle } from "./time";

export interface RadioPanelProps {
  /** The frequency: it's the picture. "88.4" */
  frequency: string;
  callSign: string;
  /** "Night Desk, Riverside". */
  name?: string;
  /** The station colour fills the panel; it must hold 4.5:1 against white. */
  colour: string;
  /** The player's tally: lit while it's playing and on air. */
  tally?: TallyState;
  /** The level meter's bars, 0 to 1. */
  levels?: number[];
  className?: string;
}

/** The phone's full player on the radio band (home 04.2): the station colour fills, the frequency is the picture. */
export function RadioPanel({ frequency, callSign, name, colour, tally = "lit", levels = [], className }: RadioPanelProps) {
  return (
    <div
      className={cx("oc-radio-panel", className)}
      style={stationStyle(colour)}
      data-contrast={stationColourPasses(colour) ? undefined : "fails"}
      role="group"
      aria-label={`${callSign} ${frequency}`}
    >
      <div className="oc-radio-panel__top">
        <span className="oc-radio-panel__f">{frequency}</span>
        <Tally state={tally} />
      </div>
      <span className="oc-radio-panel__cs oc-cs">{callSign}</span>
      {name != null && <span className="oc-radio-panel__nm">{name}</span>}
      {levels.length > 0 && <LevelMeter levels={levels} size="md" on="station" className="oc-radio-panel__meter" />}
    </div>
  );
}
