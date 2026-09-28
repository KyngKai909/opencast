// `/new`: A.1 before the station exists. The first thing saved starts it (stations.createStation),
// and setup carries on at /setup/:stationId/station.

import { useNavigate } from "react-router";
import { ControlSetupShell } from "@opencast/ui";
import { StationForm } from "../../components/onair/StationForm";
import { useInAppLinks } from "../../layout/links";

export default function NewStation() {
  useInAppLinks();
  const navigate = useNavigate();
  return (
    <ControlSetupShell step={1} onFinishLater={() => navigate("/")}>
      <StationForm setup={null} />
    </ControlSetupShell>
  );
}
