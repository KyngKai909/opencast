// The Settings and sign-in area's routes (over the picture).

import { Navigate, Route } from "react-router";
import Market from "./Market";
import Settings from "./Settings";
import Welcome from "./Welcome";

export const settingsRoutes = (
  <>
    <Route path="settings" element={<Navigate to="watching" replace />} />
    <Route path="settings/:section" element={<Settings />} />
    <Route path="welcome" element={<Welcome />} />
    <Route path="market" element={<Market />} />
  </>
);
