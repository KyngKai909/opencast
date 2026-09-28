// The station's side of a pause (biz-spots 05.1): a spot in the rotation paused, already handled
// by the backup rotation and reported as done ("Change" is there); and a spot that came back,
// which never returns to the rotation by itself ("Add it back").

import { Button, duration, Notice } from "@opencast/ui";
import type { MarketSpotExt } from "../../api/ext/spots";

const PAUSE_REASON = { budget_spent: "Its budget is spent.", balance: "Its balance ran out." } as const;

export function pausedTitle(s: MarketSpotExt): string {
  const why = s.pause ? ` ${PAUSE_REASON[s.pause.reason]}` : "";
  return `${s.business.name} paused ${s.spot.title}.${why}`;
}

export function pausedDetail(s: MarketSpotExt): string | null {
  if (!s.pause) return null;
  const held = `It had ${duration(s.pause.heldTonightMs)} in tonight's breaks.`;
  if (!s.pause.heldTonightMs) return s.pause.filledBy.length ? `Filled from your backup rotation: ${s.pause.filledBy.join(", ")}` : null;
  return s.pause.filledBy.length ? `${held} Filled from your backup rotation: ${s.pause.filledBy.join(", ")}` : `${held} Your station ID and bumpers fill it.`;
}

export function backTitle(s: MarketSpotExt): string {
  const who = s.business.shortName ?? s.business.name;
  const why = s.back ? (s.back.reason === "raised_budget" ? ` ${who} raised its budget.` : ` ${who} added money.`) : "";
  return `${s.spot.title} is back.${why}`;
}

export function backDetail(s: MarketSpotExt): string {
  const runway = s.runway.kind === "days" ? `About ${s.runway.days} ${s.runway.days === 1 ? "day" : "days"} of budget` : "Tops up automatically";
  return `It isn't in your rotation now. ${runway}`;
}

export interface PauseNoticesProps {
  spots: MarketSpotExt[];
  /** Where "Change" goes: the rotation tab. */
  rotationHref: string;
  onAddBack?: (s: MarketSpotExt) => void;
  busy?: boolean;
}

export function PauseNotices({ spots, rotationHref, onAddBack, busy }: PauseNoticesProps) {
  const paused = spots.filter((s) => s.state === "paused" && s.inRotation);
  const back = spots.filter((s) => s.state === "its_back");
  if (!paused.length && !back.length) return null;
  return (
    <div className="cc-sp-notices">
      {paused.map((s) => (
        <Notice
          key={`p${s.spot.id}`}
          icon={null}
          swatch={s.spot.preview?.colour}
          title={pausedTitle(s)}
          detail={pausedDetail(s) ?? undefined}
          action={
            <Button size="sm" href={rotationHref}>
              Change
            </Button>
          }
        />
      ))}
      {back.map((s) => (
        <Notice
          key={`b${s.spot.id}`}
          tone="plain"
          icon={null}
          swatch={s.spot.preview?.colour}
          title={backTitle(s)}
          detail={backDetail(s)}
          action={
            onAddBack ? (
              <Button size="sm" onClick={() => onAddBack(s)} disabled={busy}>
                Add it back
              </Button>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
