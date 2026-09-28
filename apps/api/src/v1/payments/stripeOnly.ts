// Stripe only, for anyone running Opencast without Clear. Advertisers top up by card or US bank
// account (ACH); all their money sits in the platform's Stripe balance, so holds are kept in the
// ledger alone. Stations are paid through Stripe Connect Express: a payout is a transfer to the
// station's connected account, which Stripe then pays to its bank. An advertiser's withdrawal is
// a refund of their most recent top-ups.

import type { StripeCards } from "./stripe.js";
import { chainCustody, stripeCardFeeMicros, type LedgerAccount, type Payments } from "./types.js";

export function stripeOnlyPayments(stripe: StripeCards, appOrigin: string): Payments {
  return {
    name: "stripe_only",
    // ACH through Stripe costs 0.8%, capped at $5; cards 2.9% + 30¢. Both at cost, on top.
    depositFeeMicros: (kind, amount) => (kind === "card" ? stripeCardFeeMicros(amount) : Math.min(Math.round(amount * 0.008), 5_000_000)),
    arrives: (kind) => (kind === "card" ? "Arrives right away" : "About 4 business days"),

    async linkFundingSource(input, accounts) {
      if (input.kind === "clear_account") throw new Error("Clear accounts aren't available on this server.");
      return stripe.link({ type: "advertiser", id: input.businessId, name: input.businessName }, input.token, accounts);
    },

    async startDeposit(input, accounts) {
      if (input.kind === "clear_account") throw new Error("Clear accounts aren't available on this server.");
      return stripe.charge(
        { depositId: input.depositId, owner: { type: "advertiser", id: input.businessId }, paymentMethodId: input.sourceRef!, amountMicros: input.amountMicros, feeMicros: input.feeMicros, bank: input.kind === "clear_bank" },
        accounts
      );
    },

    cancelDeposit: (ref) => stripe.cancel(ref),

    async startPayout(input, accounts) {
      if (input.from.type === "station") {
        const connect = await stripe.connectAccount({ type: "station", id: input.from.id }, accounts, `${appOrigin}/stations/${input.from.id}/earnings`);
        if (connect.status !== "active") throw new Error("The station hasn't finished setting up payouts with Stripe.");
        return { providerRef: await stripe.transfer({ destination: connect.ref, amountMicros: input.amountMicros, idempotencyKey: `payout:${input.payoutId}`, description: "Opencast earnings" }) };
      }
      if (input.from.type === "advertiser") {
        const customer = await stripe.customer({ type: "advertiser", id: input.from.id }, accounts);
        return { providerRef: await stripe.refund({ customer, amountMicros: input.amountMicros, idempotencyKey: `payout:${input.payoutId}` }) };
      }
      throw new Error("Opencast's own money isn't paid out through Stripe here.");
    },

    startPledge: (input) => stripe.pledge(input),
    endPledge: (ref) => stripe.endSubscription(ref),

    // Everything on Opencast's side sits in one Stripe balance: nothing moves between wallets.
    custody: (account: LedgerAccount) => (account.kind === "external" ? null : (chainCustody(account) ?? "platform")),

    async applyMove(move) {
      // Only encumbrances reach here (one wallet, no transfers); the ledger is the hold.
      return { providerRef: `ledger:${move.idempotencyKey}` };
    },

    async payoutAccount(owner, accounts) {
      if (owner.type !== "station") return { status: "active", url: null };
      const connect = await stripe.connectAccount({ type: "station", id: owner.id, name: owner.name }, accounts, `${appOrigin}/stations/${owner.id}/earnings`);
      return { status: connect.status, url: connect.url };
    },

    async webhook(provider, rawBody, headers) {
      return provider === "stripe" ? stripe.parse(rawBody, headers["stripe-signature"]) : null;
    }
  };
}
