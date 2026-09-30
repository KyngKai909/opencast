# Opencast: platform prompt (repo, backend, Railway)

You're working in `github.com/KyngKai909/untitled-project`, the Opencast repo (package scope `@openchannel`, product name Opencast, a working name). Your job is to turn it into a monorepo, replace the JSON-blob state with a real schema, split the API into modules, extend the playout worker for the product that's now designed, and deploy the services to Railway.

A second prompt builds the apps (`apps/web`, `apps/business`, `apps/tv`, `apps/site`) at the same time. You and that prompt meet at `packages/contracts`. You own the backend and the contracts; the apps prompt owns everything under `apps/*` except `api` and `worker`, and `packages/ui` and `packages/player`. If you need to change a contract after the apps prompt has started using it, add a version or a new field rather than changing the shape of an existing one, and note it in `docs/contracts-changelog.md`.

## Ground rules

- Work on a branch called `monorepo`. Never force-push and never rewrite `main`.
- Commit at the end of every phase with a message that names the phase.
- **Stop at every point marked STOP.** Write what you did and what you found, then wait for a reply before continuing.
- Don't delete data, don't drop the `opencast_state` table, and don't touch the production Railway services until Phase 7 says so.
- If something in this prompt conflicts with what you find in the code, say so at the next STOP instead of guessing.
- Anything marked **Open** is a decision that isn't made yet. Build it as configuration with a safe default of zero or off, and list it in `docs/open-decisions.md`.

## What the product is now

Opencast is a dial of 24/7 local stations. Viewers tune in on the web, a phone, a TV app or by casting, and change channel like cable. Stations are run from master control: a library, a program log timed to the second, break rules, carried programs from other stations, spots chosen from a spot market, and translators that relay to YouTube and Twitch.

The words matter because they become table names, routes and UI copy:

| Word | Meaning |
|---|---|
| Station | Who broadcasts. Has a call sign (3 to 5 capital letters, unique platform-wide), a market, a band and a channel number. |
| Channel | A station's place on the dial: TV band `2.1` to `69.9`, radio band `88.2` to `107.8` in even tenths (changed 2026-09-29: even tenths, so no number matches a real US FM station). Unique per market. Subchannels (`12.2`) are for 24/7 carriage. |
| Market | A local area, such as Inland Empire. Decides dial order. |
| Program log | What airs, in order, with exact start times. Replaces the playlist queue. |
| Log codes | `PGM` program, `SPT` spot, `UND` underwriting, `BMP` bumper, `SID` station ID. These map to today's `AssetInsertionCategory` plus station ID. |
| Break | A slot in the log filled from a rotation. Created by the station's break rule. |
| Avails | Open time in breaks. |
| Carriage | One station airing another station's program. Terms are Barter, Cash, or Cash plus barter. |
| Spot market | Where businesses list spots with a rate; stations choose which air. |
| Translator | A relay to another service (YouTube, Twitch, any RTMP), today's `MultistreamDestination`. |
| Sign on, sign off | Start and stop broadcasting. |
| Tuned in | Concurrent viewers of a station. Stations see it; viewers never do. |
| As-run log | What actually aired, to the second. The source of truth for billing. |

The reference designs are in `docs/reference/`, one folder per app: `brand/`, `viewer/`, `tv/`, `control/`, `business/` and `desk/`. They're self-contained HTML files; open them in a browser. Before Phase 3, read at least `control/opencast-master-control.html`, `control/opencast-earnings.html`, `business/opencast-biz-funding.html`, `business/opencast-biz-results.html` and `desk/opencast-network-desk.html`: they show what the schema and the money rules have to support. Where a reference file and this prompt disagree about behaviour, this prompt wins for the backend; say so at the next STOP so the design can be corrected.

## Phase 1: Explore

Read the whole repo: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, the scripts, `railway.json`, `nixpacks.toml`, `.env.example` and `docs/technical-implementation-guide.md`.

Write `docs/audit.md` covering:
- every API route with its method, input and what it touches
- the data model as it's stored in `opencast_state` and in the `storage/db*.json` files
- how the worker picks the next asset, inserts ads, writes HLS and forwards to Livepeer
- every environment variable and which service reads it
- how the three Railway services are configured today
- dead code, duplicated logic and anything that would break during a move
- the `yt-dlp` import path and what rights checks exist (the reference design keeps link imports but makes them station-local and never offered for carriage)
- how files are stored today: what's pinned to IPFS through Pinata, what's on local disk, how the worker reads files at air time, and how many gigabytes are pinned

