// airings with proof (spots.listSpotAirings), results (spots.getResults), codes and customers (saveOffer, redeemCode, scanCode), statements (ledger.listStatements).
// The Results area owns this file.

import type { HttpHandler } from "msw";

export const resultsHandlers: HttpHandler[] = [];
