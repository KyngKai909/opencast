// Master control's routes, under /control (src/routes.tsx): every path here is relative to it.
// Each area adds its routes in its own pages/<area>/routes.tsx.

import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { ControlLayout } from "./layout/ControlLayout";
import { NotFound } from "./pages/common";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import { liveStationRoutes } from "./pages/live/routes";
import { marketStationRoutes } from "./pages/market/routes";
import { moneyStationRoutes } from "./pages/money/routes";
import { onAirOutsideRoutes, onAirStationRoutes } from "./pages/onair/routes";
import { stationOutsideRoutes, stationStationRoutes } from "./pages/station/routes";
import { controlPath } from "../areas";

export function AppRoutes() {
  const auth = useAuth();
  const loc = useLocation();
  if (!auth.ready) return null;
  // Claiming a station (rights 05.1), an invite's link and a waitlist invite's link
  // (`/control/new?reservation=<id>`) start signed out: they ask for sign-in themselves.
  const waitlistInvite = loc.pathname === controlPath("/new") && new URLSearchParams(loc.search).has("reservation");
  if (!auth.signedIn && !loc.pathname.startsWith(controlPath("/claim/")) && !loc.pathname.startsWith(controlPath("/invites/")) && !waitlistInvite) return <SignIn />;
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
