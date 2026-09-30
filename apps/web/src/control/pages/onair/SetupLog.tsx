// A.4 Program log with dead air and Fill, setup step 3: the station's log page in the setup shell.
// Whoever sets a station up runs it, so "Edit log" is there too.

import { useParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import { ControlTitle } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { LogPage } from "../../components/onair/LogPage";
import { Quiet } from "../common";
import { controlPath } from "../../../areas";

export default function SetupLog() {
  const { stationId = "" } = useParams();
  const setup = useApi(stationsApi.getSetup, { params: { stationId } });
  if (setup.isLoading) return <Quiet />;
  if (!setup.data) return <ControlTitle title="Program log" description={setup.error?.message} />;
  const st = setup.data.station;
  const base = st.callSign ? controlPath(`/${st.callSign.toLowerCase()}`) : null;
  return <LogPage stationId={stationId} station={st} base={base} canEdit setup={{ back: controlPath(`/setup/${stationId}/library`), next: controlPath(`/setup/${stationId}/translators`) }} />;
}
