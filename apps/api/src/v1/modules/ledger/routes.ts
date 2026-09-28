import { ledgerApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function ledgerRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { ledger, accounts } = services;
  const everyone = ["owner", "manager", "viewer"] as const;

  r.handle(api.getBalance, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return ledger.balance(params.businessId);
  });
  r.handle(api.listMovements, async ({ user, params, query }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return ledger.movements(params.businessId, query);
  });
  r.handle(api.addFundingSource, async ({ user, params, body }) => {
    // Managers add money and approve orders, but never change funding.
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    return ledger.addFundingSource(params.businessId, body);
  });
  r.handle(api.quoteDeposit, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.quoteDeposit(params.businessId, body);
  });
  r.handle(api.addMoney, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.addMoney(params.businessId, body);
  });
  r.handle(api.cancelDeposit, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.cancelDeposit(params.businessId, params.depositId);
  });
  r.handle(api.withdraw, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    return ledger.withdraw(params.businessId, body);
  });
  r.handle(api.listStatements, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return ledger.statements({ businessId: params.businessId });
  });
  r.handle(api.getStationEarnings, async ({ user, params, query }) => {
    // Owners and operators can see this; only owners move money.
    await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return ledger.stationEarnings(params.stationId, query.period);
  });
  r.handle(api.listStationStatements, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return ledger.statements({ stationId: params.stationId });
  });
  r.handle(api.getPayoutAccount, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return ledger.payoutAccount(params.stationId);
  });
  r.handle(api.moveToBank, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return ledger.moveToBank(params.stationId, body.amountMicros);
  });
  r.handle(api.pledge, ({ user, params, body }) => ledger.pledge(user.id, params.stationId, body));
  r.handle(api.listMyPledges, ({ user }) => ledger.pledges(user.id));
  r.handle(api.updatePledge, ({ user, params, body }) => ledger.updatePledge(user.id, params.pledgeId, body));
}
