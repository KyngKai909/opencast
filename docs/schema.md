# Schema

One Postgres database, eight schemas, 96 tables. It's defined in Drizzle (`packages/db/src/schema/`), and the SQL migrations are checked in (`packages/db/migrations/`). The old `public.opencast_state` table sits beside them, untouched: no code reads or writes it any more (the old `/api` routes were removed on 2026-09-29), except the one-time legacy migration below.

```bash
npm run db:up        # Postgres 17 and Redis 7 in Docker (ports 54329, 63799)
npm run db:migrate   # apply migrations
npm test             # includes the constraint tests, against a throwaway database
npm run db:generate  # after editing packages/db/src/schema, write the next migration
```

## Conventions

- **Money** is `bigint` micro-dollars (1 USDC base unit). "262 × $8.00 ÷ 1,000" is 2,096,000, exactly, and rounding happens once where a rule says so (see `open-decisions.md`).
- **Durations** are milliseconds. **Channel numbers** are stored in tenths: `12.2` is `122`, `88.2` is `882`.
- **Ids** are UUIDs. Migrated rows keep their old ids.
- **Times** are `timestamptz`.

## Tables

| Schema | Tables |
|---|---|
| `accounts` (12) | users, identities, station_memberships, advertiser_memberships, invites, presets, preset_key_use, reminders, notification_prefs, devices, sign_in_sessions, watch_history (migration 0016: `sign_in_sessions` for sign out everywhere, `watch_history` kept only while the person's setting is on; `users.signed_out_at` and `deleted_at`; migration 0017: `invites.program_ids`, a host invite's live programs) |
| `broadcast` (35) | stations, channels, programs, assets, asset_files, asset_folders, asset_break_points, rights_confirmations, log_entries, repeat_groups, day_template_entries, day_template_dates, off_air_hours, breaks, break_rules, blocked_categories, live_sources, host_assignments, speakers, schedules, playout_state, commands, translators, livepeer_config, import_jobs, as_run, dead_air_events, caption_tracks, lower_thirds, prepared_items, prepared_renditions, channel_items, translator_sessions (migration 0020: prepare once, then assemble; see below), prepared_captions (migration 0021; see below), relay_backgrounds (migration 0023; see below) (migration 0017: `caption_tracks` (library) for an item's WebVTT track, `lower_thirds` (stations) for a live block's lower third; `log_entries.ended_early_at`, `programs.captions_mode` and `captions_language`, `assets.audio_channels`; migration 0019 (all owned by log): `day_template_entries` (a day template's entries as local wall-clock minutes and lengths), `day_template_dates` (each date a template generated, one per station and date, with `edited_at` for exceptions), `off_air_hours` (a station's standing off air rules: weekdays, sign-off and back times in the market's time zone); `repeat_groups.template`, `name`, `updated_at`, `removed_at`; `log_entries.template_date`. `repeat_groups.pattern` gains `weekdays` and `commands.action` gains `replan`, both text columns, so no migration) |
| `catalog` (4) | offers, requests, agreements, offer_previews (migration 0017: `offers.cpb_price_micros`, `cpb_price_unit`, `cpb_maker_ms_per_hour` and `barter_fill`, cash plus barter's own price) |
| `spots` (21) | advertisers, advertiser_locations, advertiser_markets, spots, spot_files, upload_checks, targeting, codes, code_events, rotations, rotation_spots, airings, sponsorship_settings, sponsorships, sponsorship_months, production_orders, order_files, order_notes, connections, connection_events, catalog_house_credits (migration 0017: `advertisers.short_name`; `spots.last_pause_reason`, `last_paused_at`, `resumed_at`, `resume_reason` for the pause story; `production_orders.maker_asked_listed_at`; migration 0018: `connections` (Clear Pay and a checkout, with the webhook's signing secret) and `connection_events` (webhooks already counted); `advertisers.redeem_on` and `receipts_key`; `codes.picked_by`; `targeting.bands`; `production_orders.quoted_at`; `order_files.duration_ms` and `checks_passed`. `spots.pause_reason` gains `by_hand`, a text column, so no migration; migration 0030: `sponsorships.market_id` and `offered_by` for the catalog's credit sold by series and market, one live sponsorship or offer per slot (`sponsorships_catalog_slot`), and `catalog_house_credits`, each month's Clear-filled catalog slots with the credits aired, not billed) |
| `ledger` (11) | accounts, entries, postings, holds, funding_sources, deposits, payouts, statements, pledges, escrow_deposits, revenue_config |
| `trust` (5) | claims, answers, takedowns, policy, claim_attachments (migration 0017: the files behind answers, by content ID) |
| `network` (15) | markets, zip_markets, waitlist_signups, call_sign_reservations, channel_holds, creators, creator_works, permission_requests, permission_records, permission_record_works, licence_records, recipes, listed_sources, listed_airings, handovers (migration 0032: `storage_runs`, each run of a one-off storage job from the desk's Settings, Storage maintenance, a check or an apply, with who, when, progress, counts and the JSON report, one running run per job; `change_log.kind` gains `storage`, each apply) |
| `audience` (6) | sessions, minute_samples, translator_samples, session_minutes, not_for_me_votes, airing_stats (migration 0031: watch data; see "Watch data" below) |
| `tv` (7) | devices, sessions, sign_in_codes, cast_targets, pair_codes, remote_phones, code_attempts (migration 0015: the TV app's devices, sign-in by code, and the phone remote's relay; `accounts.devices` from Phase 3 is unused and kept) |

### Shapes worth knowing

- **Every occupant of the dial is a station row.** `stations.kind` is `station`, `studio`, `claimable`, `listed` (a city stream) or `catalog` (OCAT). One call-sign rule and one channel rule then cover all of them. A studio has a `handle` and no call sign or channel.
- **Programs are series.** A program is what listings, sponsorships and carriage offers attach to. `assets` are its episodes, and every library item carries a log code (`PGM`, `SPT`, `UND`, `BMP`, `SID`; `OPEN` is the slate filler).
- **The program log** (`log_entries`) holds programs, live blocks and planned off-air time (one-off sign-offs), each with exact start and end times. **Breaks** are generated from the break rule into `breaks`. What aired goes to `as_run`, which is append-only and is the only thing billing reads.
- **Day templates** are `repeat_groups` with `template` true: the day lives in `day_template_entries` (minutes after local midnight, so 8:00 pm stays 8:00 pm across daylight saving), and each future date generated from it is a row in `day_template_dates` (primary key station and date) plus its `log_entries` (`repeat_group_id` the template, `template_date` the date). A date edited by hand gets `edited_at` and is never generated again. G7 copies made before templates (`template` false) have no entries or dates.
- **Prepare once, then assemble** (migration 0020, new tables only; `playout` owns them). `prepared_items` is one row per thing prepared for air, keyed by its content ID (so a carried or catalog program is prepared once for every station), a `slate-…` key for generated slates (station ID holds, credits, sign-off, stand-by: the picture's hash and the length), or `loc-…` for a file from before content IDs. `renditions` is what's wanted (the union of the bands that air it), `status` queued, preparing, ready or failed, `needed_at` the earliest airtime known (the queue's order), `prep_ms` and `bytes` what the last preparation took and stored. `prepared_renditions` (key, rendition) holds each rendition's segment lengths (`segment_ms`, the playlists' EXTINFs); the segments are in object storage under `prepared/<key>/<rendition>/`. `channel_items` is each channel's assembled timeline, a row per item or live stretch: its media sequence (`seq`), discontinuity sequence (`disc`), playlist `run` (a new one after a planned sign-off; an `end` row is #EXT-X-ENDLIST), program date-times, the prepared key and segment range (or `live_uris`), its DATERANGE `tags`, and what the as-run entry will say; `as_run_id` is set when its last segment is published and the entry written. Playlists are rendered from these rows by any replica; rows older than two days go. `translator_sessions` records each relay session's mode (copy or composite), whether it swaps breaks, and `bytes_sent` (egress); no foreign key to `translators`, so egress stays on record when a translator is removed.
- **Relay backgrounds** (migration 0023; `stations` owns it). `relay_backgrounds` is one row per radio station with a background for its translators: its `kind` (image, gif, video), the upload's `content_id` (referenced as `relay_background` in `content_refs`), `status` (preparing, ready, failed) and, once ready, `loop_key` (the prepared loop and its still in object storage, `relay-backgrounds/<content ID>-<W>x<H>/`), its size, length and `frames`. Relays only; the apps never show it.
- **Captions, prepared once** (migration 0021; X2). `prepared_captions` (key, content ID) is one row per caption track cut into a prepared item's 4-second segments (`playout` owns it): the WebVTT's content ID, its folder under `prepared/<key>/` (`rendition`, "cc" and 12 hex characters), `source` (uploaded, embedded in the file, or generated), `language`, how many segments. `caption_tracks.content_id` is the uploaded track's content ID (it's in object storage under it too, referenced as `caption_track` in `content_refs`); `translators.burn_captions` is whether a relay draws captions into the picture (off by default).
- **Catalog sponsors** (migration 0030; `spots` owns it). A catalog sponsorship is a `sponsorships` row with a `market_id`: the station is the catalog station, the program the series' (null: every catalog series in the market). It's held, paid and lapsed monthly through `sponsorship_months` like any sponsorship; `offered_by` is who on the desk offered or assigned it. A partial unique index keeps one requested or approved row per slot (market, program or none). `catalog_house_credits` (program, market, month; credits, `billed_micros` 0) records the slots Clear filled, on the 1st for the month before.
- **Watch data** (migration 0031; `audience` owns it; follow-up Phase 1). See the next section for what's kept after 30 days.
- **Off air hours** (`off_air_hours`) aren't stored as log entries: the spans are worked out from the rules when read, less anything on the log, and joined with sign-off entries. They're never dead air.
- **Ledger.** It's double-entry: `entries` each have two or more `postings` that sum to zero. Balances are sums of postings, so nothing is ever updated.
  - Holds are rows in `holds` plus postings on the shared `holds` account tagged with the hold. A hold's open amount is the sum of its postings, which is why a hold never changes.
  - `deposits`, `payouts` and `pledges` track the provider's progress (pending, sent, …). Money only moves through entries.
- **Undecided rates** live in `ledger.revenue_config`, one row per effective date, all zero by default.

## Watch data: what's kept, and for how long

Added 2026-09-29 (follow-up Phase 1, migration 0031). Collected and stored only: nothing reads it to decide what airs or how money is split (the pool's watch-time share reads `minute_samples`, as before).

**Per session, kept only to work out each airing's numbers** (the rules registry's `watch_data.retention`, 30 days):

| Table | One row per | Columns | Deleted |
|---|---|---|---|
| `sessions` (from before) | a player's session on one station (a random id the player makes; a new one on each channel change) | id, station, platform, started and last beat, beats, last media time, bot flag and reason | by the daily job, once its last beat is older than the retention |
| `session_minutes` | a minute a session counted as tuned in (the heartbeat's rule: from its second beat, only while media time moves, never while flagged as a bot) | session, station, minute | by the daily job, older than the retention (and with its session) |
| `not_for_me_votes` | a session's "Not for me" on a log entry (one per session per airing) | session, station, log entry, when | as soon as its airing's numbers are final (an hour after it ended), else by the daily job |

No user id is stored with any of them: a signed-in viewer's heartbeat or vote is tied to the session, never the person (their own watch history, `accounts.watch_history`, is separate, kept while their setting is on, and never linked to a session).

**Kept after 30 days** (nothing else from watching is):

- `audience.airing_stats`, one row per airing of a program (a log entry's program rows in a station's as-run log, or one program row with no log entry): `id`, `airing_key` (`entry:<log entry>` or `as_run:<as-run row>`), `station_id`, `log_entry_id`, `as_run_id`, `program_id`, `maker_station_id`, `carried`, `band`, `external`, `started_at`, `ended_at`, `minutes`, `watch_seconds`, `audience_at_start`, `peak_audience`, `audience_at_end`, `stayed_to_end` (how many of those at the start were there at the end), `tune_aways` (one count per minute of the airing), `not_for_me`, `final`, `computed_at`, `created_at`. Every id in it is a station's, a program's, a log entry's or an as-run row's; none is a session's or a person's.
- `audience.minute_samples` (from before): tuned in per station per minute, by platform. Counts only.
- `audience.translator_samples` (from before): viewers per relay per minute. Counts only.

`apps/api/test/watch-data.test.ts` ("after 30 days, only the numbers") proves it: after the purge the session tables are empty of the evening, `airing_stats` is unchanged and has exactly the columns above, no column in the kept tables names a session, person, device or address, and no value in `airing_stats` is any session's or person's id. `apps/api/test/watch-data-evening.test.ts` does the same for the STOP evening.

**How the numbers are worked out** (`apps/api/src/v1/modules/audience/watch.ts`): every ten minutes, each airing that ended at least five minutes ago (by its as-run rows and its log entry's end) is worked out from `session_minutes`, leaving out every session ever flagged as a bot (even minutes it counted before it was caught). Minutes run from the airing's first minute to its last. Watch time is each viewer's minutes weighted by how much of each minute the program itself was on (a break inside it, or the next thing, isn't the program's). Audience at start, peak and end are viewers in its first, busiest and last minute; stayed to the end is those in both its first and last minute; a tune-away is a viewer there one minute and gone the next, counted in the minute they were gone. A vote counts from a session counted in at least 2 of the airing's minutes. An hour after it ends an airing is final and isn't worked out again.

**What shows** (the API): an airing's numbers only once it had `watch_data.minimum_audience` viewers (20) at once at some point; below that, "Not enough viewers yet" and no numbers (stored all the same). A station sees its own airings (master control's Audience page). A maker sees its programs added up across every station that aired them (Offering your programs), other stations' airings only in twos or more (`carriedAirings`) that reach the minimum between them, never one station's airing. External stations (Phase 6) are recorded with `external` true, labelled, and left out of the maker's totals and of anything that pays.

## The Phase 3 constraints, where they live, and the test that proves each

| Rule | Enforced by | Test (`packages/db/test/constraints.test.ts`) |
|---|---|---|
| Call sign is 3 to 5 capital letters, unique platform-wide | `call_sign_format` check, `stations_call_sign` unique index | call signs › are 3 to 5 capital letters; are unique |
| Call sign immutable after first sign-on | `stations_guard` trigger | call signs › are fixed after first sign-on |
| Channel number unique within market and band | `channels_number_in_market` partial unique index (unreleased channels) | channels › are unique within a market and band |
| Channel number immutable after first sign-on | `channels_guard` trigger (no update, no delete) | channels › are fixed after first sign-on |
| Channel number in its band's range | `channel_number_in_band` check (TV 2.1 to 69.9, radio 88.2 to 107.8 in even tenths, since migration 0022: real US FM stations are on odd tenths) | channels › TV is 2.1 to 69.9; radio… |
| Station colour holds 4.5:1 against white | `colour_contrast` check calling `public.contrast_on_white`, and `isValidStationColour` in `packages/domain` | stations › colour must hold 4.5:1 |
| A log entry can't reference an asset without a rights confirmation | the foreign key from `log_entries.asset_id` goes to `rights_confirmations`, not `assets` | program log › can't reference an asset without a rights confirmation |
| (added) The log never overlaps on a station | `log_entries_no_overlap` exclusion constraint | program log › never overlaps |
| (added) Another station's program airs only under a carriage agreement | `log_entries_guard` trigger | program log › airs another station's program only under… |
| A link import can never have a carriage offer | `offers_guard` and `assets_guard` triggers, both directions | link imports › (2 tests) |
| A claimable station's works each point at a permission or licence record, and only covered works can be imported; nothing is copied before a record exists | `assets_guard` (source must be `creator_work`, and the work must be covered) and `rights_confirmations_guard` (the record must cover that exact work) | claimable stations › only import works covered by a yes… |
| A licence only counts if it allows commercial use | `licence_records.allows_carriage` generated column (CC0, CC BY, CC BY-SA), used by the guards | claimable stations › a licence only counts if… |
| Escrow money only goes to the verified creator or the creator fund | `entry_checks` constraint trigger. Escrow is paid into only from that station's owed earnings, and escrow accounts exist only for claimable stations | escrow › (6 tests, including every other account kind and a one-cent split) |
| A channel held for the waitlist can't go to another station | `channels_guard` and `channel_holds_guard`, plus reservations checked against station call signs | channels › held for a waitlist reservation…; call signs › held for the waitlist… |
| A studio has no channel and never signs on | `channels_guard`, `studio_never_signs_on` check | stations › a studio has no channel… |
| Ledger rows are never updated or deleted | `append_only` triggers on entries, postings, holds, accounts, statements (and `broadcast.as_run`) | ledger › rows are never updated or deleted |
| (added) Every entry balances; an advertiser's balance and every hold stay ≥ 0 | `entry_checks` (deferred to commit) | ledger › entries must balance; can't spend more than is available |
| A spot can't be placed in a break unless money for that airing is held | `airings.hold_id` is required and unique; `airings_guard` (hold is for this spot and station); `hold_is_funded` (the hold's amount moved in the same transaction) | spots › can't be placed in a break unless… |
| A spot can't be listed until the available balance covers a day of its budget | `spots_guard` with `spots.one_day_of_budget`, mirrored by `oneDayOfBudgetMicros` in `packages/domain` | spots › can't be listed until… |

## Migration from the old model

`npm run db:migrate:legacy -- [--report docs/migration-report.md] [file.json …]` reads `public.opencast_state` (from `LEGACY_DATABASE_URL`, default `DATABASE_URL`) and any JSON files, and writes into the new tables.

- It never writes to the old table or files.
- It's safe to rerun: the second run writes nothing, and a run at cutover picks up newer rows.
- The last run is in `docs/migration-report.md`.

| Old | New | Notes |
|---|---|---|
| channels | stations (in setup), break_rules, station_memberships (owner) | No call sign, market, band or channel exists in the old data, so every station signs on again. Colours under 4.5:1 are left unset |
| owner wallets | users + identities (`wallet`) | Matched to a Privy user when they sign in and link that wallet |
| assets | assets + asset_files | Code from the old category: program→PGM, ad→SPT, sponsor→UND, bumper→BMP. `external`→`link` |
| creator-library items | through their station copies | A library item never imported into a station has nowhere to go and is reported |
| assetFolders, streamSchedules, destinations, livepeerConfigs, externalIngestJobs | asset_folders, schedules, translators, livepeer_config, import_jobs | One to one |
| playlistItems | not migrated | No air times and no rights confirmations. The report lists each station's old order |
| playoutStates | playout_state, off air | |
| commands | dropped | They only mean something to the old worker |
