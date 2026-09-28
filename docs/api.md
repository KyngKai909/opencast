# API

Generated from `packages/contracts` by `npm run docs:api`. Every path is under `/v1`. Request and response shapes are the Zod schemas in the contracts.

184 endpoints in 13 modules.

## accounts (24)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getMe` | GET | `/me` | signed in | The signed-in person, their identities, stations and businesses |
| `updateMe` | PATCH | `/me` | signed in | Change display name, market or settings |
| `mergeDevice` | POST | `/me/merge-device` | signed in | Keep presets and reminders saved on this device before signing in |
| `listPresets` | GET | `/me/presets` | signed in | Presets in order |
| `savePreset` | POST | `/me/presets` | signed in | Save a station. With a key that's taken, the old station moves to More presets (never deleted). With no key, it goes to More presets. |
| `reorderPresets` | PUT | `/me/presets` | signed in | Set the whole order and keys at once (drag to reorder) |
| `removePreset` | DELETE | `/me/presets/:stationId` | signed in | Remove a preset |
| `suggestPresetKey` | GET | `/me/presets/suggested-key` | signed in | The key to suggest replacing when all six are full: the one used least in the last month |
| `usePresetKey` | POST | `/me/presets/keys/:key/use` | signed in | Count a press of a preset key |
| `listReminders` | GET | `/me/reminders` | signed in | Upcoming reminders |
| `addReminder` | POST | `/me/reminders` | signed in | Remind me of an airing. Switch me over is off unless asked for. |
| `updateReminder` | PATCH | `/me/reminders/:reminderId` | signed in | Turn switch me over on or off |
| `removeReminder` | DELETE | `/me/reminders/:reminderId` | signed in | Remove a reminder |
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

## stations (24)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `listMarkets` | GET | `/markets` | anyone | Every market |
| `marketForZip` | GET | `/markets/by-zip/:zip` | anyone | Your ZIP decides your market. Location isn't stored. |
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

## library (15)

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

## log (7)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getLog` | GET | `/stations/:stationId/log` | signed in | The program log for a window (day, evening or week), with generated breaks and dead air |
| `addEntry` | POST | `/stations/:stationId/log` | signed in | Put something on the log. Items need confirmed rights; another station's program needs a carriage agreement. |
| `updateEntry` | PATCH | `/stations/:stationId/log/:entryId` | signed in | Move or change an entry |
| `removeEntry` | DELETE | `/stations/:stationId/log/:entryId` | signed in | Take an entry off the log |
| `repeatDay` | POST | `/stations/:stationId/log/repeat` | signed in | Build one day and repeat it: every day, every week on that day, or once |
| `fillGap` | POST | `/stations/:stationId/log/fill` | signed in | Fill a gap: repeat from the library (in order, with the break rule), or sign off until a time |
| `getDeadAir` | GET | `/stations/:stationId/dead-air` | signed in | Gaps in the next 24 hours and warnings sent |

