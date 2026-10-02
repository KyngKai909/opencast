// The Audience page's watch data for one airing (follow-up Phase 1): its watch time (listening time
// on the radio band) in its own column, and under the program's title a small minute-by-minute
// tune-away line, whose sentence is its text alternative ("Most left around 9:24 pm"). "Counting…"
// while it's on or being worked out, and "Not enough viewers yet" under the minimum audience. A
// station's own airings only.

import { Sparkbars } from "@opencast/ui";
import type { AiringWatch } from "@opencast/contracts";
import { mostLeftText, notForMeText, watchStateText, watchTimeText } from "./words";
import "./watch.css";

/** The Watch time (Listening time) column: the minutes, or why there are none. */
export function WatchTime({ watch }: { watch: AiringWatch | undefined }) {
  if (!watch) return <span className="cc-watch__quiet">–</span>;
  const state = watchStateText(watch);
  if (state || watch.watchMinutes === null) return <span className="cc-watch__quiet cc-watch__state">{state ?? "–"}</span>;
  return <span className="cc-watch__time">{watchTimeText(watch.watchMinutes)}</span>;
}

/** Under the program's title: where people tuned away, minute by minute, and the sentence that says it. */
export function TuneAwayLine({ watch, startsAt, timeZone }: { watch: AiringWatch | undefined; startsAt: string | null; timeZone: string }) {
  if (!watch || watch.status !== "shown" || !watch.tuneAways?.length) return null;
  const votes = notForMeText(watch.notForMe);
  return (
    <Sparkbars
      className="cc-watch__line"
      values={watch.tuneAways}
      caption={
        <>
          {mostLeftText(watch.tuneAways, { startsAt, timeZone })}
          {votes && <span className="cc-watch__votes">{votes}</span>}
        </>
      }
    />
  );
}
