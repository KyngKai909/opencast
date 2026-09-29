# Deploying Opencast

Railway project **opencast** (`dc1fb63d-c475-42a0-8dce-7581260858f2`), environments `staging` and `production`. The old `@openchannel/*` services keep running in the `glistening-truth` project until the cutover below.

Everything Railway runs is defined in [.railway/railway.ts](../.railway/railway.ts): the databases, services, volume, bucket, builds, starts, health checks, watch paths and variables (by reference where they come from another service). Secrets are marked `preserve()`: they're set once in Railway and never written in the repo.

```bash
npx @railway/cli@latest link --project dc1fb63d-c475-42a0-8dce-7581260858f2 --environment staging
npx @railway/cli@latest config plan     # what would change
npx @railway/cli@latest config apply    # change it
npx @railway/cli@latest variables --set "NAME=value" -s <service>   # a secret
```

Railway retired per-service `railway.json` (Config as Code) in favour of this file. The root `railway.json` is only for the legacy services on `main`.

## Services

All build with Nixpacks from the repo root (`nixpacks.toml`: Node 22, ffmpeg, yt-dlp; `npm ci --include=dev`). Staging builds the `monorepo` branch; production builds `main`. Each service rebuilds only when its own paths or the shared packages change.

| Service | Build | Start | Health | Needs |
|---|---|---|---|---|
| **api** | `npx turbo run build --filter=@opencast/api...` | `npm run start -w @opencast/api` (pre-deploy: `npm run migrate -w @opencast/db`) | `/health` | Postgres, Redis, object storage, Privy, Livepeer, payments, chain (read-only) |
| **worker** | `npx turbo run build --filter=@opencast/worker...` | `npm run start -w @opencast/worker` | `/health` (leader, stations on air, cache hit rate, bytes, misses) | Postgres, Redis (leader lock), object storage, the cache volume at `/data`, Livepeer, chain (it sends the weekly escrow batch) |
| **web** (the Opencast app: the viewer, `/control`, `/desk`), **business**, **site**, **tv** | `npx turbo run build --filter=@opencast/<app>...` | `node scripts/serve-static.mjs apps/<app>/dist` | `/health` | `VITE_API_BASE` at build |
| Postgres, Redis | Railway databases | | | 5 GB volumes |

Keep **worker at one replica** for now: the Redis leader lock makes extra replicas wait, not share stations.

HLS: the worker writes each station's HLS to its own disk and serves it at `https://<worker>/hls/<stationId>/index.m3u8`, with the break cues. Viewers watch Livepeer's output; this is for checking and for players that want cues.

## Variables

