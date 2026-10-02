# Opencast: follow-up prompt (catch-up, watch data, pay-as-you-go, multistreaming, uploads)

You're working in `github.com/KyngKai909/opencast`, the Opencast monorepo, after the platform prompt (`prompts/1-platform.md`) and the apps prompt (`prompts/2-apps.md`) have been run. Both prompts were updated while they ran, so some decisions may not be in the code yet. This prompt first checks the repo against the latest versions, then adds six things: watch data, pay-as-you-go billing, built-in multistreaming, direct uploads, the channel-change effect, and external stations.

## Ground rules

- Work on a branch called `follow-up`, from the current main line of work. Never force-push. Commit at the end of every phase.
- **Stop at every point marked STOP.** Say what you did and what you found, then wait.
- Anything marked **Open** isn't decided. Build it as configuration with a safe default, and add it to `docs/open-decisions.md`.
- The reference designs in `docs/reference/` still apply. Where you add a screen they don't show, follow the nearest reference screen's layout and the style guide's voice, and list the new copy in `docs/apps/new-copy.md` for review.

## Phase 0: Catch up with the latest prompts

Read the current `prompts/1-platform.md` and `prompts/2-apps.md` in full, then check the repo against them. For each item below, report **done**, **partly done** (say what's missing) or **not started**:

1. **Four apps:** `apps/web` (viewer at `/`, master control at `/control`, Network desk at `/desk`), `apps/business`, `apps/tv`, `apps/site`, with one session across the areas of `apps/web`.
2. **Prepare once, then assemble:** prerecorded items transcoded once into aligned HLS segments by content ID; channels as rolling playlists; Livepeer only for live blocks; the player drawing the bug, lower thirds and codes from `#EXT-X-DATERANGE`; the readiness check instead of a download cache.
3. **Off air hours and day templates:** scheduled sign-off that isn't dead air, and days that repeat (every day, weekdays, a given weekday, once).
4. **Storage:** R2 by content ID (CIDv1 format), originals in Infrequent Access, IPFS only for the catalog and "Export to IPFS", the migration off Pinata.
5. **Sign-in:** Opencast's own Privy app from configuration, and "Connect Clear" through Privy's cross-app linking with Clear as the global-wallet provider, handling read-only and full access.
6. **Money:** prepaid holds, the escrow contract for claimable stations, Opencast's share taken from the station's side.
7. **Business roles:** owner, manager, viewer; "where your customers are" (a location, a service area, or online); code redemptions from Clear Pay, a connected online checkout, or marked as used.
8. **Partner ads, prepared for later:** break markers, IAB categories, ratings, the child-directed flag, and the "Ads from partners" switch stored as a flag.
9. **Master control rail:** On air, Market, Programming, Money (Spot market, Sponsors, Earnings), Station (Translators, Rights, Settings).
10. **Network desk, Catalog:** built from `docs/reference/desk/opencast-desk-catalog.html` (added after the apps prompt ran): the shelf, series with their items and per-item rights records, the two-person rights check with evidence, rebuilding episodes when an item fails, and the public-domain rules kept in configuration.
11. **Network desk, the remaining pages:** built from `docs/reference/desk/opencast-desk-pages.html` (also added after the apps prompt ran): Rights claims across all stations with each claim's timeline and carriers; Reserved call signs with end dates, duplicate names and refused names; Catalog sponsors sold by series and market with Clear filling the gaps; and Settings, where every Open rule (prices, shares, rights dates, repeat limit, platform limits, numbering, escrow signers) is set with an effective date and a change log.
12. **Reference files that changed after the apps prompt ran.** Copy the whole `docs/reference/` folder from the latest handoff over the repo's copy first, then check each change below against the code:
    - `control/opencast-master-control.html`: the program log's "Off air hours" setting and the "Weekdays" repeat option (step A3), and the redrawn Translators step (A4): connected platforms, "Live shows only / Everything BEAT airs", one break setting for all relays, the station bug toggle, relay hours this month.
    - `control/opencast-live-listings.html`: the library item's storage lines (stored once, content ID, ready for tonight) and the "Export to IPFS" button.
    - `control/opencast-station-settings.html`: "Ads from partners" as step 3 of the break order and its own section in Breaks settings.
    - `control/opencast-earnings.html`: the "Ads from partners" line under "From your breaks".
    - `business/opencast-biz-settings.html`, `business/opencast-biz-funding.html`, `business/opencast-biz-results.html`, `business/opencast-biz-spots.html`: owner, manager and viewer roles (no counter staff), invites by email, "where your customers are" (a location, a service area, or online), code uses counted from Clear Pay, an online checkout or marked as used, and online businesses targeting markets.
    - `desk/opencast-desk-catalog.html` and `desk/opencast-desk-pages.html`: new files, items 10 and 11 above.
    - `brand/opencast-style.html`: two new states in "When there's no picture": Changing channel and Tuning the radio band.
    - `viewer/opencast-you.html` and `tv/opencast-tv-update.html`: a "Tuning sound" setting (Watching settings, TV settings).
    - `viewer/opencast-tuning.html`: new file, built in Phase 5.
    - `desk/opencast-network-desk.html`: the External sources page (renamed from Listed sources), reworked for external stations (built in Phase 6); the viewer tag reads "External".

**STOP.** Give the report, and propose the order to close the gaps. Close them before starting Phase 1, unless told otherwise.

## Phase 1: Watch data (collect now, use later)

Record the data that tells stations and makers what's working. **Only collect and store it in this phase.** Don't build any feature that changes what airs or how money is split; those are **Open**.

**What to record, per airing of each program** (a program as it appears in a station's as-run log):
- **Watch time:** total minutes watched, from the tuned-in heartbeats, attributed to the program that was airing.
- **Audience at start, peak and end,** and "stayed to the end": the share of people tuned in at the start who were still there at the end.
- **Tune-aways:** how many viewers changed channel or stopped watching during the program, in one-minute buckets, so a maker can see where people left.
- **"Not for me" votes:** one per viewer per airing, from signed-in and signed-out viewers alike (tie signed-out votes to the session).

**Rules:**
- **Viewers are never identified in the stored data.** Keep per-session events only as long as needed to compute the per-airing numbers (30 days), then keep only the aggregates.
- **Bot filtering first.** Votes and watch time go through the same filtering as tuned-in counts. A vote counts only if the session watched at least 2 minutes of that program.
- **Minimum audience.** Don't show a program's numbers anywhere until an airing had at least 20 viewers at some point. Store them regardless.
- Radio works the same way, with listening time.

**Where it shows, in this phase:**
- **Master control, Audience:** each program row adds watch time and a small minute-by-minute tune-away line. The station sees its own airings only.
- **Offering your programs:** the maker sees each of its programs' numbers across every station that carried it, aggregated. It never sees another station's audience per airing, only totals across stations.
- **The "Not for me" control in the viewer's player** is built behind a feature flag, **off by default**. The API accepts votes either way, so the flag can be turned on without a deploy.

**Open, don't build:** syndication market stats for stations deciding what to carry; a "share by watch time" carriage deal type (a station's break revenue split among makers by watch time, possibly adjusted for time slot); station-level skippable blocks (for example a jukebox hour, never spots, credits, IDs, or carried programs unless the maker allows it).

**STOP.** Show a station's evening with the new numbers on the Audience page, a maker's view across carriers, and the stored aggregates. Confirm that no viewer can be identified from what's kept after 30 days.

## Phase 2: Pay-as-you-go for stations

**Stripe, for now.** Opencast is a ClearLabs Inc project and uses ClearLabs Inc's existing Stripe account, kept apart from Clear's use of it:
- **A restricted API key for Opencast only** (`STRIPE_SECRET_KEY` holds an `rk_` key, never the account's main secret key), with only the permissions Opencast needs: customers, payment methods, setup intents, payment intents, checkout sessions, refunds, and reading its own events. List the exact permissions in `docs/stripe.md`.
- **Its own webhook endpoint and signing secret** (`STRIPE_WEBHOOK_SECRET`), separate from Clear's.
- **`app: opencast` in the metadata** of every Stripe object Opencast creates, and ignore any webhook event without it.
- **"OPENCAST" on card statements:** set `statement_descriptor_suffix` to `OPENCAST` (from `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX`) on every card charge, so pledges, top-ups and usage charges show Opencast next to the account's name.
- Read everything from configuration, so moving Opencast to its own Stripe account inside ClearLabs Inc's organization later is only a change of variables. Note in `docs/stripe.md` that the Stripe-only Connect fallback would show ClearLabs Inc's branding to stations until then.

One channel per station, and **being on air on Opencast is free**. A station pays only for what costs Opencast the most:

| Usage | Unit | Price |
|---|---|---|
| Storage (originals and prepared segments together) | per GB a month, measured daily and averaged | **Open**, set in config |
| Relays in "Everything I air" mode (see Phase 3) | per hour relayed, **per station** however many platforms | **Open**, set in config |
| Live hours (Livepeer ingest and transcoding) | per hour live | **Open**, set in config |
| Relays in "Live shows only" mode | | Free |

- **Prices live in a pricing table with effective dates,** like Opencast's share. Build a starting price sheet in `docs/pricing.md` at cost plus a margin, using the real per-unit costs you measured in the platform prompt's playout stop, and mark every number for review.
- **A free allowance each month** (**Open**, default: 10 GB of storage and 5 live hours), so a new station can start without paying.
- **Billing:** usage accrues through the month as ledger entries. At month end it's taken from the station's earnings first. Anything earnings don't cover is charged to the station's funding source: its linked Clear wallet if it has full access, otherwise a card on file through Stripe. A station with nothing to charge keeps airing for a 14-day grace period, then its relays and live hours pause (never its channel), and the owner is told at each step.
- **No surprises:** master control shows usage so far this month and an estimate for the month in Station settings under "Station account", and a station can set a monthly cap per usage type. Reaching a cap pauses that usage (for example relays), never the channel.
- **Statements:** usage appears as its own section on the weekly and monthly statements in Earnings, with units and prices, deducted before the payout.
- **Number and call sign licenses** (yearly renewals) are **Open**; leave room for them as another usage type in the same pricing table.

Build the screens in `apps/web` under master control, following the settings and earnings reference files: a "Station account" pane with usage, estimate, caps, the funding source and the free allowance; and a usage section on statements.

**STOP.** Show a month for three stations: one inside the free allowance, one paid from earnings, and one that runs out of funding and enters the grace period.

## Phase 3: Built-in multistreaming (translators)

Opencast is the station's home. Translators simulcast the station to the platforms it connects, as one continuous stream, cheaply. Step A4 of `control/opencast-master-control.html` shows the Translators page as it should be built.

**Connecting platforms** (the Translators page in master control):
- **YouTube:** connect with Google sign-in. Opencast creates the live broadcasts through the YouTube Live API and gets the stream key.
- **Twitch:** connect with Twitch sign-in to get the stream key.
- **Anything else** (Facebook, Kick, any custom destination): add manually with an RTMP or RTMPS address and stream key.
- Stream keys are encrypted at rest, never logged, and removable in one click.

**Automatic restarts for platform limits.** Each platform caps how long one broadcast can run. Keep a table of limits in configuration (they change), starting with:
- **Twitch:** 48 hours per stream. Restart before the limit. Required.
- **YouTube:** no length limit, but only broadcasts under 12 hours are saved as videos on the channel. Offer "Save relays as YouTube videos" (off by default): when on, roll to a new broadcast about every 11 hours.
- **Facebook:** 8 hours. Automatic only if Facebook is connected by sign-in; with a pasted key, tell the station when a restart is due.
- **Kick and others:** no known limit; add limits to the table as they're found.

Rules for every restart:
- **Time it to a break.** Restart during the station ID in the last break before the limit, so the few seconds of reconnection never land inside a program. If a live block runs past the ideal window, restart at the first break after it ends, still inside the limit.
- **Restart only that platform.** Livepeer's multistream targets are per platform, so toggle only the target that needs it; the other platforms keep streaming untouched.
- **For connected accounts,** create the next broadcast through the platform's API before ending the current one, carrying over the title and description, so viewers land on the new one.
- **Log every restart** and show the next scheduled one on the Translators page ("Twitch restarts Saturday at 11:59 pm, during a break").

**Two relay modes, set per station:**
- **Live shows only (the default, free).** Only live blocks are relayed. The station's live Livepeer stream sends to its connected platforms directly with Livepeer's multistream; no relay service is involved.
- **Everything I air (pay-as-you-go).** The whole schedule, prerecorded and live, as one continuous stream, billed per relayed hour per station under Phase 2, however many platforms are connected.

**One sender per station, split by Livepeer:**
- Build the relay as its own service, `apps/relay`, deployed as a separate Railway service at first. It must run unchanged as a Docker container on a plain Linux server, so it can move to a host with cheap bandwidth (such as a Hetzner US server) by redeploying, with nothing but configuration changing. Write the move up in `docs/relay.md`.
- For each station in "Everything I air" mode, the relay reads the station's own channel playlist, pulls live blocks from Livepeer's playback while they air, composites the station bug (on by default; a station can turn it off, in which case the relay stream-copies with no re-encode), and pushes **one** RTMP stream to a per-station Livepeer relay stream.
- That Livepeer relay stream is created with `profiles: []` (no transcoding) and multistream targets set to `source`, so Livepeer sends the same stream to every connected platform. Confirm with Livepeer's billing that a stream with no transcoding profiles isn't charged for transcoding. If it is, fall back to the relay pushing to each platform itself, and report the cost difference at the STOP.
- Because one sender carries both prerecorded and live hours, platforms see one continuous stream with no interruption when a live block starts or ends.

**Breaks on relays:**
- One setting for all of a station's relays: **"During breaks, relays show: Your spots / Station ID slate."**
- Time filled by partner ads (the programmatic backfill, which is per viewer inside Opencast's player) shows the station ID slate on relays.
- When spots air on relays, mark the stream as containing paid promotion automatically on connected YouTube (and Twitch's equivalent, if its API allows), and remind the station to do it on manually added destinations.

**Counting and billing relay viewers:**
- For connected YouTube and Twitch accounts, read the platform's reported concurrent viewers every minute through its API and attribute them to whatever was airing, spots included. Manually added destinations have no counts, so their viewers are never billed.
- **Businesses that sell online** ("where your customers are: online") are billed on Opencast viewers plus relay viewers, at the spot's rate.
- **Local businesses** (a location or a service area) are billed only for viewers Opencast can place inside the spot's target area. There's no setting for this; it follows from the data:
  - **Opencast viewers** are placed by their chosen market, or a coarse IP-based location for signed-out viewers, and billed when they fall inside the target area.
  - **Relay viewers** are billed only when the platform reports where they are. YouTube's analytics gives viewer geography per broadcast, aggregated and a day or two late: use the share of the broadcast's viewers inside the target area and apply it to the relay viewers during the spot. Twitch doesn't report viewer location, so Twitch viewers are never billed to local businesses. Where YouTube returns no location data (for example below its privacy thresholds), those viewers aren't billed.
  - **Settling:** the hold for a spot on a relayed station covers the Opencast viewers plus an estimate for the relay share. Settle the Opencast part when the spot airs and the relay part when the platform's location data arrives. If none arrives within 7 days, the relay part isn't charged and returns to the business's balance. Show "Relay viewers, waiting for YouTube's location data" on the business's results until it settles.
- Relay viewers appear as their own line, "Relay viewers, as reported by YouTube" (or Twitch), on the business's results and statements and on the station's earnings. Flat per-airing spots are unaffected.

**Everything else:**
- The Translators page shows: connected platforms and "Add a platform", the relay mode, the break setting, "Station bug on relays", and relay hours and cost so far this month.
- Report relay hours, bandwidth and errors per station in the relay service's health endpoint, and alert the station and Network desk if a relay stops. Opencast's own channel is never affected by a relay failure.

**STOP.** Show a station relaying "Everything I air" to YouTube and Twitch from one upload; a live block starting and ending with no interruption on YouTube; a Twitch restart timed to a break while YouTube keeps streaming; one break with spots and one with the station ID slate; and one month's billing for the same spot bought by an online business and by a local business, including a relay share settled from YouTube's location data and one that returned because no data arrived.

## Phase 4: Direct uploads

Uploads go straight from the browser to R2, never through the API server:
- The API issues **presigned multipart upload URLs** after checking the person's role, so large video files upload in parts and resume after a dropped connection.
- **Uppy** is the upload widget in `apps/web` (library, spots) and `apps/business` (spots, production order files), with drag and drop, progress and resume.
- When an upload completes, the API computes its content ID, deduplicates against existing objects, and starts preparation.
- Don't add a third-party upload service.

**STOP.** Show a 4 GB upload interrupted and resumed, and a duplicate upload stored once.

## Phase 5: Changing channel

Build the channel-change effect in `packages/player` from `docs/reference/viewer/opencast-tuning.html`, which includes a working demo of every timing below. It's used by the viewer app, TV mode, and the Cast receiver alike.

- **On the press:** the new channel's number and call sign appear at once, top right inside title safe, and soft static covers the old picture.
- **Static runs at least 300 ms,** even when the next channel is preloaded, and for as long as the first frame takes. After 800 ms without a frame, the program's name and "Tuning in" appear over it. After 8 seconds, it becomes the Stand by screen with the colour bars.
- **When the first frame arrives,** the static clears in one 160 ms roll and the banner slides in.
- **Repeated presses** update the number each time and only load the channel the viewer lands on.
- **The static:** 2 px grey grain redrawn 24 times a second, within 15% of the ground's brightness, with a constant average brightness. **Hard limit, tested:** no full-screen brightness change larger than 10% more than 3 times a second (WCAG 2.3.1).
- **Reduced motion:** no grain; a 200 ms crossfade with the same corner number.
- **Radio band:** the needle sweeps the real distance between frequencies in 400 ms, eased, with a 250 ms soft hiss. The hiss is on by default for the radio band and off by default for video, set by "Tuning sound" in Watching settings and TV settings. Sound only plays after the viewer has interacted, as browsers require.
- **Never used for** Stand by, off air, first launch or pausing.
- Put every timing in one constants file in `packages/player`.

**STOP.** Show a channel change on web, phone and TV sizes, a slow change reaching "Tuning in", one reaching Stand by, reduced motion, and a radio band sweep with sound, plus the photosensitivity test passing.

## Phase 6: External stations

An external station has a channel number, a call sign, a banner and a place on the dial, but its video comes straight from the source's own stream: no playout, no prepared segments, no spots, sponsor credits or partner ads, no earnings, and it can't be carried or offered in the syndication market. Build it from the External sources page in `docs/reference/desk/opencast-network-desk.html`.

- **Two ways to play,** recorded on each listing with its evidence:
  - **Official embed:** the source's own embeddable player, only where its terms allow embedding. Record the terms page and the date checked.
  - **Stream link:** the raw HLS or DASH address, played in Opencast's player. Allowed only with the source's written permission (stored like a claimable station's permission record) or for a clearly public source (a government body, public access, a public agency), with the basis recorded. Never proxy, cache or re-serve the stream; the viewer's player fetches it from the source directly.
- **What's on:** from the source's own calendar or schedule feed where one exists (iCal, RSS, JSON or XMLTV), or from guide data checked against the source's published schedule. With neither, the banner shows the station name, an "External" tag, "Live" and the source, and no progress bar. Never invent program titles.
- **Health checks:** fetch each listing's stream manifest (or embed availability) every minute. After 5 minutes down, remove the station from the dial, the guide and the swipe order; viewers already watching get the Stand by screen. Restore it automatically when the stream is back, and notify Network desk both times. Show state and history on the External sources page.
- **The "External" tag** appears in the banner, the guide and the station page. External stations follow the same channel numbering and call sign rules as full stations.
- **IPTV lists are leads, not listings:** channels found on public IPTV lists (for example iptv-org) can be imported into the creator pipeline as leads with their stream address noted, but never added to the dial until they give permission or are confirmed public. From there, they can become an external station or a full one.
- **Watch data:** record tuned-in time from Opencast's player for external stations too, labelled as external and kept out of anything that pays out.

**STOP.** Show an official embed and a stream link on the dial with their schedules, one listing going down and disappearing from the swipe order and coming back, and an IPTV-list channel imported as a pipeline lead.

## Deliverables

- `docs/catch-up-report.md` from Phase 0
- `docs/pricing.md` with the starting price sheet, every number marked for review
- `docs/relay.md`
- `docs/stripe.md`
- Updates to `docs/open-decisions.md` and `docs/apps/new-copy.md`
