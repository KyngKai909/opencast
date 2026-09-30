// Picks the payments adapter from the environment:
//
//   PAYMENTS_PROVIDER=fake          (default) nothing real moves
//   PAYMENTS_PROVIDER=clear         Clear accounts; Stripe for cards when STRIPE_SECRET_KEY is set
//   PAYMENTS_PROVIDER=stripe_only   Stripe balances and Connect Express; needs STRIPE_SECRET_KEY
//
// STRIPE_SECRET_KEY is Opencast's own restricted key (rk_…) on ClearLabs Inc's Stripe account,
// never the account's secret key (sk_…, refused), and a live one only in production. Its webhook
// endpoint has its own STRIPE_WEBHOOK_SECRET; STRIPE_METADATA_APP (default "opencast") tags every
// object Opencast creates, STRIPE_STATEMENT_DESCRIPTOR_SUFFIX (default "OPENCAST") goes on every
// card charge, STRIPE_PUBLISHABLE_KEY is for the apps' card form. docs/stripe.md.
//
// Clear's API isn't wired yet (see docs/clear-integration.md), so "clear" runs against the
// in-memory fake Clear and says so.

import { usdcFromEnv } from "../chain/usdc.js";
import { clearPayments, fakeClear } from "./clear.js";
import { fakePayments } from "./fake.js";
import { StripeCards, stripeKeyProblem } from "./stripe.js";
import { stripeOnlyPayments } from "./stripeOnly.js";
import type { Payments } from "./types.js";

export * from "./types.js";
export { fakePayments } from "./fake.js";
export { clearPayments, fakeClear, type ClearClient } from "./clear.js";
export { StripeCards, stripeKeyProblem, cleanSuffix, DEFAULT_APP_TAG, DEFAULT_STATEMENT_SUFFIX } from "./stripe.js";
export { stripeOnlyPayments } from "./stripeOnly.js";

export function paymentsFromEnv(env: NodeJS.ProcessEnv, clock: { now(): Date }, appOrigin: string): Payments {
  const provider = env.PAYMENTS_PROVIDER ?? "fake";
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (key) {
    const problem = stripeKeyProblem(key, env.NODE_ENV === "production");
    if (problem) throw new Error(problem);
    if (!env.STRIPE_WEBHOOK_SECRET) console.warn("[v1] payments: STRIPE_WEBHOOK_SECRET isn't set, so Stripe's webhooks will be refused.");
  }
  const stripe = key
    ? new StripeCards({
        secretKey: key,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
        appTag: env.STRIPE_METADATA_APP?.trim() || undefined,
        statementDescriptorSuffix: env.STRIPE_STATEMENT_DESCRIPTOR_SUFFIX?.trim() || undefined,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY?.trim() || null
      })
    : null;
  if (provider === "stripe_only") {
    if (!stripe) throw new Error("PAYMENTS_PROVIDER=stripe_only needs STRIPE_SECRET_KEY.");
    console.warn("[v1] payments: Stripe only (balances and Connect Express).");
    return stripeOnlyPayments(stripe, appOrigin);
  }
  if (provider === "clear") {
    console.warn(`[v1] payments: Clear (the in-memory fake Clear until its API is wired)${stripe ? ", Stripe for cards" : ", cards faked"}.`);
    // Transfers from linked Clear wallets are checked on chain when CHAIN_RPC_URL, CHAIN_ID and USDC_ADDRESS are set.
    return clearPayments(fakeClear(), stripe, fakePayments(clock), { usdc: usdcFromEnv(env) });
  }
  console.warn("[v1] payments: using the local fake. No real money moves.");
  return fakePayments(clock);
}
