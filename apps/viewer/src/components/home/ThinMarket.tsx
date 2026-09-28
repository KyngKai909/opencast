// A thin market (home 08.2): its stations shown as they are, both bands in one list, then the
// nearest market under its own heading and distance, then an invitation to start a station.
// Nothing from elsewhere is passed off as local.

import { Button, Dial } from "@opencast/ui";
import type { DialX } from "../../api/ext";
import { config } from "../../config";
import { openChannelsText, soFarText, thinRows } from "./logic";
import { StationRow } from "./MarketDial";
import "./ThinMarket.css";

/** How many of the nearby market's stations are shown (the frame shows three). */
export const NEARBY_ROWS = 3;

export function ThinMarket({ marketName, tv, radio, phone, showNearby, now, timeZone }: { marketName: string; tv: DialX; radio: DialX | undefined; phone: boolean; showNearby: boolean; now: Date; timeZone: string }) {
  const rows = thinRows(tv.rows, radio?.rows ?? []);
  const variant = phone ? "phone" : "web";
  const nearby = showNearby ? tv.nearby[0] ?? radio?.nearby[0] : undefined;
  const secClass = phone ? "vw-sec vw-sec--phone" : "vw-sec";

  return (
    <>
      <section className={`${secClass} vw-thin__own`} aria-labelledby="vw-thin-h">
        <div className="vw-sec-h">
          <h3 id="vw-thin-h">{marketName}</h3>
          <span className="vw-sec-h__sub">{soFarText(rows.length)}</span>
        </div>
        {rows.length > 0 && (
          <Dial header={!phone} label={marketName} className="vw-thin__dial">
            {rows.map((r) => (
              <StationRow key={r.station.id} row={r} variant={variant} at={now} timeZone={timeZone} detail={r.station.band === "radio" ? "Radio band" : undefined} />
            ))}
          </Dial>
        )}
      </section>

      {nearby && nearby.rows.length > 0 && (
        <section className={secClass} aria-labelledby="vw-near-h">
          <div className="vw-sec-h">
            <h3 id="vw-near-h">Nearby: {nearby.market.name}</h3>
            <span className="vw-sec-h__sub">{Math.round(nearby.miles)} miles</span>
          </div>
          <Dial label={`Nearby: ${nearby.market.name}`} className="vw-thin__dial">
            {nearby.rows.slice(0, NEARBY_ROWS).map((r) => (
              <StationRow key={r.station.id} row={r} variant={variant} at={now} timeZone={timeZone} />
            ))}
          </Dial>
        </section>
      )}

      <section className={`${secClass} vw-thin__start`} aria-labelledby="vw-start-h">
        <h3 id="vw-start-h">Start a station here</h3>
        <p>{openChannelsText(marketName, tv.openChannels?.tv)}</p>
        <Button variant="ghost" block={phone} href={config.controlUrl}>
          Open master control
        </Button>
      </section>
    </>
  );
}
