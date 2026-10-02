// Mock mode only: what review and stations do on their side, so a spot can be taken through its
// states on mocks. Not part of the product: it isn't shown against the real API. Airings spend
// through the shared ledger (move()), so "Available" and the Balance page follow.

import { Button } from "@opencast/ui";
import type { MockSpotAction, SpotX } from "../../api/ext/spots";
import { config } from "../../config";
import { errorText, useMockAction } from "./data";
import "./MockControls.css";

const ACTIONS: Partial<Record<SpotX["state"], { action: MockSpotAction; label: string }[]>> = {
  in_review: [{ action: "pass_review", label: "Pass review now" }],
  listed: [{ action: "stations_add", label: "Stations add it to their rotations" }],
  in_rotation: [
    { action: "air_one", label: "Air it once" },
    { action: "air_all", label: "Air it until the budget is spent" }
  ],
  paused_daily_cap: [{ action: "midnight", label: "Midnight comes" }]
};

export function MockControls({ spot }: { spot: SpotX }) {
  const m = useMockAction();
  const actions = ACTIONS[spot.state];
  if (!config.mock || !actions) return null;
  return (
    <section className="bz-spmock" aria-label="Mock mode: review and stations">
      <p className="bz-spmock__h">Mock mode: review and stations</p>
      {spot.state === "in_review" && <p className="bz-spmock__p">Review passes by itself 20 seconds after it's sent.</p>}
      <div className="bz-spmock__row">
        {actions.map((a) => (
          <Button key={a.action} size="sm" disabled={m.isPending} onClick={() => void m.act(spot.id, a.action).catch(() => {})}>
            {a.label}
          </Button>
        ))}
      </div>
      {m.error && <p className="bz-sperror">{errorText(m.error)}</p>}
    </section>
  );
}