| Variable | api | worker | Notes |
|---|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | ✓ | ✓ | references to Postgres and Redis. The API uses Redis pub/sub for the TV remote's relay, so phones and TVs on different API replicas reach each other; without it the relay only works within one replica |
| `NODE_ENV` | ✓ | ✓ | `production` (hides error details; a live Stripe key is refused otherwise) |
| `PORT` | 8080 | 8080 | the public domains point at 8080 |
| `APP_ORIGIN` | ✓ | ✓ | the viewer's URL (links in notices, Stripe return URLs) |
| `WEB_ORIGIN` | ✓ | | every app's origin, comma-separated (CORS) |
| `GEOIP_URL` | ✓ | | optional: an ip-to-postal lookup with `{ip}` in it (answering a ZIP as text, or JSON with a ZIP and/or coordinates), for `GET /markets/by-connection` (a TV's first launch). Unset: that endpoint answers no market and the open markets. Addresses are never stored or logged |
| `TRUST_PROXY_HOPS` | ✓ | | how many proxies add `X-Forwarded-For` entries before the API (default 1, Railway's edge): the client's address is that many entries from the end |
| `STORAGE_ROOT` | `/tmp/opencast` | `/data/storage` | the API only keeps temporary files; the worker's HLS and proof frames live on its volume |
| `WORKER_CACHE_DIR`, `WORKER_CACHE_GB` | | ✓ | `/data/cache`; 4.5 on staging, 99.5 in production |
| `LEGACY_PLAYOUT` | | `off` | no station is on the old queue model |
| `JOBS` | `off` | | the minute jobs run in the worker |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | ✓ | ✓ | staging: the Railway bucket `media` (virtual-host URLs; `S3_STORAGE_CLASSES=false`; it doesn't verify upload checksums, so only reads catch a bad copy). Production: Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_PUBLIC_BASE` too) |
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `PRIVY_APP_SECRET` | ✓ | ✓ | sign-in, with Opencast's own Privy app (never Clear's: the API refuses to start with Clear's app ID); without them signed-in endpoints answer 401. The API also needs the secret to read a linked Clear wallet |
| `CLEAR_PRIVY_PROVIDER_APP_ID` | ✓ | | Clear's Privy app ID, as the global-wallet provider (docs/clear-integration.md). Unset: "Connect Clear" answers 409 |
| `CLEAR_WALLET_ACCESS` | ✓ | | `read_only` (default) or `full`: what Clear has granted Opencast in Clear's Privy dashboard. The API can't detect it |
| `LIVEPEER_API_KEY` | ✓ | ✓ | live sources and the Livepeer output |
| `PAYMENTS_PROVIDER` | ✓ | ✓ | `fake` on staging; `clear` or `stripe_only` in production (docs/clear-integration.md) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✓ | ✓ | test keys on staging, live only in production. Webhook: `https://<api>/v1/webhooks/stripe` |
| `CHAIN_RPC_URL`, `CHAIN_ID`, `ESCROW_CONTRACT_ADDRESS`, `CREATOR_FUND_ADDRESS`, `USDC_ADDRESS` | ✓ | ✓ | from `contracts/`'s deploy (Base Sepolia on staging). The API only reads and encodes |
| `SETTLEMENT_PRIVATE_KEY` | | ✓ | the wallet that sends the weekly escrow batch and the pool's fund share. Worker only |
| `VITE_API_BASE` | | | the web apps, at build: the API's public URL |
| `VITE_CLEAR_PRIVY_PROVIDER_APP_ID` | | | web and business, at build: Clear's Privy app ID for "Connect Clear" (`linkCrossAppAccount`). The same value as the API's `CLEAR_PRIVY_PROVIDER_APP_ID` |

Per-service examples: `apps/<service>/.env.example`.

## Staging

| Service | URL |
|---|---|
| api | https://api-staging-9fae.up.railway.app |
| worker | https://worker-staging-79d5.up.railway.app |
| control | https://control-staging-28f7.up.railway.app |
| viewer | https://viewer-staging-a773.up.railway.app |
| spots | https://spots-staging.up.railway.app |
| desk | https://desk-staging-ceae.up.railway.app |
| site | https://site-staging-77bf.up.railway.app |
| tv | https://tv-staging.up.railway.app |

These predate the Opencast app (handoff 4): the viewer, control and desk services become one `web` service (`apps/web`, with master control at `/control` and the desk at `/desk`), and spots is `business`, once `.railway/railway.ts` is applied again.

Staging's database is fresh. For markets on the dial, seed it once from inside the api service (`railway ssh -s api -- npm run seed -w @opencast/db`); the seed is safe to rerun.

## Cutting production over

Production is empty until this runs. Nothing here touches `glistening-truth` until the last step.

1. **Plan.** Upgrade the Railway plan so the worker's 100 GB volume fits (Hobby stops at 5 GB).
2. **Code.** Merge `monorepo` into `main` (a PR; never force-push `main`). Production builds `main`.
3. **Object storage.** In Cloudflare, create the R2 bucket `opencast-media` and an API token scoped to it (read and write). Optionally add a public custom domain for `R2_PUBLIC_BASE`; without one, files are served by signed URLs.
4. **Keys.** Make fresh ones for production. Don't reuse the old project's Livepeer or Pinata keys, which are to be rotated:
   - Privy: Opencast's own production app (`PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `PRIVY_APP_SECRET`), with the production app origins allowed, and embedded wallets created only for people who sign in;
   - Clear: its provider app ID (`CLEAR_PRIVY_PROVIDER_APP_ID` on api, `VITE_CLEAR_PRIVY_PROVIDER_APP_ID` on control and spots) and `CLEAR_WALLET_ACCESS`, once Clear has requested global-wallet provider access in its own Privy dashboard and allowed Opencast's app;
   - Livepeer: a new API key;
   - Stripe: live `STRIPE_SECRET_KEY`, plus a webhook to `https://<api>/v1/webhooks/stripe` for its `STRIPE_WEBHOOK_SECRET`;
   - `PAYMENTS_PROVIDER`: `stripe_only` until Clear has what docs/clear-integration.md lists, then `clear`.
5. **Contracts, on Base.** Decide the verifier and steward keys (2 of 3 each, different people) and the admin Safe (docs/open-decisions.md). Then run `contracts/script/DeployEscrow.s.sol` against Base with `ADMIN_SAFE`, `ESCROW_VERIFIERS`, `FUND_STEWARDS`, `USDC_ADDRESS` (Base USDC) and `FUND_EXCLUDED` (the settlement wallet and the Safe). Fund a settlement wallet with a little ETH for gas. Set `CHAIN_RPC_URL`, `CHAIN_ID=8453`, `ESCROW_CONTRACT_ADDRESS`, `CREATOR_FUND_ADDRESS` and `USDC_ADDRESS` on api and worker, and `SETTLEMENT_PRIVATE_KEY` on the worker only. Try it on Base Sepolia first, on staging.
6. **Create production.** `railway link --environment production`, then `config plan` and `config apply`. Then set every `preserve()` secret above with `railway variables --set` on api and worker (the R2 ones on those two only).
7. **Check it.** Every service's `/health`; the API's pre-deploy log says "Migrations applied"; seed the markets; the worker's `/health` shows the leader and the cache. Sign in on the viewer, and put one test station on air end to end.
8. **Move off Pinata.** With production's storage variables and `PINATA_JWT`, run `npm run storage:move-off-pinata -w @opencast/api`, which reports. Then `--copy`, which copies each pin in and verifies it by hash. Check Pinata's dashboard total matches (the old key sees only v3 files), mark any catalog pins, and only then `--unpin --yes-unpin`. Unpinning can't be undone.
9. **Domains.** Add the custom domains to the production services and update DNS. Update `WEB_ORIGIN`, `APP_ORIGIN`, Privy's allowed origins and Stripe's webhook URL if they were the Railway ones.
10. **Retire the old project.** Stop pointing anything at `glistening-truth`. Leave its Postgres alone: it holds the only copy of the old `opencast_state`, which production doesn't import (a fresh start).
11. **Rotate and tidy.** Rotate the old Livepeer and Pinata keys, and anything else reused on staging. Delete the Livepeer test streams the early tests made. In the Railway dashboard, delete the stray project bucket `media-probe` (empty, no instance).

## Plan limits (Hobby)

- Volumes stop at 5 GB. The worker's cache in production wants 100 GB (the file asks for it when the environment is `production`), so production needs a plan above Hobby.
