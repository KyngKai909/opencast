# API

Generated from `packages/contracts` by `npm run docs:api`. Every path is under `/v1`. Request and response shapes are the Zod schemas in the contracts.

243 endpoints in 14 modules.

## accounts (34)

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
| `resendInvite` | POST | `/invites/:inviteId/resend` | signed in | Send an invite again and extend it a week |
| `acceptInvite` | POST | `/invites/:inviteId/accept` | signed in | Join the team the invite is for |
| `signOutEverywhere` | POST | `/me/sign-out-everywhere` | signed in | A1: sign out every phone, computer and TV. Every Privy token issued before now, and every later token of a session seen before now, answers 401 `signed_out`; TVs signed in to the account are signed out and their phones dropped. This device signs out too. |
| `getWatchHistory` | GET | `/me/watch-history` | signed in, or a TV signed in | A2: the last channel and the last 30 days of watching (empty while keepWatchHistory is off) |
| `clearWatchHistory` | DELETE | `/me/watch-history` | signed in, or a TV signed in | A2: clear watch history and the last channel |
| `exportData` | POST | `/me/export` | signed in | A3: email a link to download everything the account holds (the link opens the app, which calls downloadData). 409 `no_email` without an email. |
| `downloadData` | GET | `/me/export` | signed in | A3: everything the account holds, as JSON (save it as a file) |
| `deleteAccount` | DELETE | `/me` | signed in | A3: delete the account now (no grace period). Presets, reminders, watch history, notices and TVs go; pledges stop after this month; team places are left. 409 `owns_station` or `owns_business` while the person owns one: hand it over (or close it) first. |
| `listOpencastTeam` | GET | `/admin/team` | Opencast admin | A6: the Opencast team (admins), who can run a claimable station |
| `myStationStatus` | GET | `/me/stations/status` | signed in | A5: each station you're on: on air, and the next dead air within six hours, in the order of your memberships |