**STOP.** Summarise the audit and list anything that surprised you.

## Phase 2: Restructure into the monorepo

Target layout:

```
apps/
  web/        the Opencast app, one account and one sign-in for everyone: the viewer at /,
              master control at /control, Network desk at /desk (admins only). Starts as
              today's apps/web, whose current pages become the /control area, behaviour unchanged
  api/        today's apps/api
  worker/     today's apps/worker
  business/   empty scaffold, owned by the apps prompt (Opencast for business, the advertiser side)
  tv/         empty scaffold, owned by the apps prompt (a TV build of the same app, and the Cast receiver)
  site/       empty scaffold, owned by the apps prompt (the marketing page)
packages/
  domain/     today's packages/shared (types and pure rules)
  contracts/  new: request and response schemas shared by apps and API
  ui/         empty, owned by the apps prompt
  player/     empty, owned by the apps prompt
docs/
  reference/  the HTML design references
```

- Rename the package scope to `@opencast/*`. Keep a note of the old `@openchannel/*` names, because the Railway services are still named after them.
- Keep npm workspaces. Add Turborepo for `build`, `dev`, `typecheck` and `lint` only if it removes real duplication in the root scripts; say which you chose and why.
- Every app and package gets its own `tsconfig` extending `tsconfig.base.json`, and `npm run typecheck` passes at the root.
- Today's master control pages in `apps/web` must keep working exactly as before, now under `/control`: upload, playlist, schedules, Livepeer provisioning, go live and station preview.
- Update `railway.json`, `nixpacks.toml` and the `build:service:*` and `start:service:*` scripts for the new paths, but don't deploy.

**STOP.** Show the tree and confirm the old flow still works locally.

## Phase 3: Schema

Replace the single `opencast_state` JSON blob with a normalised Postgres schema. Use Drizzle ORM with SQL migrations checked in; if you have a strong reason to prefer Kysely plus `node-pg-migrate`, say so at the STOP. Use one database with these schemas:

