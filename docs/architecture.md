# Architecture

## Services

| Service | What it is | State |
|---|---|---|
| `apps/api` | Express. The API is `/v1`; the server also serves channels' playlists and prepared segments (`/hls`), local-disk objects in development (`/objects`), provider webhooks and `/health`. The old `/api` routes are gone | Postgres |
| `apps/worker` | Playout: the engine (below) airs every station from its program log; the minute tick | Postgres, Redis lock |
| `apps/web` (the viewer, master control at `/control`, Network desk at `/desk`), `business`, `tv`, `site` | The apps (the apps prompt) | none; they call `/v1` |
| Postgres | One database, ten schemas (`accounts`, `broadcast`, `catalog`, `spots`, `ledger`, `trust`, `network`, `audience`, `notify`, `tv`), plus the old `public.opencast_state`, which no code reads or writes any more (kept as a backup; `packages/db/src/legacy/migrate.ts` reads it once) | |
| Redis | The worker's leader lock; the API's pub/sub for the TV remote's relay | |

## The v1 API

```
apps/api/src/v1/
  index.ts        builds every module's service, mounts every route under /v1
  http.ts         mounts contract endpoints: validates params, query and body, and the response
  auth.ts         Privy access tokens (ES256 JWT) checked against the app's key or JWKS
  geo.ts          the market from a connection: the client's address and the pluggable lookup (GEOIP_URL)
  places.ts       a business's address or city to coordinates: the pluggable lookup (PLACES_URL)
  relay.ts        the TV remote's message bus: in-process, or Redis pub/sub
  context.ts      Deps (db, clock, bus, auth, media, payments, notifier) and Services
  events.ts       in-process events, handled after the request (mostly notifications)
  jobs.ts         the minute tick: reminders, dead air, deadlines, daily caps, sponsorship months
  media.ts        probe, loudness, prepare for air (ffmpeg, R2), link import (yt-dlp)
  payments/       the one money interface: adapters for Clear, Stripe only, and a local fake
  ownership.ts    which tables each module owns
  modules/<name>/ service.ts (the module's functions) and routes.ts (its endpoints)
```

**Contracts first.** Every endpoint is declared once in `packages/contracts` (method, path, who can call it, Zod schemas). The API mounts exactly those; `test/routes.test.ts` fails if one isn't mounted. Responses are parsed by their schema before they're sent, so a field the contract doesn't declare (a stream key, an email) can't leak.

**Modules own their tables.** A module reads and writes only its own tables (`ownership.ts`); anything else comes from another module's service. `test/boundaries.test.ts` scans every module for `schema.<table>` and fails on a crossing. Services take a transaction where a change spans modules (placing a spot writes `spots.airings` and a `ledger` hold in one transaction).

| Module | Owns | Does |
|---|---|---|
| accounts | `accounts.*` | Sign-in, me, presets, reminders, teams, invites, roles |
| stations | stations, channels, break rules, blocked categories, translators, live sources, hosts, speakers | The dial, guide, station pages, search, setup |
| library | programs, assets, files, folders, break points, rights, import jobs | Uploads, link imports, rights, listings |
| log | log entries, repeat groups, breaks, dead-air events | The program log, breaks from the break rule, gaps, dead air |
| playout | playout state, commands, Livepeer config, schedules, as-run | Sign-on checks, sign on/off, status, the as-run log |
| catalog | `catalog.*` | The syndication market and its limits |
| spots | `spots.*` | Businesses, spots, targeting, rotations, placement, sponsorships, production orders, codes, results |
| ledger | `ledger.*` | All money (below) |
| audience | `audience.*` | Heartbeats and tuned in |
| trust | `trust.*` | Rights claims and standing |
| notifications | `notify.*` | Notices, pushes, emails |
| waitlist | signups, call-sign reservations, channel holds | The waitlist |
| network | markets, creators, permission and licence records, recipes, listed sources, handovers | Network desk |
| tv | `tv.*` | TV devices, sign-in by code, TV sessions, TVs on the account, the phone remote's relay |

