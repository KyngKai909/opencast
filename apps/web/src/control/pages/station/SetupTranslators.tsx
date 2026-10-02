// A4 Translators, setup step 4: simulcast the station to YouTube, Twitch or any RTMP address, and
// choose what's relayed. Optional on purpose: nobody is kept from signing on by it (master-control
// A notes). Signing in to YouTube or Twitch comes back here.

import { useNavigate, useParams } from "react-router";
import { Button, ControlFoot, ControlTitle } from "@opencast/ui";
import { TranslatorsPanel } from "../../components/station/TranslatorsPanel";
import { relayStopsNote, translatorsLede } from "../../components/station/relayWords";
import { useIsPhone } from "../../layout/shell";
import { useMe, useMyStations } from "../../station/StationContext";
import { stationLabel, stationPath } from "../../station/slug";
import { NotYours, Quiet } from "../common";
import "./SetupTranslators.css";
import { controlPath } from "../../../areas";

export default function SetupTranslators() {
  const { stationId = "" } = useParams();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const me = useMe();
  const m = useMyStations().find((x) => x.station.id === stationId);
  if (me.isLoading) return <Quiet />;
  if (!m) return <NotYours />;
  const cs = stationLabel(m.station);
  const next = () => navigate(controlPath(`/setup/${stationId}/sign-on`));
  return (
    <section className="cc-setup-tr" aria-labelledby="cc-setup-tr-h">
      <ControlTitle title={<span id="cc-setup-tr-h">Translators</span>} description={translatorsLede(cs)} />
      <TranslatorsPanel stationId={stationId} callSign={cs} owner={m.role === "owner"} accountHref={m.station.callSign ? stationPath(m.station, "/settings/account") : undefined} phone={phone} />
      <ControlFoot note={relayStopsNote(cs)}>
        <Button onClick={() => navigate(controlPath(`/setup/${stationId}/log`))}>Back</Button>
        <Button onClick={next}>Skip for now</Button>
        <Button variant="primary" onClick={next}>
          Continue
        </Button>
      </ControlFoot>
    </section>
  );
}
