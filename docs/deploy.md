# Deploying Opencast

Railway project **opencast** (`dc1fb63d-c475-42a0-8dce-7581260858f2`), environments `staging` and `production`. The old `@openchannel/*` services were in the `glistening-truth` project, which is being retired (the user decided on 2026-09-29 that it can be deleted).

Everything Railway runs is defined in [.railway/railway.ts](../.railway/railway.ts): the databases, services, volume, bucket, builds, starts, health checks, watch paths and variables (by reference where they come from another service). Secrets are marked `preserve()`: they're set once in Railway and never written in the repo.

```bash
npx @railway/cli@latest link --project dc1fb63d-c475-42a0-8dce-7581260858f2 --environment staging
npx @railway/cli@latest config plan     # what would change
npx @railway/cli@latest config apply    # change it
npx @railway/cli@latest variables --set "NAME=value" -s <service>   # a secret
```

Railway retired per-service `railway.json` (Config as Code) in favour of this file. The root `railway.json` is only for the legacy services in the old `glistening-truth` project; delete it with that project.

## Services

All build with Nixpacks from the repo root (`nixpacks.toml`: Node 22, ffmpeg, yt-dlp; `npm ci --include=dev`). Staging builds the `staging` branch; production builds `main`. Day-to-day work happens on `dev` and moves to `staging` by fast-forward or pull request. Each service rebuilds only when its own paths or the shared packages change.

| Service | Build | Start | Health | Needs |
|---|---|---|---|---|
| **api** | `npx turbo run build --filter=@opencast/api...` | `npm run start -w @opencast/api` (pre-deploy: `npm run migrate -w @opencast/db`) | `/health` | Postgres, Redis, object storage, Privy, Livepeer, payments, chain (read-only) |
| **worker** | `npx turbo run build --filter=@opencast/worker...` | `npm run start -w @opencast/worker` | `/health` (leader, stations on air, preparation, readiness, translators) | Postgres, Redis (leader lock), object storage, scratch space on the volume at `/data`, Livepeer (live blocks), chain (it sends the weekly escrow batch) |
| **web** (the Opencast app: the viewer, `/control`, `/desk`), **business**, **site**, **tv** | on Vercel (team Deed3Labs: `opencast-web`, `opencast-business`, `opencast-site`, `opencast-tv`), from each app's `vercel.json` | static | | `VITE_API_BASE` at build |
| Postgres, Redis | Railway databases | | | 5 GB volumes |

Keep **worker at one replica** for now: the Redis leader lock makes extra replicas wait, not share stations.

HLS: items are prepared once into segments in object storage, and each station's playlists are assembled from them and served at `https://<worker>/hls/<stationId>/master.m3u8` (`index.m3u8` answers too), with the DATERANGE tags and break cues. Segments come from the bucket's public domain (`R2_PUBLIC_BASE`); without one, the worker passes them through, billed as Railway egress.

## Variables

