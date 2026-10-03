// The picture: the player's surface (it draws the airing station's bug, lower thirds and codes
// from the stream's tags), on the web's tuned-in page. (Phones and tablets swipe on the swipe
// home's own picture: components/swipe.)

import type { ReactNode } from "react";
import { cx } from "@opencast/ui";
import { PlayerSurface } from "@opencast/player";
import { MARKET_TZ, now } from "../../../lib/clock";
import type { WatchData } from "./useWatch";

export function Picture({ className, children }: { w: WatchData; className?: string; children?: ReactNode }) {
  return (
    <div className={cx("vw-pic", className)}>
      <PlayerSurface timeZone={MARKET_TZ} clock={now} />
      {children}
    </div>
  );
}
