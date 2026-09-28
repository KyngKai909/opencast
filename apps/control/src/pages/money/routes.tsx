// The Money area's routes, under `/:callSign` (a studio's `/:handle` too).

import { Route } from "react-router";
import Audience from "./Audience";
import Breaks from "./Breaks";
import Earnings from "./Earnings";
import Orders from "./Orders";
import Sponsors from "./Sponsors";
import SpotMarket from "./SpotMarket";
import Statement from "./Statement";
import StudioSpotRotation from "./StudioSpotRotation";

export const moneyStationRoutes = (
  <>
    <Route path="breaks" element={<Breaks />} />
    <Route path="spot-market" element={<SpotMarket />} />
    <Route path="spot-market/orders" element={<Orders />} />
    <Route path="spot-market/orders/:orderId" element={<Orders />} />
    <Route path="spot-market/:spotId" element={<SpotMarket />} />
    <Route path="sponsors" element={<Sponsors />} />
    <Route path="sponsors/:sponsorshipId" element={<Sponsors />} />
    <Route path="earnings" element={<Earnings />} />
    <Route path="earnings/statements/:statementId" element={<Statement />} />
    <Route path="audience" element={<Audience />} />
    {/* A studio's pages. */}
    <Route path="spot-rotation" element={<StudioSpotRotation />} />
  </>
);
