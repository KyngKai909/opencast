// Translators (/translators): the same relays as setup step 4 (master-control A.5), from the rail.

import { ControlTitle } from "@opencast/ui";
import { TranslatorList, TRANSLATOR_NOTE } from "../../components/station/TranslatorList";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import "./Translators.css";

export default function Translators() {
  const s = useStation();
  const phone = useIsPhone();
  const cs = s.station.callSign ?? s.station.name;
  useShellOptions({ context: "Translators" });
  return (
    <section className="cc-translators" aria-labelledby="cc-translators-h">
      <ControlTitle title={<span id="cc-translators-h">Translators</span>} description={`Relay ${cs} to other services. Opencast is always on; everything here is optional and can be added any time.`} />
      <TranslatorList stationId={s.id} callSign={cs} canEdit={s.can("programming")} removable phone={phone} />
      <p className="cc-translators__note">{TRANSLATOR_NOTE}</p>
    </section>
  );
}
