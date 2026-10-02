// External stations refuse what they don't have (follow-up Phase 6): no playout, prepared segments,
// spots, sponsor credits, partner ads or earnings, and they're never carried or offered in the
// syndication market. Checked by the router before the handler, whoever asks (an admin too), so
// no screen that forgot to hide a control can do it: 409 `external_station`.

import { accountsApi, billingApi, catalogApi, ledgerApi, libraryApi, logApi, networkApi, platformsApi, playoutApi, relayApi, spotsApi, stationsApi, type EndpointDef } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { conflict } from "../../errors.js";
import type { RouteRegistrar } from "../../http.js";

/** Endpoints for a station (`:stationId`) an external station can't use. */
const BY_PATH: EndpointDef[] = [
  // Playout and the log: its video is the source's own.
  logApi.addEntry,
  logApi.updateEntry,
  logApi.removeEntry,
  logApi.repeatDay,
  logApi.fillGap,
  logApi.createTemplate,
  logApi.updateTemplate,
  logApi.removeTemplate,
  logApi.setOffAirHours,
  logApi.removeRepeat,
  logApi.endEarly,
  logApi.applyLogChanges,
  logApi.updateListing,
  playoutApi.signOn,
  playoutApi.signOff,
  playoutApi.cueBreak,
  // Nothing prepared: no library, programs or live sources.
  libraryApi.upload,
  libraryApi.importLinks,
  libraryApi.createFolder,
  libraryApi.createProgram,
  stationsApi.addLiveSource,
  stationsApi.setHosts,
  stationsApi.setLowerThird,
  stationsApi.setBreakRule,
  // No spots, sponsor credits or partner ads.
  spotsApi.setRotation,
  spotsApi.setSponsorshipSettings,
  spotsApi.stationMarket,
  spotsApi.getAvails,
  // No earnings, pledges or bills.
  ledgerApi.pledge,
  ledgerApi.moveToBank,
  ledgerApi.setPayoutDestination,
  billingApi.setUsageCaps,
  billingApi.startCardSetup,
  billingApi.saveCard,
  billingApi.setFundingSource,
  billingApi.payUsageNow,
  billingApi.quoteClearUsagePayment,
  billingApi.confirmClearUsagePayment,
  // Not relayed elsewhere, claimed or staffed.
  relayApi.updateRelay,
  platformsApi.startPlatformSignIn,
  platformsApi.addManualPlatform,
  stationsApi.addTranslator,
  stationsApi.updateTranslator,
  stationsApi.setRelayBackground,
  networkApi.startHandover,
  accountsApi.inviteToStation,
  accountsApi.transferStationOwnership
];

/** Endpoints that name the station in their body: a sponsorship, an order to a maker, carrying a program. */
const BY_BODY: Array<[EndpointDef, string]> = [
  [spotsApi.offerSponsorship, "stationId"],
  [spotsApi.orderSpot, "makerStationId"],
  [catalogApi.requestCarriage, "carrierStationId"]
];

export function externalGuards(r: RouteRegistrar, { services }: ModuleContext) {
  const refuse = async (stationId: unknown) => {
    if (typeof stationId !== "string") return;
    if ((await services.stations.kindOf(stationId)) !== "listed") return;
    const ident = (await services.stations.idents([stationId])).get(stationId);
    throw conflict(
      "external_station",
      `${ident?.callSign ?? "It"} is an external station: its video is the source's own stream, with no playout, spots, sponsor credits, partner ads or earnings, and it can't be carried or offered in the market.`
    );
  };
  r.guard(BY_PATH, ({ params }) => refuse(params.stationId));
  for (const [endpoint, field] of BY_BODY) r.guard([endpoint], ({ body }) => refuse((body as Record<string, unknown> | undefined)?.[field]));
}
