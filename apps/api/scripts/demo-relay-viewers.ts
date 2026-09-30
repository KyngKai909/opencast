// The Phase 3 STOP demo's billing half (relay viewers): a week of October 2026 on BEAT, relayed to
// YouTube and Twitch (fake platforms: nothing real is called), with the same $8-per-thousand spot
// bought by an online business and a local one, through the month's end. Printed as each airing's
// parts, the businesses' results and statements, and BEAT's earnings, on a throwaway database.
//
//   npm run demo:relay-viewers -w @opencast/api      (Postgres up: npm run db:up)
//
// - Clicky Shop (online) pays for Opencast's viewers plus every relay viewer, settled minutes later;
// - Orange Street Coffee (local) pays for the Opencast viewers placed in its area, and for YouTube's
//   relay viewers only for the share YouTube's location data places there, settled when it comes:
//   Monday, Tuesday and Thursday settle; Wednesday had no location data (not billed); Friday's never
//   came, so its relay part returned after 7 days. Twitch is never billed to it.
//
// The week itself is test/relay-month.ts, which test/relay-month.test.ts checks.

for (const key of ["LIVEPEER_API_KEY", "PINATA_JWT", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE", "PRIVY_APP_SECRET", "STRIPE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"]) process.env[key] = "";

const { relayReport, runRelayMonth } = await import("../test/relay-month.js");

const run = await runRelayMonth();
try {
  console.log(`\n${await relayReport(run)}\n`);
} finally {
  await run.h.close();
}
