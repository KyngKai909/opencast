# OpenCast — Frontend API Surface Inventory

Captured from the pass-1 frontend (`apps/web/src/api.ts`, `types.ts`) and the
Express server (`apps/api/src/server.ts`) before rebuilding the UI. The new
frontend wires to THESE real endpoints — do not invent new ones. Backend,
contracts, and data models are unchanged.

## Base + transport
- `API_BASE` = `import.meta.env.VITE_API_BASE` (trimmed, no trailing slash). Empty
  in dev → same-origin; Vite proxies `/api`, `/uploads`, `/hls` → `http://localhost:8787`.
- JSON requests set `Accept: application/json`; bodies are JSON with
  `Content-Type: application/json`. Errors → `{ error: string }` with non-2xx status.
- Uploads use `XMLHttpRequest` + `FormData` for progress (`xhr.upload.onprogress`).

## Auth / identity
- **Wallet-gated creator identity.** No tokens/headers. Ownership is an
  `ownerWallet` string (lowercased `0x…40hex`) passed in the body/query.
- Pass-1 stored the wallet in `localStorage` (`openchannel.creator.wallet.v1`).
  **Pass-2: persist via cookie / app state, not localStorage** (env storage rule).
- Injected EIP-1193 (`window.ethereum`) `eth_requestAccounts` for connect;
  structured to later swap for AppKit without changing these APIs.

## Endpoints (as consumed by the client)

### Channels
| Fn | Method · Path | Request | Response |
|---|---|---|---|
| `listChannels(ownerWallet?)` | GET `/api/channels[?ownerWallet=]` | — | `{ channels: ChannelSummary[] }` |
| `createChannel(input)` | POST `/api/channels` | `{ ownerWallet, name, description?, profileImageUrl?, bannerImageUrl?, brandColor?, streamMode? }` | `{ channel, livepeer?, livepeerWarning? }` |
| `getChannelDetail(id)` | GET `/api/channels/:id` | — | `ChannelDetail` |
| `patchChannel(id, input)` | PATCH `/api/channels/:id` | partial channel (`name, description, brandColor, playerLabel, streamMode, adTriggerMode, adInterval, adTimeIntervalSec, …`) | `{ channel }` |
| `uploadChannelProfileImage(id,{file})` | POST `/api/channels/:id/profile-image` (multipart `file`) | image | `{ channel }` |
| `uploadChannelBannerImage(id,{file})` | POST `/api/channels/:id/banner-image` (multipart `file`) | image | `{ channel }` |

### Content / library / assets
| Fn | Method · Path | Notes |
|---|---|---|
| `uploadAsset(id,{file,type,insertionCategory?,title?,onProgress})` | POST `/api/channels/:id/assets/upload` (multipart) | `type: program\|ad`; optional `archiveToIpfs`. → `{ asset, storageWarnings?: string[], compressionWarning? }` |
| `listLibraryAssets(ownerWallet,type?)` | GET `/api/library/assets?ownerWallet=&type=` | → `{ assets: Asset[] }` |
| `uploadLibraryAsset(input)` | POST `/api/library/assets/upload` (multipart, `ownerWallet`) | library-scoped upload |
| `importLibraryAssetsToChannel(id,{ownerWallet,assetIds})` | POST `/api/channels/:id/library/import` | → `{ assets }` |
| `patchAsset(assetId,{title?,insertionCategory?,type?})` | PATCH `/api/assets/:assetId` | slot type: `program`→content; `ad`+`{ad\|sponsor\|bumper}` |
| `deleteAsset(assetId)` | DELETE `/api/assets/:assetId` | → `{ deleted }` |

### Playlist (the broadcast timeline)
| Fn | Method · Path | Notes |
|---|---|---|
| `putPlaylist(id, assetIds[])` | PUT `/api/channels/:id/playlist` | ordered replace — the timeline order |
| (server) | GET `/api/channels/:id/playlist` | → `{ playlist: PlaylistItem[] }` (each has embedded `asset`) |
| (server) | POST/DELETE `/api/channels/:id/playlist/items[/:itemId]` | add/remove single item |

