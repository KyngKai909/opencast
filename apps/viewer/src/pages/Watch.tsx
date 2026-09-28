// Tuned in (home 03.1 web; 04.1 and 04.2 phone): `/watch/:stationRef`. The page is the player, so
// the player bar hides here. It tunes the station the URL names, and the URL follows the channel
// as it changes (arrow keys, the buttons, a swipe, a preset key).

import { useNavigate, useParams } from "react-router";
import { Button, Slate } from "@opencast/ui";
import { useShellOptions, useIsPhone } from "../layout/shell";
import { useWatch } from "../components/watch/useWatch";
import { WatchWeb } from "../components/watch/WatchWeb";
import { WatchPhone, WatchTop } from "../components/watch/WatchPhone";
import "../components/watch/watch.css";

export default function WatchPage() {
  const { stationRef } = useParams();
  const phone = useIsPhone();
  useShellOptions(phone ? { player: false, padded: false, tabs: false, top: <WatchTop /> } : { player: false, padded: false });
  const w = useWatch(stationRef);
  const navigate = useNavigate();

  if (w.notOnDial) {
    // No such station: say so, with the API's words, and offer the dial.
    return (
      <div className="vw-watch-missing">
        <Slate kind="off-air" title={w.page.error?.message ?? "That station wasn't found."} />
        <Button variant="ghost" onClick={() => navigate("/")}>
          Back to the dial
        </Button>
      </div>
    );
  }
  return phone ? <WatchPhone w={w} /> : <WatchWeb w={w} />;
}