**Roles** are checked in each route through `accounts.requireStation` / `requireBusiness`: station owner, operator, host (their own live blocks only); business owner, manager (never withdraws or changes funding), viewer (results, airings, statements); Opencast admin (the desk, and owner of the stations Opencast runs). A station you're not on answers 404, not 403, so its existence isn't revealed.

## TVs and the phone remote

A TV app registers on first launch (`POST /tv/devices`) and keeps an opaque device token. "Sign in on your phone": the TV shows a 6-character code (10 minutes) and polls; the person approves it on their phone; the next poll hands the TV a session token, once. Every token is stored as its SHA-256.

**Auth.** `http.ts` routes tokens by prefix: `tvd_` (device), `tvs_` (TV session), `tvp_` (a paired guest phone); anything else is a Privy token. Endpoints with `auth: "device"` take the device token or the TV session. A TV session is accepted as `user` only by endpoints marked `tvSession: true` in the contracts (getMe, updateMe, mergeDevice, presets, reminders, listMyPledges), acting as the person who approved it, never as an admin; everywhere else it's 403 `tv_not_allowed`.

**The relay.** Android TV and Fire TV have no Cast, so phones reach the TV app through the API with the Cast receiver's messages. The TV holds an event stream (`GET /tv/remote/events`, Server-Sent Events) and receives `command`s with who sent them; it posts its state, which goes to every phone's stream (`GET /tv/remote/:tvId/events`). A phone on the TV's account drives it without pairing; a guest's phone pairs with a 4-digit code the TV shows (5 minutes) and gets a phone token. The TV enforces its own "who can change the channel" setting. Messages go through `deps.relay` (Redis pub/sub when `REDIS_URL` is set, so a TV and its phones can be on different replicas). Presence is in the database: open streams write `online_until` and renew it at each 25-second heartbeat; a TV stays online 10 seconds after its stream closes.

## Playout

The engine lives in the playout module (`apps/api/src/v1/modules/playout/engine`) and runs in the worker, on the Redis leader only.

Prepare once, then assemble (the platform prompt, Phase 5): prerecorded material is never encoded live. Each file is transcoded once to a fixed ladder, and each channel is a set of rolling playlists that point at those segments in the order the log says.