## stations (29)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listMarkets` | GET | `/markets` | anyone | Every market |
| `marketForZip` | GET | `/markets/by-zip/:zip` | anyone | Your ZIP decides your market. Location isn't stored. |
| `marketForConnection` | GET | `/markets/by-connection` | anyone | The market for the request's internet address, which isn't stored or logged. With no lookup configured, or a private address, `market` is null and `nearby` is the open markets (miles null). |
| `marketForLocation` | GET | `/markets/by-location` | anyone | The market for a point (the device's location), which isn't stored: the nearest market within 50 miles of its centre, and others within 60 miles, nearest first. Nothing that close: `market` null and the open markets by distance. |
| `getDial` | GET | `/markets/:marketSlug/dial` | anyone | The dial for a market in channel order, with now and next per station |
| `getGuide` | GET | `/markets/:marketSlug/guide` | anyone | The guide for a market and time window (at most 24 hours) |
| `getStation` | GET | `/stations/:stationRef` | anyone | A station page, by id or call sign |
| `search` | GET | `/search` | anyone | Search by call sign, channel number and title. A number returns a station to tune to. |
| `createStation` | POST | `/stations` | signed in | Start a station (or a studio). Nothing is public until it signs on. The creator becomes the owner. |
| `getSetup` | GET | `/stations/:stationId/setup` | signed in | Identity and settings, for master control |
| `updateSetup` | PATCH | `/stations/:stationId/setup` | signed in | Change name, description, colour (4.5:1 on white), bug, logo, legal details (owner) |
| `availableChannels` | GET | `/markets/:marketSlug/channels` | signed in | Which main channels are open in a market and band (setup step A1) |
| `chooseChannel` | PUT | `/stations/:stationId/channel` | signed in | Choose market, band and channel before first sign-on. A station gets X.1. |
| `getBreakRule` | GET | `/stations/:stationId/break-rule` | signed in | The station's break rule and blocked categories |
| `setBreakRule` | PUT | `/stations/:stationId/break-rule` | signed in | Set the break rule (owner, operator) |
| `listTranslators` | GET | `/stations/:stationId/translators` | signed in | Relays to YouTube, Twitch and any RTMP address |
| `addTranslator` | POST | `/stations/:stationId/translators` | signed in | Add a relay |
| `updateTranslator` | PATCH | `/stations/:stationId/translators/:translatorId` | signed in | Change a relay, including its break handling |
| `removeTranslator` | DELETE | `/stations/:stationId/translators/:translatorId` | signed in | Remove a relay |
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
| `upload` | POST | `/stations/:stationId/library/uploads` | signed in | Upload a file (MP4, MOV, MP3, WAV…). It's prepared for air in the background. Under a minute is guessed as BMP. |
| `importLinks` | POST | `/stations/:stationId/library/imports` | signed in | Import from links. Link imports stay on this station and come off air the same day if the owner asks. |
| `getImport` | GET | `/stations/:stationId/library/imports/:jobId` | signed in | Progress of a link import |
| `getItem` | GET | `/library/:itemId` | signed in | One item |
| `updateItem` | PATCH | `/library/:itemId` | signed in | Change title, type, program, folder, episode details or break points |
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

## log (12)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getLog` | GET | `/stations/:stationId/log` | signed in | The program log for a window (day, evening or week), with generated breaks and dead air |
| `addEntry` | POST | `/stations/:stationId/log` | signed in | Put something on the log. Items need confirmed rights; another station's program needs a carriage agreement. |
| `updateEntry` | PATCH | `/stations/:stationId/log/:entryId` | signed in | Move or change an entry |
| `removeEntry` | DELETE | `/stations/:stationId/log/:entryId` | signed in | Take an entry off the log |
| `repeatDay` | POST | `/stations/:stationId/log/repeat` | signed in | Build one day and repeat it: every day, every week on that day, or once |
| `fillGap` | POST | `/stations/:stationId/log/fill` | signed in | Fill a gap: repeat from the library (in order, with the break rule), or sign off until a time |
| `getDeadAir` | GET | `/stations/:stationId/dead-air` | signed in | Gaps in the next 24 hours and warnings sent |
| `removeRepeat` | DELETE | `/stations/:stationId/log/repeats/:repeatId` | signed in | G7: take a repeat's entries off the log from now on (owner, operator). What already aired stays in the as-run log. |
| `endEarly` | POST | `/stations/:stationId/log/:entryId/end-early` | signed in | G3: end a live block now (owner, operator, or its host). The block ends here, the programs after it move up, and playout hands back to the log at once; the as-run log records the live airing to this moment. Only while it's on air: 409 `not_on_air`, `ended`; 409 `not_live` for anything else. |
| `getLiveBlock` | GET | `/stations/:stationId/log/:entryId/live` | signed in | G3: a live block's state: ended early or not, and whether its signal is in (owner, operator, its host) |
| `listListings` | GET | `/stations/:stationId/listings` | signed in | G5: every program and live airing in a window (at most 8 days) with its listing and status (owner, operator) |
| `updateListing` | PATCH | `/stations/:stationId/listings/:entryId` | signed in | G5: an airing's episode title and description, or a carried program's local note (owner, operator). A carried program's title and description are the maker's: 409 `from_the_maker`. |

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

## spots (50)

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
| `uploadSpotFile` | POST | `/spots/:spotId/file` | signed in | Upload the spot. Checked on arrival: exact length, picture, title safe, captions, loudness, code. |
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
| `listMakers` | GET | `/makers` | signed in | Stations that take orders, and Opencast Studio |
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
| `redeemCode` | POST | `/businesses/:businessId/redeem` | signed in | Mark a code used at the counter (owner, manager). Checks it's valid and the customer's first use. |
| `getResults` | GET | `/businesses/:businessId/results` | signed in | Every airing from the as-run log with proof, tuned in and cost; codes and customers |
| `stationCustomers` | GET | `/stations/:stationId/customers` | signed in | Customers from airings on this station only, per spot |
| `tellMeWhenListed` | POST | `/orders/:orderId/tell-me-when-listed` | signed in | P24: the maker asks to be told when the business lists the spot it made (the maker's owner or operator). Told once, when it's listed; at once if it already is. |
| `listSpotCategories` | GET | `/spot-categories` | anyone | S17: every spot category, in one list: what a business is, what markets filter by, and (`blockable`) what a station can block |

## ledger (20)

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
| `pledgeCardSession` | POST | `/me/pledges/:pledgeId/card-session` | signed in | E1: a page to change the card on a monthly pledge (Stripe's), which comes back to `returnTo` (a path in the app; default the pledge's station). 422 `no_card_to_change` for a one-time or ended pledge. |

## audience (2)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `heartbeat` | POST | `/heartbeat` | anyone (personal if signed in), or a TV signed in | Players send this every 30 seconds while tuned in |
| `getAudience` | GET | `/stations/:stationId/audience` | signed in | The station's own numbers (never shown to viewers) |

## trust (6)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `fileClaim` | POST | `/claims` | anyone | A rights holder files a claim. The item goes off air at once, everywhere it's carried. |
| `listClaims` | GET | `/stations/:stationId/claims` | signed in | Claims against this station's items, and its standing |
| `answerClaim` | POST | `/claims/:claimId/answer` | signed in | Answer with a rights basis and an attestation. The item airs again; the claimant has 10 business days to respond. |
| `removeClaimedItem` | POST | `/claims/:claimId/remove` | signed in | Take the item down instead of answering |
| `resolveClaim` | POST | `/claims/:claimId/resolve` | Opencast admin | Opencast records the outcome: upheld, withdrawn or restored |
| `attachToClaim` | POST | `/claims/:claimId/attachments` | signed in | B6: upload the permission or licence that backs an answer (owner, operator; a PDF, image or text file up to 20 MB). Returns the `attachmentUrl` `answerClaim` takes. 409 `not_open` once the claim is answered or closed; 422 `wrong_file_type`, `too_big`. |

## notifications (4)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listNotices` | GET | `/me/notices` | signed in | In-app notices, newest first |
| `markRead` | POST | `/me/notices/read` | signed in | Mark notices read |
| `getPrefs` | GET | `/me/notification-prefs` | signed in | Notification settings for a scope |
| `setPrefs` | PUT | `/me/notification-prefs` | signed in | Change notification settings. Always-on kinds stay on. |

## waitlist (5)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `join` | POST | `/waitlist` | anyone | Join the waitlist. A station can ask for a call sign; it's held until the market opens. |
| `checkCallSign` | GET | `/call-signs/:callSign` | anyone | Whether a call sign is free |
| `listReservations` | GET | `/admin/reservations` | Opencast admin | Reserved call signs and the channels held for them |
| `holdChannel` | POST | `/admin/reservations/:reservationId/channel` | Opencast admin | Hold a channel number for a reservation; no other station can take it |
| `listSignups` | GET | `/admin/waitlist` | Opencast admin | Everyone on the waitlist, per market |

## network (25)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getBoard` | GET | `/admin/markets/:marketSlug/board` | Opencast admin | Every channel's state in a market |
| `createMarket` | POST | `/admin/markets` | Opencast admin | Add a market and the ZIPs in it |
| `listCreators` | GET | `/admin/creators` | Opencast admin | The creator pipeline, sorted by next action |
| `addCreator` | POST | `/admin/creators` | Opencast admin | Add a creator found in a market |
| `updateCreator` | PATCH | `/admin/creators/:creatorId` | Opencast admin | Change stage, proposed channel, next action |
| `listWorks` | GET | `/admin/creators/:creatorId/works` | Opencast admin | Works found on the creator's source |
| `addWorks` | POST | `/admin/creators/:creatorId/works` | Opencast admin | Catalogue works from titles and lengths. Nothing is copied yet. |
| `recordLicence` | POST | `/admin/works/:workId/licence` | Opencast admin | Record a work's published licence. Only CC0, CC BY and CC BY-SA count. |
| `askPermission` | POST | `/admin/creators/:creatorId/permission-requests` | Opencast admin | Send a permission request with a preview of the station's schedule built from titles |
| `getPermissionPage` | GET | `/permission/:token` | anyone | The creator's permission page |
| `answerPermission` | POST | `/permission/:token/answer` | anyone | Yes, go ahead / No thanks. Recorded against the link with the exact list of works; a copy is emailed. |
| `stopFromLink` | POST | `/permission/:token/stop` | anyone | B8: stop from the permission link, any time after a yes. Nothing the yes covered airs again: a station set up from it signs off, and its held money goes to the creator by the stop path once they're verified (a stop handover the desk checks). 422 `nothing_to_stop` without a yes; stopping twice is the same page. |
| `claimFromLink` | POST | `/permission/:token/claim` | signed in | B8: claim from the permission link, signed in, before or after the station exists. Before, the claim waits and joins the station when the desk sets it up. 422 `nothing_to_claim` without a yes, or after a stop; 422 `in_progress` while a claim is open. |
| `remindCreator` | POST | `/admin/creators/:creatorId/reminders` | Opencast admin | N2: send the one reminder about the open permission request (to the contact email, with the same link). Next action becomes No answer, due in 7 days. 422 `not_asked` unless they're Asked; 422 `reminded` after the one reminder. |
| `sendClaimInvite` | POST | `/admin/creators/:creatorId/claim-invites` | Opencast admin | N3: tell a claimable station's creator it's theirs to claim: `invite` (the station is on air, claim when you like) or `link` (the claim link itself: their permission page's Claim). Held earnings then say Invited or Claim link sent. 422 `no_station` before the station is set up; 422 `no_contact` without a contact email. |
| `listRecipes` | GET | `/admin/recipes` | Opencast admin | Station recipes |
| `saveRecipe` | POST | `/admin/recipes` | Opencast admin | Add a recipe |
| `setUpClaimable` | POST | `/admin/creators/:creatorId/station` | Opencast admin | Set up a claimable station from a recipe: channel, call sign, and the rights record attached |
| `heldEarnings` | GET | `/admin/held-earnings` | Opencast admin | Held earnings per claimable station |
| `startHandover` | POST | `/stations/:stationId/claim` | signed in | Claim (or stop) a claimable station: connect the source account to prove it's you |
| `approveHandover` | POST | `/admin/handovers/:handoverId/approve` | Opencast admin | Record the desk's check of the claimant. With the escrow contract live, the verifiers then approve on-chain (what they sign is in `onChain`) and the 72 hours start there |
| `listListedSources` | GET | `/admin/listed-sources` | Opencast admin | City and county streams |
| `addListedSource` | POST | `/admin/listed-sources` | Opencast admin | List a city stream on the dial. Viewers get the source's own player. |
| `syncListedSource` | POST | `/admin/listed-sources/:sourceId/sync` | Opencast admin | Sync listings from the agenda calendar now |
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
