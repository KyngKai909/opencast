// The Money area's routes: getting started (steps 1 and 2) and the balance.

import { Route } from "react-router";
import Balance from "./Balance";
import StartBusiness from "./StartBusiness";
import StartFund from "./StartFund";

/** Step 1, before a business exists (inside the setup shell). */
export const moneyStartRoutes = <Route path="start" element={<StartBusiness />} />;

/** Steps under `/:businessId/start` (inside the setup shell). */
export const moneySetupRoutes = <Route path="fund" element={<StartFund />} />;

/** Pages under `/:businessId` (inside the business shell). */
export const moneyBusinessRoutes = <Route path="balance" element={<Balance />} />;