## playout (6)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getSignOnChecks` | GET | `/stations/:stationId/sign-on/checks` | signed in | Pre-flight checks before signing on |
| `signOn` | POST | `/stations/:stationId/sign-on` | signed in | Sign on. Refused while a blocking check fails. The first sign-on fixes call sign and channel. |
| `signOff` | POST | `/stations/:stationId/sign-off` | signed in | Sign off (owner, operator) |
| `cueBreak` | POST | `/stations/:stationId/cue-break` | signed in | Cue a break now during a live block (owner, operator, or the block's host) |
| `getStatus` | GET | `/stations/:stationId/playout` | signed in | What's on air now, and the output |
| `getAsRun` | GET | `/stations/:stationId/as-run` | signed in | What actually aired, to the second |

## catalog (11)

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

## spots (47)

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
| `scanCode` | POST | `/c/:code/scan` | anyone | Count a QR scan (from the page the QR opens) |
| `saveOffer` | POST | `/c/:code/save` | anyone (personal if signed in) | Save the offer to a phone |
| `redeemCode` | POST | `/businesses/:businessId/redeem` | signed in | Mark a code used at the counter (owner, manager). Checks it's valid and the customer's first use. |
| `getResults` | GET | `/businesses/:businessId/results` | signed in | Every airing from the as-run log with proof, tuned in and cost; codes and customers |
| `stationCustomers` | GET | `/stations/:stationId/customers` | signed in | Customers from airings on this station only, per spot |

## ledger (14)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `getBalance` | GET | `/businesses/:businessId/balance` | signed in | Available, held and spent, the runway in days, pending deposits |
| `listMovements` | GET | `/businesses/:businessId/movements` | signed in | Money in and out, and airings |
| `addFundingSource` | POST | `/businesses/:businessId/funding-sources` | signed in | Link a bank through Clear, a card through Stripe, or a Clear business account (owner only). The token comes from the provider's own widget. |
| `quoteDeposit` | POST | `/businesses/:businessId/deposits/quote` | signed in | The fee in dollars before paying (card: Stripe's fee at cost; bank and Clear: none), and roughly how many airings |
| `addMoney` | POST | `/businesses/:businessId/deposits` | signed in | Add money (owner, manager). Bank transfers arrive in 1 to 2 business days and can be undone until then. |
| `cancelDeposit` | POST | `/businesses/:businessId/deposits/:depositId/cancel` | signed in | Undo a deposit that hasn't arrived |
| `withdraw` | POST | `/businesses/:businessId/withdrawals` | signed in | Take out unheld money (owner only) |
| `listStatements` | GET | `/businesses/:businessId/statements` | signed in | Monthly statements with every airing |
| `getStationEarnings` | GET | `/stations/:stationId/earnings` | signed in | Earnings lines, held money, the account and next payout (owner; operators see only) |
| `listStationStatements` | GET | `/stations/:stationId/statements` | signed in | Weekly statements; the CSV has the ledger entries behind each line |
| `moveToBank` | POST | `/stations/:stationId/payouts` | signed in | Move earnings to the bank now (owner only) |
| `pledge` | POST | `/stations/:stationId/pledges` | signed in | Pledge monthly or once, by card. Credit me on air uses the display name. |
| `listMyPledges` | GET | `/me/pledges` | signed in | My pledges |
| `updatePledge` | PATCH | `/me/pledges/:pledgeId` | signed in | Change the amount or on-air credit, or stop (it ends after the current month) |

## audience (2)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `heartbeat` | POST | `/heartbeat` | anyone | Players send this every 30 seconds while tuned in |
| `getAudience` | GET | `/stations/:stationId/audience` | signed in | The station's own numbers (never shown to viewers) |

## trust (5)

| | Method | Path | Who | What |
|---|---|---|---|---|
| `fileClaim` | POST | `/claims` | anyone | A rights holder files a claim. The item goes off air at once, everywhere it's carried. |
| `listClaims` | GET | `/stations/:stationId/claims` | signed in | Claims against this station's items, and its standing |
| `answerClaim` | POST | `/claims/:claimId/answer` | signed in | Answer with a rights basis and an attestation. The item airs again; the claimant has 10 business days to respond. |
| `removeClaimedItem` | POST | `/claims/:claimId/remove` | signed in | Take the item down instead of answering |
| `resolveClaim` | POST | `/claims/:claimId/resolve` | Opencast admin | Opencast records the outcome: upheld, withdrawn or restored |

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

## network (20)

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
| `listRecipes` | GET | `/admin/recipes` | Opencast admin | Station recipes |
| `saveRecipe` | POST | `/admin/recipes` | Opencast admin | Add a recipe |
| `setUpClaimable` | POST | `/admin/creators/:creatorId/station` | Opencast admin | Set up a claimable station from a recipe: channel, call sign, and the rights record attached |
| `heldEarnings` | GET | `/admin/held-earnings` | Opencast admin | Held earnings per claimable station |
| `startHandover` | POST | `/stations/:stationId/claim` | signed in | Claim (or stop) a claimable station: connect the source account to prove it's you |
| `approveHandover` | POST | `/admin/handovers/:handoverId/approve` | Opencast admin | Record the verifier's approval; the 72-hour public waiting period starts |
| `listListedSources` | GET | `/admin/listed-sources` | Opencast admin | City and county streams |
| `addListedSource` | POST | `/admin/listed-sources` | Opencast admin | List a city stream on the dial. Viewers get the source's own player. |
| `syncListedSource` | POST | `/admin/listed-sources/:sourceId/sync` | Opencast admin | Sync listings from the agenda calendar now |
