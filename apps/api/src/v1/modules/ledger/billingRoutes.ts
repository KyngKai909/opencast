// The Station account (pay-as-you-go, added 2026-09-29): owners and operators see it (operators
// see only, as with earnings); only owners change caps and the funding source, or pay.
import { billingApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function billingRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { billing, accounts } = services;

  r.handle(api.getStationAccount, async ({ user, params }) => {
    const role = await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return billing.account(params.stationId, user, role === "owner");
  });
  r.handle(api.setUsageCaps, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.setCaps(params.stationId, user, body.caps);
  });
  r.handle(api.startCardSetup, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.startCardSetup(params.stationId);
  });
  r.handle(api.saveCard, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return (await billing.saveCard(params.stationId, user, body.setupIntentId))!;
  });
  r.handle(api.removeCard, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.removeCard(params.stationId, user);
  });
  r.handle(api.setFundingSource, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.setFunding(params.stationId, user, body.source);
  });
  r.handle(api.payUsageNow, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.payNow(params.stationId, user);
  });
  r.handle(api.quoteClearUsagePayment, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.quoteClearPayment(params.stationId, user);
  });
  r.handle(api.confirmClearUsagePayment, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return billing.confirmClearPayment(params.stationId, user, body);
  });
}
