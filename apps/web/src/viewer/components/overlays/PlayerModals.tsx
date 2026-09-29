// The modals that open from the player (home 07.1), each a search param over the page underneath
// so Esc and Back return to exactly where you were: carried from, pledge, share. (The reminder is
// a toast with Undo, not a modal: useViewerActions().remind.)

import { useNow } from "../../../lib/clock";
import { useOverlayParams } from "../watch/overlay";
import { CarriedFrom } from "../watch/CarriedFrom";
import { PledgeModal } from "../watch/Pledge";
import { ShareModal } from "../watch/Share";
import "../watch/modals.css";

export default function PlayerModals() {
  const { params, close } = useOverlayParams();
  const now = useNow(30_000);
  const modal = params.get("modal");
  const station = params.get("station");
  if (modal === "carried" && params.get("program")) return <CarriedFrom key={params.get("program")} programId={params.get("program")!} now={now} onClose={() => close(["modal", "program"])} />;
  if (modal === "pledge" && station) return <PledgeModal key={station} stationRef={station} onClose={() => close(["modal", "station"])} />;
  if (modal === "share" && station) return <ShareModal key={`${station}-${params.get("airing") ?? ""}`} stationRef={station} airingId={params.get("airing")} now={now} onClose={() => close(["modal", "station", "airing"])} />;
  return null;
}
