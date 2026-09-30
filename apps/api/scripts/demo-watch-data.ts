// The Phase 1 STOP demo (watch data): a Friday evening on a throwaway database, printed as master
// control's Audience page (BEAT, and KRAD on the radio band), MAKR's view of Night Signal across its
// carriers, and the stored aggregates; then 30 days on, what the daily purge leaves.
//
//   npm run demo:watch-data -w @opencast/api      (Postgres up: npm run db:up)
//
// The evening itself is test/watch-evening.ts, which test/watch-data-evening.test.ts checks.

// Never a real provider (as the tests' setup does), before anything loads.
for (const key of ["LIVEPEER_API_KEY", "PINATA_JWT", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE", "PRIVY_APP_SECRET"]) process.env[key] = "";

const { createHarness } = await import("../test/harness.js");
const { eveningReport, runEvening, thirtyDaysOn } = await import("../test/watch-evening.js");

const h = await createHarness();
try {
  const evening = await runEvening(h);
  console.log(`\n${(await eveningReport(h, evening)).text}\n`);
  const { purged, left } = await thirtyDaysOn(h);
  console.log("30 days on, the daily purge:");
  console.log(`  deleted ${purged.sessions} sessions, ${purged.minutes} session minutes, ${purged.votes} votes (the rest were deleted once their airing was final)`);
  console.log(`  left: ${left.airingStats} airings' numbers (audience.airing_stats), ${left.minuteSamples} station minutes (audience.minute_samples); ${left.sessions} sessions, ${left.sessionMinutes} session minutes, ${left.votes} votes`);
  console.log("  Neither table has a session, a person, a device or an address in it (docs/schema.md, Watch data).\n");
} finally {
  await h.close();
}
