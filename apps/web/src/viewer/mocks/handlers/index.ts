// Every mock endpoint, one file per area of the app.
import { dialHandlers } from "./dial";
import { guideHandlers } from "./guide";
import { meHandlers } from "./me";
import { permissionHandlers } from "./permission";
import { searchHandlers } from "./search";
import { stationHandlers } from "./station";
import { tvHandlers } from "./tvs";
import { watchHandlers } from "./watch";
import { viewerInviteHandlers } from "../../../mocks/invites";

export const handlers = [...dialHandlers, ...guideHandlers, ...stationHandlers, ...searchHandlers, ...meHandlers, ...permissionHandlers];
// TVs on the account and the remote relay's pairing (B2).
handlers.push(...tvHandlers);
// Watch data (follow-up Phase 1): the apps' public switches and the "Not for me" vote.
handlers.push(...watchHandlers);
// Invite codes (added 2026-10-07): /join pages, redeeming, and You's own codes.
handlers.push(...viewerInviteHandlers);