```
engine tick (1 s)   commands → prepare what's queued → readiness check (hourly, 48 hours ahead) →
                    fill breaks 20 min ahead → fill dead air → assemble every station on air;
                    hourly, the storage sweep
prepare.ts          once per content ID, from the original: FFmpeg to the ladder (TV 1080/720/480/360
                    and audio-only 128k; radio 128k and 64k), 4 s segments with aligned keyframes,
                    loudness levelled to -24 LUFS, captions cut to the segments (uploaded, embedded or
                    generated), stored under `prepared/<cid>/<rendition>/` (`prepared_items`,
                    `prepared_renditions`, `prepared_captions`). A carried or catalog program is
                    prepared once for every station. Slates, generated station IDs and the automatic
                    opener and closer (A242) the same way
readiness.ts        is everything on the next 48 hours of each log prepared in its band's renditions?
                    Queues what isn't, warns an hour ahead, and the usual fill airs anything missing
plan.ts             the run sheet: programs at their times, split around breaks and resumed where they
                    stopped; each break = the opening bumper sequence, spots, credit, the closing
                    sequence, station ID last (each by the break rule's cadence, cadence.ts; A243: the
                    bumpers picked with the break by sequence.ts, whole or not at all by priority,
                    held spots first), then the between-programs sequence carved from the closing
                    break's end (or open time's) before the next program, outside the break's SCTE-35
                    span; programs never move; live blocks; off air (A242: the closer, the
                    off-air card for a minute, dark, then the opener ending as the first program starts,
                    the station ID after it only if the station says so; the station's own, else
                    automatic ones in its look; short off air time keeps the channel on: closer, card,
                    opener, or the card alone); the daily opener at the first program boundary at or
                    after 6:00 am with fill before it; open time = station ID and bumpers (the Any
                    ones, in their windows), never nothing
sequence.ts         bumper roles and sequences (A243): the defaults (one into the break, one out, as
                    before), when an item may air (broadcast dates, a time of day), each role's chain
                    (into and out of a break fall back to Any; up next never), picks decided in order
                    in the log's break walk (least recently aired first from three in a pool, from the
                    as-run log; library order below that), up next once a break, fitting by priority,
                    and whether the between sequence airs at each program boundary
fill.ts             places spots in stored breaks, holding the money first: rotation, then backup rotation,
                    within the hourly cap, same-spot limit, blocked categories and dayparts; the
                    producer's barter share from the producer's rotation (the producer is paid)
assemble.ts         per station on air: the run sheet becomes the channel's timeline (`channel_items`):
                    prepared segments in log order, a discontinuity and program date-time per item, and
                    DATERANGE tags (bug, lower thirds, codes, SCTE-35 break cues, A243's up next: the
                    next program's title over an up-next bumper, from the guide's own data). Nothing
                    is encoded.
                    As each item's segments are published: an as-run row, a proof frame for spots
                    (proof.ts), and settlement
playlist.ts         renders a channel's master and media playlists from its timeline (API and worker,
                    short cache); the player draws the bug, lower thirds, codes and up next from the
                    DATERANGE tags (relays draw only the bug: no up-next title there yet, A243)
live.ts, livecopy.ts, radiolive.ts, rtmp.ts
                    live blocks, always from the worker's own segments in storage
                    (prepared/live-<source>-<session>/<rendition>/, kept with their channel rows,
                    two days): TV transcoded by Livepeer (same ladder), each new segment of each
                    rendition pulled once by the leader and stored in R2 as it's published, the
                    audio-only rendition cut from the smallest's bytes (livecopy.ts; one pull per
                    source however many stations air it or viewers watch; a failed copy is retried
                    briefly, then skipped with a discontinuity; a copy behind drops to the newest;
                    health `liveCopy`); radio through the worker's own RTMP ingest, packaged to
                    128k and 64k. Viewers and relays never fetch Livepeer's segments
sender.ts, fanout.ts, relayBreaks.ts
                    relays (follow-up Phase 3; run by the relay service, apps/relay, never the worker):
                    one continuous stream per station from the channel's own segments, live blocks
                    included (tsretime.ts), stream-copied, or re-encoded where the bug is drawn in;
                    breaks as the station chose (its spots or the station ID slate); pushed to the
                    station's Livepeer relay stream (no transcoding), which multistreams to every
                    platform. The relays module (modules/relays) holds the setting, restarts for
                    platform limits and the runner the relay service ticks (docs/relay.md)
slates.ts           station ID, credit, off-air, stand-by, bug, code + QR, the automatic opener and
                    closer's picture, a station's own off-air picture fitted to the frame: SVG (or the
                    picture) rendered with sharp
stationId.ts        the generated station ID's key, and the automatic opener's and closer's (A242):
                    keyed by what they show, so a new look (or back time) is prepared again
```

The worker keeps no files of its own: it prepares from object storage into scratch space (`WORKER_SCRATCH_DIR`) and writes the results back. Its `/health` reports items prepared, waiting and the time preparation takes, and the last readiness check.

