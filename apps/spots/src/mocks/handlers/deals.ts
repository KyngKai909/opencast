// sponsorships (checkCredit, offerSponsorship, listBusinessSponsorships, endSponsorship) and made to order (listMakers, orderSpot, listBusinessOrders, getOrder, attachBriefFile, acceptQuote, reviewDelivery, addOrderNote, cancelOrder, markOwnMistake).
// The Sponsorships and orders area owns this file.

import type { HttpHandler } from "msw";

export const dealsHandlers: HttpHandler[] = [];
