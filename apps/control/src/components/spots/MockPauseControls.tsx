// Mock mode only: the business side of a pause, so the station's side can be seen (biz-spots 05).
// The business app (apps/spots) pauses and resumes for real; this stands in for it on mocks.

import { useState } from "react";
import { Button, SelectField } from "@opencast/ui";
import { spotsApi } from "@opencast/contracts";
import type { MarketSpotExt } from "../../api/ext/spots";
import { config } from "../../config";
import { BREAK_READERS, errorText, useWrite } from "./data";
import "./parts.css";

export function MockPauseControls({ spots }: { spots: MarketSpotExt[] }) {
  const pause = useWrite(spotsApi.pauseSpot, BREAK_READERS);
  const resume = useWrite(spotsApi.resumeSpot, BREAK_READERS);
  const inRotation = spots.filter((s) => s.inRotation === "main");
  const [picked, setPicked] = useState<string>("");
  if (!config.mock || !inRotation.length) return null;
  const id = inRotation.some((s) => s.spot.id === picked) ? picked : inRotation[0].spot.id;
  const spot = inRotation.find((s) => s.spot.id === id)!;
  const error = pause.error ?? resume.error;
  return (
    <section className="cc-sp-mock" aria-label="Mock mode: the business side">
      <p className="cc-sp-mock__h">Mock mode: the business side</p>
      <div className="cc-sp-mock__row">
        <SelectField label="Spot" size="sm" value={id} onChange={(e) => setPicked(e.target.value)}>
          {inRotation.map((s) => (
            <option key={s.spot.id} value={s.spot.id}>
              {s.business.name}, {s.spot.title}
            </option>
          ))}
        </SelectField>
        {spot.state === "paused" ? (
          <Button size="sm" onClick={() => resume.mutate({ params: { spotId: id } })} disabled={resume.isPending}>
            Bring it back as its business
          </Button>
        ) : (
          <Button size="sm" onClick={() => pause.mutate({ params: { spotId: id } })} disabled={pause.isPending}>
            Spend its budget as its business
          </Button>
        )}
      </div>
      {error && <p className="cc-sp-error">{errorText(error)}</p>}
    </section>
  );
}
