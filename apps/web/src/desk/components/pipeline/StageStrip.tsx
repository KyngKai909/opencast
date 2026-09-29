// The pipeline's stage strip (network-desk 02.1 .stages): seven ruled counts under a 2px ink rule.
// Each is a filter: choosing one shows only its rows and reads bold; choosing it again shows all.
import type { CreatorStage } from "@opencast/contracts";
import { cx } from "@opencast/ui";
import { STRIP } from "./stages";
import "./StageStrip.css";

export interface StageStripProps {
  counts: Record<CreatorStage, number>;
  selected: CreatorStage | null;
  onSelect: (stage: CreatorStage | null) => void;
}

export function StageStrip({ counts, selected, onSelect }: StageStripProps) {
  return (
    <div className="nd-stages" role="group" aria-label="Stages">
      {STRIP.map(({ stage, label }) => (
        <button
          key={stage}
          type="button"
          className={cx("nd-stages__item", selected === stage && "nd-stages__item--on")}
          aria-pressed={selected === stage}
          onClick={() => onSelect(selected === stage ? null : stage)}
        >
          <span className="nd-stages__v">{counts[stage]}</span>
          <small className="nd-stages__label">{label}</small>
        </button>
      ))}
    </div>
  );
}
