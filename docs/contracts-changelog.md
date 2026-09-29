# Contracts changelog

Changes to `packages/contracts` once the apps prompt has started using it. Add a version or a new field; never change the shape of a published one.

## 2026-09-28: the account's data, pledge cards, notification timing, and the desk's fields (A1, A2, A3, A6, E1, O1, O2, B7, B8, N1 to N7, N9, N12, A125)

All additive: new endpoints, new optional fields, new enum values for notices. Nothing existing changed shape. One `auth` changed from `public` to `optional` (the heartbeat: anyone can still call it).

The account (`api.accounts`):

- A1 `signOutEverywhere` `POST /me/sign-out-everywhere` (user) → `Ok`. Privy's sessions can't be ended from here, so the API records when: every Privy token issued before that second, and every later token of a Privy session (`sid`) it had seen before, answers 401 `signed_out`. TVs signed in to the account are signed out (told `signed_out` on their relay stream) and the phones driving TVs as the person are dropped (`ended` `signed_out`). This device is signed out too: sign out of Privy in the app, then sign in again. A session the API never saw before the sign-out, refreshed afterwards, isn't caught (Privy gives it a new `iat`).
- A2 `getWatchHistory` `GET /me/watch-history` (user, or a TV signed in) → `WatchHistory` `{ keep, lastChannel: { station, at } | null, items: [{ station, startedAt, endedAt }] }`, newest first, 30 days. `clearWatchHistory` `DELETE /me/watch-history` (user, or a TV) → `Ok`. Kept from the heartbeat when it's sent signed in, while `settings.privacy.keepWatchHistory` isn't `false` (unset counts as on, as the viewer's settings show it); setting it to `false` stops keeping it and clears what was kept.
- A2: `audience.heartbeat` is `auth: "optional"` and `tvSession: true` (was `public`). Sent with the person's token (or a TV session), it also feeds their watch history. The tuned-in session stays anonymous: nothing links it to the person, and an anonymous session is never attached later.
- A3 `exportData` `POST /me/export` (user) → `{ email, readyBy }`: emails a link to `${APP_ORIGIN}/settings/data?download=1`; the file is made when the signed-in app calls `downloadData`, so `readyBy` is now. 409 `no_email` without an email. `downloadData` `GET /me/export` (user) → `AccountExport` `{ exportedAt, account { id, displayName, email, market, createdAt, settings }, identities, memberships, presets, reminders, watchHistory, pledges (with receipts), notificationPrefs [{ scope, scopeId, prefs }], notices, tvs, clear }`.
- A3 `deleteAccount` `DELETE /me` (user) → `Ok`, at once (the frames say "This can't be undone", so no grace period). 409 `owns_station` (make someone on the team the owner first) or `owns_business` (a business can't be closed or handed over yet: P21). Presets, reminders, watch history, notification settings, notices, identities, TVs and cast targets go; team places are left; monthly pledges stop after this month (their receipts stay in the ledger); a linked Clear wallet is unlinked. The account row stays as an empty tombstone because the ledger points at it. Tokens from before answer 401 `account_deleted`; signing in with the same Privy account later starts a new, empty account.
- A6 `listOpencastTeam` `GET /admin/team` (admin) → `OpencastTeamMember[]` `{ id, name, email }`: the Opencast admins (`name` is the display name, else the email; `email` is `""` when there's none).
- `401` codes: `signed_out` and `account_deleted` come through as themselves (before, any failed sign-in said `unauthorized`).

Settings (O2): `ViewerSettings.notifications` (optional, `NotificationTiming`, every field optional): `{ emailWhen: "evening_before", leadMinutes: 0 to 1440, quietHours: boolean, quietFrom: "HH:MM", quietTo: "HH:MM" }`. Absent `quietHours` counts as on, 22:00 to 08:00 in the account's market's time (Los Angeles without one): pushes about the person's own viewing (viewer scope) wait for the morning, and the notice still lands in the app. `leadMinutes` sets how early a reminder comes (absent: at the start). `emailWhen` is kept, but reminder emails still go with the reminder: the evening-before email isn't built yet.

Notices (O1): `NoticeKind` gains `preset_live` and `station_news` (viewer; off until turned on), `signed_on_off` (station team; push on) and `spot_added` (business; push on). `signed_on_off` is sent when a station signs on or off, `spot_added` when a station puts a spot in its rotation or backup rotation. Nothing sends `preset_live` or `station_news` yet (there's no live-start event or station news); the settings for them are kept.

Pledges (E1, `api.ledger`):

- `Pledge.card` (optional, nullable): `{ label: "Visa ending 4242", expired, expiresOn? }`, from the provider (Stripe's checkout, or its webhook when the card changes; the fake says Visa ending 4242). Null until the provider says.
- `Pledge.receipts.items` (optional): `[{ id, on, amountMicros, url }]`, one per payment, newest first. `url` is null (no receipt documents yet: Stripe emails its own). `receipts.totalMicros` is now what was really paid (it was the count times the current amount).
- `updatePledge` body `cadence` (optional): a monthly pledge set to `once` isn't charged again (it ends after this month, like `stop`; `cadence` stays `monthly` and `endsAfter` says when); set back to `monthly` before then, it carries on (Stripe's cancellation is undone). A one-time pledge can't become monthly: 422 `new_pledge_needed`; a pledge that has ended: 422 `pledge_ended`.
- `pledgeCardSession` `POST /me/pledges/:pledgeId/card-session` (user), optional body `{ returnTo: "/path" }` → `{ url }`: Stripe Checkout in setup mode; the new card becomes the subscription's default and is reported by webhook. Comes back to `returnTo` (default `/you/pledges/:pledgeId`) with `?card=updated`. 422 `no_card_to_change` for a one-time pledge or one that's ending.
- Behind it, no shape change: a monthly Stripe pledge is now known by its subscription (`sub_…`) once Checkout completes, so stopping it actually cancels it at Stripe (it was the Checkout session's id, which Stripe can't cancel).

The network desk and the permission page (`api.network`):

- N1 `Creator.proposedOptions` (optional, nullable) `{ band, channels[] }` (no channels: the band only). `addCreator` and `updateCreator` accept `proposedOptions`; setting it sets `proposed` to its first channel, and setting `proposed` sets `proposedOptions` to that one channel.
- N2 `remindCreator` `POST /admin/creators/:creatorId/reminders` (admin) → 201 `Creator`: the one reminder, emailed with the same link. `remindedAt` is set; next action No answer, due in 7 days. 422 `not_asked` unless they're Asked, 422 `reminded` after the one. Asking again clears `remindedAt`.
- N3 `Creator.askedAt`, `remindedAt`, `answeredAt`, `claimInviteSentAt`, `claimLinkSentAt`, `claimedAt` (all optional, nullable). `sendClaimInvite` `POST /admin/creators/:creatorId/claim-invites` (admin), body `{ kind: "invite" | "link" }` → 201 `Creator`: emails the creator (the link is their permission page, where Claim is), and held earnings then say `invited` or `claim_link_sent`. 422 `no_station`, `no_contact`.
- N4 `PermissionPage.creator.sourcePlatform`, `works[].groupLabel`, `works[].noun`, `marketName` (optional). `summary` is null: the app words it from the works, as it does today. `CreatorWork.noun` (optional), accepted by `addWorks`. `answerPermission` body `wordingVersion` (optional, up to 40 characters) is recorded with the answer. A copy of the answer is emailed to the contact email by default (as before).
- N5 `Creator.setup` (optional, nullable) `CreatorSetup` `{ recipeId, band, channel, callSign, name, colour, operator: { id, name } | null, signOnAt, importDone, importTotal, escrowStationId }`, once the station is set up (null for stations set up before this change, whose recipe wasn't kept). Drafts before the yes stay on the device.
- N6 `Recipe.blocks[].label`, `listing`, `colour`, `carried: { station, programTitle, schedule, about }`, and `Recipe.when`, `Recipe.catalogAbout` (all optional), kept by `saveRecipe`. `RecipeBreakRule` is the typed reading of `breakRule` (`{ everyMinutes, lengthMs, fillFrom: "market" | "house", blockedCategories }`, other keys kept); `Recipe.breakRule` keeps its record type, and `saveRecipe` refuses a rule whose four keys have the wrong type (400).
- N7 `MarketBoard.slots[].signOnAt` and `creatorId` (optional, nullable), and `MarketBoard.stats.market` (optional) `{ localShareOfTonightPercent, claimableOnAir, deadAirComing }` for both bands together.
- N9 `HeldEarnings.unclaimedPeriodDays` (optional; the revenue config's, default 1095), `chain` (optional, nullable: `{ name, explorerUrl }` for Ethereum, Sepolia, Base and Base Sepolia; null without a chain or on a local one), and per station `invitedAt`, `claimLinkSentAt`, `signOnAt`, `licenceName` ("CC BY 4.0", from the licence and its link). `Creator.licenceName` (optional) too.
- N12 `Creator.pronoun` (optional: absent means "their"), accepted by `addCreator` and `updateCreator` (null clears it).
- A125 `HeldEarnings.stations[].creatorId` and `creatorName` (the creator's own name, "Crate") (optional), and `HeldEarnings.stationsHoldingMoney` (optional): rows holding any money, counted from the same rows, for "Held across 2 stations". `creator` is unchanged: the person's name when known, else the creator's, as the frame draws it ("for Marcus Reyes", "for Mojave Field Recordings"). `rightsBasis` now says `licence` for a set-up station whose works are licensed and never had a yes (it said `permission` once the stage moved on).
- B7 `askPermission` body `workIds` (optional, at least one): only these works are covered by a yes. The others are left out, keeping their reason or getting "Left out when asking"; ticking a left-out work brings it back in. 400 if one isn't the creator's. The page, the schedule preview and the yes use exactly that list. (No dry run: the desk previews on its side.)
- B8 `stopFromLink` `POST /permission/:token/stop` (public) → `PermissionPage`: after a yes, any time. Nothing the yes covered is covered any more, the creator is not asked again (`declined`, `doNotAsk`), a claim not yet approved is cancelled, and a station set up from it signs off for good (its scheduled sign-on is cancelled) with a stop handover for the desk to check, so its held money goes to the creator by the escrow's stop path once they're verified. Admins get a notice. 422 `nothing_to_stop` without a yes; stopping again is the same page.
- B8 `claimFromLink` `POST /permission/:token/claim` (user) → `PermissionPage`, before or after the station exists. Before, the claim waits (a handover with no station) and joins the station when the desk sets it up; `approveHandover` answers 422 `no_station` until then. 422 `nothing_to_claim` (no yes, stopped, or already claimed), `in_progress`.
- B8 `PermissionPage.stoppedAt` and `claim` `{ handoverId, status, startedAt }` (optional, nullable): the latest claim from the link or on the station.

## 2026-09-28: TVs, sign-in by code, the phone remote's relay, the market from where you are (B2, S10, A7, S13)

All additive; nothing existing changed shape. New file `tv.ts` (`api.tv`); two endpoints in `api.stations`.

Core:

- `Auth` gains `"device"`: a TV app, with its `deviceToken` or its TV session token as `Authorization: Bearer`.
- `EndpointDef.tvSession` (optional): the endpoint also accepts a TV session token as `user`, acting as the person who approved the TV (never as an admin). Set on `accounts.getMe`, `updateMe`, `mergeDevice`, `listPresets`, `savePreset`, `reorderPresets`, `removePreset`, `suggestPresetKey`, `usePresetKey`, `listReminders`, `addReminder`, `updateReminder`, `removeReminder`, and `ledger.listMyPledges`. Any other `user` or `admin` endpoint answers a TV session 403 `tv_not_allowed`; a signed-out TV session answers 401 `tv_signed_out`.
- `EndpointDef.events` (optional): the endpoint is a Server-Sent Events stream; each key is an event name and its schema is the event's `data` (JSON). `response` describes them as `{ event, data }`. A `: ping` comment comes every 25 s. EventSource can't send `Authorization`: read streams with `fetch` and a reader (or an EventSource that takes headers).

TVs and sign-in by code (B2), `api.tv`:

- `registerTv` `POST /tv/devices` (public), body `{ platform: "android_tv" | "fire_tv" | "google_tv" | "tv_browser" | "web", name? }` → 201 `RegisteredTv` `{ tvId, deviceToken }`. Keep the token; it's shown once.
- `createTvCode` `POST /tv/codes` (device) → 201 `TvCode` `{ code, qrUrl, enterAt, expiresAt, pollToken, pollSeconds }`. `code` is 6 characters with no 0, O, 1 or I ("K7Q4MP"; show it as "K7Q 4MP"), 10 minutes; `qrUrl` is `${APP_ORIGIN}/tv?code=K7Q4MP`; `enterAt` is the viewer's host + `/tv`; `pollSeconds` is 3. A new code replaces the TV's earlier ones.
- `pollTvCode` `GET /tv/codes/:pollToken` (public) → `TvCodeStatus`: `{ status: "pending" }`, `{ status: "approved", token, signedInAs }` (the TV session, handed over once; the next poll says expired) or `{ status: "expired" }`. Unknown poll token: 404.
- `approveTvCode` `POST /tv/codes/:code/approve` (user) → `Tv`. The code may have spaces or be lower case. 404 `code_not_found` (wrong or run out), 409 `code_used`, 429 `too_many_tries` (10 wrong codes in 15 minutes per person). Signing a TV in again replaces its session.
- `signOutThisTv` `DELETE /tv/session` (device) → `Ok`. The mock declared it `user`; the TV session token still works here, and so does the device token.
- `listTvs` `GET /me/tvs` (user) → `Tv[]`; `signOutTv` `DELETE /me/tvs/:tvId` (user) → `Tv[]` (ends a TV's session remotely, or forgets a cast target; 404 otherwise); `recordCastTarget` `POST /me/tvs/cast-targets` (user), body `{ kind: "chromecast" | "airplay", name }` → 201 `Tv` (the same name again, any case, is the same target, marked used).
- `Tv`: `{ id, name, kind: "tv_app" | "chromecast" | "airplay", platform: TvPlatform | null, signedIn, lastUsedAt, online, castingNow }`. `online`: the TV app's relay stream is open (10 s grace after it closes). `castingNow`: a phone on this account is connected to its remote. Both false for cast targets. `platform` is the enum value (the apps label it "Fire TV"); `name` defaults to the platform's name.

The remote relay, `api.tv` (the Cast receiver's command and state messages):

- `RemoteCommand`: a discriminated union on `type`, the shapes `parseCastCommand` accepts, without `from`: `channel {dir}`, `digit {digit 0-9}`, `dot`, `tune {channel "12.1"}`, `preset {key 1-6}`, `savePreset {key 1-6}`, `last`, `info`, `guide`, `presets`, `menu`, `back`, `select`, `focus {dir}`, `pause`, `play`, `togglePlay`, `backToLive`, `sleep {until: minutes 1-240 | "end_of_program" | null}`.
- `RemoteState`: `{ stationId, paused, changedBy, sleepEndsAt }` (ms since the epoch). `RemotePhone`: `{ id, name, kind: "account" | "guest", connected, pairedAt, lastCommandAt }`.
- The TV (device): `tvRemoteEvents` `GET /tv/remote/events` (SSE: `command` `{ command, from: { phoneId, name }, at }`, `phones` `{ phones: RemotePhone[] }` (also first thing on open), `signed_out` `{}` when the account signs it out); `postRemoteState` `POST /tv/remote/state` body `RemoteState` → `Ok`; `endRemote` `POST /tv/remote/end` → `Ok` (phones get `ended` `tv_ended`); `createPairCode` `POST /tv/remote/pair-code` → 201 `{ code: "4821", expiresAt }` (5 minutes, a new one replaces the last); `listRemotePhones` `GET /tv/remote/phones`; `removeRemotePhone` `DELETE /tv/remote/phones/:phoneId` → `RemotePhone[]`.
- A phone: `pairPhone` `POST /tv/remote/pair` (optional auth), body `{ code, name }` → 201 `{ tvId, tvName, phoneToken }` (404 `code_not_found`; 429 `too_many_tries` after 10 wrong in 10 minutes, per account or per connection); `phoneRemoteEvents` `GET /tv/remote/:tvId/events` (SSE: `state` (also on open, if the TV has said), `ended` `{ reason: "tv_ended" | "unpaired" | "signed_out" }`, then the stream closes); `sendRemoteCommand` `POST /tv/remote/:tvId/commands` body `{ command, name }` → 202 `Ok` (409 `tv_not_connected` when the TV's stream isn't open). The caller is a phone signed in to the TV's account (its Privy token) or a guest phone (its `phoneToken`); anyone else 403 `not_paired`, an unknown TV 404.
- Who may change the channel stays the TV's decision (`anyone` or only the phone that started), as on Cast: the relay only says who sent each command.

The market from where you are (S10), `api.stations`:

- `MarketLookup` `{ market: Market | null, nearby: Array<{ market, miles: number | null }> }`. `miles` is null when where the person is isn't known. (The TV mock's `MarketByConnection` had `miles: number`.)
- `marketForConnection` `GET /markets/by-connection` (public): from the request's address, never stored or logged. A lookup giving a ZIP uses the ZIP's market (nearby with miles from its centre); one giving coordinates works as by-location. No lookup configured (`GEOIP_URL`), a private address or no answer: `{ market: null, nearby: <open markets, miles null> }`.
- `marketForLocation` `GET /markets/by-location?lat=&lng=` (public): the nearest market within 50 miles of its centre (open or not), and the others within 60 miles with miles from the point, nearest first; nothing that close: `market` null and the open markets by distance.

Settings (A7): `ViewerSettings.tv` (optional, `TvSettings`, every field optional): `{ channelUp: "up_the_dial" | "down_the_dial", bannerSeconds: 3 | 5 | 8, numberWaitSeconds: 1 | 1.5 | 2 | 3, includeRadioBand, quality: "auto" | "data_saver" | "best", eveningOut }`. It was kept already (the top level is loose); now a value outside these is refused (400). `updateMe` replaces the whole `tv` section, as with every section.

Stand by (S13): `DialRow.signal` (optional): `"standby"` while a live block is on the stand-by slate waiting for its signal, `"ok"` otherwise, absent when the station isn't on air and for listed city streams.

Audience: `Platform` gains `"mirror"` (TV mode on the iPhone's second screen), accepted by `heartbeat`. `AudienceReport.byPlatform.mirror` (optional in the schema, always sent now).

## 2026-09-28: Clear as a Privy global wallet, and ads from partners (new fields and endpoints)

All additive; nothing existing changed shape.

- `Me.clear` (optional, nullable): the Clear account linked through Privy's cross-app linking, `{ address, access: "read_only" | "full", linkedAt }`. `accounts.linkClear` (`POST /me/clear`) records it after the app links it with Privy; `accounts.unlinkClear` (`DELETE /me/clear`) forgets it.
- `ledger.quoteClearTransfer` (`POST /businesses/:businessId/deposits/clear-transfer/quote`) and `ledger.confirmClearTransfer` (`POST /businesses/:businessId/deposits/clear-transfer`): funding a business from a linked Clear wallet with full access. The person confirms the transfer on Clear's page; the API checks it on chain before crediting.
- `ledger.getPayoutAccount` gains `destination` (optional); `ledger.setPayoutDestination` (`PUT /stations/:stationId/payout-account`) pays a station out to the owner's linked Clear wallet.
- `StationEarnings.lines.partnerAds` (optional): `{ on, micros, pendingMicros }`, "Ads from partners, paid when received".
- `BreakRule.adsFromPartners` (optional boolean, off by default): the station's switch. Only a flag until partner ads are built.
- `StationSetup.iabCategories` and `Program.iabCategories` (optional): IAB Content Taxonomy 3.0 ids. `Program.rating` (optional, `ContentRating`: TV-Y to TV-MA) and `Program.childDirected` (optional boolean), also accepted by `createProgram` and `updateProgram`.
- `updateSetup` and `updateProgram` accept `iabCategories` (optional; 1 to 10 IAB ids, or null to go back to the ones derived from the category), so the overrides can be set. Derived: the program's category, else its station's, else Entertainment (`JLBCU7`); the mapping is `packages/domain/src/ads.ts`.
- `createProgram` with a children's rating (TV-Y, TV-Y7) and no `childDirected` makes it child-directed; so does `updateProgram` setting one.

How the backend answers (no shape changes):

- `addFundingSource` with `{ kind: "clear_account", token: "linked" }` adds the caller's linked Clear wallet (owner only), labelled "Clear wallet 0x1234…abcd". Withdrawals can go to it; `addMoney` from it answers 409 `clear_transfer_needed` (money from a Clear wallet comes in by the transfer flow). It drops out of `fundingSources` once the wallet is unlinked.
- Errors, all `{ error: { code, message } }`: 409 `clear_not_linked` ("Clear isn't linked yet." from `linkClear`; "Clear isn't linked yet. Connect Clear first." elsewhere), 409 `clear_not_configured` (the server has no Clear provider app ID or Privy secret), 502 `privy_unavailable`, 409 `clear_read_only` (quote with a read-only link), 409 `clear_unavailable` (no Clear on this server, or no USDC configured), 409 `transfer_already_used` (the transaction was recorded for another business or amount), 422 `transfer_not_valid` (it didn't send at least the amount from the linked wallet to the business's account), 409 `clear_unlinked` (a withdrawal or payout to a wallet that's no longer linked), 422 `not_cancellable` (cancelling a transfer from Clear).
- `confirmClearTransfer` is idempotent on the transaction hash: the same hash again returns the same `depositId`. `status` is `pending` until the chain confirms it (the jobs tick checks again each minute).
- `getPayoutAccount.destination`: `{ kind: "clear_account", label: "The station's Clear account" }`, `{ kind: "stripe_connect", label: "Stripe" }`, or `{ kind: "clear_wallet", label: "Clear wallet 0x1234…abcd", address }`. A Clear wallet that's unlinked, or whose person no longer owns the station, shows `status: "needs_onboarding"` and payouts wait. `StationEarnings.nextPayout.destination` uses the same label.

## 2026-09-28: claims on-chain

`POST /v1/admin/handovers/:handoverId/approve` now records the desk's check of the claimant. When the escrow contract is live it also returns `onChain`: `{ contract, escrowStationId, payee, kind, calldata }`, which is what each verifier signs from their own wallet. The chain starts the 72 hours, and the claim's state follows the chain. `payableAfter` is the earliest it could be paid.

## 2026-09-28: the station's payout account

- `GET /v1/stations/:stationId/payout-account` (owner only): `{ status: "active" | "needs_onboarding", url }`. Where the station is paid (its Clear account, or Stripe Connect Express in the Stripe-only setup). When `needs_onboarding`, send the owner to `url` to finish it.
- Adding money by card may now answer `status: "pending"` while Stripe confirms; the balance updates when it arrives. Pledges return a Stripe Checkout `checkoutUrl` when real payments are on.

## 2026-09-28: storage by content ID (new fields and one endpoint)

- `LibraryItem.storage` (optional, nullable): `{ contentId, bytes, sharedWith, locked, ipfs }`. `sharedWith` counts other items pointing at the same file; `locked` means a rights claim is open against it; `ipfs` is set once it's been published (catalog or Export to IPFS).
- `POST /v1/library/:itemId/export-ipfs` (owner only). Body `{ understandPublicAndPermanent: true }`: the app shows the warning that IPFS files are public and can't be taken back, and sends this only after the owner accepts it. Answers `{ contentId, ipfsCid, url }`. Refused (422) for link imports and creator works.
- `previewUrl` (optional, nullable) on an offer's `episodes[]`, on `Spot.file`, and on `ProductionOrder.deliveries[]`: a low-bitrate HLS preview, there while the item is offered, the spot is in review, or the order is open.
- `NoticeKind` gains `file_not_ready`: a file due within the hour isn't on the playout server yet, or one was missing at air.
- `url` on spot files, order briefs and deliveries is now a storage URL (presigned or the bucket's public domain), not a server path.

## 2026-09-27: added `orders` to station setup

`StationSetup.orders` (`takesOrders`, `turnaround`, `fromMicros`) and the same, optional, on `updateSetup`. A station that takes orders appears in `listMakers`.

## 2026-09-27: added `ledger.addFundingSource`

`POST /v1/businesses/:businessId/funding-sources` links a bank (Clear), a card (Stripe) or a Clear business account. Missing from the first publish; nothing else changed.

## 2026-09-27: v1 published

Every endpoint the designs need, under `/v1`, in thirteen modules: accounts, stations, library, log, playout, catalog, spots, ledger, audience, trust, notifications, waitlist, network.

- Each `*Api` object maps names to `endpoint({ method, path, auth, params, query, body, response })`. `api` in `index.ts` holds them all; `buildPath` fills a path.
- `auth` is `public`, `optional`, `user` (a Privy access token, as `Authorization: Bearer` or the `privy-token` cookie) or `admin`.
- Errors are always `{ error: { code, message, fields? } }` (`ErrorResponse`).
- Money is integer micro-dollars (`*Micros`); durations are milliseconds (`*Ms`); times are ISO 8601 with offset.
- `states.ts` holds the states both sides of a transaction see, with each side's display strings (spot, sponsorship, production order, carriage request, rights claim, creator stage). Use it on both sides.
- Responses are validated against the contract by the API, so a field that isn't in the contract never arrives.

The accounts module is implemented; the others land module by module. Until then an endpoint answers 404, so build against mocks.
