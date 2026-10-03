# API

Generated from `packages/contracts` by `npm run docs:api`. Every path is under `/v1`. Request and response shapes are the Zod schemas in the contracts.

357 endpoints in 23 modules.

## accounts (35)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getMe` | GET | `/me` | signed in, or a TV signed in | The signed-in person, their identities, stations and businesses |
| `linkClear` | POST | `/me/clear` | signed in | After the app links Clear with Privy's cross-app linking, record it: the API reads the person's Clear cross-app account from Privy and stores its address and access. 409 if Privy has no Clear account linked. |
| `unlinkClear` | DELETE | `/me/clear` | signed in | Forget the linked Clear account (the app also unlinks it in Privy). Funding sources and payout destinations that used it stop working. |
| `updateMe` | PATCH | `/me` | signed in, or a TV signed in | Change display name, market or settings |
| `mergeDevice` | POST | `/me/merge-device` | signed in, or a TV signed in | Keep presets and reminders saved on this device before signing in |
| `listPresets` | GET | `/me/presets` | signed in, or a TV signed in | Presets in order |
| `savePreset` | POST | `/me/presets` | signed in, or a TV signed in | Save a station. With a key that's taken, the old station moves to More presets (never deleted). With no key, it goes to More presets. |
| `reorderPresets` | PUT | `/me/presets` | signed in, or a TV signed in | Set the whole order and keys at once (drag to reorder) |
| `removePreset` | DELETE | `/me/presets/:stationId` | signed in, or a TV signed in | Remove a preset |
| `suggestPresetKey` | GET | `/me/presets/suggested-key` | signed in, or a TV signed in | The key to suggest replacing when all six are full: the one used least in the last month |
| `usePresetKey` | POST | `/me/presets/keys/:key/use` | signed in, or a TV signed in | Count a press of a preset key |
| `listReminders` | GET | `/me/reminders` | signed in, or a TV signed in | Upcoming reminders |
| `addReminder` | POST | `/me/reminders` | signed in, or a TV signed in | Remind me of an airing. Switch me over is off unless asked for. |
| `updateReminder` | PATCH | `/me/reminders/:reminderId` | signed in, or a TV signed in | Turn switch me over on or off |
| `removeReminder` | DELETE | `/me/reminders/:reminderId` | signed in, or a TV signed in | Remove a reminder |
| `getStationTeam` | GET | `/stations/:stationId/team` | signed in | Members and invites (owner and operator) |
| `inviteToStation` | POST | `/stations/:stationId/team/invites` | signed in | Invite by email or phone as operator or host (owner only). Expires after a week. |
| `updateStationMember` | PATCH | `/stations/:stationId/team/:userId` | signed in | Change a member's role or note (owner only). Ownership moves with transferOwnership. |
| `removeStationMember` | DELETE | `/stations/:stationId/team/:userId` | signed in | Remove a member (owner only) |
| `transferStationOwnership` | POST | `/stations/:stationId/team/transfer` | signed in | Make an existing member the owner; the old owner becomes an operator |
| `getBusinessTeam` | GET | `/businesses/:businessId/team` | signed in | Members and invites |
| `inviteToBusiness` | POST | `/businesses/:businessId/team/invites` | signed in | Invite a manager or viewer (owner only). An agency is a manager with a note. |
| `updateBusinessMember` | PATCH | `/businesses/:businessId/team/:userId` | signed in | Change a member's role or note (owner only) |
| `removeBusinessMember` | DELETE | `/businesses/:businessId/team/:userId` | signed in | Remove a member (owner only) |
| `getInvite` | GET | `/invites/:inviteId` | anyone (personal if signed in) | Added 2026-09-29: an invite as its link's page shows it: the team, the role, the invited address masked, and whether it's open, expired or accepted. Signed in, it also says whether the account has the invited email. 404 for an unknown invite. |
| `resendInvite` | POST | `/invites/:inviteId/resend` | signed in | Send an invite's email again and extend it a week (owner only). Changed 2026-09-29: it emails again. 429 `resend_too_soon` within 10 minutes of the last send; 409 `invite_used` once accepted; 502 `email_not_sent` when the email couldn't go (nothing changes). |
| `acceptInvite` | POST | `/invites/:inviteId/accept` | signed in | Join the team the invite is for. Changed 2026-09-29: an invite to an email needs that email on the signed-in account (403 `invite_email_mismatch`; INVITE_EMAIL_MATCH=off turns the check off). 409 `invite_used` when someone else accepted it (accepting your own again changes nothing); 422 `invite_expired`. |
| `signOutEverywhere` | POST | `/me/sign-out-everywhere` | signed in | A1: sign out every phone, computer and TV. Every Privy token issued before now, and every later token of a session seen before now, answers 401 `signed_out`; TVs signed in to the account are signed out and their phones dropped. This device signs out too. |
| `getWatchHistory` | GET | `/me/watch-history` | signed in, or a TV signed in | A2: the last channel and the last 30 days of watching (empty while keepWatchHistory is off) |
| `clearWatchHistory` | DELETE | `/me/watch-history` | signed in, or a TV signed in | A2: clear watch history and the last channel |
| `exportData` | POST | `/me/export` | signed in | A3: email a link to download everything the account holds (the link opens the app, which calls downloadData). 409 `no_email` without an email. |
| `downloadData` | GET | `/me/export` | signed in | A3: everything the account holds, as JSON (save it as a file) |
| `deleteAccount` | DELETE | `/me` | signed in | A3: delete the account now (no grace period). Presets, reminders, watch history, notices and TVs go; pledges stop after this month; team places are left. 409 `owns_station` or `owns_business` while the person owns one: hand it over (or close it) first. |
| `listOpencastTeam` | GET | `/admin/team` | Opencast admin | A6: the Opencast team (admins), who can run a claimable station |
| `myStationStatus` | GET | `/me/stations/status` | signed in | A5: each station you're on: on air, and the next dead air within six hours, in the order of your memberships |