### Playout / live control
| Fn | Method · Path | Notes |
|---|---|---|
| `getChannelStatus(id)` | GET `/api/channels/:id/status` | → `{ state: PlayoutState, streamUrl, livepeer? }` — **liveness source** |
| `sendChannelControl(id, action)` | POST `/api/channels/:id/control` | `action: start\|stop\|skip\|previous`. **start requires a configured output** (Livepeer enabled+provisioned, or an enabled custom RTMP dest) else 4xx |

### Schedules (time windows)
| Fn | Method · Path | Notes |
|---|---|---|
| `listStreamSchedules(id)` | GET `/api/channels/:id/schedules` | → `{ schedules: StreamSchedule[] }` |
| `createStreamSchedule(id,{startAt,endAt?,enabled?})` | POST `/api/channels/:id/schedules` | ISO times |
| `deleteStreamSchedule(scheduleId)` | DELETE `/api/schedules/:scheduleId` | |

### Livepeer + destinations (multistream) — later phases
- GET `/api/channels/:id/livepeer`, POST `…/livepeer/provision`, PATCH `…/livepeer`.
- GET/POST `/api/channels/:id/destinations`, PATCH/DELETE `/api/destinations/:destinationId`.

### Folders + external ingest (yt-dlp) — not needed for Pass-2 pages
- `/api/channels/:id/folders`, `/api/folders/:folderId`.
- `/api/channels/:id/assets/external/jobs…` (queued/expanding/running/completed).

## Core data shapes (`types.ts`)
- **Channel**: `id, ownerWallet?, name, slug, description, profileImageUrl?, bannerImageUrl?, brandColor, playerLabel, streamMode ("video"|"radio"), adTriggerMode, adInterval, adTimeIntervalSec, radioBackgroundUrl?, createdAt, updatedAt`.
- **Asset**: `id, channelId, title, sourceType ("upload"|"external"), sourceUrl?, localPath, durationSec?, type ("program"|"ad"), insertionCategory? ("program"|"ad"|"sponsor"|"bumper"), mediaKind ("video"|"audio"), storageProvider? ("local"|"r2"|"ipfs"), r2Url?, ipfsUrl?, …`.
- **PlaylistItem**: `id, channelId, assetId, position, createdAt, asset: Asset` (embedded).
- **PlayoutState**: `channelId, isRunning, currentAssetId?, currentAssetTitle?, currentStartedAt?, currentProgramOffsetSec?, queueIndex, programCountSinceAd, lastAdAt?, updatedAt, lastError?`.
- **StreamSchedule**: `id, channelId, startAt, endAt?, enabled, startedAt?, endedAt?, …`.
- **LivepeerStatus**: `channelId, enabled, streamId?, playbackId?, playbackUrl?, ingestUrl?, lastError?, updatedAt`.
- **ChannelSummary**: `{ channel, assetCount, playlistCount }`.
- **ChannelDetail**: `{ channel, assets[], schedules[], playlist[], state, destinations[], livepeer?, streamUrl }`.

## Per-page data needs (Pass-2)

### Watch (`/watch/:channelRef`)
- `getChannelDetail(id)` → identity (name/number/brand), `state` (now playing +
  offset → already-playing playhead), `playlist` (→ NowNextRail up-next), `streamUrl`
  + `livepeer.playbackUrl` (HLS via existing `HlsPlayer`).
- `getChannelStatus(id)` poll for live tally/progress.
- **Stubs (no endpoint):** live viewer/tally count, chat/Circle community data →
  derive deterministically + label as placeholder.

### Explore (`/`)
- `listChannels()` → all channels. Per channel: `getChannelStatus` (liveness/now),
  `listStreamSchedules` (next windows). Derive `live | scheduled | offline`, order
  by liveness + time. NowNextRail per row from playlist/schedule.
- **Stubs:** watcher counts; "channel numbers" (assign from slug/index).

### Creator Dashboard (`/dashboard`)
- `listChannels()` filtered by connected `ownerWallet` → owned channels + status.
- `createChannel`, `sendChannelControl` (go-live guard: needs output configured),
  `getChannelStatus` for live/metrics.
- **Stubs:** aggregate viewer metrics.

## Shared-state rule
One provider fetches channels + per-channel status/schedules and exposes derived
`live|scheduled|offline` + now/next, so a channel created/edited in the manager
appears on the Dashboard and surfaces on Explore/Watch (real data, one source).
