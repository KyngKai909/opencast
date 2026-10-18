// End-to-end tests for the site (Phase 4): the flows, axe on every route, keyboard, reduced
// motion and the CSP. They run against the built site (`npm run build -w @opencast/site` first),
// served by scripts/serve.mjs with the production rules, with the in-page mocks answering the API.
// SITE_URL runs them against a deployment instead (`SITE_URL=https://… npm run test:e2e`).
import { defineConfig } from "@playwright/test";

const PORT = 5192;
const SITE_URL = process.env.SITE_URL?.replace(/\/$/, "");

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: SITE_URL ?? `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "off",
    timezoneId: "America/Los_Angeles"
  },
  webServer: SITE_URL ? undefined : {
    command: "node scripts/serve.mjs",
    url: `http://localhost:${PORT}/healthz`,
    env: { PORT: String(PORT), HOST: "127.0.0.1" },
    // Always a fresh server: it keeps dist in memory, so an old one would serve an old build.
    reuseExistingServer: false
  }
});
