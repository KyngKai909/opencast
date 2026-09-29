// Before the real-API runs: the API on :8788 over a fresh, seeded database (run.ts). A run that
// `npm run real:up` already started is used as it is, and left running afterwards.

import { existsSync } from "node:fs";
import { startRun } from "./run.js";
import { API_BASE, STATE_FILE } from "./shared.js";

export default async function globalSetup() {
  if (existsSync(STATE_FILE)) {
    const ready = await fetch(`${API_BASE}/e2e/ready`).then((r) => r.ok).catch(() => false);
    if (ready) {
      process.env.E2E_REAL_REUSED = "1";
      console.log(`[real] using the run that's already up (${API_BASE})`);
      return;
    }
  }
  const state = await startRun();
  console.log(`[real] the API is up on ${state.apiBase} with ${state.database}`);
}
