// A.5 Translators, setup step 4: relay the station to YouTube, Twitch or any RTMP address.
// Optional on purpose: nobody is kept from signing on by it (master-control A notes).

import { useNavigate, useParams } from "react-router";
import { Button, ControlFoot, ControlTitle } from "@opencast/ui";
import { TranslatorList, TRANSLATOR_NOTE } from "../../components/station/TranslatorList";
import { useIsPhone } from "../../layout/shell";
import { useMe, useMyStations } from "../../station/StationContext";
import { NotYours, Quiet } from "../common";
import "./SetupTranslators.css";

export default function SetupTranslators() {
  const { stationId = "" } = useParams();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const me = useMe();
  const m = useMyStations().find((x) => x.station.id === stationId);
  if (me.isLoading) return <Quiet />;
  if (!m) return <NotYours />;
  const cs = m.station.callSign ?? m.station.name;
  const next = () => navigate(`/setup/${stationId}/sign-on`);
  return (
    <section className="cc-setup-tr" aria-labelledby="cc-setup-tr-h">
      <ControlTitle title={<span id="cc-setup-tr-h">Translators</span>} description={`Relay ${cs} to other services. Opencast is always on; everything here is optional and can be added any time.`} />
      <TranslatorList stationId={stationId} callSign={cs} canEdit phone={phone} />
      <ControlFoot note={TRANSLATOR_NOTE}>
        <Button onClick={() => navigate(`/setup/${stationId}/log`)}>Back</Button>
        <Button onClick={next}>Skip for now</Button>
        <Button variant="primary" onClick={next}>
          Continue
        </Button>
      </ControlFoot>
    </section>
  );
}
