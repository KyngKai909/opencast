// Fields home and first visit need beyond api/ext.ts. Each names its request in
// docs/contract-requests.md; when it lands in @opencast/contracts, delete it here.

import { z } from "zod";
import { MarketX } from "../ext";

/**
 * S10 (interim form): where each market sits, so "Use my location" can pick the nearest market on
 * the device. The coordinates never leave the phone, which keeps "Your location is only used to
 * pick a market and isn't stored" true without a coordinates endpoint.
 */
export const MarketPlaceX = MarketX.extend({ centre: z.object({ lat: z.number(), lng: z.number() }).optional() });
export type MarketPlaceX = z.infer<typeof MarketPlaceX>;
export const MarketPlacesX = z.array(MarketPlaceX);
