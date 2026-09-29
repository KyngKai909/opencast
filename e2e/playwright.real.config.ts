// The apps against the real API (apps prompt, Phase 9): `npm run e2e:real` from the root, or
// `npx playwright test -c playwright.real.config.ts --project control` here. docs/apps/testing.md.
//
// The global setup starts the API (the v1 routers and services, with the fakes the API's tests use
// for everything outside) on :8788 over a throwaway database on the Docker Postgres, migrated and
// seeded (e2e/real/seed.ts); the teardown drops it. Each app runs its dev server in real mode on an
// e2e port, with the test-token sign-in (e2e/lib/real.ts signIn). Specs are
// `tests/<product>[.<name>].real.spec.ts`; the mock config leaves them out.

import { defineConfig } from "@playwright/test";
import { appCommand, appEnv } from "./real/apps";
import { REAL_PORTS, ROOT, WORKSPACES, type RealApp } from "./real/shared";

// Start only the servers the chosen projects need, as playwright.config.ts does.
// `--project a b c` or `--project a --project b` or `--project=a`: every project name given.
const PROJECTS = ["viewer", "tv", "control", "business", "desk", "site"];
const chosen = process.argv.flatMap((a, i, all) => {
  if (a.startsWith("--project=")) return [a.slice(10)];
  if (a !== "--project") return [];
  const names: string[] = [];
  for (let j = i + 1; j < all.length && PROJECTS.includes(all[j]!); j++) names.push(all[j]!);
  return names;
});
const needs: Record<string, RealApp[]> = { viewer: ["viewer", "tv"], desk: ["desk", "viewer"] };
const apps = new Set<RealApp>(chosen.length ? chosen.flatMap((p) => needs[p] ?? [p as RealApp]) : (Object.keys(REAL_PORTS) as RealApp[]));

const spec = (product: string) => new RegExp(`(^|/)${product}\\.(.+\\.)?real\\.spec\\.ts$`);
const baseURL = (app: RealApp) => `http://localhost:${REAL_PORTS[app]}`;

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results/real",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  globalSetup: "./real/global-setup.ts",
  globalTeardown: "./real/global-teardown.ts",
  reporter: [["list"], ["html", { open: "never", outputFolder: "report/real" }]],
  use: { channel: "chrome", trace: "off", screenshot: "only-on-failure", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
  projects: [
    { name: "viewer", outputDir: "test-results/real/viewer", testMatch: spec("viewer"), use: { baseURL: baseURL("viewer") } },
    { name: "control", outputDir: "test-results/real/control", testMatch: spec("control"), use: { baseURL: baseURL("control") } },
    { name: "business", outputDir: "test-results/real/business", testMatch: spec("business"), use: { baseURL: baseURL("business") } },
    { name: "tv", outputDir: "test-results/real/tv", testMatch: spec("tv"), use: { baseURL: baseURL("tv"), viewport: { width: 1920, height: 1080 } } },
    { name: "desk", outputDir: "test-results/real/desk", testMatch: spec("desk"), use: { baseURL: baseURL("desk") } },
    { name: "site", outputDir: "test-results/real/site", testMatch: spec("site"), use: { baseURL: baseURL("site") } }
  ],
  webServer: [...apps].map((a) => ({
    command: appCommand(REAL_PORTS[a]),
    cwd: `${ROOT}/${WORKSPACES[a]}`,
    env: appEnv(a),
    url: baseURL(a),
    reuseExistingServer: true,
    timeout: 120_000
  }))
});
