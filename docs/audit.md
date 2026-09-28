# Audit (platform prompt, Phase 1)

Read on 2026-09-27 against `main` at `1d16570`. `main` installs, typechecks and builds clean on Node 22 (`npm ci && npm run typecheck && npm run build`).

There is a second line of work, `feat/opencast-phase-a` (3 commits, pushed today, never merged). It is covered in [Unmerged branch](#unmerged-branch-featopencast-phase-a) and is **not** the base for `monorepo`.

## Layout today

| Path | Package | What it is |
|---|---|---|
| `apps/api` | `@openchannel/api` | Express 5. One 2,733-line `server.ts` holding every route, upload, compression, yt-dlp ingest and Livepeer control |
| `apps/worker` | `@openchannel/worker` | Playout loop. One ffmpeg process per item, writing HLS and optionally an FLV push to Livepeer or one RTMP destination |
| `apps/web` | `@openchannel/web` | Vite, React 19, Tailwind 4, shadcn-style `components/ui`. Creator dashboard, station manager, station preview |
| `packages/shared` | `@openchannel/shared` | Types only (`Channel`, `Asset`, `PlaylistItem`, `PlayoutState`, …, `DatabaseSchema`). No runtime rules |
| `scripts/` | | `start-runtime.mjs` (API and worker in one process tree, the "single service" mode), `env-check.mjs`, `create-sample-media.sh` |
| `storage/` | | Local media, HLS output and the JSON fallback DB |
| `docs/technical-implementation-guide.md` | | The MVP design and cost notes. Predates the reference designs |

## API routes

There is **no authentication on any route**. "Ownership" is an `ownerWallet` string the client sends in the body or query. The server checks only that it's shaped like an address, and compares it in exactly one place (`library/import`). Anyone who can reach the API can edit, delete, start or stop any station.

| Method | Path | Input | Touches |
|---|---|---|---|
| GET | `/health`, `/api/health` | none | nothing |
| GET | `/api/channels` | `?ownerWallet` (filter, optional) | channels, asset and playlist counts |
| POST | `/api/channels` | name, slug, description, adInterval, adTriggerMode, adTimeIntervalSec, streamMode, brandColor, playerLabel, profileImageUrl, bannerImageUrl, ownerWallet | channels, playoutStates; provisions a Livepeer stream if `LIVEPEER_DEFAULT_ENABLED` and a key is set |
| GET | `/api/channels/:id` | none | channel with assets, folders, schedules, playlist, state, **destinations including their RTMP stream keys**, livepeer (key stripped), streamUrl |
| PATCH | `/api/channels/:id` | same fields as create, plus radioBackgroundUrl; ownerWallet can be reassigned by anyone | channels |
| GET | `/api/channels/:id/assets` | none | assets |
| GET, POST | `/api/channels/:id/folders` | name, parentFolderId | assetFolders |
| PATCH, DELETE | `/api/folders/:folderId` | name, parentFolderId (cycle-checked) | assetFolders; delete un-files its assets |
| GET, POST | `/api/channels/:id/schedules` | startAt, endAt, enabled | streamSchedules |
| PATCH, DELETE | `/api/schedules/:scheduleId` | startAt, endAt, enabled | streamSchedules |
| POST | `/api/library/assets/upload` | multipart `file`, ownerWallet, title, type, insertionCategory | assets, under the pseudo channel id `library:<wallet>`; ffmpeg compress, optional Pinata pin |
| POST | `/api/channels/:id/assets/upload` | multipart `file`, title, type, insertionCategory, folderId | assets; ffmpeg compress, optional Pinata pin, optional local delete |
| POST | `/api/channels/:id/profile-image`, `/banner-image`, `/radio/background` | multipart `file` | writes to `uploads/`, returns a `/uploads/...` URL (the client then PATCHes the channel) |
| GET, POST | `/api/channels/:id/assets/external/jobs` | url or urls, type, titlePrefix, expandPlaylists; `?limit` | externalIngestJobs; queued yt-dlp job |
| GET | `/api/channels/:id/assets/external/jobs/:jobId` | none | externalIngestJobs |
| POST | `…/jobs/:jobId/cancel` | none | externalIngestJobs; kills yt-dlp |
| DELETE | `…/jobs/:jobId` | none | externalIngestJobs |
| PATCH | `…/jobs/:jobId/items/:itemId` | title | externalIngestJobs, assets (rename) |
| POST | `/api/channels/:id/assets/external` | url, title, type, insertionCategory, folderId | assets; **synchronous** yt-dlp download in the request, optional Pinata pin |
| PATCH | `/api/assets/:assetId` | title, type, insertionCategory, folderId | assets |
| DELETE | `/api/assets/:assetId` | none | assets, playlistItems; removes local files |
| POST | `/api/channels/:id/library/import` | assetIds, ownerWallet | assets (copies library rows into the channel; same file, new id) |
| GET, PUT | `/api/channels/:id/playlist` | PUT: assetIds (whole-queue replace) | playlistItems |
| POST | `/api/channels/:id/playlist/items` | assetId, position | playlistItems |
| DELETE | `/api/channels/:id/playlist/items/:itemId` | none | playlistItems |
| GET | `/api/channels/:id/status` | none | playoutStates, livepeerConfigs; streamUrl |
| GET | `/api/channels/:id/livepeer` | none | livepeerConfigs (key stripped) |
| POST | `/api/channels/:id/livepeer/provision` | none | Livepeer `POST /stream`, livepeerConfigs |
| PATCH | `/api/channels/:id/livepeer` | enabled | livepeerConfigs; refuses to disable if no custom output |
| GET, POST | `/api/channels/:id/destinations` | name, rtmpUrl, streamKey | destinations; **GET returns stream keys** |
| PATCH, DELETE | `/api/destinations/:destinationId` | name, rtmpUrl, streamKey, enabled | destinations |
| POST | `/api/channels/:id/control` | action: start, stop, skip, previous | commands, playoutStates; may provision Livepeer on start |
| static | `/hls/*`, `/uploads/*` | | the API's own disk. `/uploads` serves every uploaded file (originals included) to anyone |
| GET | `/*` | | the web build, when `SERVE_WEB_APP` isn't `false` and `apps/web/dist` exists |

## Data model

Everything is one `DatabaseSchema` object (`packages/shared/src/index.ts`), stored either as:

- **Postgres:** one row, `opencast_state(id=1, state jsonb, updated_at)`, with a check constraint forcing a single row. Created on first boot and seeded from `storage/db.json` if present. Every write is `SELECT … FOR UPDATE`, mutate in JS, `UPDATE` the whole document.
- **JSON fallback:** `storage/db.json`, with a lock file (`db.lock`, 30 s stale, 15 s timeout) plus an in-process write queue.

Collections, with the fields that matter for the new schema:

| Collection | Becomes | Notes |
|---|---|---|
| `channels` | `broadcast.stations` and `broadcast.channels` | id, ownerWallet (lowercase 0x, optional), name, slug, description, profile and banner images, `brandColor` (default `#00a96b`, **3.05:1 on white, fails the 4.5:1 rule**), playerLabel, `streamMode` video or radio, radioBackgroundUrl, ad rules (`adTriggerMode` disabled, every_n_programs or time_interval, `adInterval`, `adTimeIntervalSec`). No call sign, market, band or channel number |
| `assets` | `broadcast.assets` | channelId (or `library:<wallet>` for the creator library), title, `sourceType` upload or external, sourceUrl, localPath (a disk path **or** a URL), originalLocalPath, folderId, storageProvider local or ipfs, ipfsCid, ipfsUrl, compression, durationSec, `type` program or ad, `insertionCategory` program, ad, sponsor or bumper, mediaKind video or audio |
| `assetFolders` | `broadcast.asset_folders` | nested by parentFolderId |
| `playlistItems` | seed rows for `broadcast.program_log` | ordered queue, no times |
| `playoutStates` | `broadcast.playout_state` | isRunning, current asset, queueIndex, programCountSinceAd, lastAdAt, currentProgramOffsetSec, lastError |
| `commands` | `broadcast.commands` | start, stop, skip, previous; drained by the worker every poll |
| `streamSchedules` | `broadcast.schedules` | start and end windows that turn the whole station on and off. Not a program log |
| `destinations` | `broadcast.translators` | name, rtmpUrl, streamKey (plaintext), enabled |
| `livepeerConfigs` | `broadcast.livepeer_config` | streamId, streamKey, playbackId, playbackUrl, ingestUrl, enabled |
| `externalIngestJobs` | `broadcast.import_jobs` | yt-dlp jobs with per-URL items and progress |

Log codes today: `insertionCategory` covers `program`, `ad`, `sponsor` and `bumper`, which map to `PGM`, `SPT`, `UND` and `BMP`. There is no station ID (`SID`); the worker never plays one.

JSON files in the repo, all **tracked in git** (they shouldn't be):

| File | Contents |
|---|---|
| `storage/db 2.json` | 1 channel, 2 assets, 2 playlist items, 1 Livepeer config |
| `storage/db 3.json` | 1 channel, 5 assets, 5 playlist items, 1 schedule, 1 Livepeer config, 1 ingest job |
| `apps/api/storage/db.json` | empty, older shape (no folders, schedules or jobs) |

`storage/db 2.json` and `storage/db 3.json` are iCloud sync-conflict copies. The old checkout lived in `~/Documents` (iCloud), which is why they exist. The repo now lives at `~/dev/untitled-project`. The real `storage/db.json` is git-ignored and was never committed. The Livepeer config rows contain Livepeer **stream keys** (see [Security](#security)).

## Worker

`apps/worker/src/worker.ts` polls every `WORKER_POLL_INTERVAL_MS` (1 s):

1. **Leadership.** Refreshes a Redis lease (`opencast:worker:leader`, 15 s). With no `REDIS_URL`, or if Redis errors, every replica thinks it's the leader (`redis.ts` returns `true`). Two replicas without Redis will both play out.
2. **Schedules.** In one blob transaction, turns stations on at `startAt` (resetting the queue to 0) and off at `endAt` unless another window is open, by pushing `start` and `stop` commands.
3. **Commands.** Drains `db.commands` and applies them. `start` auto-fills an empty playlist with every program asset by upload date.
4. **Runtimes.** One `ChannelRuntime` per running station. Each loop iteration re-reads the whole blob and calls `chooseNextAsset`:
   - The program queue is the playlist, filtered to `type = program`.
   - The ad pool is **every** `type = ad` asset on the station. Sponsor and bumper assets are all "ads" to the worker, and the pool isn't ordered by category.
   - `every_n_programs`: after N completed programs, play one ad (round-robin by `queueIndex`).
   - `time_interval`: programs longer than the interval are played in slices with `-ss` and `-t`, with one ad between slices. `currentProgramOffsetSec` carries the resume point.
   - With no programs, it loops ads. With nothing at all, it writes `lastError` and idles. **It never plays a station ID or slate, so open time is dead air.**
5. **Output.** `ffmpeg.ts` starts **one ffmpeg per item** with `-re`: libx264 veryfast, GOP 48, AAC 128k. It writes 2 s HLS segments to `STORAGE_ROOT/hls/<channelId>/` (list of 6, epoch numbering, `program_date_time`), plus a second FLV output to the Livepeer ingest URL, or to the first enabled destination when Livepeer is off. Radio mode loops a background (or a solid colour) under the audio. Each item change tears down the RTMP connection, so Livepeer sees a reconnect at every boundary.
6. **Input.** When `MEDIA_BASE_URL` is set, assets under `uploads/` are read over HTTP from the API's `/uploads`. Otherwise it reads `localPath` directly, which is a disk path or an IPFS or R2 URL.

Things that will matter in Phase 5:
- Only **one** destination is ever used, and only when Livepeer is **off**. "Translators" (several relays at once) don't exist; Livepeer multistream targets aren't used.
- No as-run log. `playoutStates` keeps only the current item.
- Skip and previous kill ffmpeg and wipe the HLS directory.
- On Railway, the worker's HLS output is on the worker's disk and the API serves `/hls` from its own disk. They're different services with different volumes (the worker has no volume), so `/hls/<id>/index.m3u8` from the API is empty in split mode. Split-mode playback only works through Livepeer.

## Environment variables

| Variable | Read by | Default and notes |
|---|---|---|
| `PORT`, `API_PORT` | api | 8787 |
| `WEB_ORIGIN` | api | `*`. Comma-separated CORS allowlist |
| `STORAGE_ROOT` | api, worker | `./storage` (repo root). `/data/storage` on Railway |
| `DATABASE_URL` | api, worker | empty means the JSON fallback |
| `SERVE_WEB_APP`, `WEB_DIST_DIR` | api | true, `apps/web/dist` |
| `KEEP_ORIGINAL_UPLOADS` | api | false |
| `MAX_COMPRESSION_INPUT_BYTES` | api | unset means always compress |
| `UPLOAD_STORAGE_MODE` | api | `local`, `hybrid` or `ipfs`; anything else becomes `hybrid` |
| `DELETE_LOCAL_AFTER_IPFS` | api | true |
| `LIVEPEER_API_KEY`, `LIVEPEER_API_BASE`, `LIVEPEER_RTMP_INGEST_BASE` | api | |
| `LIVEPEER_DEFAULT_ENABLED` | api, worker | true |
| `PINATA_JWT`, `PINATA_UPLOAD_URL`, `PINATA_GATEWAY_BASE`, `PINATA_NETWORK` | api | |
| `EXTERNAL_INGEST_*_TIMEOUT_MS` (4) | api | yt-dlp watchdogs |
| `MEDIA_BASE_URL` | worker | the API's public URL, so the worker can fetch `/uploads` |
| `WORKER_POLL_INTERVAL_MS` | worker | 1000 |
| `REDIS_URL`, `REDIS_WORKER_LEADER_KEY`, `REDIS_WORKER_LEASE_SEC` | worker | unset means no lock |
| `RAILWAY_REPLICA_ID` | worker | used in the instance id |
| `RAILWAY_ENVIRONMENT` | api, worker, web `dev` scripts | switches `npm run dev` to `node dist/...` |
| `VITE_API_BASE` | web (build time) | empty means same origin |
| `API_PROXY_BASE_URL` | web `server.mjs` | the API to proxy `/api`, `/hls` and `/uploads` to |

Both `apps/api/src/config.ts` and `apps/worker/src/config.ts` load the repo-root `.env` themselves (a hand-written parser, not dotenv).

## Railway today

Project `glistening-truth`, environment `production`. Every service shows **offline** on the canvas. Variable names were read; values weren't printed.

| Service | Build and start | Variables |
|---|---|---|
| `@openchannel/api` | `npm run build:service:api`, `npm run start:service:api`, Node 22.12 | DATABASE_URL, STORAGE_ROOT=/data/storage, `UPLOAD_STORAGE_MODE=ipfs`, DELETE_LOCAL_AFTER_IPFS, PINATA_JWT, LIVEPEER_API_KEY, MAX_COMPRESSION_INPUT_BYTES, `SERVE_WEB_APP=false`, WEB_ORIGIN, WORKER_POLL_INTERVAL_MS (unused here). Volume `@openchannel/api-volume` |
| `@openchannel/worker` | `build:service:worker`, `start:service:worker` | DATABASE_URL, REDIS_URL, MEDIA_BASE_URL, STORAGE_ROOT=/data/storage (**no volume**, so ephemeral), WORKER_POLL_INTERVAL_MS |
| `@openchannel/web` | `build:service:web`, `start:service:web` | API_PROXY_BASE_URL, VITE_API_BASE |
| Postgres, Redis | plugins with volumes | |

Every service carries both `NIXPACKS_*` and `RAILPACK_*` build and start variables. Railway has moved new services to Railpack, so the Nixpacks ones may be ignored. The root `nixpacks.toml` (`npm ci`, `npm run build`, `npm run start:railway`) and `railway.json` (builder NIXPACKS) describe the old **single-service** mode, not the split services.

**Decision (2026-09-27):** the new deployment goes into a **new Railway project**, not `glistening-truth`. Phase 7's "don't touch production" then means "leave `glistening-truth` alone". Its Postgres holds the only copy of the production `opencast_state` blob that Phase 3's migration is meant to be tested against (see the questions at the STOP).

## yt-dlp import and rights

- There are two paths: synchronous `POST /api/channels/:id/assets/external`, and the queued job API `/assets/external/jobs` (expands playlists, runs in the API process, recovers queued jobs on boot). Both spawn `yt-dlp` from `PATH`, with a Python-module fallback (`media.ts`), then ffprobe and an optional Pinata pin.
- Imported assets are `sourceType: "external"` with `sourceUrl`, and can be `type: "ad"`, so a downloaded video can air as a spot.
- **Rights checks: none.** There is no confirmation, licence field, allowlist or per-station restriction. `library/import` copies assets between stations of the same wallet, so a link import can move to another station.
- The design keeps link imports but makes them station-local and never offered for carriage. That needs: a rights confirmation row per asset (Phase 3 constraint), `sourceType = link` excluded from carriage offers, and library import blocked for link assets.
- Neither `nixpacks.toml` nor the Railway services install `yt-dlp`, so on Railway both import paths fail with the "install yt-dlp" error.

## Dead code, duplication, and what would break in the move

- `apps/api/src/db.ts` and `apps/worker/src/db.ts` are near-identical copies (normalise, file lock, Postgres blob). The worker's lacks `writeDb`. Both go away with the schema.
- `apps/api/src/config.ts` and `apps/worker/src/config.ts` duplicate the `.env` loader and storage-root logic.
- `normalizeInsertionCategory`, `normalizeStreamMode` and the media-kind guess exist in both `server.ts` and `db.ts`. These are domain rules that belong in `packages/domain`.
- `writeDb` in the API is exported and never called.
- The Livepeer provisioning block is repeated in create, provision, PATCH and control.
- Root `dist/` (`livepeer.js`, `server.js`, `worker.js`, `index.d.ts`, …) is a stale single-service build **on disk only**, git-ignored. Harmless, but it confused the old checkout.
- `docs/technical-implementation-guide.md` and the root README describe out-of-scope items (discover, guide, multistream) that the reference designs now bring back.

Things that break when paths move:
- `apps/api/src/config.ts` resolves the workspace root as `../../..` from `dist/` or `src/`, and `WEB_DIST_DIR` defaults to `apps/web/dist`. Moving `web` to `control` breaks API static hosting unless `WEB_DIST_DIR` changes.
- `apps/web/server.mjs` and `vite.config.ts` hard-code the dev ports and API proxy.
- `predev` builds `@openchannel/shared`, and every script names `@openchannel/*` workspaces.
- `nixpacks.toml` and `start-runtime.mjs` hard-code `apps/api/dist/server.js` and `apps/worker/dist/worker.js`.
- `.claude/launch.json` exists only in the old iCloud checkout, not in git.
- Railway service names stay `@openchannel/*` (old names are recorded in the README).

## Security

1. **No auth.** Covered above. Anyone can read or change every station.
2. **Stream keys are public.** `GET /api/channels/:id` returns every destination's `streamKey` in plain text. Anyone who knew a station id could read the YouTube or Twitch key entered for it. **Rotate any YouTube, Twitch or RTMP key that was ever entered on the deployed app.**
3. **Livepeer stream keys are committed.** `livepeerConfigs[].streamKey` is in `storage/db 2.json` and `db 3.json` in public git history. They let anyone push video into those Livepeer streams. **Delete those streams, or rotate their keys, in Livepeer Studio.**
4. `/uploads` is a public static directory, including originals and library uploads.
5. The repo is **public** on GitHub.

## Web app (`apps/web`, becomes `apps/control`)

Routes (`App.tsx`):

| Route | Page | Does |
|---|---|---|
| `/` | LoginPage | Wallet connect: `eth_requestAccounts` on `window.ethereum`, address kept in localStorage. **Never signs anything.** |
| `/dashboard` | CreatorDashboardPage | Station list with status, create station (with images), **upload** to the creator library (XHR with progress) |
| `/studio` | | redirects to `/dashboard` |
| `/stations/:id` | StationManagerPage (2,104 lines) | Library import, delete asset, **queue editing** (PUT playlist), **schedules**, **go live** (start, stop, skip, previous), **Livepeer** enable (which provisions server-side), RTMP destinations, station settings. Polls status every 5 s |
| `/stations/:id/preview`, `/station/:id` | StationPreviewPage | **Station preview**: HLS or the Livepeer embed. Owner-only settings overlay |

This is the flow Phase 2 must keep working: wallet, create station, upload, import to the station, queue, schedule, Livepeer, go live, preview.

Notes:
- Uploads go to the creator library and are then imported into a station. The per-station upload route is unused by the UI.
- Unused `api.ts` exports: `uploadAsset`, `listStreamSchedules`, `getLivepeerStatus`, `provisionLivepeer`, `listDestinations`.
- `apps/web/server.mjs` serves `dist/` with an SPA fallback and proxies `/api`, `/hls` and `/uploads` to `API_PROXY_BASE_URL ?? VITE_API_BASE` on `PORT` (4173). The API can also serve the same build (`SERVE_WEB_APP`), so there are two ways to host it.
- `vite.config.ts` has **no dev proxy** on main, so local dev needs `VITE_API_BASE`.
- Tailwind 4 is loaded, but pages use hand-written classes in `styles.css`.
- Dead code, imported by nothing:
  - `creatorStorage.ts`, `presentation.ts`, `viewer.css`, all of `components/ui/*` and `lib/utils.ts`
  - their dependencies: `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
  - dependencies never imported at all: `tailwindcss-animate`, `autoprefixer`, `postcss`
- Duplication:
  - `web/src/types.ts` hand-copies `packages/shared`, because web doesn't depend on it.
  - `resolveStreamUrl`, `toLivepeerEmbedUrl`, `formatDuration` and the date helpers are copy-pasted between StationManagerPage and StationPreviewPage.
- Hard-coded URLs: `https://lvpr.tv/?v=` (both pages), `playback.livepeer.studio` (API `livepeer.ts`), and Fontshare and Google Fonts in CSS.

## Unmerged branch `feat/opencast-phase-a`

Three commits from 2026-07-12 that lived only in the old iCloud checkout; pushed today so they're safe. Compare with `main...feat/opencast-phase-a`; the two-dot diff shows `docs/` as deleted.

- **`0864f8a` R2 hot-path storage (API).**
  - Adds `r2.ts` and the AWS S3 SDK.
  - Adds these variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_BASE`, `R2_PRESIGN_TTL_SEC`, `DELETE_LOCAL_AFTER_R2`, `IPFS_ARCHIVE_DEFAULT`.
  - `UPLOAD_STORAGE_MODE` becomes `r2` (default), `hybrid` or `local`.
  - With `R2_PUBLIC_BASE` set, `asset.localPath` becomes the public R2 URL and IPFS becomes an optional archive.
  - Gaps: the external-import path skips it; deleting an asset `unlink`s a URL, so the R2 object is orphaned; `presignGetUrl` is never used.
  - Worth keeping, as the basis for the storage module.
- **`b2fc9a7` snapshot** and **`805ef19` Pass 2 frontend.** Replaces the creator app with Explore, Watch and a Dashboard.
  - Only start/stop and create station survive.
  - Upload, queue editing, library import, schedules, Livepeer, destinations and settings are **gone** from the UI.
  - Watch plays only Livepeer `https` URLs.
  - `ChannelsProvider` fetches every channel's detail every 12 s.
  - This is a viewer-direction experiment that the reference designs now supersede.

**Recommendation:** keep `monorepo` based on `main`, which the prompt's "apps/control must run exactly as apps/web did" describes, and cherry-pick only the R2 commit into the API during Phase 2. Leave the Pass 2 frontend on its branch as history.

`.gitignore` covers only `storage/db.json`. `storage/db.backup.review.json` (branch only) is also tracked and holds three more Livepeer stream keys.

## What I did in this phase

- Cloned the repo to `~/dev/untitled-project`, out of iCloud.
- Committed the handoff (`docs/reference/`, `docs/prompts/`, `docs/handoff.md`) to `main` (`1d16570`), as the handoff asks.
- Pushed the local-only `feat/opencast-phase-a` so it isn't lost.
- Created `monorepo` from `main`.

## Addendum (2026-09-28): how files were stored

Added when the platform prompt gained the storage section.

- **Pinned to IPFS through Pinata.** Uploads and link imports were compressed, then pinned when `UPLOAD_STORAGE_MODE` was `ipfs` or `hybrid` (production ran `ipfs`, with `DELETE_LOCAL_AFTER_IPFS=true`, so the gateway URL became the only copy). The unmerged R2 commit (`0864f8a`) made R2 the default and IPFS an archive, but never reached production.
- **On local disk.** `storage/uploads/<channel>/…` on the API's Railway volume: originals, and prepared files when pinning was off. HLS under `storage/hls`.
- **At air time** the worker read `asset.localPath` as-is: a disk path, or the IPFS gateway URL, fetched by ffmpeg over HTTP while airing. Every airing of a pinned file was a gateway read.
- **How much is pinned.** Counted with the old project's key (read only): **1 file, 0.1 GB** in Pinata's v3 Files API (public and private). The key can't read the legacy pin list (403), so anything pinned through the older API isn't in that count. The report is `npm run storage:move-off-pinata -w @opencast/api`.