The money jobs (the worker's minute tick): provider moves sent, the escrow contract's events read, unaired holds returned, deliveries auto-approved; daily: monthly pledge renewals (fake provider); Mondays: the escrow batch and stations' weekly statements; payday (Mondays, or the 1st on a monthly schedule): payouts to stations whose payout account is set up; the 1st: the pool shared out for last month (equal base, watch time, the creator fund on-chain) and businesses' statements. Cash carriage is charged when a carried episode airs (the runner), once per slot.

Held airings that never aired (a file not prepared at air time, a station signed off) give their hold back an hour after their slot (`spots.releaseUnaired`, in the jobs tick).

## Storage

Files are stored by **content ID**: a CID (v1, raw codec, sha-256) of the bytes. The same file uploaded by twelve stations is stored once.

```
storage.ts            the storage interface: an object store (R2 or any S3-compatible store; local disk in
                      development) and an IPFS publisher (Pinata), keyed by content ID
library/content.ts    contents (one row per file), content_refs (who points at it), locks, takedowns,
                      the storage sweep
playout/service.ts    previews (a playlist over prepared segments), and deleting what was prepared
storageMaintenance.ts the one-off steps (below)
```

| What | Where | Class |
|---|---|---|
| Originals: every upload (library items, spots, order deliveries and briefs), claim attachments, logos, caption files | `<cid>` | Infrequent Access (files from before 2026-09-29: Standard) |
| What's prepared from an original: each rendition's playlist and 4 s segments, and its caption tracks | `prepared/<cid>/<rendition>/`, `prepared/<cid>/cc…/` | Standard |
| Slates, generated station IDs and the automatic opener and closer, prepared the same way | `prepared/slate-…/`, `prepared/sid-…/`, `prepared/opn-…/`, `prepared/cls-…/` | Standard |
| Radio live segments | `prepared/live-…/` | Standard |
| Proof frames, kept a year | `proof/<station>/<airing>.jpg` | Infrequent Access |
| Relay backgrounds' loops | `relay-backgrounds/<cid>-<size>/` | Standard |

- **Prepared from the original.** Uploads are kept as they came; nothing is compressed at upload. Playout prepares from the original, once, so a 1080p source airs a real 1080p. Checks (length, picture, loudness, embedded captions, codecs) read the original. Items stored before 2026-09-29 pointed at a 1280 px copy (`asset_files.original_content_id` held the original); `storage:prepare-from-originals` moves them onto their originals (see `docs/deploy.md`).
- **Previews play the prepared segments.** The catalog's episodes, spots in review and in the market, and order deliveries get `/v1/previews/<cid>/<rendition>.m3u8`: a short-cache (60 s) VOD playlist over the lowest TV rendition (v360), or a64 on the radio band. Asking for a preview queues the file's preparation if it isn't prepared, soon after what airs within the hour; until then `previewStatus` is `preparing` ("Being prepared"). There are no separate preview renditions; the old `previews/<cid>/` ones are deleted by the storage sweep.
- **Storage classes stay put.** Storing bytes that are already stored changes nothing, whatever class is asked for: an Infrequent Access object is never moved to Standard. What's read all day (prepared and live segments, relay loops) is written straight to object storage in Standard and never goes through `content.store`.
- **References.** Asset files, spot files and order files each hold a reference. Deleting an item drops its references; the object goes when the last one does, and with it everything prepared from it (`prepared/<cid>/…` and its `prepared_items`, `prepared_renditions` and `prepared_captions` rows; a caption file that goes takes the tracks cut from it). What a channel pointed at in the last two hours is left for the storage sweep (the worker, hourly), so players still fetching it aren't cut off. The as-run log keeps what aired. A database trigger refuses to mark content deleted while anything references it or a claim holds it.
- **Takedowns.** A claim locks the file (kept, never aired, never exported, no preview) and pulls every station's item made from it off the log. Answered or withdrawn: unlocked. Resolved against it (removed, upheld, expired): deleted from storage with everything prepared from it, at once, and it can never be stored again.
- **IPFS** is publishing, not storage: the catalog station's originals are pinned when stored, and an owner can "Export to IPFS" their own upload after accepting that it's public and permanent. The IPFS CID is recorded beside the content ID (`ipfs_cid`): for files over about 1 MiB it differs from the content ID, since IPFS chunks them (see `docs/open-decisions.md`).
- **Moving off Pinata**: `npm run storage:move-off-pinata -w @opencast/api` reports; `--copy` copies each pin into storage, verifies it by hash and relinks every row that used it to the new content ID; `--unpin --yes-unpin` then unpins every verified, non-catalog copy.
- **Files keyed by location** (from before content IDs: a disk path or URL, prepared as `loc-…`): `npm run storage:relink-locations -w @opencast/api` reports; `--relink` stores each by content ID and relinks it, carrying its prepared segments over.

## Money

Double-entry in `ledger`: every movement is an entry whose postings sum to zero; nothing is edited. The database enforces balance, non-negative advertiser balances and holds, funded holds, and escrow paying only the creator or the fund.

```
deposit        external → advertiser available          (card fee external → card fees, on top)
placement      available → holds (per airing, sponsorship month, production order)
airing         holds (+ available if the real cost is higher, + Opencast absorbs any gap)
                 → station earnings (or owed-to-escrow for a claimable station)
                 → Opencast share and the pool (both 0 until decided)
               the rest of the hold → available
barter         carrier earnings → producer earnings (the agreed share)
cash carriage  carrier earnings → producer earnings (per aired episode)
pledge         external → station earnings (less Stripe's fee, less Opencast's share, 0)
withdrawal     available → external
payout         station earnings → external
usage          station usage owed → Opencast usage billed (each day, accrued; nothing moves)
usage paid     station earnings (before each payout, and at month end) or external (Clear, card)
                 → Opencast usage (the treasury); usage owed and billed settle
```

**Pay-as-you-go** (follow-up Phase 2; `modules/ledger/billing.ts`, docs/pricing.md). Being on air is free. The jobs measure each station's storage, relay hours (per station, platforms at the same time counted once) and live hours every hour, close each UTC day into a `usage` entry (after the free allowance, at that day's price from the rules registry, never past the station's cap), and close each month's bill: earnings first, then the owner's Clear wallet with full access (the owner approves the transfer) or the station's card (an off-session Stripe charge). What can't be charged starts the grace period (`billing.grace`); after it, relays and live hours pause ("Everything I air" falls back to live shows only in the relay service, live blocks plan as open time), never the channel. A cap reached pauses its usage the same way (a storage cap stops new uploads). The Stripe side, kept apart from Clear's use of ClearLabs Inc's account, is docs/stripe.md.

**Platform connections and relay viewers** (follow-up Phase 3; `modules/platforms/`, `modules/spots/relayViewers.ts`, docs/platforms.md). YouTube and Twitch connect by signing in (OAuth; the real clients are behind an interface, with fakes for tests), anything else by address and key; keys and tokens are sealed with AES-256-GCM (PLATFORM_SECRETS_KEY) and opened only in memory. The platforms module is the relay service's seam (`PlatformsSeam`, relay.ts): destinations with their keys, YouTube's next broadcast, ending one, paid promotion. Every minute the jobs read each signed-in platform's concurrent viewers; per-thousand spots bill them (online businesses every relay viewer, local ones only YouTube's share inside their area, from YouTube Analytics a day or two late), each platform's part settling on its own from the airing's hold.

