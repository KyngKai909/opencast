// Every route. Each area adds its routes in its own pages/<area>/routes.tsx.

import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { ControlLayout } from "./layout/ControlLayout";
import { NotFound } from "./pages/common";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import { liveStationRoutes } from "./pages/live/routes";
import { marketStationRoutes } from "./pages/market/routes";
import { moneyStationRoutes } from "./pages/money/routes";
import { onAirOutsideRoutes, onAirStationRoutes } from "./pages/onair/routes";
import { stationOutsideRoutes, stationStationRoutes } from "./pages/station/routes";

export function AppRoutes() {
  const auth = useAuth();
  const loc = useLocation();
  if (!auth.ready) return null;
  // Claiming a station starts signed out (rights 05.1): it asks for sign-in itself.
  if (!auth.signedIn && !loc.pathname.startsWith("/claim/")) return <SignIn />;
  return (
    <Routes>
      <Route index element={<Home />} />
      {onAirOutsideRoutes}
      {stationOutsideRoutes}
      <Route path=":callSign" element={<ControlLayout />}>
        <Route index element={<Navigate to="monitor" replace />} />
        {onAirStationRoutes}
        {liveStationRoutes}
        {marketStationRoutes}
        {moneyStationRoutes}
        {stationStationRoutes}
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
