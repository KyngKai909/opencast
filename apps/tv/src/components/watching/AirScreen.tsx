// Off air and stand by (tv 05.2), over the picture on "/": the headline, when the station is back,
// and always a way out, with "Tune to REEL 24.1" focused and "Open the guide" beside it. ▲ ▼
// still flip the dial (Watching's command layer). Stand by is the same layout with the colour
// bars, shown only when the dial says the station is waiting for its signal (S13).

import { useEffect } from "react";
import { usePlayer } from "@opencast/player";
import { Slate, clock } from "@opencast/ui";
import { MARKET_TZ } from "../../lib/clock";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { backTime, identText, signOnDay, type Row } from "./offAir";
import { TvButton } from "./TvButton";
import "./AirScreen.css";

export interface AirScreenProps {
  kind: "off_air" | "standby";
  row: Row;
  suggest: Row | null;
  now: Date;
  onTune: (stationId: string) => void;
  onGuide: () => void;
}

export function AirScreen({ kind, row, suggest, now, onTune, onGuide }: AirScreenProps) {
  const box = useTvFocusable({ focusKey: "tvw-air", trackChildren: true, isFocusBoundary: true });
  const first = suggest ? "tvw-air-tune" : "tvw-air-guide";
  // Opens with the way out focused (and again when the station or the offer changes).
  useEffect(() => focusKey(first), [first, row.station.id, kind]);

  const here = identText(row.station);
  // The player's word first: a stream that signed off says when it's back (its sign-off tag), then the dial's.
  const [ps] = usePlayer();
  const back = kind === "off_air" ? backTime(row, ps.offAir) : null;
  const day = back ? signOnDay(back, now, MARKET_TZ) : null;
  const other = suggest ? ` ${identText(suggest.station)} is on now.` : "";
  const line =
    kind === "standby" ? (
      <>{`${here} is waiting for its signal.${other}`}</>
    ) : back ? (
      <>
        {`${here} signs on again ${day ? `${day} ` : ""}at `}
        <span className="oc-mono">{clock(back, { timeZone: MARKET_TZ })}</span>.{other}
      </>
    ) : (
      <>{suggest ? other.trim() : `${here} is off air.`}</>
    );

  return (
    <div className="tvw-full tvw-air" data-kind={kind}>
      <Slate
        kind={kind === "standby" ? "standby" : "off-air"}
        size="tv"
        actions={
          <FocusContext.Provider value={box.focusKey}>
            <div ref={box.ref} className="tvw-air__row">
              {suggest && (
                <TvButton focusKey="tvw-air-tune" variant="primary" onSelect={() => onTune(suggest.station.id)}>
                  Tune to {identText(suggest.station)}
                </TvButton>
              )}
              <TvButton focusKey="tvw-air-guide" onSelect={onGuide}>
                Open the guide
              </TvButton>
            </div>
          </FocusContext.Provider>
        }
      >
        {line}
      </Slate>
    </div>
  );
}