Spots, catalog and playout never call a provider: they ask the ledger, which uses `payments/` (adapters: `clear`, `stripe_only`, `fake`, chosen by `PAYMENTS_PROVIDER`).

**Clear as a Privy global wallet.** Opencast has its own Privy app; a person links their Clear wallet through Privy's cross-app linking (Clear is the provider app), and the API records it (`accounts.clear_links`, `clearLink.ts`). A station can be paid out to its owner's linked wallet (`ledger.payout_destinations`); a business's owner can withdraw to theirs; with full access, a business is funded by a transfer from it, checked on chain (`chain/usdc.ts`) and credited once per transaction (`deposits.tx_hash`). See `docs/clear-integration.md`.

**The outbox.** A provider is never called inside a database transaction. Each entry writes, in its own transaction, what the provider has to do (`ledger.provider_moves`): an entry's postings map to wallets (the adapter's `custody`), encumbrances change for holds, and wallets that lost money pay wallets that gained it (`moves.ts`). The jobs tick sends them in order with an idempotency key each, retrying failures; a wallet with a failed move waits so nothing overtakes it. Money leaving (withdrawals, payouts) is taken out of the ledger first and reversed if the provider refuses. Deposits, pledges and payout results arrive by webhook (`POST /v1/webhooks/stripe|clear`). See `docs/clear-integration.md`.

