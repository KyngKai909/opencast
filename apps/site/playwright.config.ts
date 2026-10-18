// End-to-end tests for the site (Phase 4): the flows, axe on every route, keyboard, reduced
// motion and the CSP. They run against the built site (`npm run build -w @opencast/site` first),
// served by scripts/serve.mjs exactly as in production, with the in-page mocks answering the API.
import { defineConfig } from "@playwright/test";

const PORT = 5192;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "off",
    timezoneId: "America/Los_Angeles"
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: `http://localhost:${PORT}/healthz`,
    env: { PORT: String(PORT), HOST: "127.0.0.1" },
    // Always a fresh server: it keeps dist in memory, so an old one would serve an old build.
    reuseExistingServer: false
  }
});
