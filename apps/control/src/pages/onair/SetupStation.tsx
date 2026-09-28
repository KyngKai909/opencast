// A.1 Your station, setup step 1, for a station already started (its setup, saved as you go).

import { useParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import { ControlTitle } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { StationForm } from "../../components/onair/StationForm";
import { Quiet } from "../common";

export default function SetupStation() {
  const { stationId = "" } = useParams();
  const setup = useApi(stationsApi.getSetup, { params: { stationId } });
  if (setup.isLoading) return <Quiet />;
  if (!setup.data) return <ControlTitle title="Your station" description={setup.error?.message} />;
  return <StationForm key={stationId} setup={setup.data} />;
}
