// A thin market (home 08.2): its stations shown as they are, both bands in one list, then the
// nearest market under its own heading and distance, then an invitation to start a station.
// Nothing from elsewhere is passed off as local. On phones and tablets (A245) it's a note at the
// top of Guide: the guide below already lists the market's own stations.

import { Button, Dial } from "@opencast/ui";
import { useAuth } from "../../../auth/AuthProvider";
import { useMe } from "../../data/viewer";
import { useDevice } from "../../device/store";
import type { DialX } from "../../api/ext";
import { openChannelsText, soFarText, thinRows } from "./logic";
import { StationRow } from "./MarketDial";
import "./ThinMarket.css";
import { CONTROL } from "../../../areas";

/** How many of the nearby market's stations are shown (the frame shows three). */
export const NEARBY_ROWS = 3;

/** Settings, Market: "Show nearby markets" (on unless turned off). */
export function useShowNearby(): boolean {
  const auth = useAuth();
  const me = useMe();
  const device = useDevice();
  const s = auth.signedIn ? me.data?.settings.market : device.settings.market;
  return s?.showNearby !== false;
}

export function ThinMarket({ marketName, tv, radio, phone, showNearby, now, timeZone, note = false }: { marketName: string; tv: DialX; radio: DialX | undefined; phone: boolean; showNearby: boolean; now: Date; timeZone: string; note?: boolean }) {
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
        {rows.length > 0 && !note && (
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
        <Button variant="ghost" block={phone} href={CONTROL}>
          Open master control
        </Button>
      </section>
    </>
  );
}
