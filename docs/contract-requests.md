# Contract requests (from the apps)

Fields and endpoints the reference designs need that `packages/contracts` doesn't have yet. The apps prompt never edits the contracts: it asks here, and builds against Mock Service Worker fixtures until each lands. The platform side answers by adding the field (and a line in `docs/contracts-changelog.md`), or by marking the request **declined** with a reason, in which case the apps change the screen.

Found in Phase 0 by checking every frame against the Zod schemas; the frame-by-frame evidence is in [docs/apps/inventory.md](apps/inventory.md). Frame IDs are `<file> <section>.<frame>`.

**Mock** says whether the apps can fake it safely in `dev:mock` until it lands. "Yes" means the fixture shape is obvious. "UI only" means the screen can be drawn but not used for real. "No" means a placeholder would be wrong somewhere else, so the request blocks the flow.

**Phase** is the apps phase that first needs it. Numbers in brackets count how many frames depend on it.

## Blocking a flow as drawn

These change what the API accepts, or add something no fixture can stand in for. They're listed first because a mock would hide a real problem.

| # | Request | Why | Frames | Mock | Phase |
|---|---|---|---|---|---|
| B1 | **A draft spot without a rate or budget.** `createSpot` requires positive `rate.micros` and `budget.totalMicros`, and `Spot.rate` and `budget` aren't nullable. Allow null while `state = draft` (or `createSpot` with only title, length and category) | Upload (spots 02) comes before rate and budget (spots 03). An approved production order "becomes a spot waiting for a rate and budget". A placeholder rate would show in stations' markets | biz-spots 02.1, 03.1; orders 05.1, 06.2 (4) | No | 5 |
| B2 | **Done 2026-09-28** (monorepo; `api.tv`, see docs/contracts-changelog.md): `registerTv`, `createTvCode` (now `device` auth), `pollTvCode`, `approveTvCode`, `signOutThisTv` (`device`: the device token or the TV session), `listTvs`, `signOutTv`, `recordCastTarget`; TV sessions accepted as `user` where `tvSession: true`; plus the remote relay for TVs without Cast. **TV sign-in by code, and TVs on the account.** Needed: `POST /tv/codes` (public: code, QR URL, expiry, poll token, and as in OAuth's device flow `enterAt`, the address to type, and `pollSeconds`); `GET /tv/codes/:pollToken` (pending, approved with a TV session, expired); `POST /tv/codes/:code/approve` (user); the API accepting a TV session as `user`; `listTvs`, `signOutTv`, and the TV signing itself out (`DELETE /tv/session`). Built against a mock in `apps/tv/src/api/ext/signIn.ts` | A TV has no Privy token, so it can't read presets or reminders after "sign in on your phone". You shows "Your TVs" with Sign out and "Add a TV, enter a code" | tv 05.3; you 02.1, 06.2; tv-update 04.1 (5) | UI only | 6 |
| B3 | **Browser and phone go-live ingest.** `addLiveSource` returns no WHIP or WebRTC endpoint or token for a browser source | Going live from a browser or phone can't send video | live-listings 01.1, 02.1, 05.1, 05.2 (4) | UI only | 4 |
| B4 | **Listed airings can be reminded.** `Airing` has `logEntryId` but no `listedAiringId`, which `addReminder` needs for a listed stream | Remind me on city meetings (RDLS) in home, the guide and search | home 01.1, 05.1; station-pages 03.1; tv 03.2 (4) | No | 3 |
| B5 | **Check a code before redeeming.** `redeemCode` validates and counts in one call. Add a dry run (`confirm: false` or `/redeem/check`), returning when and where the offer was saved and its text | Calling it to show the check would count the use | biz-results 05.1; biz-settings 05.1 (2) | No | 5 |
| B6 | **Answer a claim with a file.** `answerClaim` takes `attachmentUrl`, but nothing uploads the attachment | "Attach the permission" | rights 03.1 (1) | UI only | 4 |
| B7 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `askPermission` body `workIds`; only the ticked works are covered, the rest left out with their reason. No dry run (the desk previews on its side). **Ticked works, and a preview before sending.** `askPermission` has no `workIds`, and nothing edits a work after `addWorks`. Its schedule preview exists only in the response, after sending. Add `workIds` and a `dryRun` or preview endpoint | The desk ticks works and previews the message before it goes out, and "only ticked works are covered by the yes" | desk 03.1 (1) | No | 7 |
| B8 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `POST /permission/:token/stop` (public) and `POST /permission/:token/claim` (user), `PermissionPage.stoppedAt` and `claim`. A claim before the station exists joins it at setup. **Stop from the permission link, and Claim now before there's a station.** `answerPermission` refuses a second answer, and `startHandover` needs a user and a `stationId` | 06.2: "This link works to stop it at any time"; "Claim it now and skip the team-run part" | desk 06.2 (1) | No | 7 |
| B9 | **No K or W prefix on call signs.** `CallSign` is `/^[A-Z]{3,5}$/` in contracts and domain | The style guide's dial rules. `KBEA` passes `checkCallSign` and `join` today | site S.10; control A.1; desk 04.1 (3) | Client pre-check | 1 |

## accounts

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| A1 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `POST /me/sign-out-everywhere`: tokens issued before, and sessions seen before, answer 401 `signed_out`; TVs and their phones are signed out. **Sign out everywhere** (Settings, Account) | you 05.1 | UI only | 3 |
| A2 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `GET /me/watch-history` (`lastChannel`, 30 days) and `DELETE /me/watch-history`; the heartbeat is `optional` and keeps history only when sent signed in and `keepWatchHistory` isn't off. The tuned-in session stays anonymous. **Watch history and last channel**: store (when `keepWatchHistory`), read the last channel, clear. The heartbeat carries no user, by design | you 05.1; tv 02.1 ("It opens tuned in") | Device-local for one device | 3 |
| A3 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `POST /me/export` (emails a link), `GET /me/export` (the JSON), `DELETE /me` (at once; 409 `owns_station` / `owns_business`; pledges stop after this month). **Your data**: download (export) and delete the account | you 05.1 | UI only | 3 |
| A4 | **Host blocks readable, and invites that carry them.** `setHosts` is write-only, and `inviteToStation` can't name blocks. Add a GET (or `blocks` on `TeamMember`), and `programIds` on host invites | station-settings 03.1, 03.2; every host-scoped screen | Yes | 4 |
| A5 | **Station switcher status**: on air and needs attention ("Dead air in 40 min") per membership in `Me` | station-settings 04.1, 05.2 | Fan-out per station | 4 |
| A6 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `GET /admin/team` → `[{ id, name, email }]`. **Opencast team list** for `setUpClaimable.operatorUserId` ("Run by Dee A.") | desk 04.1 | Yes | 7 |
| A7 | **Done 2026-09-28** (monorepo): typed as `ViewerSettings.tv` (`TvSettings`), the same six fields, all optional. Quiet hours not typed (O2). **`ViewerSettings` sections are strict**: nested `watching`, `market` and the rest strip unknown keys. Type the TV-only rows (channel-up direction, banner seconds, number-entry wait, include radio band, picture quality, audio evening-out) and quiet hours, or make the sections `.loose()`. Until then the TV keeps them under a top-level `settings.tv` key, which the top-level `.loose()` keeps: `{ channelUp, bannerSeconds, numberWaitSeconds, includeRadioBand, quality, eveningOut }` | tv-update 04.1; you 06.3 | Top-level keys | 3 |
| A8 | (minor) `TeamMember.role` is `z.string()`; make it `StationRole` or `BusinessRole` | station-settings 03.1 | n/a | 4 |
| A9 | **A first sign-in marker** (`Me.createdAt`, or a `firstSignIn` flag on the session) so sign-in knows when to ask the two first-time questions (keep what's on this device, the display name). Until it lands, the viewer asks when the device holds presets or reminders, or the account has no name | you 01.3 | Yes | 3 |

## stations

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| S1 | **Station category on `StationIdent`** (or on dial and search rows): the home chips, "Public affairs." in the preview, and search results | home 01.1, 06.1; station-pages 03.1, 05.2 | Yes | 3 |
| S2 | **Carried widely**: programs carried widely in a market, with maker, carrier count and the in-market airing now and next (on `Dial`, or public) | home 01.1, 02.1 | Yes | 3 |
| S3 | **Coming up live**: live airings past the guide's 24-hour window (`Dial.comingUpLive`) | home 01.1, 02.1 | Several guide calls | 3 |
| S4 | **A note per airing** (`Airing.note`): "Overnight repeat", "Full meeting, unedited", "Live from Redlands City Hall". Also used by the TV banner and the site tuner | home 01.1, 03.1, 06.1; tv 06.1; site S.01 | Yes | 3 |
| S5 | **A station's schedule by range** (`from`/`to` on `getStation`): the week by day, and tonight from 8:00 | station-pages 01.1; home 03.1 | Guide per station, in market only | 3 |
| S6 | **Station page fields**: member count, about text, on the dial since, broadcast hours, bug (mode, position, logo) for the viewer player | station-pages 01.1; home 03.1, 06.1 | Yes | 3 |
| S7 | **Public carriage for a station**: what it carries (with slot text), what it makes that others carry, and carrier counts | station-pages 01.1; home 06.1, 06.2 | Yes | 3 |
| S8 | **Made possible by**: public credits (credited sponsorships and the members' credit) | station-pages 01.1 | Yes | 3 |
| S9 | **Station counts per market** on `listMarkets` | home 08.1 | Yes | 3 |
| S10 | **Done 2026-09-28** (monorepo): `GET /markets/by-connection` and `GET /markets/by-location?lat=&lng=`, both `MarketLookup` (`nearby[].miles` is nullable). **Market from where you are**: from coordinates ("Use my location") and from the request's IP (TV first launch), neither stored | home 08.1; tv 05.3 | Fixture market | 3 |

S10 interim (Phase 3): the viewer computes "Use my location" on the device from a market centre (`lat`, `lng` on `listMarkets`, proposed in `apps/web/src/viewer/api/ext/home.ts`): the nearest open market within 150 miles. The coordinates are never sent. A server-side lookup by IP is still needed for the TV's first launch.

| S11 | **Open channels for signed-out viewers**: a thin market's "Any channel from 2 to 69 is open except 5" (`availableChannels` is `user`) | home 08.2 | Yes | 3 |
| S12 | **One airing by id, public**: for share links that tune in or offer a reminder | home 07.1 | Yes | 3 |
| S13 | **Done 2026-09-28** (monorepo): `DialRow.signal: "ok" | "standby"` (optional). **Stand by as a state**: a live block waiting for its signal (`DialRow.signal` or `Airing.kind: standby`) | tv 05.2 | Yes | 6 |
| S14 | **Live source detail**: signal quality ("Receiving, 1080p", bitrate), and a private rehearsal preview for encoders | live-listings 01.1 | Yes | 4 |
| S15 | **Live lower third state**: which speaker is showing, or free text, or hidden, readable by a second device (and composited for encoder sources) | live-listings 02.1, 05.2 | Client-side for the browser source | 4 |
| S16 | **Translator Connect** (YouTube and Twitch OAuth), or the design moves to a key form | master-control A.5 | UI only | 4 |
| S17 | **Spot categories**: one list of valid categories, for blocked categories, market filters and a business's category | station-settings 02.1; master-control C.2; biz-funding 01.1 | Constant | 4 |
| S18 | **Studio to station**: claiming a channel as a studio | market 04.1 | UI only | 4 |
| S19 | **The program on each search airing**: `program {id, title}` on `SearchResult` airings, for the airing's title card and its link to the program page | station-pages 03.1 | Yes | 3 |

## library

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| L1 | **Program format**: typical episode length, cadence ("Weekly", "Nightly"), series or one-off, band or media kind (audio only). Used by the market, offers, sponsorships and the program page | market 01.1, 05.1; offering 01.1; master-control B.1; sponsorships 01.1, 04.1 | Yes | 4 |
| L2 | **Carriers of a program**: total, outside the market, and the list | station-pages 02.1; home 07.1 | Yes | 3 |
| L3 | **Where to watch**: `upcoming[]` with `endsAt`, on now, episode, slot text ("Saturdays at 8:30 pm") | station-pages 02.1; home 07.1 | Yes | 3 |
| L4 | **Episode airings**: aired or not, last airing, next airing (with its `logEntryId`), episode description | station-pages 02.1 | Yes | 3 |
| L5 | **An item's history**: scheduled and aired, including on carrying stations; usage counts; cached on playout; audio layout; caption language | live-listings 04.1 | Yes | 4 |
| L6 | **Replace an item's file**, keeping its history and schedule | live-listings 04.1 | UI only | 4 |
| L7 | **Captions mode and language** on a program | live-listings 03.1 | Yes | 4 |

## log and playout

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| G1 | **Break contents**: each break's rows (code, title, start, length, whose time: the station's, the maker's barter, backup). Used by the Monitor rundown, Breaks, "then 6 more" and the paused notice | master-control A.7, C.1, C.3, P.1; biz-spots 05.1 | Yes | 4 |
| G2 | **Monitor status**: the next item and its picture for the preview monitor, on air since, output bitrate | master-control A.7 | Yes | 4 |
| G3 | **End early** during a live block (hands back to the log) | live-listings 02.1, 05.2 | UI only | 4 |
| G4 | **Fill a gap by carrying**: a `carry` option on `fillGap` for one night | master-control A.4, P.2; market 06.1 | No | 4 |
| G5 | **Per-airing listing**: `episodeDescription` returned on `LogEntry`, and a listing status per airing | live-listings 03.1; home 03.1 (tuned in: "Tonight: a steamboat, a haunted barn…", read from `Airing.episodeDescription`) | Yes | 4 |
| G6 | **Test output before sign-on**: a playback URL for "Watch it" | master-control A.6 | Yes | 4 |
| G7 | **Repeats readable**: `repeats[]` on `getLog` (what "Repeat this day" set up, until when), so the log can show and undo them | master-control A.4 | Yes | 4 |

## catalog

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| C1 | **Why it fits**: the slot label and range, the reason (dead air, library repeats, weak slot), length, exact fit. Also offers that fit a given gap (from, to, minimum length) | market 01.1, 02.1, 06.1; master-control A.4, A.7 | Dead air only | 4 |
| C2 | **Browse**: filters for kind, maker kind, maker station (Offered by BEAT, studio, catalog), approval, gap window; sort (fits, carried by most, newest); facet counts | market 01.1, 04.1, 05.1, 06.1; offering 01.1 | Client-side on fixtures | 4 |
| C3 | **A price per deal**: cash and cash plus barter each with a fee and a barter split; the program's break time per hour | master-control B.2; offering 02.1 | No | 4 |
| C4 | **Carry in one step, and undo**: `requestCarriage` returning the agreement when approval isn't needed; withdraw a request (the enum has `withdrawn`); mark an airing as the repeat of an episode | master-control B.3; market 06.1 | Delayed send | 4 |
| C5 | **Episodes**: first aired (date and station), captions | market 02.1, 03.1 | Yes | 4 |
| C6 | **Slots on agreements and carriers**: when each carrier airs it | market 02.1; offering 04.1 | Yes | 4 |
| C7 | **Carrier profile on a request**: members, how many programs it carries, blocked categories | offering 03.1 | Yes | 4 |
| C8 | **A default deal** on an offer (one-tap carry) | market 06.1 | `termsOffered[0]` | 4 |
| C9 | **Catalog underwriter** and upcoming shelves | market 05.1 | Static | 4 |

## spots

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| P1 | **Upload check regions**: a typed `detail` with a box in frame coordinates and a time range, and where the code and QR sit | biz-spots 02.1 | Yes | 5 |
| P2 | **Shrink to fit on the stored file** | biz-spots 02.1 | Re-upload | 5 |
| P3 | **Captions**: the track, and editing it | biz-spots 02.1 | UI only | 5 |
| P4 | **Code placement and limits**: position, timing, "once per customer", and who picks the code string (the design says Opencast generates it; the contract takes it from the business) | biz-spots 02.1; biz-results 03.1 | Yes | 5 |
| P5 | **Which stations a spot is in rotation on** (`StationIdent[]`, not a count) | biz-spots 04.1, 06.1 | Yes | 5 |
| P6 | **The pause story**: when and why it paused, the last hold, held airings that still aired, what each station did with the time, told when back. The station-side notice needs the same data: the reason, time held tonight, the backup that filled it, the resume reason | biz-spots 04.1, 05.1 | From notice text | 5 |
| P7 | **Estimates**: airings a day and days of budget; days for a raise ("$200 more is about 17 days") | biz-spots 03.1, 04.1, 06.2 | Client-side | 5 |
| P8 | **Band in targeting** ("Radio band" as a kind of station) | biz-spots 03.1 | No | 5 |
| P9 | **Category reach**: how many stations in a market can carry a category, and which block it | biz-funding 01.1; biz-settings 01.1 | Yes | 5 |
| P10 | **Address to coordinates**: `LocationInput` needs latitude and longitude, and the frames take an address, or a city and radius | biz-funding 01.1; biz-settings 01.1 | Fixture | 5 |
| P11 | **Logo upload** for a business | biz-settings 01.1 | UI only | 5 |
| P12 | **The Redeem tool**: a setting to turn it on, and today's count | biz-settings 05.1 | Yes | 5 |
| P13 | **Codes by code, and by how uses were counted** (Clear Pay, marked, online checkout) | biz-results 03.1 | Yes | 5 |
| P14 | **Results periods**: week and all time, not only month | biz-results 01.1, 05.2 | Yes | 5 |
| P15 | **Results CSV**, why an airing was short, when the proof frame was captured; paging | biz-results 02.1 | Yes | 5 |
| P16 | **What a business can sponsor**: stations and programs with minimum, room left and schedule line (`listStationSponsorships` is the station's own) | sponsorships 02.1 | Yes | 5 |
| P17 | **Credit preview**: the members' credit name, and co-sponsors | sponsorships 02.1, 03.1, 05.1 | Yes | 5 |
| P18 | **Makers**: history with this business, specialty, the samples themselves; brief files before sending (multipart `orderSpot`, or a draft order) | orders 02.1 | Yes | 5 |
| P19 | **Delivery checks and length**; `approvedAt` and `quotedAt` | orders 01.1, 05.1 | Yes | 5 |
| P20 | **Connections**: Clear Pay and an online checkout (fields and connect endpoints) | biz-settings 04.1; biz-results 03.1 | UI only | 5 |
| P21 | **Close account** (business) | biz-settings rail | UI only | 5 |
| P22 | **Sponsor profile** for the station: business category, city, distance, sponsors elsewhere; and members who asked to be named | sponsorships 03.1 | Yes | 4 |
| P23 | **Market spot preview URL** for stations | master-control C.2 | Yes | 4 |
| P24 | **Maker "Tell me when it's listed"** on the station side | orders 06.2 | Drop the button | 4 |
| P25 | **A business's short name** (`business.shortName`: "Orange Street", "Inland Tire"), used in thumbnails, break summaries and notices | master-control C.3; biz-spots 05.1 | Yes | 4 |
| P26 | **Edit a location in place** (`PATCH /businesses/:id/locations/:locationId`): only add and remove exist, and adding puts it last, so editing the first address would reorder them | biz-settings 01.1 | Yes | 5 |

## ledger

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| E1 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `Pledge.card`, `Pledge.receipts.items`, `cadence` on `updatePledge`, `POST /me/pledges/:pledgeId/card-session`. Receipt documents (`url`) are null for now. **Pledges**: the card on file and changing it; receipts (list and documents); changing monthly or once | you 04.1, 02.1 | UI only | 3 |
| E2 | **Station earnings detail**: sponsor names, the airings and breaks held tonight, the next payout amount | earnings 02.1 | Derived | 4 |
| E3 | **Statement structure**: line groups, per-thousand fields (rate, airings, average tuned in), paid-on date and destination, in progress or final, closing split into available and held | earnings 03.1; biz-results 04.1 | Detail strings | 4 |
| E4 | **Receipts for a business**: prepayment, expense or statement, with a PDF each | biz-settings 03.1 | Yes | 5 |
| E5 | **Funding sources**: remove, make default | biz-settings 03.1; biz-funding 03.1 | UI only | 5 |
| E6 | (minor) **Deposit quote basis** (rate, reference station); **withdrawal arrival**; the usual top-up amount | biz-funding 02.1, 04.1, 06.1 | Copy or derived | 5 |
| E7 | **The business's deposit address** (`Balance.depositAddress`): with Clear shared read-only, `quoteClearTransfer` answers 409, so nothing says where to send USDC from inside Clear | biz-funding 02.1, 06.1 | Yes | 5 |

## audience

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| U1 | **By program, per airing**: aired at, source, average, peak, stayed to the end, on now | earnings 01.1, 04.1 | Yes | 4 |
| U2 | **Mirroring as a platform** (`Platform` has phone, cast, web, tv_app) | tv-update 01.1 | Send `phone` | 8 |
| U3 | **Last week across the whole window** (`comparison[]`; `series[].lastWeek` stops at now) and the window's breaks (`breaks[]`) for the shaded bands | earnings 01.1 | Yes | 4 |

## trust

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| T1 | **Takedown airing times** ("Monday, 8:00 pm on BEAT") and what carriers were told | rights 02.1, 04.1, 06.1 | Template | 4 |
| T2 | **Replace a claimed item with a cut**, tied to the claim | rights 02.1 | Drop the footnote | 4 |
| T3 | **Label fixes in `states.ts`**: "Removed" is shared by `removed` and `expired`, but an expired claim "counts as removed, not upheld" and the frame says "Removed by BEAT"; the frame says "Answered, back on air". The rights basis reads "We made it" in the claim and "I made it" in the library, and the note says they must match | rights 01.1, 03.1; master-control A.3 | n/a | 4 |
| T4 | **What kind of work a claim is about** (`workNoun`: "recording", "film"), for "Claim: the recording is theirs" | rights 02.1, 04.1 | Yes | 4 |

## network

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| N1 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `Creator.proposedOptions`, accepted by `addCreator` and `updateCreator`. **Several proposed channels, or a band only** ("38.1 or 45.1", "Radio band") | desk 02.1, 03.1 | Yes | 7 |
| N2 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `POST /admin/creators/:creatorId/reminders`. **The reminder** (one, then `no_answer`) | desk 02.1 | UI only | 7 |
| N3 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): the pipeline's dates on `Creator`, held earnings' `invitedAt`, `claimLinkSentAt`, `signOnAt`, and `POST /admin/creators/:creatorId/claim-invites` (`invite` or `link`). **Pipeline dates**: said yes, claim invite sent, claim link sent, claimed, said no, sign-on time; and a claim-invite endpoint (`heldEarnings` never produces `invited` or `claim_link_sent`) | desk 02.1, 07.1 | Yes | 7 |
| N4 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `sourcePlatform`, `groupLabel`, `noun`, `marketName` on the page; `CreatorWork.noun`; `wordingVersion` recorded. `summary` is null (the app words it). **Permission page**: the source platform, grouped work counts, a copy emailed by default, the wording version recorded with the answer | desk 06.1, 06.2 | Yes | 7 |
| N5 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `Creator.setup` (recipe, operator, sign-on, import progress, escrow id). Drafts before the yes stay on the device. **A claimable station's setup, read back**: recipe, operator, sign-on time, import progress; drafts prepared before the yes | desk 04.1 | Client draft | 7 |
| N6 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): block `label`, `listing`, `colour`, `carried`; `Recipe.when`, `catalogAbout`; `RecipeBreakRule` (the typed reading; `breakRule` keeps its type). **Recipe detail**: carried programs in blocks, labels, a typed `breakRule` | desk 04.1 | Parse client-side | 7 |
| N7 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `MarketBoard.stats.market`, `slots[].signOnAt`, `creatorId`. **Board stats for the whole market** (both bands), and structured slot status | desk 01.1 | Yes | 7 |
| N8 | **A listed source without a channel** yet | desk 05.1 | Yes | 7 |
| N9 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `HeldEarnings.unclaimedPeriodDays`, `chain`, `stations[].licenceName`, and the invite dates. Pending handovers show as `claim_pending` (A125: `creatorId`, `creatorName`, `stationsHoldingMoney` too). **Held earnings**: unclaimed period and date, licence name, pending handovers (so `approveHandover` is reachable), chain | desk 07.1 | Config | 7 |
| N10 | **The creator's claim page**: said-yes date, days on air, presets, held amount, source platform to connect, and a GET for the handover's status after starting | rights 05.1 | Yes | 4 |
| N11 | **Moving the catalog station** to a free channel (channels are fixed after sign-on) | desk 05.1 | Decision first | 7 |
| N12 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `Creator.pronoun`, accepted by `addCreator` and `updateCreator`. **The creator's pronoun** (`Creator.pronoun`: she, he, they), for "Her videos", "Suggested from her name. She can't change it after claiming". Without it the desk says "their" | desk 04.1 | Yes | 7 |

Phase 7 built against these as optional extensions in `apps/web/src/desk/api/ext.ts` and `apps/web/src/viewer/components/permission/api.ts`, filled by the mocks:
- N1 `Creator.proposedOptions: { band, channels[] }` (empty channels: band only).
- N2 `POST /admin/creators/:creatorId/reminders` (admin) → `Creator` with `remindedAt`; a second reminder is refused; after it the desk offers "No answer" (`updateCreator { stage: "no_answer" }`).
- N3 `Creator.askedAt`, `remindedAt`, `answeredAt`, `claimInviteSentAt`, `claimLinkSentAt`, `claimedAt`; `HeldEarnings.stations[].invitedAt`, `claimLinkSentAt`, `signOnAt`.
- N4 `PermissionPage.creator.sourcePlatform`, `works[].groupLabel` and `noun`, `summary: { included, leftOut }` ("6 skate films and 7 park session edits", "the shoe sponsor edit"), `marketName`; `CreatorWork.noun`; `answerPermission` body `wordingVersion` (sent now, ignored until it lands).
- N5 `Creator.setup: { recipeId, band, channel, callSign, name, colour, operator, signOnAt, importDone, importTotal, escrowStationId }`. The draft before the yes is kept on the device (`oc-desk-draft-<creatorId>`) until the API keeps drafts.
- N6 `Recipe.blocks[].label`, `listing`, `colour`, `carried: { station, programTitle, schedule, about }`; `Recipe.when`, `catalogAbout`; `breakRule` read as `{ everyMinutes, lengthMs, fillFrom, blockedCategories }`.
- N7 `MarketBoard.stats.market: { localShareOfTonightPercent, claimableOnAir, deadAirComing }`; `slots[].signOnAt`, `creatorId`.
- N9 `HeldEarnings.unclaimedPeriodDays`, `chain: { name, explorerUrl }`, `stations[].licenceName`.
- A6 `GET /admin/team` (admin) → `[{ id, name, email }]`.
- B7 `askPermission` body `workIds` (the ticked works). Done 2026-09-28.
- B8 `POST /permission/:token/stop` (public) and `POST /permission/:token/claim` (user) → `PermissionPage` with `stoppedAt` and `claim: { handoverId, status, startedAt }`. Done 2026-09-28.

## notifications

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| O1 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `NoticeKind` gains `preset_live`, `station_news`, `signed_on_off`, `spot_added`; the last two are sent. **New kinds**: a preset goes live, station news, signed on or off (station team), a station added your spot (business) | you 06.3; station-settings 05.1; biz-settings 04.1 | Yes | 3 |
| O2 | **Done 2026-09-28** (monorepo; see docs/contracts-changelog.md): `ViewerSettings.notifications` (`emailWhen`, `leadMinutes`, `quietHours`, `quietFrom`, `quietTo`); quiet hours and lead time are honoured, the evening-before email isn't built yet. **Preference detail**: lead time, email timing, quiet hours window (on by default, honoured by the sender) | you 06.3 | Yes | 3 |
| O3 | **Push registration**: web push subscriptions, and APNs and FCM tokens | every push frame | UI only | 3 |

## waitlist

| # | Request | Frames | Mock | Phase |
|---|---|---|---|---|
| W1 | **Message for a station without a call sign**: the API says "Your station is on the list."; the site says "You're on the list." One of them changes | site S.11 | n/a | 7 |

## Platform (not contracts)

| # | Request | Why | Phase |
|---|---|---|---|
| X1 | **Live playlists keep 30 minutes** (the worker's HLS and Livepeer's output: a DVR window of at least 30 minutes) | Pause holds your place for up to 30 minutes, then offers Back to live. With a short window the player can only hold what the playlist still lists | 3 |
| X2 | **A subtitle rendition in the live output** (WebVTT in the HLS, or CEA-608 in the video) | Captions, with the size setting, come from the stream; the player shows whatever rendition it's given | 3 |


## How the viewer carries them (Phase 3)

Every proposed field is an optional extension of a contract schema in `apps/web/src/viewer/api/ext.ts` or `apps/web/src/viewer/api/ext/<area>.ts`, named by its request id here. The mock responses are validated against those extended schemas. Against the real API the fields are absent until each request lands, and the screens hide what depends on them. The shapes the viewer proposes:

- **S5**: `from`/`to` on `getStation`; the station's schedule over that range.
- **S7**: `carries[] {from, program, slot}` and `madeHere[] {program, carriers}` on the station page.
- **S8**: `madePossibleBy[] {kind: "members" | "underwriter", text}`.
- **L1**: `typicalLengthMs` on the program. **L2**: `carriers {total, outsideMarket, outside[] {station, market}}`. **L3**: `whereToWatch[] {station, slot, now, next}`, with a `market` query on `getProgram`. **L4**: on each episode `aired`, `lastAiring`, `onNow`, `nextAiring`, `description`, and `airedCount` on the program.
- **B2**: `listTvs`, `signOutTv`, `approveTvCode`; `Tv {kind, platform, signedIn, lastUsedAt, castingNow}`. Only the casting device really knows "Casting now".
- **E1**: `card {label, expired}` on a pledge, `receipts.items`, `cadence` on `updatePledge` (switching a monthly pledge to once ends it after this month), and a card-session endpoint for Change.
- **O1**: kinds `preset_live` and `station_news`. **O2 / A7**: quiet hours and email timing in `settings.notifications`.

## How master control carries them (Phase 4)

As in the viewer: every proposed field is an optional extension of a contract schema in `apps/web/src/control/api/ext/<area>.ts` (onair, live, market, spots, earnings, station), named by its request id, and the mocks return them. The new ones are G7, T4, P25 and U3 above. The shapes master control proposes for requests already listed:

- **G1** break contents: `rows` (code, title, length, whose, note) on `getLog` breaks and `contents[]` on `Avail`. **G2** `onAirSince`, `next`, `output.bitrateKbps` on `PlayoutStatus`. **G3** end a live block early, and its state. **G5** listings per airing, and editing one. **G6** `watchUrl` on sign-on checks.
- **A4** `GET /stations/:id/hosts`, and `programIds` on host invites. **A5** `GET /me/stations/status` (`stationId`, `onAir`, `deadAirAt`) for the switcher; it could live on `Me.memberships[]`.
- **S14** `quality` and `previewUrl` on a live source. **S15** get and put the lower third per live block. **B3** `ingest` (WHIP) for browser sources: master control draws the whole studio on the local camera and sends nothing until it lands. **S16** Translator Connect is a key form until OAuth exists. **S17** a constant list of spot categories.
- **L1** program format, card colour, advisory. **L5** an item's history (with `audioLayout`). **L6** replace an item's file. **L7** captions on a program.
- **C1** fit slots on offers (`fit[]`, `?forStation`). **C2** `maker`, `makerKind`, `gap` on browse, and `offeredAt`. **C3** `breakMsPerHour`, `cashPlusBarter`, `barterFill`. **C4** `agreementId` and `repeatSlots` on requests. **C5** an episode's first airing and captions. **C6** slots on carriers and agreements, with `offerId`. **C7** carrier profile. **C8** `defaultTerm`. **C9** underwriter.
- **P6** `pause` and `back` on a market spot. **P17** the members' credit. **P22** sponsor profile. **P23** spot preview (url, still). **P24** `POST /orders/:id/tell-me-when-listed`, `makerToldWhenListed`, `listedRate`.
- **E2** sponsors listed on earnings, `held.tonightBreaks`, `nextPayout.amountMicros`. **E3** per line `group`, `airings`, `rate`, `averageTunedIn`; `paidOn` and `destination` on statements. **U1** `byProgram[]` on the audience.
- **T1** `takedowns[].airings[]`, `term`, `carrierNotice`. **B6** `POST /claims/:id/attachments`. **N10** `GET /claim/:token` with the handover's status. **O1** the `signed_on_off` notification key.

## How the business app carries them (Phase 5)

As in the other apps: optional extensions in `apps/business/src/api/ext/<area>.ts` (money, spots, results, deals, settings), named by request id, returned by the mocks. New here: E7 and P26. Used most: E6 (the basis for "roughly N airings"), P9 (category reach), P10 (address lookup), P12 and B5 (the Redeem tool: today's count, and checking a code without counting it), P13 and P14 (codes and periods in results), P16 (what a business can sponsor: blocks the new-sponsorship page against the real API), P17 to P19 (credit preview, makers, deliveries), P20 (Clear Pay and an online checkout), P21 (close a business), E3 to E5 (statement lines, receipts, funding sources), P11 (the logo, with the logo mark shown until one is uploaded).
