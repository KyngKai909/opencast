// What the Market area needs that the catalog contract doesn't have yet, as an optional extension
// (see ../ext.ts for the pattern). The rest of the market's requests (L1, C1 to C9) landed on
// 2026-09-29. Against the real API the field is absent, and the screen falls back as noted.

import { catalogApi } from "@opencast/contracts";
import { z } from "zod";

/**
 * C5 (the part not in the contract): whether an episode has speech, so no captions reads "None,
 * no speech" rather than "None". Absent, it reads "None".
 */
const EpisodeX = catalogApi.getOffer.response.shape.episodes.element.extend({ speech: z.boolean().optional() });
export type EpisodeX = z.infer<typeof EpisodeX>;

/** getOffer, with `speech` on its episodes. */
export const OfferDetailX = catalogApi.getOffer.response.extend({ episodes: z.array(EpisodeX) });
export type OfferDetailX = z.infer<typeof OfferDetailX>;
