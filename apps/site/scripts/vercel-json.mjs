// Writes apps/site/vercel.json from scripts/http.mjs, so Vercel serves the site the way
// scripts/serve.mjs does. vercel.json is read before the build runs, so it's committed: run this
// again (`npm run vercel:config -w @opencast/site`, with PUBLIC_API_URL set the way the Vercel
// project has it) whenever http.mjs or the API's address changes. src/lib/vercel.test.ts checks
// that the committed file is current.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CACHE, REDIRECTS, securityHeaders } from "./http.mjs";

export function vercelConfig(origin) {
  const headers = (h) => Object.entries(h).map(([key, value]) => ({ key, value }));
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: "astro",
    // npm workspaces: install and build from the repository root.
    installCommand: "cd ../.. && npm ci",
    buildCommand: "cd ../.. && npm run build -w @opencast/site",
    outputDirectory: "dist",
    // The project builds from Git on every push to the repository; this skips the build (exit 0)
    // on branches where apps/site is still the old Vite site, and on commits that touch neither
    // the site, the contracts it imports, nor the lockfile. Those old branches have no vercel.json,
    // so the project's settings carry the same command (docs/site/deploy.md).
    ignoreCommand: "[ ! -f astro.config.mjs ] || git diff --quiet HEAD^ HEAD -- . ../../packages/contracts ../../package-lock.json",
    // /run/index.html is /run; /run/ and /run.html redirect to it. 404.html is the 404.
    cleanUrls: true,
    trailingSlash: false,
    redirects: Object.entries(REDIRECTS).map(([source, destination]) => ({ source, destination, permanent: true })),
    headers: [
      // Later rules win for the same header: the default first, then the specific ones.
      { source: "/(.*)", headers: headers({ ...securityHeaders(origin), "Cache-Control": CACHE.page }) },
      { source: "/(.*)\\.(png|svg|ico|xml|txt|webmanifest|woff2?)", headers: headers({ "Cache-Control": CACHE.other }) },
      { source: "/_astro/(.*)", headers: headers({ "Cache-Control": CACHE.hashed }) }
    ]
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { apiOrigin } = await import("./http.mjs");
  const out = fileURLToPath(new URL("../vercel.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify(vercelConfig(apiOrigin()), null, 2)}\n`);
  console.log(`Wrote ${out}${apiOrigin() ? ` (API ${apiOrigin()})` : " (mocks: no API origin)"}`);
}
