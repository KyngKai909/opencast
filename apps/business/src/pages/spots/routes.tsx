// The Spots area's routes.

import { Route } from "react-router";
import Spot from "./Spot";
import SpotRate from "./SpotRate";
import Spots from "./Spots";
import SpotUpload from "./SpotUpload";
import StartSpot from "./StartSpot";

/** Steps under `/:businessId/start` (inside the setup shell). */
export const spotsSetupRoutes = <Route path="spot" element={<StartSpot />} />;

/** Pages under `/:businessId`. */
export const spotsBusinessRoutes = (
  <>
    <Route path="spots" element={<Spots />} />
    <Route path="spots/new" element={<SpotUpload />} />
    <Route path="spots/:spotId/setup" element={<SpotUpload />} />
    <Route path="spots/:spotId/setup/rate" element={<SpotRate />} />
    <Route path="spots/:spotId" element={<Spot />} />
  </>
);
