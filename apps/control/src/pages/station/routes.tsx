// The Station area's routes: settings, translators, rights under `/:callSign`; claiming a
// station outside the shell.

import { Navigate, Route } from "react-router";
import ClaimStation from "./ClaimStation";
import Rights from "./Rights";
import Settings from "./Settings";
import Translators from "./Translators";

export const stationOutsideRoutes = <Route path="claim/:token" element={<ClaimStation />} />;

export const stationStationRoutes = (
  <>
    <Route path="settings" element={<Navigate to="identity" replace />} />
    <Route path="settings/:section" element={<Settings />} />
    <Route path="settings/team/invite" element={<Settings />} />
    <Route path="translators" element={<Translators />} />
    <Route path="rights" element={<Rights />} />
    <Route path="rights/:claimId" element={<Rights />} />
    <Route path="rights/:claimId/answer" element={<Rights />} />
  </>
);
