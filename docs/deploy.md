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
| **control** | `npx turbo run build --filter=@opencast/control...` | `npm run start -w @opencast/control` | `/health` | the API over private networking |
| **viewer**, **spots**, **desk**, **site**, **tv** | `npx turbo run build --filter=@opencast/<app>...` | `node scripts/serve-static.mjs apps/<app>/dist` | `/health` | `VITE_API_BASE` at build |
| Postgres, Redis | Railway databases | | | 5 GB volumes |

Keep **worker at one replica** for now: the Redis leader lock makes extra replicas wait, not share stations.

HLS: the worker writes each station's HLS to its own disk and serves it at `https://<worker>/hls/<stationId>/index.m3u8`, with the break cues. Viewers watch Livepeer's output; this is for checking and for players that want cues.

## Variables

| Variable | api | worker | Notes |
|---|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | ✓ | ✓ | references to Postgres and Redis |
| `NODE_ENV` | ✓ | ✓ | `production` (hides error details; a live Stripe key is refused otherwise) |
| `PORT` | 8080 | 8080 | the public domains point at 8080 |
| `APP_ORIGIN` | ✓ | ✓ | the viewer's URL (links in notices, Stripe return URLs) |
| `WEB_ORIGIN` | ✓ | | every app's origin, comma-separated (CORS) |
| `STORAGE_ROOT` | `/tmp/opencast` | `/data/storage` | the API only keeps temporary files; the worker's HLS and proof frames live on its volume |
| `WORKER_CACHE_DIR`, `WORKER_CACHE_GB` | | ✓ | `/data/cache`; 4.5 on staging, 99.5 in production |
| `LEGACY_PLAYOUT` | | `off` | no station is on the old queue model |
| `JOBS` | `off` | | the minute jobs run in the worker |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | ✓ | ✓ | staging: the Railway bucket `media` (virtual-host URLs; `S3_STORAGE_CLASSES=false`; it doesn't verify upload checksums, so only reads catch a bad copy). Production: Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_PUBLIC_BASE` too) |
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `PRIVY_APP_SECRET` | ✓ | ✓ | sign-in; without them signed-in endpoints answer 401 |
| `LIVEPEER_API_KEY` | ✓ | ✓ | live sources and the Livepeer output |
| `PAYMENTS_PROVIDER` | ✓ | ✓ | `fake` on staging; `clear` or `stripe_only` in production (docs/clear-integration.md) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✓ | ✓ | test keys on staging, live only in production. Webhook: `https://<api>/v1/webhooks/stripe` |
| `CHAIN_RPC_URL`, `CHAIN_ID`, `ESCROW_CONTRACT_ADDRESS`, `CREATOR_FUND_ADDRESS`, `USDC_ADDRESS` | ✓ | ✓ | from `contracts/`'s deploy (Base Sepolia on staging). The API only reads and encodes |
| `SETTLEMENT_PRIVATE_KEY` | | ✓ | the wallet that sends the weekly escrow batch and the pool's fund share. Worker only |
| `API_PROXY_BASE_URL` | | | control: `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080` |
| `VITE_API_BASE` | | | the web apps, at build: the API's public URL |

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

## Plan limits (Hobby)

- Volumes stop at 5 GB. The worker's cache in production wants 100 GB (the file asks for it when the environment is `production`), so production needs a plan above Hobby.
