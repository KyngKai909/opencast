// The Dial marketing site (usedial.com): static pages, no framework runtime. See README.md.
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const contracts = fileURLToPath(new URL("../../packages/contracts/src/", import.meta.url));

export default defineConfig({
  site: "https://usedial.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "directory", inlineStylesheets: "never" },
  devToolbar: { enabled: false },
  // SITE-SPEC §1. On Railway the server answers these with a 301 (scripts/serve.mjs); these pages
  // are the fallback anywhere else.
  redirects: { "/spot-market": "/spots", "/about": "/network", "/stations": "/run" },
  integrations: [sitemap({ filter: (page) => !/\/(_kit|404|og\/)/.test(page) && !/\/(spot-market|about|stations)\/?$/.test(page) })],
  server: { port: 5183 },
  vite: {
    // One contracts file at a time (`@contracts/waitlist`), straight from source, so a page's JS
    // carries only the schemas it calls and never the whole package.
    resolve: { alias: [{ find: /^@contracts\/(.*)$/, replacement: `${contracts}$1.ts` }] }
  }
});
