// Playwright flows, one per product (apps prompt, Phase 9), against each app's mock mode
// (`npm run dev:mock`): the mocks stay for tests. `npm run e2e` from the root. A server that's
// already running on its port is reused (the dev servers you have open), otherwise it's started.
// The installed Chrome runs the tests (channel "chrome"): nothing is downloaded.
//
// playwright.real.config.ts runs the same apps against the real API on a throwaway database.

import { defineConfig } from "@playwright/test";

const root = new URL("..", import.meta.url).pathname;
const server = (workspace: string, port: number) => ({
  command: `npm run dev:mock -w ${workspace}`,
  cwd: root,
  url: `http://localhost:${port}`,
  reuseExistingServer: true,
  timeout: 120_000
});

export const PORTS = { viewer: 5174, tv: 5175, control: 5179, spots: 5181, desk: 5182, site: 5183 } as const;

// Start only the servers the chosen projects need (`--project tv` needs TV mode only; the viewer's
// casting flows need TV mode too). With no --project, every app.
const WORKSPACE = { viewer: "@opencast/viewer", tv: "@opencast/tv", control: "@opencast/control", spots: "@opencast/spots", desk: "@opencast/desk", site: "@opencast/site" } as const;
type App = keyof typeof WORKSPACE;
const chosen = process.argv.flatMap((a, i, all) => (a === "--project" ? [all[i + 1]] : a.startsWith("--project=") ? [a.slice(10)] : [])).filter(Boolean) as string[];
const needs: Record<string, App[]> = { viewer: ["viewer", "tv"], desk: ["desk", "viewer"] };
const apps = new Set<App>(chosen.length ? chosen.flatMap((p) => needs[p] ?? [p as App]) : (Object.keys(WORKSPACE) as App[]));

export default defineConfig({
  testDir: "tests",
  // The real-API specs run with playwright.real.config.ts.
  testIgnore: /\.real\.spec\.ts$/,
  outputDir: "test-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: { channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
  projects: [
    { name: "viewer", outputDir: "test-results/viewer", testMatch: /viewer\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.viewer}` } },
    { name: "control", outputDir: "test-results/control", testMatch: /control\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.control}` } },
    { name: "spots", outputDir: "test-results/spots", testMatch: /spots\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.spots}` } },
    { name: "tv", outputDir: "test-results/tv", testMatch: /tv\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.tv}`, viewport: { width: 1920, height: 1080 } } },
    { name: "desk", outputDir: "test-results/desk", testMatch: /desk\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.desk}` } },
    { name: "site", outputDir: "test-results/site", testMatch: /site\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.site}` } }
  ],
  webServer: [...apps].map((a) => server(WORKSPACE[a], PORTS[a]))
});
