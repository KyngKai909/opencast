// A creator's stage as a small sign (network-desk .stg). Words from states.ts; never colour alone.
import { CREATOR_STAGE_LABELS, type CreatorStage } from "@opencast/contracts";
import type { ReactNode } from "react";
import { STAGE_LOOK, type StageLook } from "./stages";
import "./StageTag.css";

export function StageTag({ stage }: { stage: CreatorStage }) {
  return <Stg look={STAGE_LOOK[stage]}>{CREATOR_STAGE_LABELS[stage].desk}</Stg>;
}

/** The sign itself, for other states drawn the same way (held earnings' statuses). */
export function Stg({ look, children }: { look: StageLook; children: ReactNode }) {
  return <span className={`nd-stg nd-stg--${look}`}>{children}</span>;
}
