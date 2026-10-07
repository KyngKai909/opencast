# The Network desk's Analytics page: the map (A251)

The user's request (2026-10-06): an Analytics page in the Network desk for the whole network and each station or channel, external stations included. The design is `docs/reference/desk/opencast-desk-analytics.html` (Ref. 12d). This file maps it onto the code, lists what's collected and what has to be added, and splits the build into phases.

## The user's decisions

- **Who sees it.** Admins see everything. A market lead opens it already filtered to their market and can't remove the filter. Rights reviewers don't see it. (Matches the reference.)
- **History.** The last 30 days come from the per-session rows the API already keeps. Totals worked out each night (and hourly) are kept forever, so 90-day and one-year views fill in from the day they ship.
- **Unique devices.** The reference counts sessions only, on purpose. The user chose to add devices as well: a random id kept on the device, never tied to an account, kept only as a hash for 30 days, then counts. The page says "devices", never "viewers" or "people".
- **Also shown.** Presets and reminders, pledges, spot revenue, "Not for me" votes, and watch time everywhere (hours watched leads, as the reference has it).
- **A seventh tab, Growth** (not in the reference; the user's choice): new and active accounts, new stations by kind, creators in the pipeline, markets opened, TV devices and paired phones, programs and hours uploaded, and top searches and searches that found nothing.
- **Searches** are logged with no account, device or session, kept 90 days, then totals.

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | **The data**, shipped first so history builds up: a session per station (and the fix that comes with it), the visit, the device hash, how it was tuned, press-to-picture, searches. Migration 0054. | Done |
| 2 | **Totals and the API**: hourly station totals (every station, external included, from session minutes), nightly totals (sessions and their length, bots by reason, devices, how people tuned in, station flows), `deskApi.analytics` (overview and stations) with CSV, the rail's "Analytics" first under Network, the **Overview** and **Stations** tabs. | |
| 3 | **One station** (03): the night by the minute with breaks, airings, surfaces, markets, came from and went to, airtime fill, earned, cost to run. | |
| 4 | **Audience** (04): the hour-by-day grid, session lengths, surfaces by day, moving around the dial, relays, how people tuned in, devices. | |
| 5 | **Programs and breaks** (05): programs across stations with still-watching curves; `break_stats` and break hold. | |
| 6 | **Money** (06): earnings by kind, held for claimable stations, the spot market, per 1,000 hours, Opencast's week, carriage; the `costs` rule group in Settings. | |
| 7 | **Health** (07) and **Growth**: airtime fill, incidents, relays, bots, press to picture and Stand by; then Growth and search. | |

Each phase goes to `dev` by its own pull request, merged when its checks pass.

## Where each number comes from

"Collected" means the data exists today. "Worked out" means it's derived from what's collected. "Phase N" means it's added then.

### Audience

| Metric | Source | Status |
|---|---|---|
| Tuned in at once (average, peak) | `audience.minute_samples` for Opencast stations; for external stations, `session_minutes` counted per minute (they're never in `minute_samples`, which billing reads) | Collected |
| Hours watched (listened on radio) | Sum of tuned-in minutes ÷ 60; hourly totals `station_hours` kept forever | Phase 2 |
| Where they watch (platforms) | `minute_samples` platform columns; for every station, `sessions.platform` through `session_minutes` | Collected |
| Where they are (markets) | `minute_markets`, `sessions.market_id` | Collected |
| Sessions and their length | `audience.sessions`; nightly totals `daily_session_stats` (kept forever) | Phase 2 |
| Devices (day, 7 days, 30 days, returning) | `sessions.device_hash` (30 days); nightly `daily_device_stats` | Collected (Phase 1); totals Phase 2 |
| Moving around the dial | A visit's sessions one after another (`sessions.visit_id`, `session_minutes`); nightly `station_flows` | Collected (Phase 1); totals Phase 2 |
| How people tuned in | `sessions.via`, nightly counts by station | Collected (Phase 1) |
| Presets | `accounts.presets` | Collected |
| Relays | `translator_samples` | Collected |
| Other apps (IPTV) | Not built (the reference's "Coming") | Later |

### Programs and breaks

| Metric | Source | Status |
|---|---|---|
| Stayed to the end, still watching by minute | `airing_stats.stayed_to_end`, `audience_at_start`, `tune_aways[]` | Collected |
| "Not for me" per 1,000 hours | `airing_stats.not_for_me`, `watch_seconds` | Worked out |
| A program across stations | `airing_stats` by `program_id`, the `MakerProgramWatch` rules | Collected |
| Break hold | New `break_stats`, from session heartbeats around each break and `as_run` (worked out from the 30 days of sessions kept, so it can be added later without losing history) | Phase 5 |

### Money, airtime and cost

| Metric | Source | Status |
|---|---|---|
| Earned by kind, held for claimable stations, carriage | The ledger, escrow | Collected |
| Spot market | `breaks`, airings, `as_run` | Collected |
| How airtime was filled | `as_run.reason`, `code` | Collected |
| Pay-as-you-go charges | Billing | Collected |
| Cost to run (estimated) | Measured usage times a new `costs` rule group in Settings; preparing minutes recorded on prepare jobs | Phase 6 |

### Health

| Metric | Source | Status |
|---|---|---|
| Incidents | Playout's dead-air fills and slates in `as_run`, notices | Collected |
| External stream time down | The worker's external checks | Collected |
| Bots filtered, by reason | `sessions.flagged_bot`, `flag_reason`; nightly totals | Phase 2 |
| Press to picture | `sessions.tune_ms` | Collected (Phase 1) |

### Growth

| Metric | Source | Status |
|---|---|---|
| New and active accounts | `accounts.users` (created), sign-ins and watching | Collected |
| New stations by kind, creators in the pipeline, markets opened | `broadcast.stations`, the desk's pipeline, `network.markets` | Collected |
| TV devices and paired phones | `tv.devices`, pairings | Collected |
| Programs and hours uploaded | The library | Collected |
| Top searches, searches with no results | `audience.searches` (90 days), then totals | Collected (Phase 1) |

## Rules the pages follow (from the reference)

- Hours watched is the number that adds up; average and peak tuned in sit beside it and are never summed.
- Every change is against the span just before, of the same length ("Today" against the same weekday last week, to the same minute).
- Relays and other apps are never in the network's totals.
- Below the minimum audience (`watch_data.minimum_audience`, 20), the desk sees hours, presets and sessions, not per-airing numbers, and the row is marked "Under the minimum".
- Every tab exports its tables as CSV with the same filters.
- "Today" is live; other spans read the totals and say when they were last worked out.

## Found while mapping

**Channel changes weren't counted.** A player keeps one session id for its tab, and the API refused a beat for a station other than the session's first ("start a new one when you change channel"), so after someone's first channel in a tab, nothing they watched was counted, in the station's numbers, the pool or per-thousand billing. Phase 1 fixes it in the API, so players already out there (the Samsung TV app as installed, open tabs) are counted per station without an update.
