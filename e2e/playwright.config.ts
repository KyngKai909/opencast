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

// The Opencast app (apps/web) is one server for the viewer, master control (/control) and the desk (/desk).
export const PORTS = { web: 5174, tv: 5175, business: 5181, site: 5183 } as const;

// Start only the servers the chosen projects need (`--project tv` needs TV mode only; the viewer's
// casting flows need TV mode too). With no --project, every app.
const WORKSPACE = { web: "@opencast/web", tv: "@opencast/tv", business: "@opencast/business", site: "@opencast/site" } as const;
type App = keyof typeof WORKSPACE;
// `--project a b c` or `--project a --project b` or `--project=a`: every project name given.
const PROJECTS = ["web", "tv", "business", "site"];
const chosen = process.argv.flatMap((a, i, all) => {
  if (a.startsWith("--project=")) return [a.slice(10)];
  if (a !== "--project") return [];
  const names: string[] = [];
  for (let j = i + 1; j < all.length && PROJECTS.includes(all[j]!); j++) names.push(all[j]!);
  return names;
});
const needs: Record<string, App[]> = { web: ["web", "tv"] };
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
  use: { channel: "chrome", trace: "off", screenshot: "only-on-failure", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
  projects: [
    // The Opencast app: its specs keep their area's name (viewer.*, control.*, desk.*).
    { name: "web", outputDir: "test-results/web", testMatch: /(viewer|control|desk)\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.web}` } },
    { name: "business", outputDir: "test-results/business", testMatch: /business\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.business}` } },
    { name: "tv", outputDir: "test-results/tv", testMatch: /tv\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.tv}`, viewport: { width: 1920, height: 1080 } } },
    { name: "site", outputDir: "test-results/site", testMatch: /site\..*\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.site}` } }
  ],
  webServer: [...apps].map((a) => server(WORKSPACE[a], PORTS[a]))
});
