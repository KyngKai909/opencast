// The Sponsorships and orders area's routes.

import { Route } from "react-router";
import NewOrder from "./NewOrder";
import NewSponsorship from "./NewSponsorship";
import Order from "./Order";
import Orders from "./Orders";
import Sponsorships from "./Sponsorships";

export const dealsBusinessRoutes = (
  <>
    <Route path="sponsorships" element={<Sponsorships />} />
    <Route path="sponsorships/new" element={<NewSponsorship />} />
    <Route path="orders" element={<Orders />} />
    <Route path="orders/new" element={<NewOrder />} />
    <Route path="orders/:orderId" element={<Order />} />
  </>
);
