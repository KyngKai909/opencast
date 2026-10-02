import { ledgerApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function ledgerRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { ledger, accounts } = services;
  const everyone = ["owner", "manager", "viewer"] as const;
  // The balance and its movements are the owner's and managers': a viewer sees results, airings
  // and statements only (biz-settings 02.1). Statements, their CSV and receipts stay everyone's.
  const money = ["owner", "manager"] as const;

  r.handle(api.getBalance, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...money]);
    const [balance, depositAddress] = await Promise.all([ledger.balance(params.businessId), ledger.depositAddress(params.businessId)]);
    // E7: where to send USDC from inside Clear.
    return { ...balance, depositAddress };
  });
  // ---- E4, E5 (added 2026-09-29) ----
  r.handle(api.listReceipts, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, [...everyone]);
    return ledger.receipts(params.businessId);
  });
  r.handle(api.removeFundingSource, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    return ledger.removeFundingSource(params.businessId, params.sourceId);
  });
  r.handle(api.makeDefaultFundingSource, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    return ledger.makeDefaultFundingSource(params.businessId, params.sourceId);
  });
  // E4: a receipt's PDF, at a signed link (the app opens it without the sign-in header). Not a contract endpoint: it answers a PDF.
  r.router.get("/receipts/:businessId/:receiptId/pdf", async (req, res, next) => {
    try {
      const found = /^[0-9a-f-]{36}$/i.test(req.params.businessId) && /^[0-9a-f-]{36}$/i.test(req.params.receiptId)
        ? await ledger.receiptPdf(req.params.businessId, req.params.receiptId, String(req.query.sig ?? ""))
        : null;
      if (!found) {
        res.status(404).json({ error: { code: "not_found", message: "That receipt wasn't found." } });
        return;
      }
      res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${found.filename}"`, "cache-control": "private, no-store" }).send(found.pdf);
    } catch (error) {
      next(error);
    }
  });
  r.handle(api.listMovements, async ({ user, params, query }) => {
    await accounts.requireBusiness(user, params.businessId, [...money]);
    return ledger.movements(params.businessId, query);
  });
  r.handle(api.addFundingSource, async ({ user, params, body }) => {
    // Managers add money and approve orders, but never change funding.
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    return ledger.addFundingSource(params.businessId, body, user.id);
  });
  r.handle(api.quoteDeposit, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.quoteDeposit(params.businessId, body);
  });
  r.handle(api.addMoney, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.addMoney(params.businessId, body);
  });
  r.handle(api.quoteClearTransfer, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.quoteClearTransfer(params.businessId, user.id, body.amountMicros);
  });
  r.handle(api.confirmClearTransfer, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager"]);
    return ledger.confirmClearTransfer(params.businessId, user.id, body);
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
  r.handle(api.getStatementCsv, async ({ user, params }) => {
    const statement = await ledger.statementCsv(params.statementId);
    if (statement.owner.businessId) await accounts.requireBusiness(user, statement.owner.businessId, [...everyone]);
    else if (statement.owner.stationId) await accounts.requireStation(user, statement.owner.stationId, ["owner"]);
    return { filename: statement.filename, csv: statement.csv };
  });
  r.handle(api.getPayoutAccount, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return ledger.payoutAccount(params.stationId);
  });
  r.handle(api.setPayoutDestination, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return ledger.setPayoutDestination(params.stationId, user.id, body.kind);
  });
  r.handle(api.moveToBank, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return ledger.moveToBank(params.stationId, body.amountMicros);
  });
  r.handle(api.pledge, ({ user, params, body }) => ledger.pledge(user.id, params.stationId, body));
  r.handle(api.listMyPledges, ({ user }) => ledger.pledges(user.id));
  r.handle(api.updatePledge, ({ user, params, body }) => ledger.updatePledge(user.id, params.pledgeId, body));
  r.handle(api.pledgeCardSession, ({ user, params, body }) => ledger.pledgeCardSession(user.id, params.pledgeId, body?.returnTo));
}
