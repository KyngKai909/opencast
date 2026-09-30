// Translators (/translators): step A4 of master control, from the rail (the same panel as setup
// step 4): connected platforms, what gets relayed, one setting for every relay, restarts, and a
// radio station's relay background.

import { ControlTitle } from "@opencast/ui";
import { RelayBackground } from "../../components/station/RelayBackground";
import { TranslatorsPanel } from "../../components/station/TranslatorsPanel";
import { relayStopsNote, translatorsLede } from "../../components/station/relayWords";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import "./Translators.css";

export default function Translators() {
  const s = useStation();
  const phone = useIsPhone();
  const cs = s.label;
  useShellOptions({ context: "Translators" });
  return (
    <section className="cc-translators" aria-labelledby="cc-translators-h">
      <ControlTitle title={<span id="cc-translators-h">Translators</span>} description={translatorsLede(cs)} />
      <TranslatorsPanel stationId={s.id} callSign={cs} owner={s.role === "owner"} accountHref={`${s.base}/settings/account`} phone={phone} />
      <p className="cc-translators__note">{relayStopsNote(cs)}</p>
      {/* Radio: the picture relays air under the station's sound. */}
      {s.station.band === "radio" && <RelayBackground stationId={s.id} callSign={s.station.callSign ?? s.station.name} channel={s.station.channel} colour={s.station.colour} canEdit={s.can("programming")} />}
    </section>
  );
}
