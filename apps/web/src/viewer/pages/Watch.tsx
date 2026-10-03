// Tuned in: `/watch/:stationRef`. The page is the player, so the player bar hides here. It tunes the
// station the URL names, and the URL follows the channel as it changes (arrow keys, the buttons, a
// swipe, a preset key). On the web it's home 03.1's tuned-in page; on phones and tablets it's the
// swipe home (A245, viewer/opencast-swipe-home.html), the picture full screen.

import { useNavigate, useParams } from "react-router";
import { Button, Slate } from "@opencast/ui";
import { useShellOptions, useIsPhone } from "../layout/shell";
import { useWatch, type WatchData } from "../components/watch/useWatch";
import { WatchWeb } from "../components/watch/WatchWeb";
import { SwipeWatch, useOpeningSound } from "../components/swipe/SwipeHome";
import "../components/watch/watch.css";

export default function WatchPage() {
  const { stationRef } = useParams();
  const phone = useIsPhone();
  return phone ? <PhoneWatch stationRef={stationRef} /> : <WebWatch stationRef={stationRef} />;
}

function WebWatch({ stationRef }: { stationRef: string | undefined }) {
  useShellOptions({ player: false, padded: false });
  const w = useWatch(stationRef);
  if (w.notOnDial) return <Missing w={w} />;
  return <WatchWeb w={w} />;
}

function PhoneWatch({ stationRef }: { stationRef: string | undefined }) {
  // Before the tune: Muted previews holds the sound when the app opens here.
  useOpeningSound();
  const w = useWatch(stationRef, { arrows: false });
  return <SwipeWatch w={w} fallback={w.notOnDial ? <MissingOnPhone w={w} /> : undefined} />;
}

function MissingOnPhone({ w }: { w: WatchData }) {
  useShellOptions({ player: false });
  return <Missing w={w} />;
}

/** No such station: say so, with the API's words, and offer the dial. */
function Missing({ w }: { w: WatchData }) {
  const navigate = useNavigate();
  return (
    <div className="vw-watch-missing">
      <Slate kind="off-air" title={w.page.error?.message ?? "That station wasn't found."} />
      <Button variant="ghost" onClick={() => navigate("/")}>
        Back to the dial
      </Button>
    </div>
  );
}
