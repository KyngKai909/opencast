// The On air area's routes. Station pages sit under `/:callSign` (ControlLayout); setup runs
// before a call sign is fixed, under `/setup/:stationId` (SetupLayout).

import { Navigate, Route } from "react-router";
import { SetupLayout } from "../../layout/SetupLayout";
import SetupLibrary from "../live/SetupLibrary";
import SetupTranslators from "../station/SetupTranslators";
import Monitor from "./Monitor";
import NewStation from "./NewStation";
import ProgramLog from "./ProgramLog";
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
    <Route path="log" element={<ProgramLog />} />
  </>
);
