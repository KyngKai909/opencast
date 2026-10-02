// Stripe: the card on-ramp for both adapters (advertisers' card top-ups and viewers' pledges),
// stations' cards for pay-as-you-go (2026-09-29), and in the Stripe-only adapter also bank (ACH)
// top-ups, Connect Express payouts to stations, and refunds for advertisers' withdrawals.
//
// Opencast uses ClearLabs Inc's Stripe account for now, kept apart from Clear's use of it
// (docs/stripe.md): a restricted key of its own (`rk_…`), its own webhook endpoint and signing
// secret, `metadata.app` ("opencast") on every object it creates (webhook events whose object
// lacks it are ignored), and the statement suffix ("OPENCAST") on every card charge. All of it
// comes from configuration, so moving to Opencast's own account is a change of variables.

import Stripe from "stripe";
import { cardFrom, fromCents, stripeCardFeeMicros, toCents, type AccountDirectory, type Owner, type PaymentEvent, type PledgeCard, type StationCardRail } from "./types.js";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** `metadata.app` on everything Opencast creates (STRIPE_METADATA_APP, default "opencast"). */
  appTag?: string;
  /** On every card charge (STRIPE_STATEMENT_DESCRIPTOR_SUFFIX, default "OPENCAST"). */
  statementDescriptorSuffix?: string;
  /** For the apps' card form (STRIPE_PUBLISHABLE_KEY). */
  publishableKey?: string | null;
  /** stripe-mock in tests. */
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  /** Tests: a transport that records what would be sent. */
  httpClient?: Stripe.HttpClient;
}

export const DEFAULT_APP_TAG = "opencast";
export const DEFAULT_STATEMENT_SUFFIX = "OPENCAST";

/**
 * The key Opencast may use: a restricted key (`rk_`), never an account's main secret key (`sk_`),
 * and a live one only in production. Returns why not, or null when it's fine.
 */
export function stripeKeyProblem(key: string, production: boolean): string | null {
  if (key.startsWith("sk_")) return "STRIPE_SECRET_KEY is a secret key (sk_…). Opencast uses a restricted key of its own (rk_…) with only the permissions in docs/stripe.md.";
  if (!key.startsWith("rk_")) return "STRIPE_SECRET_KEY isn't a Stripe restricted key (rk_test_… or rk_live_…).";
  if (key.startsWith("rk_live") && !production) return "A live Stripe key outside production. Use a test key (rk_test_…) here.";
  return null;
}

