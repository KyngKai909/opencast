import { catalogApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function catalogRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { catalog, accounts, library } = services;
  const staff = ["owner", "operator"] as const;

  r.handle(api.browse, async ({ user, query }) => {
    if (query.forStation) await accounts.requireStation(user, query.forStation, [...staff]);
    return catalog.browse(query);
  });
  r.handle(api.getOffer, ({ params }) => catalog.offer(params.offerId));
  // C4: the carrier withdraws a request that hasn't been answered.
  r.handle(api.withdrawRequest, async ({ user, params }) => {
    await accounts.requireStation(user, await catalog.carrierOfRequest(params.requestId), [...staff]);
    return catalog.withdraw(params.requestId);
  });
  r.handle(api.countPreview, async ({ params }) => ({ previews: await catalog.countPreview(params.offerId) }));
  r.handle(api.offerProgram, async ({ user, params, body }) => {
    await accounts.requireStation(user, await library.stationOfProgram(params.programId), [...staff]);
    return catalog.offerProgram(params.programId, body);
  });
  r.handle(api.updateOffer, async ({ user, params, body }) => {
    await accounts.requireStation(user, await catalog.makerOfOffer(params.offerId), [...staff]);
    return catalog.updateOffer(params.offerId, body);
  });
  r.handle(api.requestCarriage, async ({ user, params, body }) => {
    await accounts.requireStation(user, body.carrierStationId, [...staff]);
    return catalog.request(params.offerId, body);
  });
  r.handle(api.listRequests, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return catalog.requests(params.stationId);
  });
  r.handle(api.decideRequest, async ({ user, params, body }) => {
    await accounts.requireStation(user, await catalog.makerOfRequest(params.requestId), [...staff]);
    return catalog.decide(params.requestId, user.id, body);
  });
  r.handle(api.listAgreements, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return catalog.agreements(params.stationId);
  });
  r.handle(api.endAgreement, async ({ user, params }) => {
    const parties = await catalog.partiesOf(params.agreementId);
    // Either side can give notice; find which side the caller is on.
    const asMaker = await accounts.stationRole(user, parties.makerStationId);
    const by = asMaker === "owner" || asMaker === "operator" ? "maker" : "carrier";
    await accounts.requireStation(user, by === "maker" ? parties.makerStationId : parties.carrierStationId, [...staff]);
    return catalog.endAgreement(params.agreementId, by);
  });
  r.handle(api.placeInLog, async ({ user, params, body }) => {
    const parties = await catalog.partiesOf(params.agreementId);
    await accounts.requireStation(user, parties.carrierStationId, [...staff]);
    return catalog.place(params.agreementId, body);
  });
}
