// The Settings area's routes. /settings is the list of sections on the phone, and Business on the
// web (the page sends it there).

import { Route } from "react-router";
import Settings from "./Settings";

export const settingsBusinessRoutes = (
  <>
    <Route path="settings" element={<Settings />} />
    <Route path="settings/:section" element={<Settings />} />
  </>
);
