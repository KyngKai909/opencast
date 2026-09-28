// The Settings area's routes.

import { Navigate, Route } from "react-router";
import Settings from "./Settings";

export const settingsBusinessRoutes = (
  <>
    <Route path="settings" element={<Navigate to="business" replace />} />
    <Route path="settings/:section" element={<Settings />} />
  </>
);
