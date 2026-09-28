// Every route of TV mode: "/" is the picture; the rest are overlays over it (the picture keeps
// playing). Each area adds its routes in its own pages/<area>/routes.tsx.

import { Route, Routes } from "react-router";
import { TvLayout } from "./tv/TvApp";
import { guideRoutes } from "./pages/guide/routes";
import { settingsRoutes } from "./pages/settings/routes";
import { watchingRoutes } from "./pages/watching/routes";

export const tvRoutes = (
  <Routes>
    <Route element={<TvLayout />}>
      {watchingRoutes}
      {guideRoutes}
      {settingsRoutes}
      <Route path="*" element={null} />
    </Route>
  </Routes>
);
