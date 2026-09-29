// The station's Program log (A.4's page as the station sees it): a timeline of the evening with
// breaks and dead air, Fill for a gap, the break rule and the day's repeat. On the phone, a
// dead-air warning opens it with `?fill=<gapStart>`, the fill choices in a sheet (P.2).

import { LogPage } from "../../components/onair/LogPage";
import { useStation } from "../../station/StationContext";

export default function ProgramLog() {
  const s = useStation();
  return <LogPage stationId={s.id} station={s.station} base={s.base} />;
}