- `accounts`: users, sign-in identities, station memberships and roles (owner, operator), advertiser memberships, viewer presets (keys 1 to 6 and beyond), reminders, markets
- `broadcast`: stations, channels, assets and folders, rights confirmations, program log entries, day templates and their repeat rules (every day, weekdays, a given weekday, once), scheduled off air hours, break rules, schedules, playout state, commands, translators, Livepeer config, live sources, as-run log
- `catalog`: carriage offers (per program: terms offered, rates, airings per episode, window, notice period), carriage agreements, approvals
- `spots`: advertisers, spots, sponsorships (underwriting of a whole station or one program: flat monthly, approved by the station, with credit text), rate cards, targeting (distance, categories), budgets (total and optional daily cap), spot status (draft, listed, paused, ended), rotations and backup rotations, airings, on-screen codes and redemptions, production orders (a station or the house studio making a spot for a business)
- `ledger`: accounts (including each advertiser's funded balance and a holds account), an append-only double-entry journal, holds against scheduled airings, payouts, statements
- `trust`: rights claims, answers and their deadlines, takedowns and where each was pulled, each station's standing
- `network`: markets and their dial (every channel's state: station, claimable, listed, catalog, held, open), reserved call signs from the waitlist, creators in the pipeline and their stage, permission records (exactly which works, when, from which link, a copy sent), licence records (for works published under a licence that allows commercial use, such as CC BY: the licence, its link, the attribution it requires, and when it was last checked), station recipes (template schedules by category), listed sources (city and county streams, embed terms, agenda-calendar sync), claimable-station handovers, and each claimable station's escrowed earnings
- `audience`: tuned-in samples per station per minute

Constraints that matter:
- a call sign is unique platform-wide and immutable after first sign-on
- a channel number is unique within a market and band, and immutable after first sign-on
- a station colour must hold 4.5:1 contrast against white; validate it in `packages/domain`
- a log entry can't reference an asset without a rights confirmation
- an asset imported from a link can never have a carriage offer
- a claimable station's imported works must each point at a permission record or a licence record, and only works covered by it can be imported. Nothing is copied from a creator's source before one of those records exists; a station can be prepared from titles and lengths alone
- a licence record only counts if the licence allows commercial use (CC BY and CC BY-SA do; any non-commercial or no-derivatives variant doesn't), and its attribution is added to the program's listing and credit
- money held for a claimable station can only go to the verified creator, or to the creator fund after the unclaimed period, enforced by the escrow contract. There is no code path that sends it to Opencast or to another station
- a channel held for a waitlist reservation can't be given to any other station
- a station can also be a studio: a station with no channel that never signs on
- ledger rows are never updated or deleted, only reversed
- a spot can't be placed in a break unless money for that airing is held (see Phase 6)
- a spot can't be listed until its advertiser's available balance covers at least one day of its budget

Write a one-time migration script that reads the existing `opencast_state` blob and the JSON files and writes them into the new tables. Keep the old table untouched as a backup. Local development uses Docker Compose Postgres instead of the JSON fallback; remove the JSON fallback once the migration is verified.

**Storage.** IPFS through Pinata stops being the working store. It costs more per gigabyte than object storage, it charges for reads the worker makes every day, its files are public by default, and a takedown can't guarantee removal. Replace it with this:
- **Object storage** on Cloudflare R2 (S3-compatible, no charge for reads), behind a `storage` interface so another S3-compatible provider can be swapped in. Every object is keyed by its content ID, computed in the IPFS CID format (CIDv1, raw, sha-256), so identical files are stored once however many stations air them, and any file can move to IPFS later without renaming.
- **Classes:** the prepared HLS segments every channel airs from (all renditions, see Phase 5) in Standard; the original upload in Infrequent Access. Previews in the syndication market, the business review screen and the spot review queue play the prepared segments directly, so no separate preview renditions are needed.
- **Assets** point at content IDs, never at files. Deleting an asset removes the object only when no other asset, carriage agreement or claim still references that content ID.
- **Takedowns** remove the content ID from every station's log, from the worker cache, and from storage once the claim resolves against it; until then the object is locked, not deleted, so it can come back.
- **IPFS stays for two things only:** the Opencast catalog (public domain, published and pinned on purpose), and "Export to IPFS", a per-item action a station owner takes on its own original, with a warning that IPFS files are public and can't be taken back. Keep Pinata for those, behind the same `storage` interface.
- **Migration:** copy everything currently pinned into R2 under its content ID, verify each copy by hash, and unpin everything except catalog items. Report the gigabytes moved and the monthly cost before and after at the STOP.


**STOP.** Show the schema, the migration result against a copy of production data, any rows that didn't map cleanly, and the storage migration: gigabytes moved to R2, what stayed on IPFS, and the monthly storage cost before and after.

## Phase 4: API modules and contracts

Split `apps/api` into modules: `accounts`, `stations`, `library`, `log`, `playout`, `catalog`, `spots`, `ledger`, `audience`, `trust`, `notifications`, `waitlist`. `notifications` sends push, email and in-app notices (reminders, dead-air warnings, paused spots, low balance) from events the other modules emit. Each has its routes, service and data access, and none reaches into another's tables directly.

Put every request and response shape in `packages/contracts` as Zod schemas with inferred types. The apps prompt will build against these with mock data, so publish them early: after the first module is done, commit and push the contracts so the apps prompt can start.

Sign-in: Privy for everyone, with email first and Apple, Google and wallets as alternatives. **Opencast has its own Privy app, separate from Clear's.** Its app ID and secret come from configuration (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`), never hard-coded, so anyone self-hosting Opencast uses their own Privy app. Don't reuse Clear's app ID anywhere. Embedded wallets are created only for people who sign in. A station's team reaches the station's money through their roles, not a shared wallet or login. The API verifies Privy tokens issued to Opencast's app.

**Clear connects as a Privy global wallet.** Clear's Privy app is the provider and Opencast's is the requester. "Connect Clear" in the business app and in station settings calls Privy's cross-app linking (`linkCrossAppAccount` with Clear's provider app ID from configuration, `CLEAR_PRIVY_PROVIDER_APP_ID`): the user approves on a page hosted by Clear, and their Clear wallet is attached to their Opencast account as a linked account. Build for both of Clear's possible settings: read-only (Opencast can verify the address and use it as a payout destination, but funding happens inside Clear) and full access (Opencast can request a signed transfer from the Clear wallet to fund a balance, which the user confirms). Nothing about a Clear account is visible to Opencast until the user links it. Put the cross-app details in `docs/clear-integration.md`, and note that Clear must request global-wallet provider access in its own Privy dashboard. Roles: viewer, station owner, station operator, station host (go live on assigned blocks only), business owner, business manager (spots, sponsorships, orders, results, redeeming codes, adding money and approving orders; never withdrawing or changing funding; an agency can be a manager), business viewer (results, airings and statements only, for a bookkeeper or partner), and Opencast admin (Network desk). Team members sign in with their own accounts from anywhere. A business says where its customers are: a location (a private street address, used for distance), a service area (a city and radius), or online (chosen markets, no distance). It can have more than one location. Stations see only the city, or "Online". Businesses can't turn off the warning that their spots are about to pause. Signing in is optional for viewers; watching needs no account.

Endpoints the designs need, at minimum:
- the dial for a market, in channel order, with now and next per station
- the guide for a market and time window
- station detail, program detail, search by call sign, channel number and title
- presets, reminders (with "switch me over" flag) and waitlist signups (viewer, station with a held call sign, or business)
- master control: station setup, library with type and rights, program log by day and week, break rules, dead-air status, translators with per-destination break handling, sign-on pre-flight checks, sign on and sign off
- catalog: browse offers, choose terms, place in the log, end carriage
- spots: station side (browse, add to rotation, backup rotation, avails by break, paused-spot notices, and each listed spot's runway: roughly how many days its available balance lasts at the current pace, or that it tops up automatically, never the balance itself) and advertiser side (fund the balance, list a spot, set a rate and budget, pause and resume, see airings, holds and redemptions, withdraw unheld money)
- production orders: a business sends a brief (length, what it's about, what it must say, files, needed-by date) to a station that takes orders or to Opencast Studio; the maker quotes a price, a delivery date, the rounds of changes included and who voices it, or passes; accepting holds the price from the business's balance; the maker delivers; the business approves, or asks for changes with notes pinned to timecodes. Notes the maker marks as its own mistake don't use up a round. Approval releases the money and turns the order into a spot in the business's Spots, already through the upload checks; no answer for 7 days after delivery approves it automatically. If the delivery date passes and the business cancels, the hold returns in full. After the included rounds, either side can ask Opencast to review; a disputed order stays held until then. The maker is told when the spot is listed so it can add it first. By default the business owns the finished spot and the maker may show it in its samples (**Open**: final terms, and whether Opencast's share applies to production)
- spot lifecycle: draft, in review (category and content checked before any station can see it), listed, in rotation, paused (daily cap reached, resumes by itself at midnight; or budget spent, needs the business), ended. Uploads are checked on arrival: exact length (:15, :30, :60), picture size, action and title safe (report where on the frame text falls outside, and offer a scale-to-fit that shrinks the whole spot inside title safe), captions generated from speech, and loudness levelled to broadcast level. Each spot gets its own on-screen code and QR, rendered by the worker inside the safe area for the last :10, with scans and redemptions counted per spot and per airing
- targeting (distance from a business location or service area, or whole markets for online businesses; station categories; dayparts; excluded stations) decides which stations see a spot in their market; it never places a spot. The API returns the matched stations by name, with the reason any nearby station is left out, and an estimated cost per airing from those stations' tuned-in numbers
- when a paused spot resumes, stations that had it are told and can add it back; it never returns to a rotation by itself. Budget pauses notify the business and stations; daily-cap pauses notify no one
- results for businesses: every airing from the as-run log (never the planned log) with the program it aired in, how much of the spot aired, tuned in averaged over the spot, and the cost with its working. The worker captures one frame during each spot's airing, with the station's bug, as proof; keep it for a year. Totals are labelled as people tuned in added up across airings, never reach or unique viewers
- codes: count QR scans, offers saved to a phone, and uses at the counter. A use counts as a customer only within the offer's window after an airing (default 7 days). Uses come from Clear Pay when customers pay in person, from a connected online checkout (Shopify, Stripe or Square promotion codes, counted by webhook), or from an owner or manager marking a code used in the business app, which checks validity and prior use first. Stations see only the count of customers from airings on their own station
- sponsorships: a business offers to underwrite a whole station or one program for a flat monthly amount with its credit text; the station approves or declines (with a reason from a short list); it renews monthly while funded. Stations set a minimum a month and a maximum number of sponsors for the station and for each program; programs can be closed to sponsors. A carried program is sponsored through the station that makes it, and its credit travels with it to every carrier
- credit text is checked as it's typed, and can't be sent until it passes: who the business is, where, and what it does, and nothing else. Flag prices, offers and discounts, comparisons and superlatives ("the best"), and calls to action ("come by", "call", "visit"), each with a suggested rewrite
- ledger: statements and payouts per station and per advertiser
- network (admin only): the market board, the creator pipeline (including an "already licensed" stage), sending a permission request with a preview of the station's schedule built from titles, recording the yes or no without the creator needing an account, setting up a claimable station from a recipe, held earnings per station, handing it over when the creator claims (proving identity by connecting the source account), listed sources with calendar sync

**STOP.** List the endpoints, and confirm the contracts are pushed.

## Phase 5: Playout

**Prepare once, then assemble.** Prerecorded material is never encoded live. Change the worker from a queue loop that encodes a continuous stream into two jobs:

1. **Prepare, once per file.** When an item's rights are confirmed, transcode it into HLS segments at a fixed ladder (for TV: 1080p, 720p, 480p and 360p, with an audio-only rendition; for the radio band: AAC at 128 and 64 kbps), with aligned keyframes and a fixed segment length (4 seconds unless testing shows a reason to change), and store the segments in R2 under the item's content ID. Use Livepeer's transcode API or FFmpeg on the worker, whichever is cheaper per hour at the audit's volumes; report both at the STOP. Loudness is levelled and captions are generated here, once. Spots, bumpers, station IDs and generated underwriting credits are prepared the same way. Carried programs and catalog items are prepared once for every station that airs them.
2. **Assemble, continuously.** Each channel's stream is a rolling HLS playlist per rendition, written by the worker, that points at prepared segments in the order the log says, with `#EXT-X-DISCONTINUITY` between items and `#EXT-X-PROGRAM-DATE-TIME` on every item. Writing playlists takes almost no CPU, so a channel costs a few dollars a month, not hundreds. Serve segments from R2 through its custom domain (check Cloudflare's terms for video at scale before launch) and playlists from the API with a short cache.

The channel is on air 24 hours a day either way; only how the picture is made changes. The log is timed to the second but the stream changes item at segment boundaries, so programs, breaks and live blocks are scheduled on segment boundaries, and the log editor snaps to them.

**Live blocks** are the only live encoding. A live source is ingested and transcoded by Livepeer for the block's hours only, to the same rendition ladder. During the block the channel's playlist points at Livepeer's live segments, then returns to prepared segments when the block ends. Verify at the STOP that the renditions line up so players switch cleanly.

**The bug, lower thirds and on-screen codes** are drawn by the player as overlays, timed from `#EXT-X-DATERANGE` tags in the playlist, not burned into the picture. Anywhere the picture leaves Opencast's players (translators, proof frames), the worker composites them in.

The timeline rules:
- Read the program log as timed entries. Programs start at their times; breaks are generated from the station's break rule (after every program, every N minutes, or none) and always contain a station ID.
  - **Changed by the user on 2026-09-29:** breaks no longer always contain a station ID. Station IDs follow the station's cadence (every break, after every program, after every N programs, or once an hour at the first break after the top of the hour; every break unless the station changes it), as bumpers and the underwriting credit do (which may also be never). The pre-flight check warns when the cadence and the log would leave more than an hour without a station ID. A station with no station ID of its own airs a generated one (ten seconds in its colour with its call sign, channel, name and city, over a soft sound bed).
- Fill each break from the station's rotation, within each spot's daily limit and any barter split: break time inside a carried program is divided between the airing station and the producer as the carriage agreement says.
- Placing a spot in a break creates a hold on the advertiser's balance for that airing (Phase 6). If the hold can't be made, skip that spot, try the next in the rotation, then the station's backup rotation, then station ID and bumpers.
- An airing that already has a hold always airs, even if the spot is paused afterwards. It's already paid for.
- Open time with nothing in it airs the station ID and bumpers, never nothing.
- Underwriting credits are generated, not uploaded. The worker renders each credit as a short slate (10 to 15 seconds) in the station's colour: "Inland Beat is made possible by", then each active sponsor's name and one line of their approved text, set in the style guide's typefaces. Once a month it also renders a members credit from every viewer who opted in to on-air credit when pledging. Credits regenerate automatically when sponsors or members change, and the break's underwriting slot plays the current one. Sponsor text is limited to who they are and where: no prices, offers or calls to action, which is the difference between underwriting and a spot.
- Mark every break in the playlists with SCTE-35 style cues (`#EXT-X-DATERANGE` with `SCTE35-OUT` and `SCTE35-IN`). They're written by the worker, so nothing has to pass them through.
- **Translators** (relays to YouTube, Twitch or any RTMP destination) are the one place a continuous encode is needed. Only while a translator is on, the worker reads the channel's own playlist, composites the bug, swaps breaks for the station ID slate where the station chose that, and pushes the result over RTMP. Stream-copy wherever no compositing is needed. Report each translator's egress in gigabytes, because relaying a full channel around the clock is the largest per-station cost.
- Live blocks switch the playlist to the live source at their start time and back at their end. A live source that isn't connected airs a prepared slate.
- **Off air is a choice; dead air is a mistake.** A station can schedule off air hours (a standing rule like "every night 2:00 to 6:00 am", or a one-off sign-off entry in the log). During them the channel's playlist ends with `#EXT-X-ENDLIST` after a sign-off slate, the guide and dial show the station as off air with the time it's back, heartbeats stop, and no warning or auto-fill applies. At sign-on the playlist starts again from the station ID.
- **Day templates.** A station builds a day once and repeats it: every day, weekdays, a given weekday, or once. The log for each future date is generated from its template; editing one date changes only that date, and editing the template changes every future date that hasn't been edited.
- Keep a rolling 24-hour dead-air check for everything else: any unplanned gap outside off air hours. Emit warnings at 30 and 12 minutes before a gap. If nobody acts, fill the gap by repeating from the library and record that it happened.
- Write an as-run entry for every item as its segments are published to the playlist, with the program date-times it aired at. Billing reads the as-run log, never the planned log. Proof frames are extracted from the segment that was published during each spot, with the station's bug composited on.
- Neighbouring channels are cheap to pre-warm, since they're just playlists: the player fetches the next and previous channels' playlists and first segment so channel changes are fast.

Tuned-in counting: viewers' players send a heartbeat every 30 seconds with station and session. Store per-station per-minute concurrency in `audience`. Drop sessions that behave like bots (no media progress, impossible rates) before they count. Billing per thousand tuned in reads these numbers.

Keep the Redis leader lock for worker replicas.

**Readiness check.** Every hour, check the next 48 hours of every station's log: every item must have its prepared segments in storage, in every rendition. An item that isn't ready an hour before it airs raises a warning to the station and Network desk, and the log's usual fill airs in its place if it's still missing at air time. Expose items prepared, items waiting and preparation time in the health endpoint. The worker only needs a small volume, for preparation scratch space and for translators.

**STOP.** Show a station's evening running end to end locally: programs, a carried program with a barter break, a live block through Livepeer switching in and out cleanly, a dead-air auto-fill, one translator relaying, and the as-run log it produced. Report the cost per channel per month for a TV channel and a radio-band channel, split into preparation, assembly, storage, live hours and translators.

## Phase 6: Money

Sign-in is Privy (decided). Money is split across two providers behind one `payments` interface in the `ledger` module, so spots, catalog and playout never call a provider directly:

- **Clear** holds station wallets and advertiser budgets. Each station and each advertiser gets a Clear business account, which lives in Clear's own systems and Privy app, not Opencast's: a wallet holding USDC, with bank deposits and withdrawals through Clear's existing stack (Plaid to link a bank, Bridge for deposit accounts). Opencast reaches it only through the linked global wallet and Clear's API. Whether Opencast can open a Clear business account on someone's behalf during sign-up, or they must open it in Clear first, is **Open**. An advertiser's budget is its Clear balance, and a hold on an airing is an encumbrance on that balance. Station earnings, carriage fees and payouts settle into the station's Clear account.
- **Stripe** is the card on-ramp: advertisers topping up by card, and viewers' pledges. A card top-up converts into the advertiser's Clear balance; a pledge settles into the station's Clear account.
- A **Stripe-only adapter** also exists for anyone running their own copy of Opencast without Clear, using Stripe balances and Stripe Connect Express in place of Clear accounts.

Clear's API for opening business accounts, moving USDC between accounts and placing encumbrances may not exist in a usable form yet. Build the `clear` adapter against the interface with a local fake, list exactly which Clear calls it needs in `docs/clear-integration.md`, and don't guess at Clear's endpoints. Which entity holds advertiser prepaid funds, and what that requires legally, is **Open**.

The rule this phase exists to guarantee: **a station is never left airing, or making, something that isn't paid for.**

**Advertisers prepay.**
- An advertiser funds their Clear balance by bank transfer, or by card through Stripe. Funds land in their ledger account as available balance.
- Each spot has a total budget and an optional daily cap, and a rate: per thousand tuned in, or flat per airing.
- A spot can only be listed while the available balance covers at least one day of its budget.

**Money is held at placement, settled at airing.**
- When the worker places a spot in a break, it moves money from the advertiser's available balance into a hold for that airing.
- Flat rate: the hold is the exact price.
- Per thousand tuned in: the hold is an estimate, from that station's recent tuned-in numbers for that slot, capped at the spot's per-airing maximum. After the airing, the as-run log and audience data settle the real cost; the difference returns to available balance. If the real cost is higher than the hold, the station still gets paid the real cost, drawn from available balance; if that's empty, Opencast absorbs the gap for that airing and records it, so the station is never short.
- A held airing always airs. Pausing a spot never cancels holds that already exist.

**When a budget or balance runs out.**
- The spot pauses: it leaves the spot market and can't be placed in any new break. Existing holds still air.
- Every station with it in rotation gets a notice naming the spot, why it paused, and how much open time that leaves in its upcoming breaks, with a link to fill it. The station's backup rotation fills first if it has one; otherwise open time airs the station ID and bumpers.
- The advertiser is warned before it happens: when the balance covers about three days of current spend, and again at one day, with the thresholds set in days. Auto top-up is optional.
- When the as-run log shows a spot aired only part of its length (a live program overran, a break was cut), the unaired share of its hold returns to the advertiser automatically.
- Topping up resumes the spot automatically and tells the stations it's back.
- Unheld balance can be withdrawn by the advertiser at any time.

**Sponsorships** are prepaid like spots: each month's amount is held from the sponsor's balance at the start of the month and released to the station at the end. An unfunded sponsorship lapses at the end of its paid month, and its credit is removed from the next render.

**Claimable stations earn like any station, into escrow.** Claimable stations get no wallet. Their settled earnings, after the same fees and pool share as any station, are paid each week into one escrow contract, held under the station's ID. Wallets are only created for people who sign in.

Write the escrow contract in a `contracts/` package with Foundry, with full tests, deployed to a local chain for development. It holds USDC and has exactly these ways out, and no others:
- **Claim:** pays a station's balance to the creator's wallet, after a claim approved by a multi-signature verifier key and a 72-hour public waiting period during which the verifier can cancel it. Future deposits for that station then go to the claimed station's normal account.
- **Stop:** the same path, when the creator asks for the station to be signed off.
- **Unclaimed:** after the unclaimed period (default 3 years, **Open**) with no claim, anyone can trigger payment of the balance to the creator fund, whose address is fixed at deployment.

No owner or admin function may move funds anywhere else, and the contract must not be upgradeable in a way that could add one. Emit an event for every deposit, approval, cancellation and payout. Put the contract address and each station's ID on the station page and the claim page.

In the `ledger`, a claimable station's earnings are a liability to that station until the weekly deposit confirms, then an escrowed balance. Which chain, and whether the contract belongs in Opencast's repo or as part of the Clear protocol next to its encumbrance, are **Open**; build for the chain Clear uses by default and list the decision in `docs/open-decisions.md`.

**STOP after the contract.** Before wiring it into the ledger, show the contract, its tests (including tests that every path to a non-creator, non-fund address fails), and the gas cost of a weekly deposit batch.

**Production orders.** When a business asks a station or the house studio to make a spot, the business pays the agreed price up front into a hold. It's released to the maker when the business approves the finished spot, or automatically 7 days after delivery if the business doesn't respond. A disputed order is flagged for review, not refunded automatically.

**Stations and producers are paid into their Clear accounts** (Stripe Connect Express in the Stripe-only adapter).
- Settled airings move from holds into the station's earnings. Barter carriage splits the settled amount between the airing station and the producer as the agreement says. Cash carriage fees are charged per aired episode to the airing station and credited to the producer.
- Because airings are prepaid, payouts can run weekly. Make the schedule configurable; default weekly.

**Pledges** are paid by card through Stripe and settle into the station's Clear account. Opencast's share of pledges is **Open**; default 0.

**Opencast's share and the pool.** Opencast's share of spot revenue is taken from what the station receives, never added to what the advertiser pays: the rate an advertiser sets is exactly what it's charged per airing. Card top-ups carry Stripe's fee at cost, shown in dollars before paying; bank transfers and Clear funding carry none. Opencast's share and the pool split (equal base share, watch-time share, fund) are **Open**. Build them as a config table with effective dates, default everything to 0, and compute the monthly pool from the as-run log and audience data.

Every movement of money is a balanced ledger entry. A reversal is a new entry, never an edit.

**STOP.** Show the ledger for a sample week: one advertiser who funds, lists two spots and runs out of budget midweek; two stations, one with a backup rotation and one without; a per-thousand airing whose real cost differs from its hold; one barter carriage; one cash carriage; one production order; one pledge, and one claimable station whose earnings are deposited into escrow and then claimed.

## Phase 7: Railway

Services, each its own Railway service:
- `api`, `worker`
- `web` (the Opencast app: viewer, master control and Network desk; the desk's admin-only access is enforced by the API's role checks, not by a separate deploy), `business` (Opencast for business), `site` (marketing, static), `tv` (the TV build and the Chromecast receiver, static)
- Postgres and Redis as Railway plugins
- a small Railway volume for the worker (preparation scratch space and translators, start at 20 GB), and R2 credentials as variables on `api` and `worker` only

For each service, write its build and start commands, health check, and required variables into `docs/deploy.md` and a per-service `.env.example`. Suggested domains: the root for `site`, `app.` for `web`, `business.`, `tv.` (the Cast receiver's registered URL) and `api.`, on whatever domain is chosen.

Create a `staging` environment first and deploy everything there. Don't point production at the new services until you're told to; the existing `@openchannel/*` services keep running until then.

**STOP.** Give the staging URLs and a checklist for cutting production over.

## Later: ads from partners (programmatic backfill)

Don't build this now, but build Phases 3 to 5 so it can be added without rework: break markers (SCTE-35) on every break, IAB content categories on every station, program and blocked category, content ratings, and a child-directed flag on programs aimed at children.

When it's built:
- **A station setting, off by default:** "Ads from partners" fills only time still open after the station's own rotation, backup rotation and thank-you credit, and before bumpers and the station ID. The station's hourly cap and blocked categories apply, mapped to IAB categories on every ad request.
- **Server-side ad insertion** behind an `adfill` interface, so the provider can change: Google Ad Manager's Dynamic Ad Insertion or AWS Elemental MediaTailor, fed by VAST or VMAP requests at each marked break. Start through a FAST aggregator's demand if exchanges won't take Opencast directly at launch. Publish `ads.txt` and `app-ads.txt`.
- **Per-viewer ads are allowed only in this backfill.** The as-run log records a "partner ads" block with its length and impressions, not individual spots.
- **Child-directed programs** get no personalized ads.
- **Money:** its own ledger line per station, "Ads from partners, paid when received". It's never held in advance, never escrowed, and never counted in held money. Record invalid-traffic deductions when the partner reports them. Opencast's share and the pool apply as they do to spots, once set.
- Tuned-in bot filtering and partner impression counts are reported side by side; spots in the spot market are still billed only on Opencast's own count.

## Deliverables

- `docs/audit.md`, `docs/architecture.md`, `docs/deploy.md`, `docs/open-decisions.md`, `docs/contracts-changelog.md`, `docs/clear-integration.md`
- the migration script and its report
- a root `README.md` that explains the layout, how to run everything locally, and which prompt owns which folder
