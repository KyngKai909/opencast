import { spotsApi as api } from "@opencast/contracts";
import { checkCreditText } from "@opencast/domain";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { notFound } from "../../errors.js";

export function spotsRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
  const { spots, accounts } = services;
  const everyone = ["owner", "manager", "viewer"] as const;
  const doers = ["owner", "manager"] as const;
  const staff = ["owner", "operator"] as const;
  type User = Parameters<typeof accounts.requireBusiness>[0];
  const spotBusiness = async (user: User, spotId: string, roles: readonly ("owner" | "manager" | "viewer")[]) =>
    accounts.requireBusiness(user, await spots.businessOfSpot(spotId), [...roles]);

  // Businesses
  r.handle(api.createBusiness, ({ user, body }) => spots.createBusiness(user, body));
  r.handle(api.getBusiness, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return spots.business(params.businessId);
  });
  r.handle(api.updateBusiness, async ({ user, params, body }) => {
    // Managers change the profile; money settings (auto top-up, tax details) are the owner's.
    const role = await accounts.requireBusiness(user, params.businessId, [...doers]);
    if (role !== "owner" && (body.autoTopUp || body.ein !== undefined || body.legalName !== undefined)) {
      await accounts.requireBusiness(user, params.businessId, ["owner"]);
    }
    return spots.updateBusiness(params.businessId, body);
  });
  r.handle(api.addLocation, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, [...doers]);
    return spots.addLocation(params.businessId, body);
  });
  r.handle(api.removeLocation, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...doers]);
    return spots.removeLocation(params.businessId, params.locationId);
  });

  // Spots
  r.handle(api.listSpots, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return spots.spots(params.businessId);
  });
  r.handle(api.createSpot, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, [...doers]);
    return spots.createSpot(params.businessId, body);
  });
  r.handle(api.getSpot, async ({ user, params }) => {
    await spotBusiness(user, params.spotId, everyone);
    return spots.spot(params.spotId);
  });
  r.handle(api.updateSpot, async ({ user, params, body }) => {
    await spotBusiness(user, params.spotId, doers);
    return spots.updateSpot(params.spotId, body);
  });
  r.handle(api.uploadSpotFile, async ({ user, params, body, file }) => {
    await spotBusiness(user, params.spotId, doers);
    return spots.uploadSpotFile(params.spotId, file!, body.scaleToFit);
  });
  r.handle(api.matchStations, async ({ user, params, body }) => {
    await spotBusiness(user, params.spotId, everyone);
    return { stations: await spots.matches(params.spotId, body) };
  });
  r.handle(api.submitSpot, async ({ user, params }) => {
    await spotBusiness(user, params.spotId, doers);
    return spots.submit(params.spotId);
  });
  r.handle(api.pauseSpot, async ({ user, params }) => {
    await spotBusiness(user, params.spotId, doers);
    return spots.pause(params.spotId);
  });
  r.handle(api.resumeSpot, async ({ user, params }) => {
    await spotBusiness(user, params.spotId, doers);
    return spots.resume(params.spotId);
  });
  r.handle(api.endSpot, async ({ user, params }) => {
    await spotBusiness(user, params.spotId, doers);
    return spots.end(params.spotId);
  });
  r.handle(api.listSpotAirings, async ({ user, params }) => {
    const businessId = await spots.businessOfSpot(params.spotId);
    await accounts.requireBusiness(user, businessId, [...everyone]);
    const now = deps.clock.now();
    const [held, results] = await Promise.all([spots.heldAiringsForSpot(params.spotId, now), spots.results(businessId, now.toISOString().slice(0, 7))]);
    return { held, aired: results.airings.filter((a) => a.spot.id === params.spotId) };
  });
  r.handle(api.reviewQueue, () => spots.reviewQueue());
  r.handle(api.reviewSpot, ({ params, body }) => spots.review(params.spotId, body.decision));

  // The station side
  r.handle(api.stationMarket, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.stationMarket(params.stationId, query);
  });
  r.handle(api.getRotations, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.rotations(params.stationId);
  });
  r.handle(api.setRotation, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.setRotation(params.stationId, params.kind, body.spotIds);
  });
  r.handle(api.getAvails, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    const now = deps.clock.now();
    const breaks = await services.log.breaks(params.stationId, now, new Date(now.getTime() + query.hours * 3_600_000));
    return {
      totalOpenMs: breaks.reduce((s, b) => s + b.openMs, 0),
      breaks: breaks.map((b) => ({ breakStartsAt: b.startsAt, context: b.context, lengthMs: b.lengthMs, openMs: b.openMs, producerShareMs: b.producerShareMs }))
    };
  });

  // Sponsorships
  r.handle(api.checkCredit, ({ body }) => checkCreditText(body.text));
  r.handle(api.offerSponsorship, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, [...doers]);
    return spots.offerSponsorship(params.businessId, body);
  });
  r.handle(api.listBusinessSponsorships, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return spots.businessSponsorships(params.businessId);
  });
  r.handle(api.listStationSponsorships, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.stationSponsorships(params.stationId);
  });
  r.handle(api.decideSponsorship, async ({ user, params, body }) => {
    const { stationId } = await spots.stationOfSponsorship(params.sponsorshipId);
    await accounts.requireStation(user, stationId, [...staff]);
    return spots.decideSponsorship(params.sponsorshipId, user.id, body);
  });
  r.handle(api.endSponsorship, async ({ user, params }) => {
    const { businessId } = await spots.stationOfSponsorship(params.sponsorshipId);
    await accounts.requireBusiness(user, businessId, [...doers]);
    return spots.endSponsorship(params.sponsorshipId);
  });
  r.handle(api.setSponsorshipSettings, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.setSponsorshipSettings(params.stationId, body);
  });

  // Production orders
  r.handle(api.listMakers, () => spots.makers());
  r.handle(api.orderSpot, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, [...doers]);
    return spots.orderSpot(params.businessId, body);
  });
  r.handle(api.listBusinessOrders, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return spots.businessOrders(params.businessId);
  });
  r.handle(api.listMakerOrders, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.makerOrders(params.stationId);
  });

  /** Either side of an order can read it; each side does its own steps. */
  const orderSide = async (user: User, orderId: string, side?: "business" | "maker") => {
    const parties = await spots.partiesOfOrder(orderId);
    const asBusiness = side !== "maker" ? await accounts.requireBusiness(user, parties.businessId, [...(side ? doers : everyone)]).catch(() => null) : null;
    if (asBusiness) return "business" as const;
    if (side === "business") throw notFound("That order");
    await accounts.requireStation(user, parties.makerStationId, [...staff]);
    return "maker" as const;
  };
  r.handle(api.getOrder, async ({ user, params }) => {
    await orderSide(user, params.orderId);
    return spots.order(params.orderId);
  });
  r.handle(api.attachBriefFile, async ({ user, params, file }) => {
    await orderSide(user, params.orderId, "business");
    return spots.attachBriefFile(params.orderId, file!);
  });
  r.handle(api.quoteOrder, async ({ user, params, body }) => {
    await orderSide(user, params.orderId, "maker");
    return spots.quote(params.orderId, body);
  });
  r.handle(api.acceptQuote, async ({ user, params }) => {
    await orderSide(user, params.orderId, "business");
    return spots.acceptQuote(params.orderId);
  });
  r.handle(api.deliverOrder, async ({ user, params, file }) => {
    await orderSide(user, params.orderId, "maker");
    return spots.deliver(params.orderId, file!);
  });
  r.handle(api.addOrderNote, async ({ user, params, body }) => {
    await orderSide(user, params.orderId);
    return spots.addNote(params.orderId, user.id, body);
  });
  r.handle(api.markOwnMistake, async ({ user, params }) => {
    await orderSide(user, params.orderId, "maker");
    return spots.markOwnMistake(params.orderId, params.noteId);
  });
  r.handle(api.reviewDelivery, async ({ user, params, body }) => {
    // Either side can ask Opencast to review; approving and asking for changes is the business's.
    await orderSide(user, params.orderId, body.decision === "dispute" ? undefined : "business");
    return spots.reviewDelivery(params.orderId, body.decision, body.tellMakerWhenListed);
  });
  r.handle(api.cancelOrder, async ({ user, params }) => {
    await orderSide(user, params.orderId, "business");
    return spots.cancelOrder(params.orderId);
  });

  // Codes and results
  r.handle(api.scanCode, ({ params, body }) => spots.scan(params.code, body));
  r.handle(api.saveOffer, ({ params, body }) => spots.saveOffer(params.code, body));
  r.handle(api.redeemCode, async ({ user, params, body }) => {
    // Viewers can see redemptions but not mark them.
    await accounts.requireBusiness(user, params.businessId, [...doers]);
    return spots.redeem(params.businessId, user.id, body);
  });
  r.handle(api.getResults, async ({ user, params, query }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return spots.results(params.businessId, query.month);
  });
  r.handle(api.stationCustomers, async ({ user, params, query }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return spots.stationCustomers(params.stationId, query.month);
  });
}