/** Stripe's statement suffix: up to 22 characters, at least one letter, none of < > \ ' " *. */
export function cleanSuffix(value: string | undefined): string {
  const cleaned = (value ?? DEFAULT_STATEMENT_SUFFIX).replace(/[<>\\'"*]/g, "").trim().slice(0, 22);
  return /[A-Za-z]/.test(cleaned) ? cleaned : DEFAULT_STATEMENT_SUFFIX;
}

export class StripeCards {
  readonly stripe: Stripe;

  readonly appTag: string;
  readonly suffix: string;

  constructor(private config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      maxNetworkRetries: 2,
      ...(config.host ? { host: config.host, port: config.port, protocol: config.protocol ?? "http" } : {}),
      ...(config.httpClient ? { httpClient: config.httpClient } : {})
    });
    this.appTag = config.appTag || DEFAULT_APP_TAG;
    this.suffix = cleanSuffix(config.statementDescriptorSuffix);
  }

  /** Opencast's metadata: `app` first, so every object says whose it is. */
  private meta(extra: Record<string, string> = {}): Record<string, string> {
    return { app: this.appTag, ...extra };
  }

  /** Whether an object is Opencast's (its `metadata.app`). Invoices from a subscription carry it on the subscription's details. */
  isOurs(object: unknown): boolean {
    const o = object as { metadata?: Record<string, string> | null; parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null; subscription_details?: { metadata?: Record<string, string> | null } | null };
    return o?.metadata?.app === this.appTag || o?.parent?.subscription_details?.metadata?.app === this.appTag || o?.subscription_details?.metadata?.app === this.appTag;
  }

  /** The Stripe customer for a business or (pay-as-you-go) a station, made the first time it's needed. */
  async customer(owner: Owner & { type: "advertiser" | "station" }, accounts: AccountDirectory): Promise<string> {
    const known = await accounts.get(owner, "stripe_customer");
    if (known) return known.ref;
    const created = await this.stripe.customers.create(
      { name: owner.name, metadata: this.meta(owner.type === "station" ? { stationId: owner.id } : { businessId: owner.id }) },
      { idempotencyKey: owner.type === "station" ? `customer:station:${owner.id}` : `customer:${owner.id}` }
    );
    await accounts.save(owner, "stripe_customer", { ref: created.id, status: "active" });
    return created.id;
  }

  /** A card (or, Stripe-only, a US bank account) saved in the app with Stripe's own form: `token` is its PaymentMethod ID. */
  async link(owner: Owner & { type: "advertiser" }, paymentMethodId: string, accounts: AccountDirectory): Promise<{ providerRef: string; label: string }> {
    const customer = await this.customer(owner, accounts);
    // Attaching changes a method Opencast's own form made; its metadata is set as it's attached to Opencast's customer.
    const pm = await this.stripe.paymentMethods.attach(paymentMethodId, { customer });
    await this.stripe.paymentMethods.update(pm.id, { metadata: this.meta({ businessId: owner.id }) }).catch(() => undefined);
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
        // The suffix is for card charges only; a bank debit has its own descriptor.
        ...(input.bank ? {} : { statement_descriptor_suffix: this.suffix }),
        metadata: this.meta({ depositId: input.depositId, businessId: input.owner.id, amountMicros: String(input.amountMicros), feeMicros: String(input.feeMicros) })
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
    const metadata = this.meta({ pledgeId: input.pledgeId, stationId: input.stationId });
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
        // A one-off pledge's charge carries the suffix here; a monthly one's renewals get it on each
        // draft invoice (`invoice.created`, below): Checkout has no suffix for subscriptions.
        ...(input.cadence === "monthly" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata, statement_descriptor_suffix: this.suffix } }),
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
    const metadata = this.meta({ pledgeId: input.pledgeId, subscription: input.providerRef });
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
        { type: "express", business_profile: { name: owner.name }, capabilities: { transfers: { requested: true } }, metadata: this.meta({ stationId: owner.id }) },
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
      { amount: toCents(input.amountMicros), currency: "usd", destination: input.destination, description: input.description, metadata: this.meta() },
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
      // Only Opencast's own top-ups (the account's other charges aren't ours to refund).
      if (!this.isOurs(intent) || !intent.metadata?.depositId) continue;
      const charge = intent.latest_charge;
      if (intent.status !== "succeeded" || !charge || typeof charge === "string") continue;
      // Only the top-up itself comes back; Stripe keeps its fee on a refund.
      const fee = toCents(Number(intent.metadata?.feeMicros ?? 0));
      const refundable = charge.amount - fee - charge.amount_refunded;
      const amount = Math.min(left, refundable);
      if (amount <= 0) continue;
      const refund = await this.stripe.refunds.create({ payment_intent: intent.id, amount, metadata: this.meta() }, { idempotencyKey: `${input.idempotencyKey}:${intent.id}` });
      refs.push(refund.id);
      left -= amount;
    }
    if (left > 0) throw new Error("Not enough refundable top-ups for that withdrawal.");
    return refs.join(",");
  }

  // ---- Pay-as-you-go: stations' cards ------------------------------------------------

  /** A station's card: saved with a SetupIntent, charged off-session at month end. */
  stationCards(): StationCardRail {
    return {
      publishableKey: this.config.publishableKey ?? null,
      setupCard: async (input, accounts) => {
        const customer = await this.customer({ type: "station", id: input.stationId, name: input.stationName }, accounts);
        // Cards only: the app's form asks for a card, and `savedCard` refuses anything else.
        const intent = await this.stripe.setupIntents.create({
          customer,
          usage: "off_session",
          description: `Opencast usage for ${input.stationName}`,
          metadata: this.meta({ stationId: input.stationId })
        });
        if (!intent.client_secret) throw new Error("Stripe didn't return a client secret for the card.");
        return { setupIntentId: intent.id, clientSecret: intent.client_secret };
      },
      savedCard: async (input) => {
        const intent = await this.stripe.setupIntents.retrieve(input.setupIntentId);
        if (!this.isOurs(intent) || intent.metadata?.stationId !== input.stationId) throw new Error("That card setup isn't this station's.");
        if (intent.status !== "succeeded") throw new Error("The card wasn't confirmed.");
        const pmId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
        if (!pmId) throw new Error("The card setup has no card.");
        const pm = await this.stripe.paymentMethods.retrieve(pmId);
        if (!pm.card) throw new Error("Only a card can pay for usage.");
        await this.stripe.paymentMethods.update(pmId, { metadata: this.meta({ stationId: input.stationId }) }).catch(() => undefined);
        const card = cardFrom(pm.card);
        return { paymentMethodId: pmId, label: card.label, expiresOn: card.expiresOn };
      },
      chargeUsage: async (input, accounts) => {
        const customer = await this.customer({ type: "station", id: input.stationId, name: input.stationName }, accounts);
        const cents = toCents(input.amountMicros);
        try {
          const intent = await this.stripe.paymentIntents.create(
            {
              amount: cents,
              currency: "usd",
              customer,
              payment_method: input.paymentMethodId,
              confirm: true,
              off_session: true,
              description: input.description,
              statement_descriptor_suffix: this.suffix,
              metadata: this.meta({ usageBillId: input.billId, stationId: input.stationId, amountMicros: String(input.amountMicros) })
            },
            { idempotencyKey: `usage:${input.billId}:${input.attempt}` }
          );
          const fee = stripeCardFeeMicros(fromCents(cents));
          if (intent.status === "succeeded") return { status: "succeeded", providerRef: intent.id, feeMicros: fee, reason: null };
          if (intent.status === "processing") return { status: "pending", providerRef: intent.id, feeMicros: fee, reason: null };
          const reason = intent.status === "requires_action" ? "Your bank wants to confirm this charge. Pay now in master control." : (intent.last_payment_error?.message ?? "The card wasn't charged.");
          return { status: "failed", providerRef: intent.id, feeMicros: 0, reason };
        } catch (error) {
          // A decline is an answer, not an outage.
          if (error instanceof Stripe.errors.StripeCardError) {
            const intentId = (error.raw as { payment_intent?: { id?: string } } | undefined)?.payment_intent?.id ?? null;
            return { status: "failed", providerRef: intentId, feeMicros: 0, reason: error.message };
          }
          throw error;
        }
      },
      detachCard: async (paymentMethodId) => {
        await this.stripe.paymentMethods.detach(paymentMethodId);
      }
    };
  }

  // ---- Webhooks --------------------------------------------------------------------

  /**
   * Verifies Stripe's signature and reads the events the ledger acts on. The account is shared
   * with Clear, so an event whose object isn't Opencast's (no `metadata.app`) is ignored.
   */
  async parse(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent | null> {
    if (!signature) throw new Error("Missing Stripe signature");
    const event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, this.config.webhookSecret);
    if (!this.isOurs(event.data.object)) return null;
    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        const billId = intent.metadata?.usageBillId;
        if (billId) {
          const amount = fromCents(intent.amount_received || intent.amount);
          return { kind: "usage_paid", billId, providerRef: intent.id, amountMicros: amount, feeMicros: stripeCardFeeMicros(amount) };
        }
        const depositId = intent.metadata?.depositId;
        return depositId ? { kind: "deposit_arrived", depositId } : null;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const reason = intent.last_payment_error?.message ?? "The payment failed.";
        if (intent.metadata?.usageBillId) return { kind: "usage_failed", billId: intent.metadata.usageBillId, providerRef: intent.id, reason };
        const depositId = intent.metadata?.depositId;
        return depositId ? { kind: "deposit_failed", depositId, reason } : null;
      }
      case "setup_intent.succeeded": {
        const intent = event.data.object;
        const stationId = intent.metadata?.stationId;
        return stationId ? { kind: "station_card_saved", stationId, setupIntentId: intent.id } : null;
      }
      case "invoice.created": {
        // A monthly pledge's renewal, still a draft: its card charge carries the suffix too.
        const invoice = event.data.object;
        // A failure here mustn't make Stripe retry the event forever: it's logged, and the renewal goes without the suffix.
        if (invoice.status === "draft" && invoice.id) {
          await this.stripe.invoices.update(invoice.id, { statement_descriptor: this.suffix }).catch((error) => console.error(`[stripe] the suffix on invoice ${invoice.id} failed`, (error as Error).message));
        }
        return null;
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
