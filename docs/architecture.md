# Architecture

## Services

| Service | What it is | State |
|---|---|---|
| `apps/api` | Express. `/v1` is the new API on the new schema; `/api` is the old one, kept for the old master control until the apps prompt replaces it | Postgres |
| `apps/worker` | Playout: ffmpeg to HLS and Livepeer. Still reads the old `opencast_state` blob until platform Phase 5 moves it onto the program log | Postgres, Redis lock |
| `apps/control`, `viewer`, `tv`, `site`, `spots`, `desk` | The apps (the apps prompt) | none; they call `/v1` |
| Postgres | One database, nine schemas (`accounts`, `broadcast`, `catalog`, `spots`, `ledger`, `trust`, `network`, `audience`, `notify`), plus the old `public.opencast_state` | |
| Redis | The worker's leader lock | |

## The v1 API

```
apps/api/src/v1/
  index.ts        builds every module's service, mounts every route under /v1
  http.ts         mounts contract endpoints: validates params, query and body, and the response
  auth.ts         Privy access tokens (ES256 JWT) checked against the app's key or JWKS
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

**Roles** are checked in each route through `accounts.requireStation` / `requireBusiness`: station owner, operator, host (their own live blocks only); business owner, manager (never withdraws or changes funding), viewer (results, airings, statements); Opencast admin (the desk, and owner of the stations Opencast runs). A station you're not on answers 404, not 403, so its existence isn't revealed.

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

Spots, catalog and playout never call a provider: they ask the ledger, which uses `payments.ts`.

## Still to move (later phases)

- The worker reads the old blob: Phase 5 moves it onto the program log, breaks, rotations and the as-run log, and calls `spots.place` and `spots.settleAiring`.
- `/api` and `apps/control` stay until the apps prompt's master control replaces them.
- `payments.ts` is a local fake: Phase 6 adds the Clear and Stripe adapters and the escrow contract.
- The jobs tick runs in one API process (`JOBS=on`); it moves to the worker, under its Redis lock, in Phase 5.