## stations (32)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listMarkets` | GET | `/markets` | anyone | Every market |
| `marketForZip` | GET | `/markets/by-zip/:zip` | anyone | Your ZIP decides your market. Location isn't stored. |
| `marketForConnection` | GET | `/markets/by-connection` | anyone | The market for the request's internet address, which isn't stored or logged. With no lookup configured, or a private address, `market` is null and `nearby` is the open markets (miles null). |
| `marketForLocation` | GET | `/markets/by-location` | anyone | The market for a point (the device's location), which isn't stored: the nearest market within 50 miles of its centre, and others within 60 miles, nearest first. Nothing that close: `market` null and the open markets by distance. |
| `getDial` | GET | `/markets/:marketSlug/dial` | anyone | The dial for a market in channel order, with now and next per station |
| `getGuide` | GET | `/markets/:marketSlug/guide` | anyone | The guide for a market and time window (at most 24 hours) |
| `getStation` | GET | `/stations/:stationRef` | anyone | A station page, by id or call sign. Added 2026-09-30 (A229): or by its address (`StationIdent.slug`): `rivc-15-2` for a station sharing X.1's call sign (the call sign alone is X.1's); a call sign that changed still finds its station through the year it's held |
| `search` | GET | `/search` | anyone | Search by call sign, channel number and title. A number returns a station to tune to. |
| `createStation` | POST | `/stations` | signed in | Start a station (or a studio). Nothing is public until it signs on. The creator becomes the owner. Changed 2026-09-29: `reservationId` starts it from a waitlist invite, with the call sign and channel held. |
| `getSetup` | GET | `/stations/:stationId/setup` | signed in | Identity and settings, for master control |
| `updateSetup` | PATCH | `/stations/:stationId/setup` | signed in | Change name, description, colour (4.5:1 on white), bug, logo, legal details (owner) |
| `availableChannels` | GET | `/markets/:marketSlug/channels` | signed in | Which main channels are open in a market and band (setup step A1) |
| `chooseChannel` | PUT | `/stations/:stationId/channel` | signed in | Choose market, band and channel before first sign-on. A station gets X.1. Changed 2026-09-29: choosing another than the channel held with its waitlist call sign lets the held one go. Added 2026-09-30 (A229, rule `numbering.own_subchannels`): an owner's own subchannel X.n beside a station they own on X.1 in the same market (409 `not_your_subchannel` otherwise), sharing X.1's call sign with `shareCallSign` (the station then has X.1's call sign; its own, if it had one, is let go). A station sharing a call sign that moves elsewhere, or takes its own call sign (`updateSetup`), stops sharing. X.1 can't move while stations share its call sign (409 `family_channel`). |
| `getBreakRule` | GET | `/stations/:stationId/break-rule` | signed in | The station's break rule and blocked categories |
| `setBreakRule` | PUT | `/stations/:stationId/break-rule` | signed in | Set the break rule (owner, operator) |
| `listTranslators` | GET | `/stations/:stationId/translators` | signed in | Relays to YouTube, Twitch and any RTMP address |
| `addTranslator` | POST | `/stations/:stationId/translators` | signed in | Add a relay |
| `updateTranslator` | PATCH | `/stations/:stationId/translators/:translatorId` | signed in | Change a relay, including its break handling |
| `removeTranslator` | DELETE | `/stations/:stationId/translators/:translatorId` | signed in | Remove a relay |
| `getRelayBackground` | GET | `/stations/:stationId/relay-background` | signed in | The picture a radio station's translators air under its sound (owner, operator). Null: the generated picture in the station's colour |
| `setRelayBackground` | PUT | `/stations/:stationId/relay-background` | signed in | Upload or replace a radio station's relay background (owner, operator): a PNG, JPEG or WebP image, a GIF, or an MP4, MOV or WebM video up to 30 seconds (its sound is dropped), up to 100 MB. Prepared once into a loop at the relay's size (`status` `preparing`, then `ready`); relays that are on pick it up once it's ready. 409 `not_radio` (a TV station relays its own picture); 422 `wrong_file_type`, `too_big`, `too_long`, `unreadable_file`. |
| `removeRelayBackground` | DELETE | `/stations/:stationId/relay-background` | signed in | Remove the relay background (owner, operator); relays go back to the picture in the station's colour |
| `listLiveSources` | GET | `/stations/:stationId/live-sources` | signed in | Encoders and browser sources |
| `addLiveSource` | POST | `/stations/:stationId/live-sources` | signed in | Add an encoder or browser source; an encoder's key is returned once |
| `resetLiveSourceKey` | POST | `/stations/:stationId/live-sources/:sourceId/reset-key` | signed in | Reset an encoder's key; the old key stops working |
| `removeLiveSource` | DELETE | `/stations/:stationId/live-sources/:sourceId` | signed in | Remove a live source |
| `setHosts` | PUT | `/stations/:stationId/programs/:programId/hosts` | signed in | Who can go live on a live program (hosts see only their blocks) |
| `getSpeakers` | GET | `/programs/:programId/speakers` | signed in | The lower-thirds speaker list for a live program |
| `setSpeakers` | PUT | `/programs/:programId/speakers` | signed in | Replace the speaker list |
| `listHosts` | GET | `/stations/:stationId/hosts` | signed in | A4: every live program and who hosts it (owner, operator; a host gets only their own programs) |
| `getLowerThird` | GET | `/stations/:stationId/log/:entryId/lower-third` | signed in | S15: the lower third on a live block (owner, operator, its host). Before anyone sets it: the first speaker, showing. |
| `setLowerThird` | PUT | `/stations/:stationId/log/:entryId/lower-third` | signed in | S15: show a speaker (their name and title are taken from the list), free text, or hide it (owner, operator, its host). 409 `not_live`. |

## library (21)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getLibrary` | GET | `/stations/:stationId/library` | signed in | Every item with its type, rights and status; folders; programs |
| `upload` | POST | `/stations/:stationId/library/uploads` | signed in | Upload a file (MP4, MOV, MP3, WAV…). It's prepared for air in the background. Under a minute is guessed as BMP. An off-air card (`code` OFF, A242) can also be a picture (PNG, JPEG or WebP). |
| `importLinks` | POST | `/stations/:stationId/library/imports` | signed in | Import from links. Link imports stay on this station and come off air the same day if the owner asks. |
| `getImport` | GET | `/stations/:stationId/library/imports/:jobId` | signed in | Progress of a link import |
| `getItem` | GET | `/library/:itemId` | signed in | One item |
| `updateItem` | PATCH | `/library/:itemId` | signed in | Change title, type, program, folder, episode details or break points. A242: made an opener, closer or off-air card (`OPN`, `CLS`, `OFF`) while it's on the log, 409 `on_the_log`; an off-air card that's a picture can't become another type, 422 `still_image`. A243: `bumperRole` on anything but a bumper, or `airs` on anything but a bumper, station ID, opener or closer, 400. |
| `deleteItem` | DELETE | `/library/:itemId` | signed in | Delete an item. Refused while it's in the log or carried by other stations. |
| `exportToIpfs` | POST | `/library/:itemId/export-ipfs` | signed in | Export the station's own original to IPFS (owner only). IPFS files are public and can't be taken back. |
| `confirmRights` | POST | `/library/:itemId/rights` | signed in | Confirm the rights to air it. Needed before it can go on the log. |
| `createFolder` | POST | `/stations/:stationId/library/folders` | signed in | Make a folder |
| `updateFolder` | PATCH | `/library/folders/:folderId` | signed in | Rename or move a folder |
| `deleteFolder` | DELETE | `/library/folders/:folderId` | signed in | Delete a folder; its items move out of it |
| `createProgram` | POST | `/stations/:stationId/programs` | signed in | Make a program (a series) for listings, sponsorship and carriage |
| `updateProgram` | PATCH | `/programs/:programId` | signed in | Change a program's listing |
| `getProgram` | GET | `/programs/:programId` | anyone | A program page: listing, episodes, upcoming airings |
| `getItemHistory` | GET | `/library/:itemId/history` | signed in | L5: where an item is scheduled and where it aired (carriers too), usage and readiness (owner, operator) |
| `replaceFile` | POST | `/library/:itemId/file` | signed in | L6: replace the file (owner, operator). The item keeps its id, rights, history and schedule; the new file goes through the same checks and preparation as an upload, and the old one airs until it's ready. 422 `unreadable_file`, `wrong_kind` (audio for video or the other way), `too_long_for_log` (longer than a slot it's in); 409 `claim_open`, `not_an_upload`. |
| `updateProgramCaptions` | PATCH | `/programs/:programId/captions` | signed in | L7: how a program is captioned, and in what language (owner, operator) |
| `getCaptionTrack` | GET | `/library/:itemId/captions` | signed in | L7: the item's caption track, to edit (owner, operator). 404 when it has none. |
| `putCaptionTrack` | PUT | `/library/:itemId/captions` | signed in | L7: upload or edit the caption track (owner, operator): WebVTT, or SRT (turned into WebVTT), up to 1 MB. The item's captions become `uploaded`. 422 `not_captions` when it isn't either. |
| `removeCaptionTrack` | DELETE | `/library/:itemId/captions` | signed in | L7: remove the caption track (owner, operator); the item's captions go back to none |