| Variable | api | worker | Notes |
|---|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | ✓ | ✓ | references to Postgres and Redis. The API uses Redis pub/sub for the TV remote's relay, so phones and TVs on different API replicas reach each other; without it the relay only works within one replica |
| `NODE_ENV` | ✓ | ✓ | `production` (hides error details; a live Stripe key is refused otherwise) |
| `PORT` | 8080 | 8080 | the public domains point at 8080 |
| `APP_ORIGIN` | ✓ | ✓ | the web app's URL (links in notices and emails, a station invite's `/control/invites/:id`, Stripe return URLs) |
| `BUSINESS_ORIGIN` | ✓ | ✓ | added 2026-09-29: the business app's URL. Business invites link to `<BUSINESS_ORIGIN>/invites/:id`, and business notices' emails to its pages. Staging: `https://opencast-business.vercel.app`; production: a secret, set at the cutover. Unset: `http://localhost:5177` in development; in production APP_ORIGIN, with a warning (it has no business pages) |
| `RESEND_API_KEY` | ✓ | ✓ | added 2026-09-29: email (invites, notices, the desk's letters, "your data") through Resend's HTTP API, tried up to three times with one idempotency key per email. Unset: emails only go to the log (a masked address; the link too, outside production). A secret: set in Railway, never in the repo. See "Email" below |
| `EMAIL_FROM` | ✓ | ✓ | added 2026-09-29: the sender, `Opencast <hello@<domain>>` (**Open**: the domain isn't bought yet). It must be on a domain verified in Resend. Unset: Resend's test sender `onboarding@resend.dev`, which only delivers to the Resend account's own email |
| `EMAIL_REPLY_TO` | ✓ | ✓ | optional (added 2026-09-29): where replies go, e.g. `team@<domain>`. Unset: replies go to `EMAIL_FROM` |
| `INVITE_EMAIL_MATCH` | ✓ | | optional (added 2026-09-29): `off` lets anyone signed in accept an invite made to another email. Unset: on (docs/open-decisions.md) |
| `WEB_ORIGIN` | ✓ | | every app's origin, comma-separated (CORS) |
| `GEOIP_URL` | ✓ | | optional: an ip-to-postal lookup with `{ip}` in it (answering a ZIP as text, or JSON with a ZIP and/or coordinates), for `GET /markets/by-connection` (a TV's first launch). Unset: that endpoint answers no market and the open markets. Addresses are never stored or logged |
| `PLACES_URL`, `PLACES_USER_AGENT` | ✓ | | optional (added 2026-09-29, P10): a geocoding lookup with `{q}` in it, for `GET /places/lookup` (a business's address or city). Nominatim's, Mapbox's and Google's answers are read, or plain `{ latitude, longitude, city, streetAddress }`. Unset: that endpoint answers 503 `not_available` and businesses choose Online. What's typed is never stored or logged |
| `API_PUBLIC_URL` | ✓ | ✓ | the API's public origin (added 2026-09-29, A117), e.g. `https://api.<domain>`: paths it serves itself (`/objects/…` on local storage, receipt PDFs, checkout webhook addresses) are sent as full URLs, so apps on other hosts load them. Unset: Railway's `RAILWAY_PUBLIC_DOMAIN`, else paths as before |
| `HLS_PUBLIC_URL` | ✓ | | optional (A117): the worker's public origin, for a station's own HLS (`/hls/<stationId>/index.m3u8`) when it has no Livepeer output. Unset: the API's origin |
| `TRUST_PROXY_HOPS` | ✓ | | how many proxies add `X-Forwarded-For` entries before the API (default 1, Railway's edge): the client's address is that many entries from the end |
| `STORAGE_ROOT` | `/tmp/opencast` | `/data/storage` | the API only keeps temporary files (an upload until its original is stored); prepared segments and proof frames live in object storage |
| `WORKER_SCRATCH_DIR` | | ✓ | `/data/scratch`: preparation and translators (the volume is 5 GB on staging, 20 GB in production) |
| `PREPARE_CONCURRENCY` | | ✓ | items prepared at once (1; each FFmpeg pass wants about 2 vCPU). `PREPARE_PRESET` is optional |
| `LEGACY_PLAYOUT` | | `off` | `on` runs the old continuous encode instead of prepare once, then assemble |
| `JOBS` | `off` | | the minute jobs run in the worker |
| `OPENCAST_ADMIN_EMAILS` | ✓ | | added 2026-09-29: comma-separated emails; whoever signs in through Privy with one (email, Google or Apple) becomes an Opencast admin (the Network desk, and owner of every network station). It only adds admins. Set in Railway, never in the repo |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | ✓ | ✓ | staging: the Railway bucket `media` (virtual-host URLs; `S3_STORAGE_CLASSES=false`; it doesn't verify upload checksums, so only reads catch a bad copy). Production: Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_PUBLIC_BASE` too) |
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `PRIVY_APP_SECRET` | ✓ | ✓ | sign-in, with Opencast's own Privy app (never Clear's: the API refuses to start with Clear's app ID); without them signed-in endpoints answer 401. The API also needs the secret to read a linked Clear wallet |
| `CLEAR_PRIVY_PROVIDER_APP_ID` | ✓ | | Clear's Privy app ID, as the global-wallet provider (docs/clear-integration.md). Unset: "Connect Clear" answers 409 |
| `CLEAR_WALLET_ACCESS` | ✓ | | `read_only` (default) or `full`: what Clear has granted Opencast in Clear's Privy dashboard. The API can't detect it |
| `LIVEPEER_API_KEY` | ✓ | ✓ | live sources and the Livepeer output |
| `WORKER_INGEST_PORT` | | ✓ | added 2026-09-29: the port the leading worker takes radio stations' RTMP pushes on (1935 by default; `off` turns it off). Radio live blocks never go through Livepeer. Encoders need a TCP route to it (on Railway, a TCP proxy on the worker) |
| `WORKER_INGEST_SERVER` | ✓ | | added 2026-09-29: the address radio stations' encoders are given, e.g. `rtmp://<the worker's TCP proxy>/live` (default `rtmp://localhost:<WORKER_INGEST_PORT>/live`) |
| `PAYMENTS_PROVIDER` | ✓ | ✓ | `fake` on staging; `clear` or `stripe_only` in production (docs/clear-integration.md) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✓ | ✓ | test keys on staging, live only in production. Webhook: `https://<api>/v1/webhooks/stripe` |
| `CHAIN_RPC_URL`, `CHAIN_ID`, `ESCROW_CONTRACT_ADDRESS`, `CREATOR_FUND_ADDRESS`, `USDC_ADDRESS` | ✓ | ✓ | from `contracts/`'s deploy (Base Sepolia on staging). The API only reads and encodes |
| `SETTLEMENT_PRIVATE_KEY` | | ✓ | the wallet that sends the weekly escrow batch and the pool's fund share. Worker only |
| `VITE_API_BASE` | | | the web apps, at build: the API's public URL |
| `VITE_CLEAR_PRIVY_PROVIDER_APP_ID` | | | web and business, at build: Clear's Privy app ID for "Connect Clear" (`linkCrossAppAccount`). The same value as the API's `CLEAR_PRIVY_PROVIDER_APP_ID` |

Per-service examples: `apps/<service>/.env.example`.

## Email

The API and the worker send email through [Resend](https://resend.com) when `RESEND_API_KEY` is set; without it, emails go to the log, so development and tests need nothing. To turn it on:

1. Create a Resend account (the user's; nothing in the repo holds its login).
2. Until a domain is bought (**Open**), leave `EMAIL_FROM` unset: Resend's test sender, `onboarding@resend.dev`, delivers only to the Resend account's own email, which is enough to try an invite on staging. Once there's a domain, add it in Resend (Domains, Add domain; a subdomain like `mail.<domain>` keeps the root's mail separate), put the DNS records it lists (SPF, DKIM, and the MX for bounces) at the domain's DNS host, and wait for Verified.
3. Make an API key (API Keys, Create; "Sending access", limited to that domain once it exists). One for staging and another for production.
4. Set on **api and worker** in each environment: `RESEND_API_KEY`; `EMAIL_FROM` (`Opencast <hello@<domain>>`, once the domain is verified); optionally `EMAIL_REPLY_TO`. Check `BUSINESS_ORIGIN` too: staging's is set by `.railway/railway.ts`, production's is a secret.
5. Try it: invite yourself to a station (master control, Settings, Team) and to a business (the business app, Settings, Team). The emails link to `<APP_ORIGIN>/control/invites/:id` and `<BUSINESS_ORIGIN>/invites/:id`. The API logs `[email] sent invite to y…@<domain>`; it never logs the key or whole addresses.

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

## One-off storage steps (Follow-up, 2026-09-29)

Since this change, uploads are kept as their original (Infrequent Access) and playout prepares from it; previews play the prepared segments; what was prepared from a file is deleted with it. Three one-off steps bring older data in line. Each reports by default, changes nothing until asked, is safe to run again, and never unpins or deletes anything but the 1280 px copies the originals replace. Run them from inside the api service (`railway ssh -s api -- npm run <script> -w @opencast/api [-- flags]`) with the worker running; each writes a JSON report under `STORAGE_ROOT`. On staging, in this order:

1. **Files keyed by location.** `storage:relink-locations` reports every file row from before content IDs (a disk path or URL, prepared as `loc-…`) and whether its bytes can be read. `-- --relink` stores each by content ID (Infrequent Access), points the row at it (`storage` becomes the object store, with a reference) and carries its prepared segments over, so it doesn't need preparing again. Rows it can't read are reported and left (they keep airing from their old location while it lasts).
2. **Pinata pins.** `storage:move-off-pinata` reports; `-- --copy` copies each pin in, verifies it by hash and relinks the rows that used it (the same way). Leave `--unpin` for the production cutover (step 8 there).
3. **Items prepared from the 1280 px copy.** `storage:prepare-from-originals` lists items whose file is still the copy, with the bands the copy was prepared for. `-- --apply` queues their originals (the worker prepares them, soon after anything airing within the hour) and moves each item whose original is prepared onto it (a new file version; its caption track is cut again within a minute; a catalog item's original is pinned). The copy is released and goes with what was prepared from it once nothing points at it; a station that aired it in the last two hours keeps its segments until the sweep. Run `--apply` again (say hourly) until the report shows nothing `queued` or `to_prepare`. Items with no original (`no_original`) stay on their copy. Each item is transcoded once more here, so expect the worker busy for about as long as preparation took the first time.

Nothing to run for these, they happen on their own:
- **The storage sweep** (the worker, hourly): deletes what was prepared from files that are gone (kept while it aired), and the separate `previews/<cid>/` renditions made before previews played the prepared segments, with their rows.
- **Previews** are asked for when a program is offered, a spot goes to review, or an order is delivered, and when one of those is opened; they show "Being prepared" (`previewStatus: "preparing"`) until the worker has prepared the file.

## Cutting production over

Production is empty until this runs. Nothing here touches `glistening-truth` until the last step.

1. **Plan.** Upgrade the Railway plan so the worker's 20 GB scratch volume fits (Hobby stops at 5 GB).
2. **Code.** Merge `staging` into `main` (a PR; never force-push `main`). Production builds `main`.
3. **Object storage.** In Cloudflare, create the R2 bucket `opencast-media` and an API token scoped to it (read and write). Optionally add a public custom domain for `R2_PUBLIC_BASE`; without one, files are served by signed URLs.
4. **Keys.** Make fresh ones for production. Don't reuse the old project's Livepeer or Pinata keys, which are to be rotated:
   - Privy: Opencast's own production app (`PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `PRIVY_APP_SECRET`), with the production app origins allowed, and embedded wallets created only for people who sign in;
   - Clear: its provider app ID (`CLEAR_PRIVY_PROVIDER_APP_ID` on api, `VITE_CLEAR_PRIVY_PROVIDER_APP_ID` on control and spots) and `CLEAR_WALLET_ACCESS`, once Clear has requested global-wallet provider access in its own Privy dashboard and allowed Opencast's app;
   - Livepeer: a new API key;
   - Stripe: live `STRIPE_SECRET_KEY`, plus a webhook to `https://<api>/v1/webhooks/stripe` for its `STRIPE_WEBHOOK_SECRET`;
   - `PAYMENTS_PROVIDER`: `stripe_only` until Clear has what docs/clear-integration.md lists, then `clear`.
   - Resend: a production API key (`RESEND_API_KEY`), and `EMAIL_FROM` on a verified domain (see "Email"); `BUSINESS_ORIGIN` for the business app.
5. **Contracts, on Base.** Decide the verifier and steward keys (2 of 3 each, different people) and the admin Safe (docs/open-decisions.md). Then run `contracts/script/DeployEscrow.s.sol` against Base with `ADMIN_SAFE`, `ESCROW_VERIFIERS`, `FUND_STEWARDS`, `USDC_ADDRESS` (Base USDC) and `FUND_EXCLUDED` (the settlement wallet and the Safe). Fund a settlement wallet with a little ETH for gas. Set `CHAIN_RPC_URL`, `CHAIN_ID=8453`, `ESCROW_CONTRACT_ADDRESS`, `CREATOR_FUND_ADDRESS` and `USDC_ADDRESS` on api and worker, and `SETTLEMENT_PRIVATE_KEY` on the worker only. Try it on Base Sepolia first, on staging.
6. **Create production.** `railway link --environment production`, then `config plan` and `config apply`. Then set every `preserve()` secret above with `railway variables --set` on api and worker (the R2 ones on those two only).
7. **Check it.** Every service's `/health`; the API's pre-deploy log says "Migrations applied"; seed the markets; the worker's `/health` shows the leader, preparation and readiness. Sign in on the viewer, and put one test station on air end to end.
8. **Move off Pinata.** With production's storage variables and `PINATA_JWT`, run `npm run storage:move-off-pinata -w @opencast/api`, which reports. Then `--copy`, which copies each pin in, verifies it by hash, and points every item that used the pin at its new content ID (see "One-off storage steps"). Check Pinata's dashboard total matches (the old key sees only v3 files), mark any catalog pins, and only then `--unpin --yes-unpin`. Unpinning can't be undone. Then run the other one-off storage steps below.
9. **Domains.** Add the custom domains to the production services and update DNS. Update `WEB_ORIGIN`, `APP_ORIGIN`, `BUSINESS_ORIGIN`, Privy's allowed origins and Stripe's webhook URL if they were the Railway ones. Verify the sending domain in Resend and set `EMAIL_FROM` on it (see "Email").
10. **Retire the old project.** Stop pointing anything at `glistening-truth`, then delete it from the Railway dashboard, along with the root `railway.json`. Its Postgres holds the only copy of the old `opencast_state`, which production doesn't import (a fresh start); take a `pg_dump` first if it might ever be wanted.
11. **Rotate and tidy.** Rotate the old Livepeer and Pinata keys, and anything else reused on staging. Delete the Livepeer test streams the early tests made. In the Railway dashboard, delete the stray project bucket `media-probe` (empty, no instance).

## Plan limits (Hobby)

- Volumes stop at 5 GB. The worker's scratch volume in production is 20 GB (the file asks for it when the environment is `production`; there's no worker cache, only preparation's scratch space), so production needs a plan above Hobby.
