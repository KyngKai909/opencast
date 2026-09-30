// The Phase 2 STOP demo (pay-as-you-go): October 2026 for three stations on a throwaway database,
// printed as master control's Station account, the statements and the notices the owners got.
//
//   npm run demo:billing -w @opencast/api      (Postgres up: npm run db:up)
//
// - PREP stays inside the free allowance;
// - BEAT is paid from its earnings (taken before each weekly payout, and at month end);
// - REEL runs out of funding (a declined card): its grace period starts on November 1, its relays
//   and live shows pause on the 15th while its channel keeps airing, and come back when it pays.
//
// The month itself is test/billing-month.ts, which test/billing-month.test.ts checks. Prices are
// the rules registry's starting versions (migration 0033, docs/pricing.md). Nothing real is charged:
// the payments provider is the local fake.

// Never a real provider (as the tests' setup does), before anything loads.
for (const key of ["LIVEPEER_API_KEY", "PINATA_JWT", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE", "PRIVY_APP_SECRET", "STRIPE_SECRET_KEY"]) process.env[key] = "";

const { createMonthHarness, monthReport, runMonth } = await import("../test/billing-month.js");

const { h, mirror, cards } = await createMonthHarness();
try {
  const run = await runMonth(h, mirror, cards);
  console.log(`\n${await monthReport(run)}\n`);
} finally {
  await h.close();
}
