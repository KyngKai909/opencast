// After the real-API runs: the API stops and drops its database (run.ts), unless the run was one
// `npm run real:up` started.

import { stopRun } from "./run.js";

export default async function globalTeardown() {
  if (process.env.E2E_REAL_REUSED === "1") return;
  await stopRun();
}
