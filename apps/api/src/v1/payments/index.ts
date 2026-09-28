// Picks the payments adapter from the environment:
//
//   PAYMENTS_PROVIDER=fake          (default) nothing real moves
//   PAYMENTS_PROVIDER=clear         Clear accounts; Stripe for cards when STRIPE_SECRET_KEY is set
//   PAYMENTS_PROVIDER=stripe_only   Stripe balances and Connect Express; needs STRIPE_SECRET_KEY
//
// Clear's API isn't wired yet (see docs/clear-integration.md), so "clear" runs against the
// in-memory fake Clear and says so.

import { usdcFromEnv } from "../chain/usdc.js";
import { clearPayments, fakeClear } from "./clear.js";
import { fakePayments } from "./fake.js";
import { StripeCards } from "./stripe.js";
import { stripeOnlyPayments } from "./stripeOnly.js";
import type { Payments } from "./types.js";

export * from "./types.js";
export { fakePayments } from "./fake.js";
export { clearPayments, fakeClear, type ClearClient } from "./clear.js";
export { StripeCards } from "./stripe.js";
export { stripeOnlyPayments } from "./stripeOnly.js";

export function paymentsFromEnv(env: NodeJS.ProcessEnv, clock: { now(): Date }, appOrigin: string): Payments {
  const provider = env.PAYMENTS_PROVIDER ?? "fake";
  const stripe = env.STRIPE_SECRET_KEY ? new StripeCards({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "" }) : null;
  if (env.STRIPE_SECRET_KEY?.startsWith("sk_live") && env.NODE_ENV !== "production") {
    throw new Error("A live Stripe key outside production. Use a test key (sk_test_…) here.");
  }
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
