// Stripe: the card on-ramp for both adapters (advertisers' card top-ups and viewers' pledges),
// and in the Stripe-only adapter also bank (ACH) top-ups, Connect Express payouts to stations,
// and refunds for advertisers' withdrawals.

import Stripe from "stripe";
import { cardFrom, fromCents, stripeCardFeeMicros, toCents, type AccountDirectory, type Owner, type PaymentEvent, type PledgeCard } from "./types.js";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** stripe-mock in tests. */
  host?: string;
  port?: number;
  protocol?: "http" | "https";
}

export class StripeCards {
  readonly stripe: Stripe;

  constructor(private config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      maxNetworkRetries: 2,
      ...(config.host ? { host: config.host, port: config.port, protocol: config.protocol ?? "http" } : {})
    });
  }

  /** The Stripe customer for a business, made the first time it's needed. */
  async customer(owner: Owner & { type: "advertiser" }, accounts: AccountDirectory): Promise<string> {
    const known = await accounts.get(owner, "stripe_customer");
    if (known) return known.ref;
    const created = await this.stripe.customers.create({ name: owner.name, metadata: { businessId: owner.id } }, { idempotencyKey: `customer:${owner.id}` });
    await accounts.save(owner, "stripe_customer", { ref: created.id, status: "active" });
    return created.id;
  }

  /** A card (or, Stripe-only, a US bank account) saved in the app with Stripe's own form: `token` is its PaymentMethod ID. */
  async link(owner: Owner & { type: "advertiser" }, paymentMethodId: string, accounts: AccountDirectory): Promise<{ providerRef: string; label: string }> {
    const customer = await this.customer(owner, accounts);
    const pm = await this.stripe.paymentMethods.attach(paymentMethodId, { customer });
    const label = pm.card
      ? `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} ending ${pm.card.last4}`
      : pm.us_bank_account
        ? `${pm.us_bank_account.bank_name ?? "Bank"} ending ${pm.us_bank_account.last4}`
        : "Saved payment method";
    return { providerRef: pm.id, label };
  }

  /** Charges a saved card (or bank) for a top-up, with Stripe's fee on top. */
  async charge(input: { depositId: string; owner: Owner & { type: "advertiser" }; paymentMethodId: string; amountMicros: number; feeMicros: number; bank: boolean }, accounts: AccountDirectory) {
    const customer = await this.customer(input.owner, accounts);
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: toCents(input.amountMicros + input.feeMicros),
        currency: "usd",
        customer,
        // The saved method says whether it's a card or a bank account.
        payment_method: input.paymentMethodId,
        confirm: true,
        off_session: !input.bank,
        description: "Opencast balance top-up",
        metadata: { depositId: input.depositId, businessId: input.owner.id, amountMicros: String(input.amountMicros), feeMicros: String(input.feeMicros) }
      },
      { idempotencyKey: `deposit:${input.depositId}` }
    );
    return {
      providerRef: intent.id,
      status: intent.status === "succeeded" ? ("arrived" as const) : ("pending" as const),
      expectedAt: null,
      clientSecret: intent.status === "requires_action" ? intent.client_secret : null
    };
  }

  async cancel(paymentIntentId: string) {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (!["succeeded", "canceled", "processing"].includes(intent.status)) await this.stripe.paymentIntents.cancel(paymentIntentId);
  }

  /** A pledge through Stripe Checkout: a subscription for monthly, a one-off payment otherwise. */
  async pledge(input: { pledgeId: string; stationId: string; stationName: string; amountMicros: number; cadence: "monthly" | "once"; returnUrl: string }) {
    const metadata = { pledgeId: input.pledgeId, stationId: input.stationId };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: input.cadence === "monthly" ? "subscription" : "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: toCents(input.amountMicros),
              product_data: { name: `Pledge to ${input.stationName}` },
              ...(input.cadence === "monthly" ? { recurring: { interval: "month" as const } } : {})
            }
          }
        ],
        metadata,
        ...(input.cadence === "monthly" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
        success_url: `${input.returnUrl}?pledge=${input.pledgeId}&done=1`,
        cancel_url: `${input.returnUrl}?pledge=${input.pledgeId}`
      },
      { idempotencyKey: `pledge:${input.pledgeId}` }
    );
    return { providerRef: session.id, checkoutUrl: session.url, paidNow: false, feeMicros: stripeCardFeeMicros(input.amountMicros) };
  }

  async endSubscription(ref: string) {
    if (ref.startsWith("sub_")) await this.stripe.subscriptions.update(ref, { cancel_at_period_end: true });
  }

  async resumeSubscription(ref: string) {
    if (ref.startsWith("sub_")) await this.stripe.subscriptions.update(ref, { cancel_at_period_end: false });
  }

  /**
   * E1: Checkout in setup mode for the subscription's customer. When it completes, the webhook
   * makes the new card the subscription's default and reports it (`pledge_card`).
   */
  async cardSession(input: { pledgeId: string; providerRef: string; returnUrl: string }): Promise<{ url: string }> {
    if (!input.providerRef.startsWith("sub_")) throw new Error("This pledge's subscription hasn't started yet.");
    const subscription = await this.stripe.subscriptions.retrieve(input.providerRef);
    const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const metadata = { pledgeId: input.pledgeId, subscription: input.providerRef };
    const session = await this.stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer,
      metadata,
      setup_intent_data: { metadata },
      success_url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}card=updated`,
      cancel_url: input.returnUrl
    });
    if (!session.url) throw new Error("Stripe didn't return a page for the card.");
    return { url: session.url };
  }

  /** The card behind a payment method, if it is one. */
  private async cardOf(paymentMethod: string | Stripe.PaymentMethod | null | undefined): Promise<PledgeCard | null> {
    if (!paymentMethod) return null;
    const pm = typeof paymentMethod === "string" ? await this.stripe.paymentMethods.retrieve(paymentMethod) : paymentMethod;
    return pm.card ? cardFrom(pm.card) : null;
  }

  // ---- Stripe-only: Connect Express, transfers, refunds ----------------------------

  async connectAccount(owner: Owner & { type: "station" }, accounts: AccountDirectory, returnUrl: string) {
    let known = await accounts.get(owner, "stripe_connect");
    if (!known) {
      const created = await this.stripe.accounts.create(
        { type: "express", business_profile: { name: owner.name }, capabilities: { transfers: { requested: true } }, metadata: { stationId: owner.id } },
        { idempotencyKey: `connect:${owner.id}` }
      );
      await accounts.save(owner, "stripe_connect", { ref: created.id, status: "needs_onboarding" });
      known = { ref: created.id, status: "needs_onboarding", onboardingUrl: null };
    }
    if (known.status === "active") return { status: "active" as const, url: null, ref: known.ref };
    const link = await this.stripe.accountLinks.create({ account: known.ref, type: "account_onboarding", refresh_url: returnUrl, return_url: returnUrl });
    await accounts.save(owner, "stripe_connect", { ref: known.ref, status: "needs_onboarding", onboardingUrl: link.url });
    return { status: "needs_onboarding" as const, url: link.url, ref: known.ref };
  }

  async transfer(input: { destination: string; amountMicros: number; idempotencyKey: string; description: string }) {
    const transfer = await this.stripe.transfers.create(
      { amount: toCents(input.amountMicros), currency: "usd", destination: input.destination, description: input.description },
      { idempotencyKey: input.idempotencyKey }
    );
    return transfer.id;
  }

  /** Stripe-only withdrawals: money goes back the way it came, newest top-ups first. */
  async refund(input: { customer: string; amountMicros: number; idempotencyKey: string }) {
    let left = toCents(input.amountMicros);
    const refs: string[] = [];
    const intents = await this.stripe.paymentIntents.list({ customer: input.customer, limit: 100, expand: ["data.latest_charge"] });
    for (const intent of intents.data) {
      if (left <= 0) break;
      const charge = intent.latest_charge;
      if (intent.status !== "succeeded" || !charge || typeof charge === "string") continue;
      // Only the top-up itself comes back; Stripe keeps its fee on a refund.
      const fee = toCents(Number(intent.metadata?.feeMicros ?? 0));
      const refundable = charge.amount - fee - charge.amount_refunded;
      const amount = Math.min(left, refundable);
      if (amount <= 0) continue;
      const refund = await this.stripe.refunds.create({ payment_intent: intent.id, amount }, { idempotencyKey: `${input.idempotencyKey}:${intent.id}` });
      refs.push(refund.id);
      left -= amount;
    }
    if (left > 0) throw new Error("Not enough refundable top-ups for that withdrawal.");
    return refs.join(",");
  }

  // ---- Webhooks --------------------------------------------------------------------

  /** Verifies Stripe's signature and reads the events the ledger acts on. */
  async parse(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent | null> {
    if (!signature) throw new Error("Missing Stripe signature");
    const event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, this.config.webhookSecret);
    switch (event.type) {
      case "payment_intent.succeeded": {
        const depositId = event.data.object.metadata?.depositId;
        return depositId ? { kind: "deposit_arrived", depositId } : null;
      }
      case "payment_intent.payment_failed": {
        const depositId = event.data.object.metadata?.depositId;
        return depositId ? { kind: "deposit_failed", depositId, reason: event.data.object.last_payment_error?.message ?? "The payment failed." } : null;
      }
      case "checkout.session.completed": {
        const session = event.data.object;
        const pledgeId = session.metadata?.pledgeId;
        if (!pledgeId) return null;
        // E1: a new card for a monthly pledge. It becomes the subscription's default.
        if (session.mode === "setup") {
          const subscription = session.metadata?.subscription;
          const intentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
          if (!subscription || !intentId) return null;
          const intent = await this.stripe.setupIntents.retrieve(intentId);
          const pm = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
          if (!pm) return null;
          await this.stripe.subscriptions.update(subscription, { default_payment_method: pm });
          const card = await this.cardOf(pm);
          return card ? { kind: "pledge_card", pledgeId, card } : null;
        }
        // A monthly pledge's subscription: from now on it's known by its subscription (to stop it, or change its card).
        if (session.mode === "subscription") {
          const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
          if (!subscriptionId) return null;
          const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
          return { kind: "pledge_started", pledgeId, providerRef: subscriptionId, card: await this.cardOf(subscription.default_payment_method).catch(() => null) };
        }
        if (session.mode !== "payment" || session.payment_status !== "paid") return null;
        const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        const card = intentId ? await this.stripe.paymentIntents.retrieve(intentId).then((i) => this.cardOf(i.payment_method)).catch(() => null) : null;
        return { kind: "pledge_paid", pledgeId, amountMicros: fromCents(session.amount_total ?? 0), feeMicros: stripeCardFeeMicros(fromCents(session.amount_total ?? 0)), providerRef: session.id, card };
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const pledgeId = invoice.parent?.subscription_details?.metadata?.pledgeId;
        if (!pledgeId) return null;
        const amount = fromCents(invoice.amount_paid);
        // The fee is Stripe's usual card fee; the balance transaction has the exact one.
        return { kind: "pledge_paid", pledgeId, amountMicros: amount, feeMicros: stripeCardFeeMicros(amount), providerRef: invoice.id ?? event.id };
      }
      case "customer.subscription.deleted": {
        const pledgeId = event.data.object.metadata?.pledgeId;
        return pledgeId ? { kind: "pledge_ended", pledgeId } : null;
      }
      case "account.updated": {
        const account = event.data.object;
        const stationId = account.metadata?.stationId;
        return stationId && account.payouts_enabled ? { kind: "account_ready", owner: { type: "station", id: stationId } } : null;
      }
      default:
        return null;
    }
  }
}
