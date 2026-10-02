# @opencast/site

The marketing site, one page, from `docs/reference/brand/opencast-site.html` (apps prompt, Phase 7). Owned by the apps prompt (`docs/prompts/2-apps.md`).

- `npm run dev:mock -w @opencast/site`: on :5183, the waitlist answered by Mock Service Worker (`src/mocks`, validated against `@opencast/contracts`; taken call signs BEAT, CIVC, REEL, SAZN, NITE; ZIPs 92373, 92374, 92324, 92335, 92501, 92507, 92376, 92336 are the Inland Empire, 90012, 90026, 90028, 90291 Los Angeles, anything else is outside every market).
- `npm run dev -w @opencast/site`: on :5176, `/v1` proxied to the API on :8787.
- `npm run build -w @opencast/site`: static files in `dist`, served by `scripts/serve-static.mjs`. `VITE_API_BASE` is the API's origin at build time. No mock code is in the build: the worker script is served by a dev-only plugin, and the mocks load only when `import.meta.env.DEV` and `VITE_MOCK` are both set.

What's live: the tuner in the hero (a fixed sample of the dial, `src/lib/tuner.ts`) and the waitlist (`waitlist.join`, with `waitlist.checkCallSign` under the call sign as it's typed). Everything else is static copy. The ground toggle saves to `localStorage` `oc-ground`; with nothing saved the page follows the system.
