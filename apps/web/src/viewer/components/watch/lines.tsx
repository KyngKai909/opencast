// The small lines under an airing's title, the same wherever it's listed: "Carried from REEL
// 24.1", "Beat showcase", "Live, from the Redlands studio" (Live in red text, never the tally).

import type { ReactNode } from "react";
import { LiveText, clock } from "@opencast/ui";
import type { AiringX } from "../../api/ext";
import { MARKET_TZ } from "../../../lib/clock";
import { identText, isOffAir, liveRest } from "./logic";

/** Planned off air's line (G9): "Signs on at 6:00 am", the time in mono. */
export function BackAt({ at, timeZone = MARKET_TZ }: { at: string; timeZone?: string }) {
  return (
    <>
      Signs on at <span className="oc-mono">{clock(at, { timeZone })}</span>
    </>
  );
}

/** "Carried from REEL 24.1", or null for the station's own program. */
export function carriedText(a: Pick<AiringX, "carriedFrom">): string | null {
  return a.carriedFrom ? `Carried from ${identText(a.carriedFrom)}` : null;
}

/** A schedule row's line: where it's carried from, or its note, with Live set in red. */
export function scheduleLine(a: AiringX): ReactNode {
  if (isOffAir(a)) return <BackAt at={a.backAt ?? a.endsAt} />;
  const carried = carriedText(a);
  if (carried) return carried;
  const { live, rest } = liveRest(a.note);
  if (live || a.live)
    return (
      <>
        <LiveText />
        {rest ? `, ${rest}` : null}
      </>
    );
  return a.note ?? null;
}

/** Words that may start with "Live": the word in red, the rest as it is ("Live from the studio."). */
export function withLive(text: string, live: boolean): ReactNode {
  const r = liveRest(text);
  if (!r.live && !live) return text;
  return (
    <>
      <LiveText />
      {r.live ? ` ${r.rest}` : text ? ` ${text}` : null}
    </>
  );
}