## log (21)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getLog` | GET | `/stations/:stationId/log` | signed in | The program log for a window (day, evening or week), with generated breaks and dead air, and (G11) the day template that made each broadcast day in it |
| `addEntry` | POST | `/stations/:stationId/log` | signed in | Put something on the log. Items need confirmed rights; another station's program needs a carriage agreement. |
| `updateEntry` | PATCH | `/stations/:stationId/log/:entryId` | signed in | Move or change an entry |
| `removeEntry` | DELETE | `/stations/:stationId/log/:entryId` | signed in | Take an entry off the log |
| `repeatDay` | POST | `/stations/:stationId/log/repeat` | signed in | Build one day and repeat it: every day, every week on that day, or once. Since 2026-09-29 this makes a day template (see `createTemplate`, which also does weekdays) running until `until`: dates are generated three weeks ahead, the rest as they come. |
| `fillGap` | POST | `/stations/:stationId/log/fill` | signed in | Fill a gap: repeat from the library (in order, with the break rule), or sign off until a time |
| `getDeadAir` | GET | `/stations/:stationId/dead-air` | signed in | Gaps in the next 24 hours and warnings sent |
| `listTemplates` | GET | `/stations/:stationId/log/templates` | signed in | Day templates still repeating (owner, operator) |
| `getTemplate` | GET | `/stations/:stationId/log/templates/:templateId` | signed in | One day template, with the dates generated from it (owner, operator) |
| `createTemplate` | POST | `/stations/:stationId/log/templates` | signed in | Repeat this day: make a day template from `fromDay`'s log, its broadcast day from 6:00 am to 6:00 am, and generate the dates it covers (owner, operator). `weekly` repeats on `fromDay`'s weekday unless `weekday` says otherwise; `once` needs `onto`. Entries that overlap something already on a date are skipped there. |
| `updateTemplate` | PATCH | `/stations/:stationId/log/templates/:templateId` | signed in | Change a day template (owner, operator): its entries (`entries` replaces them; `fromDay` takes them from that day's log again), when it repeats, or its name. Every future date made from it that nobody edited is made again; edited dates stay as they are. |
| `removeTemplate` | DELETE | `/stations/:stationId/log/templates/:templateId` | signed in | Stop repeating a day template (owner, operator): the same as `removeRepeat`. Its entries come off the dates ahead that weren't edited, which another template may take; edited dates stay as they are. |
| `getOffAirHours` | GET | `/stations/:stationId/off-air-hours` | signed in | The station's off air hours, in its market's time zone (owner, operator) |
| `setOffAirHours` | PUT | `/stations/:stationId/off-air-hours` | signed in | Set the off air hours (owner, operator): replaces every rule; an empty list means none. A program or live block on the log inside them still airs (the hours cover what's otherwise empty). 400 when a rule signs off and back at the same time. |
| `removeRepeat` | DELETE | `/stations/:stationId/log/repeats/:repeatId` | signed in | G7: take a repeat's entries off the log from now on (owner, operator). What already aired stays in the as-run log. |
| `endEarly` | POST | `/stations/:stationId/log/:entryId/end-early` | signed in | G3: end a live block now (owner, operator, or its host). The block ends here, the programs after it move up, and playout hands back to the log at once; the as-run log records the live airing to this moment. Only while it's on air: 409 `not_on_air`, `ended`; 409 `not_live` for anything else. |
| `getLiveBlock` | GET | `/stations/:stationId/log/:entryId/live` | signed in | G3: a live block's state: ended early or not, and whether its signal is in (owner, operator, its host) |
| `listListings` | GET | `/stations/:stationId/listings` | signed in | G5: every program and live airing in a window (at most 8 days) with its listing and status (owner, operator) |
| `updateListing` | PATCH | `/stations/:stationId/listings/:entryId` | signed in | G5: an airing's episode title and description, or a carried program's local note (owner, operator). A carried program's title and description are the maker's: 409 `from_the_maker`. |
| `applyLogChanges` | POST | `/stations/:stationId/log/changes` | signed in | Edit mode (owner, operator): check a batch of changes together (`dryRun`) or publish them all at once, in one transaction: moves, replacing an item, a new end, removals and inserts, with the same rules as `addEntry`, `updateEntry` and `removeEntry`. A problem refuses the whole batch (422 `log_changes_refused`, nothing applied); a dry run answers them instead. `base` is the window and version the draft began from: 409 `log_changed` if the log changed there since. On air, the entry airing now and anything starting within `LOG_EDIT_LEAD_MS` is locked. Publishing tells an on-air station to read its log again (once), marks template dates edited, moves spots held in a break that goes to the next break, and records the batch in the log's history. |
| `listLogChanges` | GET | `/stations/:stationId/log/changes` | signed in | Edit mode: the log's published batches of changes, newest first, with who and when (owner, operator) |

## playout (6)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getSignOnChecks` | GET | `/stations/:stationId/sign-on/checks` | signed in | Pre-flight checks before signing on |
| `signOn` | POST | `/stations/:stationId/sign-on` | signed in | Sign on. Refused while a blocking check fails. The first sign-on fixes call sign and channel. |
| `signOff` | POST | `/stations/:stationId/sign-off` | signed in | Sign off (owner, operator) |
| `cueBreak` | POST | `/stations/:stationId/cue-break` | signed in | Cue a break now during a live block (owner, operator, or the block's host) |
| `getStatus` | GET | `/stations/:stationId/playout` | signed in | What's on air now, and the output |
| `getAsRun` | GET | `/stations/:stationId/as-run` | signed in | What actually aired, to the second |

## catalog (12)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `browse` | GET | `/catalog/offers` | signed in | Browse the syndication market. With forStation, each offer says whether it fits that station's open schedule. |
| `getOffer` | GET | `/catalog/offers/:offerId` | signed in | An offer, with its episodes, break marks and who carries it |
| `countPreview` | POST | `/catalog/offers/:offerId/preview` | signed in | Count a preview (not who; it doesn't use up an airing) |
| `offerProgram` | POST | `/programs/:programId/offer` | signed in | Offer a program for carriage. Refused if any episode was imported from a link. |
| `updateOffer` | PATCH | `/catalog/offers/:offerId` | signed in | Change terms (new carriers only) or withdraw |
| `requestCarriage` | POST | `/catalog/offers/:offerId/requests` | signed in | Ask to carry a program: choose a deal, when it airs and when it starts |
| `listRequests` | GET | `/stations/:stationId/carriage/requests` | signed in | Requests to carry this station's programs, and requests it has made |
| `decideRequest` | POST | `/carriage/requests/:requestId/decision` | signed in | Approve, or decline with a reason from the short list (the maker) |
| `listAgreements` | GET | `/stations/:stationId/carriage/agreements` | signed in | What this station carries, and who carries its programs |
| `endAgreement` | POST | `/carriage/agreements/:agreementId/end` | signed in | Give notice to end carriage (either side). It ends after the notice period. |
| `placeInLog` | POST | `/carriage/agreements/:agreementId/place` | signed in | Put the agreed slots on the carrier's log: next unaired episode, in order, replacing what's there |
| `withdrawRequest` | POST | `/carriage/requests/:requestId/withdraw` | signed in | C4: withdraw a request the maker hasn't answered (the carrier's owner or operator). 409 `decided` once it's approved or declined. |

## spots (61)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `createBusiness` | POST | `/businesses` | signed in | Start a business account. The creator is its owner. |
| `getBusiness` | GET | `/businesses/:businessId` | signed in | Profile and settings |
| `updateBusiness` | PATCH | `/businesses/:businessId` | signed in | Change the profile, where customers are, warnings and auto top-up (owner; managers can't change funding) |
| `addLocation` | POST | `/businesses/:businessId/locations` | signed in | Add a location or service area |
| `removeLocation` | DELETE | `/businesses/:businessId/locations/:locationId` | signed in | Remove a location |
| `listSpots` | GET | `/businesses/:businessId/spots` | signed in | A business's spots |
| `createSpot` | POST | `/businesses/:businessId/spots` | signed in | Start a spot (a draft) with its rate, budget and targeting |
| `getSpot` | GET | `/spots/:spotId` | signed in | One spot |
| `updateSpot` | PATCH | `/spots/:spotId` | signed in | Change the rate, budget, dates, targeting or code. Raising the budget uses money already available. |
| `uploadSpotFile` | POST | `/spots/:spotId/file` | signed in | Upload the spot. Checked on arrival: exact length, picture, title safe, captions, loudness, code. A spot without a code gets one here (added 2026-09-29, P4): Opencast's letters, the title as the offer until the business names one. |
| `matchStations` | POST | `/spots/:spotId/matches` | signed in | Which stations would see it, with the reason any nearby station is left out, and an estimated cost per airing |
| `submitSpot` | POST | `/spots/:spotId/submit` | signed in | Send for review (category and content), before any station can see it |
| `pauseSpot` | POST | `/spots/:spotId/pause` | signed in | Pause. Airings already held still air. |
| `resumeSpot` | POST | `/spots/:spotId/resume` | signed in | Back in the market. Stations that had it are told; it never returns to a rotation by itself. |
| `endSpot` | POST | `/spots/:spotId/end` | signed in | End it. It stays in your results. |
| `listSpotAirings` | GET | `/spots/:spotId/airings` | signed in | Scheduled (held) and aired |
| `reviewQueue` | GET | `/review/spots` | Opencast admin | Spots in review |
| `reviewSpot` | POST | `/review/spots/:spotId` | Opencast admin | Approve (lists it, if the balance covers a day of budget) or send back |
| `stationMarket` | GET | `/stations/:stationId/spot-market` | signed in | Spots listed for this station's market, matched by targeting, blocked categories hidden |
| `getRotations` | GET | `/stations/:stationId/rotations` | signed in | The rotation and the backup rotation |
| `setRotation` | PUT | `/stations/:stationId/rotations/:kind` | signed in | Set a rotation's spots in order (owner, operator) |
| `getAvails` | GET | `/stations/:stationId/avails` | signed in | Open time in upcoming breaks |
| `checkCredit` | POST | `/sponsorships/credit-check` | anyone | Check credit text as it's typed: who, where and what they do, and nothing else |
| `offerSponsorship` | POST | `/businesses/:businessId/sponsorships` | signed in | Offer to underwrite a station or one program, flat monthly. Can't be sent until the credit passes. |
| `listBusinessSponsorships` | GET | `/businesses/:businessId/sponsorships` | signed in | A business's sponsorships |
| `listStationSponsorships` | GET | `/stations/:stationId/sponsorships` | signed in | Requests and sponsors, and the station's sponsorship settings |
| `decideSponsorship` | POST | `/sponsorships/:sponsorshipId/decision` | signed in | Approve, or decline with a reason from the short list |
| `endSponsorship` | POST | `/sponsorships/:sponsorshipId/end` | signed in | Stop renewing; it ends with its paid month |
| `setSponsorshipSettings` | PUT | `/stations/:stationId/sponsorship-settings` | signed in | Minimum a month and most sponsors for the station and each program; closed programs can't be sponsored |
| `listMakers` | GET | `/makers` | signed in | Stations that take orders, and Opencast Studio. `businessId` (added 2026-09-29, P18) adds each maker's history with that business. |
| `orderSpot` | POST | `/businesses/:businessId/orders` | signed in | Send a brief to a maker |
| `listBusinessOrders` | GET | `/businesses/:businessId/orders` | signed in | A business's orders |
| `listMakerOrders` | GET | `/stations/:stationId/orders` | signed in | Orders sent to this maker |
| `getOrder` | GET | `/orders/:orderId` | signed in | One order |
| `attachBriefFile` | POST | `/orders/:orderId/brief-files` | signed in | Attach a file to the brief |
| `quoteOrder` | POST | `/orders/:orderId/quote` | signed in | Quote a price, delivery date, rounds included and who voices it; or pass |
| `acceptQuote` | POST | `/orders/:orderId/accept` | signed in | Accept the quote; the price is held from the balance |
| `deliverOrder` | POST | `/orders/:orderId/deliveries` | signed in | Deliver a version (the maker) |
| `addOrderNote` | POST | `/orders/:orderId/notes` | signed in | A note pinned to a timecode |
| `markOwnMistake` | POST | `/orders/:orderId/notes/:noteId/makers-mistake` | signed in | The maker marks a note as its own mistake; it doesn't use up a round |
| `reviewDelivery` | POST | `/orders/:orderId/review` | signed in | Approve (releases the money and makes it a spot), ask for changes, or ask Opencast to review after the included rounds |
| `cancelOrder` | POST | `/orders/:orderId/cancel` | signed in | Cancel. After the delivery date passes undelivered, the hold returns in full. |
| `resolveOrderDispute` | POST | `/admin/orders/:orderId/resolve` | Opencast admin | Opencast's review of a disputed order: pay the maker, refund the business, or split (added 2026-09) |
| `scanCode` | POST | `/c/:code/scan` | anyone | Count a QR scan (from the page the QR opens) |
| `saveOffer` | POST | `/c/:code/save` | anyone (personal if signed in) | Save the offer to a phone |
| `redeemCode` | POST | `/businesses/:businessId/redeem` | signed in | Mark a code used at the counter (owner, manager). Checks it's valid and the customer's first use. 409 `redeem_off` while the Redeem tool is off (added 2026-09-29). |
| `getResults` | GET | `/businesses/:businessId/results` | signed in | Every airing from the as-run log with proof, tuned in and cost; codes and customers. `period` (added 2026-09-29, P14): a `week` (the Sunday `week`, default this one), the `month`, or `all` time. |
| `stationCustomers` | GET | `/stations/:stationId/customers` | signed in | Customers from airings on this station only, per spot |
| `tellMeWhenListed` | POST | `/orders/:orderId/tell-me-when-listed` | signed in | P24: the maker asks to be told when the business lists the spot it made (the maker's owner or operator). Told once, when it's listed; at once if it already is. |
| `listSpotCategories` | GET | `/spot-categories` | anyone | S17: every spot category, in one list: what a business is, what markets filter by, and (`blockable`) what a station can block |
| `updateLocation` | PATCH | `/businesses/:businessId/locations/:locationId` | signed in | P26: change a location or service area in place (owner, manager); it keeps its place in the list. A location has no radius. |
| `uploadLogo` | POST | `/businesses/:businessId/logo` | signed in | P11: upload the logo (owner, manager): a square PNG or JPEG, at least 256 pixels. Stored at 512 pixels. 422 `logo_size`, `not_an_image`. |
| `closeBusiness` | POST | `/businesses/:businessId/close` | signed in | P21: close the account (owner only; type its name). Spots end (out of every rotation), sponsorships stop renewing, unanswered orders are cancelled. Held money pays for what's already scheduled; the available balance goes back to the default bank or Clear account now, and what's left after the held airings follows. 409 `order_in_progress` while an order is being made or reviewed; 409 `no_source` when there's money to send back and no bank or Clear account to send it to. |
| `getConnections` | GET | `/businesses/:businessId/connections` | signed in | P20: Clear Pay and an online checkout |
| `connect` | POST | `/businesses/:businessId/connections/:kind` | signed in | P20: connect Clear Pay or an online checkout (owner only). For a checkout, `token` is the webhook signing secret the provider shows (Shopify's app secret, Stripe's `whsec_…`, Square's signature key); the answer's `webhookUrl` is where the provider sends order events, and each promotion code used counts as a use. Connecting another checkout replaces the one before. |
| `disconnect` | DELETE | `/businesses/:businessId/connections/:kind` | signed in | P20: disconnect Clear Pay or the checkout (owner only). Uses already counted stay counted. |
| `redeemCheck` | POST | `/businesses/:businessId/redeem/check` | signed in | B5: check a code at the counter without counting the use (owner, manager): valid, first use for this customer, when and where the offer was saved, its text |
| `redeemToday` | GET | `/businesses/:businessId/redeem/today` | signed in | P12: the Redeem tool: on or off, codes marked used today, and whether Clear Pay counts uses by itself (owner, manager) |
| `listSponsorTargets` | GET | `/businesses/:businessId/sponsor-targets` | signed in | P16: the stations near the business (its markets; within 25 miles of a place, or its service area) and their own programs that take sponsors, with the minimum and the room. Closed ones and full ones are left out. |
| `getCategoryReach` | GET | `/markets/:marketId/category-reach` | signed in | P9: how many of a market's stations on the air can carry a spot category, and which block it |
| `lookupPlace` | GET | `/places/lookup` | signed in | P10: an address or a city to coordinates and a market, through the server's place lookup (PLACES_URL). Nothing is stored. 404 `not_found` when nothing matches; 503 `not_available` when no lookup is set up. |

## ledger (23)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getBalance` | GET | `/businesses/:businessId/balance` | signed in | Available, held and spent, the runway in days, pending deposits |
| `listMovements` | GET | `/businesses/:businessId/movements` | signed in | Money in and out, and airings |
| `addFundingSource` | POST | `/businesses/:businessId/funding-sources` | signed in | Link a bank through Clear, a card through Stripe, or a Clear business account (owner only). The token comes from the provider's own widget. |
| `quoteDeposit` | POST | `/businesses/:businessId/deposits/quote` | signed in | The fee in dollars before paying (card: Stripe's fee at cost; bank and Clear: none), and roughly how many airings |
| `addMoney` | POST | `/businesses/:businessId/deposits` | signed in | Add money (owner, manager). Bank transfers arrive in 1 to 2 business days and can be undone until then. |
| `quoteClearTransfer` | POST | `/businesses/:businessId/deposits/clear-transfer/quote` | signed in | Funding from a linked Clear wallet with full access (owner, manager): where to send it. The app asks Clear to send it (the person confirms on Clear's page), then confirms with the transaction hash. 409 when the person's Clear link is read-only or missing. |
| `confirmClearTransfer` | POST | `/businesses/:businessId/deposits/clear-transfer` | signed in | The transfer from Clear was sent: the API checks it on chain (from the person's linked Clear wallet, to the business's account, at least the amount) and credits the balance once it confirms |
| `cancelDeposit` | POST | `/businesses/:businessId/deposits/:depositId/cancel` | signed in | Undo a deposit that hasn't arrived |
| `withdraw` | POST | `/businesses/:businessId/withdrawals` | signed in | Take out unheld money (owner only) |
| `listStatements` | GET | `/businesses/:businessId/statements` | signed in | Monthly statements with every airing |
| `getStationEarnings` | GET | `/stations/:stationId/earnings` | signed in | Earnings lines, held money, the account and next payout (owner; operators see only) |
| `listStationStatements` | GET | `/stations/:stationId/statements` | signed in | Weekly statements; the CSV has the ledger entries behind each line |
| `getStatementCsv` | GET | `/statements/:statementId/csv` | signed in | A statement's ledger entries as CSV (the business's team, or the station's owners) |
| `getPayoutAccount` | GET | `/stations/:stationId/payout-account` | signed in | Where the station is paid (its Clear account, or Stripe Connect), and a link if it has to finish setting it up (owner only) |
| `setPayoutDestination` | PUT | `/stations/:stationId/payout-account` | signed in | Pay the station out to the owner's linked Clear wallet (read-only access is enough), or back to its Clear account (owner only) |
| `moveToBank` | POST | `/stations/:stationId/payouts` | signed in | Move earnings to the bank now (owner only) |
| `pledge` | POST | `/stations/:stationId/pledges` | signed in | Pledge monthly or once, by card. Credit me on air uses the display name. |
| `listMyPledges` | GET | `/me/pledges` | signed in, or a TV signed in | My pledges |
| `updatePledge` | PATCH | `/me/pledges/:pledgeId` | signed in | Change the amount or on-air credit, or stop (it ends after the current month). `cadence` (added 2026-09-28, E1): a monthly pledge set to `once` isn't charged again (it ends after this month, like stop); set back to `monthly` before then, it carries on. A one-time pledge can't become monthly (422 `new_pledge_needed`: pledge again, monthly). |
| `listReceipts` | GET | `/businesses/:businessId/receipts` | signed in | E4: every receipt and monthly statement, newest first, each with a PDF (the business's team) |
| `removeFundingSource` | DELETE | `/businesses/:businessId/funding-sources/:sourceId` | signed in | E5: remove a funding source (owner only). The default can't be removed (409 `default_source`: make another the default first), nor one with a deposit on its way (409 `deposit_pending`). |
| `makeDefaultFundingSource` | POST | `/businesses/:businessId/funding-sources/:sourceId/default` | signed in | E5: make a funding source the default (owner only): auto top-up and closing the account use it |
| `pledgeCardSession` | POST | `/me/pledges/:pledgeId/card-session` | signed in | E1: a page to change the card on a monthly pledge (Stripe's), which comes back to `returnTo` (a path in the app; default the pledge's station). 422 `no_card_to_change` for a one-time or ended pledge. |

## audience (4)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `heartbeat` | POST | `/heartbeat` | anyone (personal if signed in), or a TV signed in | Players send this every 30 seconds while tuned in |
| `getAudience` | GET | `/stations/:stationId/audience` | signed in | The station's own numbers (never shown to viewers) |
| `programWatchData` | GET | `/stations/:stationId/programs/watch-data` | signed in | Offering your programs: each of the maker's programs across every station that aired it, added up |
| `voteNotForMe` | POST | `/stations/:stationId/not-for-me` | anyone (personal if signed in), or a TV signed in | A viewer's "Not for me" on the program airing now (one per session per airing) |

## trust (7)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `fileClaim` | POST | `/claims` | anyone | A rights holder files a claim. The item goes off air at once, everywhere it's carried. |
| `listClaims` | GET | `/stations/:stationId/claims` | signed in | Claims against this station's items, and its standing |
| `answerClaim` | POST | `/claims/:claimId/answer` | signed in | Answer with a rights basis and an attestation. The item airs again; the claimant has 10 business days to respond. |
| `removeClaimedItem` | POST | `/claims/:claimId/remove` | signed in | Take the item down instead of answering |
| `resolveClaim` | POST | `/claims/:claimId/resolve` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Opencast records the outcome: upheld, withdrawn or restored. A rights reviewer or an admin (403 `desk_role` otherwise; `admin` before 2026-09-29). 409 `not_open` once the claim is closed. |
| `attachToClaim` | POST | `/claims/:claimId/attachments` | signed in | B6: upload the permission or licence that backs an answer (owner, operator; a PDF, image or text file up to 20 MB). Returns the `attachmentUrl` `answerClaim` takes. 409 `not_open` once the claim is answered or closed; 422 `wrong_file_type`, `too_big`. |
| `listDeskClaims` | GET | `/admin/claims` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Every claim on every station, newest first, with each one's timeline and carriers, the stations with claims and the page's figures. Admins and rights reviewers see every market; a market lead sees their own markets' (and only theirs with `marketId`: 403 `desk_role` for another). |

## notifications (4)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listNotices` | GET | `/me/notices` | signed in | In-app notices, newest first |
| `markRead` | POST | `/me/notices/read` | signed in | Mark notices read |
| `getPrefs` | GET | `/me/notification-prefs` | signed in | Notification settings for a scope |
| `setPrefs` | PUT | `/me/notification-prefs` | signed in | Change notification settings. Always-on kinds stay on. |

## waitlist (14)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `join` | POST | `/waitlist` | anyone | Join the waitlist. A station can ask for a call sign; it's held for 120 days (`call_signs.hold`). 422 `call_sign_refused` for a name Opencast won't allow; someone else asking for the same name is allowed, and the desk decides. |
| `checkCallSign` | GET | `/call-signs/:callSign` | anyone (personal if signed in) | Whether a call sign is free. Signed in, a name held for you is available to you |
| `getReservationInvite` | GET | `/waitlist/reservations/:reservationId` | anyone (personal if signed in) | Added 2026-09-29: a waitlist invite's link as master control reads it: the call sign, market, channel held and end, whether it's open, being set up, signed on or ended, and the address masked. Signed in, whether the account has the signup's email. 404 for an unknown one, or a hold that isn't the waitlist's. |
| `listReservations` | GET | `/admin/reservations` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Reserved call signs and the channels held for them |
| `holdChannel` | POST | `/admin/reservations/:reservationId/channel` | Opencast admin | Hold a channel number for a reservation; no other station can take it |
| `reservationsOverview` | GET | `/admin/reservations/overview` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The market's reservations in numbers, the hold's rule, and stations on the dial whose call signs break the rules now |
| `callSignSuggestions` | GET | `/admin/call-signs/:callSign/suggestions` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Free names to offer in place of this one (Suggest, Decide) |
| `inviteReservation` | POST | `/admin/reservations/:reservationId/invite` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Email them to sign on with their call sign (again, if they were invited before). 422 `not_allowed`, `same_name`, `no_email` |
| `inviteNextReservations` | POST | `/admin/reservations/invite-next` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Invite the next ones waiting in the market, in reservation order (Invite the next 10) |
| `extendReservation` | POST | `/admin/reservations/:reservationId/extend` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Hold it longer: the hold's days again, from its end (or from today, if that's later) |
| `releaseReservation` | POST | `/admin/reservations/:reservationId/release` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | End the hold now: the name and any channel held with it are free. They get an email |
| `decideReservation` | POST | `/admin/reservations/:reservationId/decide` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Same name twice: keep this one. Each other is told, with a free name held for them instead in the same place in line (chosen here, or the first suggestion) |
| `suggestCallSign` | POST | `/admin/reservations/:reservationId/suggest` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Not allowed: hold `callSign` for them instead, in the same place in line, and tell them why (with up to three other free names) |
| `listSignups` | GET | `/admin/waitlist` | Opencast admin | Everyone on the waitlist, per market |

## network (33)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getBoard` | GET | `/admin/markets/:marketSlug/board` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Every channel's state in a market |
| `createMarket` | POST | `/admin/markets` | Opencast admin | Add a market and the ZIPs in it |
| `listCreators` | GET | `/admin/creators` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The creator pipeline, sorted by next action |
| `addCreator` | POST | `/admin/creators` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Add a creator found in a market |
| `updateCreator` | PATCH | `/admin/creators/:creatorId` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Change stage, proposed channel, next action |
| `listWorks` | GET | `/admin/creators/:creatorId/works` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Works found on the creator's source |
| `addWorks` | POST | `/admin/creators/:creatorId/works` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Catalogue works from titles and lengths. Nothing is copied yet. |
| `recordLicence` | POST | `/admin/works/:workId/licence` | Opencast admin | Record a work's published licence. Only CC0, CC BY and CC BY-SA count. |
| `askPermission` | POST | `/admin/creators/:creatorId/permission-requests` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Send a permission request with a preview of the station's schedule built from titles |
| `getPermissionPage` | GET | `/permission/:token` | anyone | The creator's permission page |
| `answerPermission` | POST | `/permission/:token/answer` | anyone | Yes, go ahead / No thanks. Recorded against the link with the exact list of works; a copy is emailed. |
| `stopFromLink` | POST | `/permission/:token/stop` | anyone | B8: stop from the permission link, any time after a yes. Nothing the yes covered airs again: a station set up from it signs off, and its held money goes to the creator by the stop path once they're verified (a stop handover the desk checks). 422 `nothing_to_stop` without a yes; stopping twice is the same page. |
| `claimFromLink` | POST | `/permission/:token/claim` | signed in | B8: claim from the permission link, signed in, before or after the station exists. Before, the claim waits and joins the station when the desk sets it up. 422 `nothing_to_claim` without a yes, or after a stop; 422 `in_progress` while a claim is open. |
| `remindCreator` | POST | `/admin/creators/:creatorId/reminders` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | N2: send the one reminder about the open permission request (to the contact email, with the same link). Next action becomes No answer, due in 7 days. 422 `not_asked` unless they're Asked; 422 `reminded` after the one reminder. |
| `sendClaimInvite` | POST | `/admin/creators/:creatorId/claim-invites` | Opencast admin | N3: tell a claimable station's creator it's theirs to claim: `invite` (the station is on air, claim when you like) or `link` (the claim link itself: their permission page's Claim). Held earnings then say Invited or Claim link sent. 422 `no_station` before the station is set up; 422 `no_contact` without a contact email. |
| `listRecipes` | GET | `/admin/recipes` | Opencast admin | Station recipes |
| `saveRecipe` | POST | `/admin/recipes` | Opencast admin | Add a recipe |
| `setUpClaimable` | POST | `/admin/creators/:creatorId/station` | Opencast admin | Set up a claimable station from a recipe: channel, call sign, and the rights record attached |
| `heldEarnings` | GET | `/admin/held-earnings` | Opencast admin | Held earnings per claimable station |
| `startHandover` | POST | `/stations/:stationId/claim` | signed in | Claim (or stop) a claimable station: connect the source account to prove it's you |
| `approveHandover` | POST | `/admin/handovers/:handoverId/approve` | Opencast admin | Record the desk's check of the claimant. With the escrow contract live, the verifiers then approve on-chain (what they sign is in `onChain`) and the 72 hours start there |
| `listListedSources` | GET | `/admin/listed-sources` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | City and county streams. A215 (added 2026-09-30): the listed ones by default; `show=removed` lists the ones taken off the dial for good |
| `addListedSource` | POST | `/admin/listed-sources` | Opencast admin | List a source as an external station: its official embed (where its terms allow embedding) or its stream link (with its written permission, or a clearly public source). On the dial only once the evidence is in; same channel and call sign rules as full stations. Added 2026-09-30 (A229): `shareCallSign` on X.n beside an external X.1 shares its call sign ("Same brand as 15.1"). Added 2026-10-01 (A241): what's on can be a webpage's own event data (schema.org JSON-LD), or a weekly schedule entered by hand and checked against the source's published schedule (`schedule`), made into airings for the next 14 days at once and hourly. |
| `recordListedEvidence` | POST | `/admin/listed-sources/:sourceId/evidence` | Opencast admin | Phase 6: record the evidence a listing was waiting for (terms checked, written permission, a public basis, or a note). It goes on the dial once the evidence is complete. A permission is recorded once and never edited. |
| `listExternalOutages` | GET | `/admin/listed-sources/:sourceId/outages` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Phase 6: an external station's outages, newest first (the last 90 days) |
| `previewIptvList` | POST | `/admin/creators/iptv/preview` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Phase 6: read a public IPTV list (a pasted or uploaded M3U, or an iptv-org address: M3U or JSON) and list its channels, each with whether it's already a lead or an external station. Nothing is saved. Only the list is fetched, never a stream. |
| `importIptvLeads` | POST | `/admin/creators/iptv/import` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Phase 6: import IPTV-list channels into the creator pipeline as leads (stage `found`), with their stream addresses noted. Never on the dial from here. A channel already a lead or an external station (by its stream address) is skipped. |
| `syncListedSource` | POST | `/admin/listed-sources/:sourceId/sync` | Opencast admin | Sync listings from the agenda calendar now. Added 2026-10-01 (A241): a webpage is read for its event data (`calendarSync` `no_event_data` when it has none); a schedule entered by hand is made into airings for the next 14 days again |
| `updateListedSource` | PATCH | `/admin/listed-sources/:sourceId` | Opencast admin | A215: change a listing: its name, description, address, how it plays, the embed terms, the schedule feed or guide data (A241: or a weekly schedule entered by hand), and its channel and call sign (the rules for listing). An edit never puts anything on the dial without evidence that covers what now plays: a written permission covers one exact stream address, so a new address waits for new evidence; embed terms stay for an address on the same host and wait for one on another; a public basis stays; a new way to play needs its own evidence. A new address or way to play is checked afresh (an open outage ends); a new schedule is read again. Every change is kept in the listing's history. 409 `removed` for a listing taken off the dial. |
| `listListedChanges` | GET | `/admin/listed-sources/:sourceId/changes` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | A215: a listing's change history, newest first: each change (who, when, which fields from → to, and what it did), taking it off the dial and putting it back. Addresses in full to admins, as their host to the rest of the desk |
| `removeListedSource` | POST | `/admin/listed-sources/:sourceId/remove` | Opencast admin | A215: take a listing off the dial for good. Archived, never deleted: its permission records, outage history, change history, watch data and lead link stay. It leaves the dial, the guide, search and the swipe order at once, its checks and schedule reads stop. Like a full station that signs off for good, its channel is held for it 90 days and then freed, and its call sign stays its own (held a year on the waitlist's side). Its pipeline lead goes back to the stage it had before it went on air (Found when that wasn't recorded) and is a lead again. 409 `removed` when it already is. Added 2026-09-30 (A231): X.1 whose call sign stations share goes with them, only with `withFamily` (409 `family` names them otherwise). |
| `restoreListedSource` | POST | `/admin/listed-sources/:sourceId/restore` | Opencast admin | A215: put a listing taken off the dial back on the list, on its old channel (or `channel`, another free one in its band, by the rules for listing). It comes back with its evidence as recorded and waits for its checks (`health: unchecked`); its lead goes back to On air once the evidence holds. 409 `channel_taken` when the channel has gone to another station or a hold, `call_sign_taken` when its call sign has (after its hold), `not_removed` when it's listed. |
| `getClaimPage` | GET | `/claim/:token` | anyone | N10: the creator's claim page, by the link we sent them (their permission link's token), and the claim's status once started. 404 when there's no station to claim from it. |

## tv (17)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `registerTv` | POST | `/tv/devices` | anyone | A TV app registers itself on first launch. Keep the deviceToken; it's shown once. |
| `createTvCode` | POST | `/tv/codes` | a TV app (device token or TV session) | A sign-in code for this TV (10 minutes). A new code replaces the TV's earlier ones. |
| `pollTvCode` | GET | `/tv/codes/:pollToken` | anyone | Has a phone approved this TV's code? Approved carries the TV session token, once. Unknown poll token: 404. |
| `approveTvCode` | POST | `/tv/codes/:code/approve` | signed in | Sign in the TV showing this code (spaces and lower case are fine). Wrong or run-out: 404 `code_not_found`; already used: 409 `code_used`; 10 wrong in 15 minutes: 429 `too_many_tries`. |
| `signOutThisTv` | DELETE | `/tv/session` | a TV app (device token or TV session) | The TV signs itself out (its session ends on the server). Phones on the account are told `ended`. |
| `listTvs` | GET | `/me/tvs` | signed in | TVs signed in to the account (the TV app), and remembered cast targets |
| `signOutTv` | DELETE | `/me/tvs/:tvId` | signed in | Sign a TV out remotely (or forget a cast target). Returns the list. |
| `recordCastTarget` | POST | `/me/tvs/cast-targets` | signed in | Remember a Chromecast or AirPlay TV by name for Your TVs (again: it's marked used now) |
| `tvRemoteEvents` | GET | `/tv/remote/events` | a TV app (device token or TV session) (event stream) | The TV's stream (SSE): `command` from phones, with who sent it, and `phones` when the list changes. Open while the app runs; it makes the TV `online`. |
| `postRemoteState` | POST | `/tv/remote/state` | a TV app (device token or TV session) | What the TV shows now, for every phone driving it (sent after each change) |
| `endRemote` | POST | `/tv/remote/end` | a TV app (device token or TV session) | The TV ended the session (the sleep timer ran out): every phone is told `ended`. Pairings stay. |
| `createPairCode` | POST | `/tv/remote/pair-code` | a TV app (device token or TV session) | A 4-digit code for a guest's phone to pair with this TV (5 minutes; a new one replaces the last) |
| `listRemotePhones` | GET | `/tv/remote/phones` | a TV app (device token or TV session) | Phones that can drive this TV: guests paired by code, and account phones that have connected |
| `removeRemotePhone` | DELETE | `/tv/remote/phones/:phoneId` | a TV app (device token or TV session) | Unpair a guest's phone (its token stops working), or drop an account phone from the list until it connects again. It's told `ended`. |
| `pairPhone` | POST | `/tv/remote/pair` | anyone (personal if signed in) | Pair this phone with the TV showing the code. Wrong or run-out: 404 `code_not_found`; 10 wrong in 10 minutes: 429 `too_many_tries`. |
| `phoneRemoteEvents` | GET | `/tv/remote/:tvId/events` | anyone (personal if signed in) (event stream) | A phone's stream for one TV (SSE): `state` and `ended`. A phone signed in to the TV's account (its Privy token), or a guest phone paired with this TV (its `phoneToken`). Anyone else: 403 `not_paired`. |
| `sendRemoteCommand` | POST | `/tv/remote/:tvId/commands` | anyone (personal if signed in) | Send a command to the TV, with the phone's name ("Kai's phone"). The TV isn't connected: 409 `tv_not_connected`. A phone signed in to the TV's account (its Privy token), or a guest phone paired with this TV (its `phoneToken`). Anyone else: 403 `not_paired`. |

## desk (17)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getTeam` | GET | `/admin/desk/team` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The Opencast team and their desk roles |
| `addTeamMember` | POST | `/admin/desk/team` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Gives someone with an Opencast account desk roles, by their email (admins only) |
| `setTeamRoles` | PUT | `/admin/desk/team/:userId` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Sets someone's desk roles; none takes them off the team (admins only) |
| `listRules` | GET | `/admin/rules` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Every rule with its value (now, or at `at`) and the next change set |
| `ruleValue` | GET | `/admin/rules/:key/value` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | A rule's value at a moment |
| `ruleVersions` | GET | `/admin/rules/:key/versions` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Every version of a rule, past and future, newest first |
| `setRule` | POST | `/admin/rules/:key/versions` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | A new value from a date, never before today (admins only). The old value stays in the change log |
| `changeLog` | GET | `/admin/change-log` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Every change made in Settings, newest first |
| `listNumbering` | GET | `/admin/numbering` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Each market's numbering ranges |
| `getSigners` | GET | `/admin/escrow/signers` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The escrow's verifier keys (read-only), and changes proposed here |
| `proposeSignerChange` | POST | `/admin/escrow/signer-proposals` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Proposes a change to the verifier keys; every other admin has to approve it (admins only) |
| `decideSignerChange` | POST | `/admin/escrow/signer-proposals/:proposalId/decision` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Approves or refuses a proposed signer change (the other admins only) |
| `withdrawSignerChange` | POST | `/admin/escrow/signer-proposals/:proposalId/withdraw` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Withdraws your own open proposal |
| `getStorageMaintenance` | GET | `/admin/storage` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Each storage job's run going now, last check and last apply; `check` starts a fresh check of one job or all (admins only) |
| `startStorageRun` | POST | `/admin/storage/runs` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Checks (report only) or applies one storage job, in the background (admins only) |
| `getStorageRun` | GET | `/admin/storage/runs/:runId` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | One storage run, with its progress (admins only) |
| `storageRunReport` | GET | `/admin/storage/runs/:runId/report` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | A finished storage run's JSON report, as the script writes it (admins only) |

## catalogShelf (13)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getShelf` | GET | `/admin/catalog/shelf` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The shelf: every series, its rights basis, episodes, carriers and state |
| `createSeries` | POST | `/admin/catalog/series` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | A new series, as a program on a catalog station (rights reviewers and admins) |
| `getSeries` | GET | `/admin/catalog/series/:seriesId` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | A series: its episodes and items, the offer and its carriers, and what was rebuilt |
| `libraryChoices` | GET | `/admin/catalog/series/:seriesId/library` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Files in the catalog station's library that can become items (ready, not on the shelf yet) |
| `addItem` | POST | `/admin/catalog/series/:seriesId/items` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Adds an item from the catalog station's library; its checklist starts from the public-domain rules (rights reviewers and admins) |
| `getItem` | GET | `/admin/catalog/items/:itemId` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | An item's rights record: the checklist, evidence and both checks |
| `setCheck` | PUT | `/admin/catalog/items/:itemId/checks/:line` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Answers one line of the checklist (rights reviewers and admins; not once it's sent) |
| `addEvidence` | POST | `/admin/catalog/items/:itemId/checks/:line/evidence` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Attaches a file to a line of the checklist, stored by content ID (a PDF, image or text file up to 20 MB) |
| `sendForSecondCheck` | POST | `/admin/catalog/items/:itemId/send` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The first check: every line answered with evidence, then sent for someone else to check. 422 `evidence_missing` |
| `secondCheck` | POST | `/admin/catalog/items/:itemId/second-check` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The second check, by a different rights reviewer or admin (403 `same_person`): confirm it, send it back for more evidence, or fail it |
| `failItem` | POST | `/admin/catalog/items/:itemId/fail` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Marks an item failed (a renewal found, a rights claim): it comes out of every episode, and those episodes are rebuilt |
| `setEpisode` | PUT | `/admin/catalog/series/:seriesId/episodes/:number` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | An episode's items in order: double-checked items only (422 `not_passed`). Composed by the next rebuild |
| `rebuildEpisodes` | POST | `/admin/catalog/series/:seriesId/rebuild` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Composes every episode whose items changed; the rest are left as they are |

## catalogSponsors (7)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getCatalogSponsors` | GET | `/admin/catalog/sponsors` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | The catalog's credit by series and market: who it thanks, the price, what aired, and the offers out |
| `catalogSponsorBusinesses` | GET | `/admin/catalog/sponsors/businesses` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Businesses to offer a slot to, by name (the first 20) |
| `offerCatalogSponsorship` | POST | `/admin/catalog/sponsors/offers` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Offers a slot to a business at the registry's price; it answers from its own side. 422 `credit_text`, `not_for_sale` (no price set), `bad_month`; 409 `slot_taken` |
| `assignCatalogSponsorship` | POST | `/admin/catalog/sponsors/assignments` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Assigns a slot to a business that has agreed to it, holding its first month now (as `offerCatalogSponsorship`, and 422 `insufficient_balance`) |
| `endCatalogSponsorship` | POST | `/admin/catalog/sponsors/:sponsorshipId/end` | the Opencast team (admin, rights reviewer or market lead; the role is checked per action) | Ends a sponsorship (credited to the end of its paid month, then Clear again), or withdraws an offer |
| `listBusinessCatalogSponsorships` | GET | `/businesses/:businessId/catalog-sponsorships` | signed in | A business's catalog sponsorships and the offers waiting for its answer (owner or manager) |
| `answerCatalogOffer` | POST | `/businesses/:businessId/catalog-sponsorships/:sponsorshipId/answer` | signed in | Accepts an offer (its first month is held now if it has started; 422 `insufficient_balance`) or declines it (owner or manager) |

## config (1)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getConfig` | GET | `/config` | anyone | The viewer apps' switches (features on or off), from the rules registry |

## billing (9)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getStationAccount` | GET | `/stations/:stationId/account` | signed in | The Station account (owners and operators; operators see only): usage so far this month and the month's estimate per type, the free allowance left, caps, the funding source, standing (ok, grace, paused) and recent bills |
| `setUsageCaps` | PUT | `/stations/:stationId/account/caps` | signed in | Monthly caps in dollars per usage type (owner only). Null removes a cap. Reaching one pauses that usage until the month ends (relays, live shows, new uploads), never the channel, and tells the owner. 422 `not_cappable` for a free type. |
| `startCardSetup` | POST | `/stations/:stationId/account/card-setup` | signed in | Start saving a card (owner only): a Stripe SetupIntent for the station, to confirm with Stripe's own card form (`clientSecret`, with `publishableKey`), then `saveCard`. 409 `cards_unavailable` when this server has no card provider. |
| `saveCard` | POST | `/stations/:stationId/account/card` | signed in | The card's SetupIntent succeeded: save it as the station's card (owner only), replacing any other. When the card is what pays (chosen, or no Clear wallet with full access), anything due is charged to it at once; paid, relays and live hours resume. 422 `card_not_saved` when the SetupIntent isn't the station's or didn't succeed. |
| `removeCard` | DELETE | `/stations/:stationId/account/card` | signed in | Remove the station's card (owner only). If it was the funding source, none is chosen until another is. |
| `setFundingSource` | PUT | `/stations/:stationId/account/funding` | signed in | Choose what pays what earnings don't cover (owner only), instead of the default order (an owner's Clear wallet with full access, then the card): `clear` (the caller's linked Clear wallet; 409 `clear_not_linked`, `clear_read_only` or `clear_unavailable`) or `card` (409 `no_card` until one is saved) |
| `payUsageNow` | POST | `/stations/:stationId/account/pay` | signed in | Pay what's due now (owner only): from earnings first, then the card. Paid, relays and live hours resume. 409 `nothing_due`; 409 `pay_from_clear` when the source is Clear (use the Clear payment); 422 `card_declined` with the card's reason. |
| `quoteClearUsagePayment` | POST | `/stations/:stationId/account/clear-payment/quote` | signed in | Paying what's due from the owner's linked Clear wallet (owner only, full access): where to send it. The app asks Clear to send it (the person confirms on Clear's page), then confirms with the transaction hash. 409 `nothing_due`, `clear_read_only`, `clear_not_linked`, `clear_unavailable`. |
| `confirmClearUsagePayment` | POST | `/stations/:stationId/account/clear-payment` | signed in | The transfer from Clear was sent (owner only): checked on chain (from the owner's linked wallet, to Opencast's account, at least what's due), then what's due is paid and relays and live hours resume. Waits while it isn't mined yet. 422 `transfer_not_valid`; 409 `transfer_already_used`. |

## platforms (4)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listPlatforms` | GET | `/stations/:stationId/platforms` | signed in | The station's relay destinations: YouTube and Twitch signed in, anything else by address and key (owner, operator) |
| `startPlatformSignIn` | POST | `/stations/:stationId/platforms/oauth/:provider/start` | signed in | Where to send the owner to sign in to YouTube or Twitch. The platform returns to /v1/platforms/oauth/:provider/callback, which connects it and goes back to master control's Translators page (owner) |
| `addManualPlatform` | POST | `/stations/:stationId/platforms` | signed in | Add any destination by its RTMP or RTMPS address and stream key. Its viewers can't be counted (owner) |
| `removePlatform` | DELETE | `/stations/:stationId/platforms/:platformId` | signed in | Remove a destination in one click: its key and tokens are erased, and signed-in tokens revoked where the platform allows (owner) |

## relay (4)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getRelay` | GET | `/stations/:stationId/relay` | signed in | The station's relays: mode, what breaks show, the station bug, hours and cost this month, each platform's next restart (owners, operators) |
| `updateRelay` | PATCH | `/stations/:stationId/relay` | signed in | Change the relay mode, what breaks show, the station bug on relays, or saving YouTube videos (owners, operators) |
| `listRelayRestarts` | GET | `/stations/:stationId/relay/restarts` | signed in | Every restart for platform limits, latest first: planned, done, failed, or due for the station to do |
| `dismissPaidPromotionReminder` | POST | `/stations/:stationId/relay/platforms/:platformId/paid-promotion-reminder/dismiss` | signed in | The station marked paid promotion on a destination Opencast can't mark: stop reminding it for this broadcast |

## uploads (6)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `createUpload` | POST | `/uploads` | signed in | Start a direct upload: checks the role for its purpose (404 or 403 as the old upload endpoint would), then answers with the part size, parts to send at once and the first part URLs. 422 `too_big`, `wrong_file_type` (a relay background or caption file of the wrong type); 409 `storage_paused` (a library item while storage is at its cap), `not_radio` (a relay background on a TV station), `brief_closed`, `not_in_the_making`, `not_an_upload`, `preparing`, `claim_open`. |
| `signUploadParts` | POST | `/uploads/:uploadId/parts` | signed in | More part URLs (up to 100 at once), each used once; ask again to retry a part. The person who started it only (404 otherwise). 409 `not_uploading` once it's completed or aborted; 422 for a part number past `partCount`. |
| `listUploadParts` | GET | `/uploads/:uploadId/parts` | signed in | The parts the store already has, to resume after a dropped connection or a reload. 409 `not_uploading` once it's completed or aborted. |
| `completeUpload` | POST | `/uploads/:uploadId/complete` | signed in | Every part is in: the upload becomes `checking` and the API takes it from there (content ID, stored once, the checks, preparation). Answers at once; follow it with `getUpload`. Calling it again answers the same. 409 `parts_missing` (a part the store doesn't have, or an ETag that doesn't match), `not_uploading` (aborted). |
| `abortUpload` | DELETE | `/uploads/:uploadId` | signed in | Cancel an upload: its parts are deleted. An upload that's already finished is left as it is. Uploads left unfinished for 24 hours are aborted by themselves. |
| `getUpload` | GET | `/uploads/:uploadId` | signed in | An upload's state, content ID and what it made. The person who started it only (404 otherwise). |

## blocks (6)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listBlocks` | GET | `/stations/:stationId/blocks` | signed in | A244: the station's programming blocks (owner, operator), with their items, schedule and next airing |
| `getBlock` | GET | `/stations/:stationId/blocks/:blockId` | signed in | A244: one programming block (owner, operator), with where it's on the log (`onLog`) |
| `createBlock` | POST | `/stations/:stationId/blocks` | signed in | A244: make a programming block (owner, operator). A name the station already has is 409 `block_name_taken`; a colour under 4.5:1 against white is 400. Put it on the log with `applyLogChanges` (`block_add`) or a day template. |
| `updateBlock` | PATCH | `/stations/:stationId/blocks/:blockId` | signed in | A244: change a programming block's name, description, colour, bug, intro, outro or bumper order (owner, operator). `removeLogo` takes its logo off. |
| `uploadBlockLogo` | POST | `/stations/:stationId/blocks/:blockId/logo` | signed in | A244: upload the block's logo (owner, operator): a PNG, JPEG or WebP, at least 128 pixels on its short side. Stored at 512 pixels at most. 422 `not_an_image`, `logo_size`. |
| `archiveBlock` | DELETE | `/stations/:stationId/blocks/:blockId` | signed in | A244: archive a programming block (owner, operator). While it's on the log from now on, 409 `block_on_log` ("Late Crate Nights is on the log 3 more times. Take it off the log first."); with `takeOffLog`, its spans ahead come off every date nobody edited, it leaves its day templates, and dates edited by hand keep theirs (`kept`). Its items go back to being the station's. |