**Escrow and the creator fund.** A claimable station's settled earnings are `escrow_owed` (a liability to the station) until the weekly batch into `CreatorEscrow` (`contracts/`) confirms, then `escrow`. The contract pays only an approved creator wallet (a threshold of verifier keys, then 72 hours in public) or, after the unclaimed period, `CreatorFund`, which pays only grants its stewards approve (again a threshold and 72 hours), never to Opencast. Both are upgradeable only through a 7-day timelock any key holder can cancel. See `contracts/README.md`.

## Ads from partners: what's ready

Ads from partners (a programmatic backfill for break time still open after the station's own rotation, backup rotation and thank-you credit, and before bumpers and the station ID) isn't built. Everything it needs from Phases 3 to 5 is, so it can be added without rework:

- **Break markers.** Every break carries SCTE-35 `splice_insert` cues (`playout/engine/scte35.ts`) as `EXT-X-DATERANGE` `SCTE35-OUT`/`SCTE35-IN` in the station's live playlist: stored breaks by their ID, breaks generated from the rule but not stored yet by an ID made from the station and start time (`breakCue`). Cued-live breaks are stored as they happen, so they're cued too. Players on Livepeer's output read the same breaks from the log.
- **IAB categories.** Every station and program has IAB Content Taxonomy 3.0 ids (`StationSetup.iabCategories`, `Program.iabCategories`): its own override (`iab_categories` on `broadcast.stations` and `broadcast.programs`), else derived from its category (a program falls back to its station's), else Entertainment. A station's blocked spot categories map to IAB Ad Product Taxonomy 2.0 ids for each ad request's block list. The mappings are in `packages/domain/src/ads.ts`; `stations.adProfile` puts a station's together.
- **Ratings and children.** `Program.rating` (TV-Y to TV-MA) and `Program.childDirected`. A children's rating (TV-Y, TV-Y7) makes a program child-directed unless it says otherwise. Child-directed programs will get no personalized ads.
- **The station's switch.** `BreakRule.adsFromPartners` (`break_rules.ads_from_partners`), off by default, read and written through the break rule endpoints. It changes nothing in playout yet.
- **The ledger line.** `StationEarnings.lines.partnerAds` (`{ on, micros, pendingMicros }`, all 0 until it's built): "Ads from partners, paid when received". When it's built it's its own line per station: never held in advance, never escrowed, never counted in held money; paid when the partner pays (30 to 90 days after airing); invalid-traffic deductions recorded when the partner reports them; Opencast's share and the pool applied as they are to spots, once set.

To come: an `adfill` interface in the playout module, so the provider can change (Google Ad Manager's Dynamic Ad Insertion, or AWS Elemental MediaTailor), fed by VAST or VMAP requests at each marked break with the station's and program's IAB categories, the blocked ad products, the rating and the child-directed flag. The as-run log will record a "partner ads" block with its length and impressions, not individual spots; per-viewer ads are allowed only in this backfill; spots in the spot market are still billed on Opencast's own count, with partner impression counts shown beside it. `ads.txt` and `app-ads.txt` get published on the site and the apps' domains. Which provider, whether to start through a FAST aggregator, and Opencast's share are open (docs/open-decisions.md).

## What was removed

- The old `/api` routes, the JSON state store over `public.opencast_state` and the old upload path (compress to 720p, key by asset, optional Pinata pin) are gone from the API. The table and its data stay untouched.
- The worker's old queue loop (`LEGACY_PLAYOUT`) is gone; every station airs from its program log.
- `apps/control` and `apps/desk` are gone: master control and the Network desk are `/control` and `/desk` in `apps/web`.
