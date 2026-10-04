// The On air area's routes. Station pages sit under `/control/:callSign` (ControlLayout); setup runs
// before a call sign is fixed, under `/control/setup/:stationId` (SetupLayout).

import { Navigate, Route } from "react-router";
import { SetupLayout } from "../../layout/SetupLayout";
import SetupLibrary from "../live/SetupLibrary";
import SetupTranslators from "../station/SetupTranslators";
import Monitor from "./Monitor";
import NewStation from "./NewStation";
import Blocks from "../live/Blocks";
import OldRoute from "./OldRoute";
import Schedule from "./Schedule";
import SetupLog from "./SetupLog";
import SetupSignOn from "./SetupSignOn";
import SetupStation from "./SetupStation";

export const onAirOutsideRoutes = (
  <>
    <Route path="new" element={<NewStation />} />
    <Route path="setup/:stationId" element={<SetupLayout />}>
      <Route index element={<Navigate to="station" replace />} />
      <Route path="station" element={<SetupStation />} />
      <Route path="library" element={<SetupLibrary />} />
      <Route path="log" element={<SetupLog />} />
      <Route path="translators" element={<SetupTranslators />} />
      <Route path="sign-on" element={<SetupSignOn />} />
    </Route>
  </>
);

export const onAirStationRoutes = (
  <>
    <Route path="monitor" element={<Monitor />} />
    {/* A246: the Schedule workspace, its tabs as routes. */}
    <Route path="schedule" element={<Schedule tab="log" />} />
    <Route path="schedule/templates" element={<Schedule tab="templates" />} />
    <Route path="schedule/templates/:templateId" element={<Schedule tab="templates" />} />
    <Route path="schedule/blocks" element={<Blocks />} />
    <Route path="schedule/blocks/:blockId" element={<Blocks />} />
    <Route path="schedule/rules" element={<Schedule tab="rules" />} />
    {/* The pages it replaced, redirected to its tabs with their query (OldRoute.tsx). */}
    <Route path="log" element={<OldRoute />} />
    <Route path="log/place/:offerId" element={<OldRoute />} />
    <Route path="breaks" element={<OldRoute />} />
    <Route path="blocks" element={<OldRoute />} />
    <Route path="blocks/:blockId" element={<OldRoute />} />
  </>
);
