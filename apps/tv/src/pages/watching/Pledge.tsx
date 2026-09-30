// tv 05.4 pledge by QR ("/pledge/:stationRef"), from the menu rail's station line or a station's
// About. Money happens on the phone: the QR opens the viewer's pledge page for the station, and
// the TV never takes payment details. The panel takes the right side and the picture moves over
// to its left, still playing (squeezed back, as broadcast does, so nothing of it is cut off).

import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { useApi } from "../../api/hooks";
import { QrCode } from "../../components/common/QrCode";
import { byRef, pledgeUrl, shownUrl } from "../../components/watching/pledge";
import { TvButton } from "../../components/watching/TvButton";
import { config } from "../../config";
import { callSignLabel } from "../../lib/stationRef";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { useQuietPicture } from "../../components/watching/useQuietPicture";
import "./Pledge.css";

/** The pledge sheet's own default, which the QR opens with. */
const DEFAULT_MONTHLY_MICROS = 10_000_000;

export default function Pledge() {
  const { stationRef = "" } = useParams();
  const navigate = useNavigate();
  useQuietPicture();
  const [s] = usePlayer();
  const fromDial = byRef(s.channels, stationRef)?.station ?? null;
  // Not on this market's dial (a link from elsewhere): ask for the station.
  const page = useApi(stationsApi.getStation, { params: { stationRef } }, { enabled: !fromDial && !!stationRef });
  const station = fromDial ?? page.data?.station ?? null;

  const box = useTvFocusable({ focusKey: "tvw-pledge", trackChildren: true, isFocusBoundary: true });
  useEffect(() => focusKey("tvw-pledge-close"), [station?.id, page.isError]);

  // The picture moves over while the panel is up.
  useEffect(() => {
    document.documentElement.classList.add("tvw-squeeze");
    return () => document.documentElement.classList.remove("tvw-squeeze");
  }, []);

  const close = () => navigate("/", { replace: true });
  // "BEAT", or "BEAT 12.2" for a station sharing its call sign.
  const who = station ? callSignLabel(station) : "";

  return (
    <aside className="tvw-pledge" aria-labelledby="tvw-pledge-h">
      {station ? (
        <>
          <h3 id="tvw-pledge-h">Pledge to {station.name}</h3>
          <p>
            Scan with your phone. It opens {who}'s pledge with {money(DEFAULT_MONTHLY_MICROS)} a month selected, and you finish there.
          </p>
          <div className="tvw-pledge__qr">
            <QrCode value={pledgeUrl(config.viewerUrl, station)} size={256} label={`A code that opens ${who}'s pledge on your phone`} />
          </div>
          <div className="tvw-pledge__url">{shownUrl(config.viewerUrl, station)}</div>
        </>
      ) : page.isError ? (
        <p id="tvw-pledge-h" role="alert">
          {(page.error as Error).message}
        </p>
      ) : (
        <div className="tvw-pledge__wait" id="tvw-pledge-h" aria-busy="true" />
      )}
      <FocusContext.Provider value={box.focusKey}>
        <div ref={box.ref} className="tvw-pledge__foot">
          <TvButton focusKey="tvw-pledge-close" onSelect={close}>
            Close
          </TvButton>
        </div>
      </FocusContext.Provider>
    </aside>
  );
}
