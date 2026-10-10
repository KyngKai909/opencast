// A tablet on its side (A245; swipe home 07): Guide and Search keep the live picture on screen, in a
// column beside them, instead of shrinking it into the mini player: the channel you're watching,
// what's on and what's next, Watch full screen and Remind.

import { useNavigate } from "react-router";
import { Button, Ident, ProgressBar, clock } from "@opencast/ui";
import { PlayerSurface } from "@opencast/player";
import { MARKET_TZ, now as clockNow, useNow } from "../../../lib/clock";
import { useViewerActions } from "../../data/viewer";
import { useNowPlaying } from "../../player/PlayerRoot";
import { callSignOf } from "../watch/logic";
import { watchPath } from "../station/actions";
import "./swipe.css";

export function SideWatch() {
  const np = useNowPlaying();
  const navigate = useNavigate();
  const { remind } = useViewerActions();
  const t = useNow(30_000);
  const row = np.row;
  const on = row?.now && row.now.kind !== "off_air" ? row.now : null;
  const next = row?.next && row.next.kind !== "off_air" ? row.next : null;
  return (
    <aside className="vw-side" aria-label="Watching">
      <div className="vw-side__pic">
        <PlayerSurface timeZone={MARKET_TZ} clock={clockNow} pausedControls={false} />
      </div>
      {row ? (
        <div className="vw-side__info">
          <Ident variant="block-sm" channel={row.station.channel ?? ""} callSign={callSignOf(row.station)} name={row.station.name} />
          <h2 className="vw-side__t">{on?.title ?? "Off air"}</h2>
          {on && <ProgressBar start={on.startsAt} end={on.endsAt} now={t} timeZone={MARKET_TZ} size="sm" />}
          {next && (
            <p className="vw-side__nx">
              Next at <span className="oc-mono">{clock(next.startsAt, { timeZone: MARKET_TZ })}</span> <b>{next.title}</b>
            </p>
          )}
          <div className="vw-side__acts">
            <Button variant="primary" size="sm" onClick={() => navigate(watchPath(row.station))}>
              Watch full screen
            </Button>
            {next && (
              <Button variant="ghost" size="sm" onClick={() => remind({ airing: next, station: row.station })}>
                Remind
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="vw-side__none">Nothing on. Tap a station in the guide to tune in.</p>
      )}
    </aside>
  );
}
