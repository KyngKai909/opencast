// The Market area's routes, under `/control/:callSign` (a studio's `/control/:handle` too).

import { Route } from "react-router";
import Carried from "./Carried";
import Carriers from "./Carriers";
import Catalog from "./Catalog";
import Market from "./Market";
import Offer from "./Offer";
import OfferProgram from "./OfferProgram";
import Offered from "./Offered";
import PlaceInLog from "./PlaceInLog";
import StudioCarriers from "./StudioCarriers";
import StudioPrograms from "./StudioPrograms";

export const marketStationRoutes = (
  <>
    <Route path="market" element={<Market />} />
    <Route path="market/catalog" element={<Catalog />} />
    <Route path="market/carried" element={<Carried />} />
    <Route path="market/offers/:offerId" element={<Offer />} />
    <Route path="market/offers/:offerId/terms" element={<Offer />} />
    <Route path="market/offers/:offerId/preview/:episodeId" element={<Offer />} />
    <Route path="market/offers/:offerId/carriers" element={<Carriers />} />
    <Route path="market/offered" element={<Offered />} />
    <Route path="market/offered/requests/:requestId" element={<Offered />} />
    <Route path="market/offered/:programId/offer" element={<OfferProgram />} />
    {/* A246: on the Schedule (the old /log/place/:offerId redirects here). */}
    <Route path="schedule/place/:offerId" element={<PlaceInLog />} />
    {/* A studio's pages. */}
    <Route path="programs" element={<StudioPrograms />} />
    <Route path="carriers" element={<StudioCarriers />} />
  </>
);
