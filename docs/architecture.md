# Architecture

## Services

| Service | What it is | State |
|---|---|---|
| `apps/api` | Express. `/v1` is the new API on the new schema; `/api` is the old one, kept for the old master control until the apps prompt replaces it | Postgres |
| `apps/worker` | Playout: the engine (below) airs every station from its program log; the minute tick. Also runs the old queue loop for stations still on the old model (`LEGACY_PLAYOUT`) | Postgres, Redis lock |
| `apps/web` (the viewer, master control at `/control`, Network desk at `/desk`), `business`, `tv`, `site` | The apps (the apps prompt) | none; they call `/v1` |
| Postgres | One database, ten schemas (`accounts`, `broadcast`, `catalog`, `spots`, `ledger`, `trust`, `network`, `audience`, `notify`, `tv`), plus the old `public.opencast_state` | |
| Redis | The worker's leader lock; the API's pub/sub for the TV remote's relay | |

## The v1 API

```
apps/api/src/v1/
  index.ts        builds every module's service, mounts every route under /v1
  http.ts         mounts contract endpoints: validates params, query and body, and the response
  auth.ts         Privy access tokens (ES256 JWT) checked against the app's key or JWKS
  geo.ts          the market from a connection: the client's address and the pluggable lookup (GEOIP_URL)
  relay.ts        the TV remote's message bus: in-process, or Redis pub/sub
  context.ts      Deps (db, clock, bus, auth, media, payments, notifier) and Services
  events.ts       in-process events, handled after the request (mostly notifications)
  jobs.ts         the minute tick: reminders, dead air, deadlines, daily caps, sponsorship months
  media.ts        probe, loudness, prepare for air (ffmpeg, R2), link import (yt-dlp)
  payments.ts     the one money interface (Clear, Stripe in Phase 6; a local fake now)
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

```
engine tick (1 s)   commands → runners follow who's on air → fill breaks 20 min ahead → fill dead air
fill.ts             places spots in stored breaks, holding the money first: rotation, then backup rotation,
                    within the hourly cap, same-spot limit, blocked categories and dayparts; the
                    producer's barter share from the producer's rotation (the producer is paid)
plan.ts             the run sheet: programs at their times, split around breaks and resumed where they
                    stopped; each break = spots, credit, bumpers, station ID last; live blocks; off air;
                    open time = station ID and bumpers, never nothing
runner.ts           per station: one long-running muxer (MPEG-TS in, `-c copy` out) to HLS, Livepeer and
                    relays; relays set to "Station ID slate" get their own feed with the slate in breaks.
                    Each segment is encoded in real time with the bug (and a spot's code and QR for its
                    last :10), timestamps carried on, so outputs never reconnect between items. Spots,
                    credits, bumpers and IDs air in full; programs are joined late instead. When a segment
                    ends: an as-run row with its real times, a proof frame for spots, and settlement.
cache.ts            the worker's file cache on its volume: hourly, the next 48 hours of every station's log
                    (plus station IDs, bumpers, rotations and dead-air repeats), earliest airtime first,
                    evicting what airs furthest away; a file due within the hour and not cached tells the
                    station and Network desk and is fetched at once. Playout reads only from here: a miss
                    airs the usual fill and is reported. Hit rate, bytes and misses on the worker's /health
live.ts             a live source read ahead of its block (encoders can connect early or reconnect)
slates.ts           station ID, credit, off-air, stand-by, bug, code + QR: SVG rendered with sharp
scte35.ts           splice_insert cues; the API adds EXT-X-DATERANGE (SCTE35-OUT/IN) to live playlists
```

Live blocks read the encoder from Livepeer's playback when the source was made with a Livepeer key, or from a local RTMP listener (`LIVE_LISTEN_PORT`) otherwise. The feed opens a minute before the block; with no signal the stand-by slate airs and the station is told, and it switches to the feed as soon as one arrives (and back, if it drops). The local listener serves one live block at a time, since there's one port; production reads through Livepeer.

The money jobs (the worker's minute tick): provider moves sent, the escrow contract's events read, unaired holds returned, deliveries auto-approved; daily: monthly pledge renewals (fake provider); Mondays: the escrow batch and stations' weekly statements; payday (Mondays, or the 1st on a monthly schedule): payouts to stations whose payout account is set up; the 1st: the pool shared out for last month (equal base, watch time, the creator fund on-chain) and businesses' statements. Cash carriage is charged when a carried episode airs (the runner), once per slot.

Held airings that never aired (a file missing from the cache, a station signed off) give their hold back an hour after their slot (`spots.releaseUnaired`, in the jobs tick).

## Storage

Files are stored by **content ID**: a CID (v1, raw codec, sha-256) of the bytes. The same file uploaded by twelve stations is stored once.

```
storage.ts          the storage interface: an object store (R2 or any S3-compatible store; local disk in
                    development) and an IPFS publisher (Pinata), keyed by content ID
library/content.ts  contents (one row per file), content_refs (who points at it), previews and their needs
```

| What | Where | Class |
|---|---|---|
| The prepared file playout airs (items, spots, deliveries) | `<cid>` | Standard |
| Original uploads, order briefs | `<cid>` | Infrequent Access |
| Previews: low-bitrate HLS for the market, spot review and order review | `previews/<cid>/` | Standard, only while an offer, a review or an open order needs it |

- **References.** Asset files (prepared and original), spot files and order files each hold a reference. Deleting an item drops its references; the object goes when the last one does. A database trigger refuses to mark content deleted while anything references it or a claim holds it.
- **Takedowns.** A claim locks the file (kept, never aired, never exported) and pulls every station's item made from it off the log. Answered or withdrawn: unlocked. Resolved against it (removed, upheld, expired): deleted from storage, from previews and from the worker cache, and it can never be stored again.
- **IPFS** is publishing, not storage: the catalog station's items are pinned when prepared, and an owner can "Export to IPFS" their own upload after accepting that it's public and permanent. The IPFS CID is recorded beside the content ID.
- **Moving off Pinata**: `npm run storage:move-off-pinata -w @opencast/api` reports; `--copy` copies each pin into storage and verifies it by hash; `--unpin --yes-unpin` then unpins every verified, non-catalog copy.

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
```

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

## Still to move (later phases)

- `/api` and `apps/control` stay until the apps prompt's master control replaces them.
- `payments.ts` is a local fake: Phase 6 adds the Clear and Stripe adapters and the escrow contract.
- The old queue loop in the worker stays (`LEGACY_PLAYOUT=on`) until nothing is on the old model.
