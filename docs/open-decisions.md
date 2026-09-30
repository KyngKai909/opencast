# Open decisions

Things that aren't decided yet. Each is built as configuration with a safe default of zero or off. When one is decided, change its default and move it to "Decided" with the date.

## Money

| Decision | Where it lives | Default |
|---|---|---|
| Opencast's share of spot revenue | the rules registry, `shares.opencast.spotBps` (Network desk, Settings, Rules; since 2026-09-29, was `ledger.revenue_config.opencast_spot_share_bps`, which still reaches it) | 0 ("Not set yet") |
| Opencast's share of pledges | `shares.opencast.pledgeBps` (was `revenue_config.opencast_pledge_share_bps`) | 0 |
| Whether Opencast's share applies to production orders | `shares.opencast.productionBps` (was `revenue_config.opencast_production_share_bps`) | 0 |
| The pool: its share, and the split between base, watch time and fund | `shares.pool` (was `revenue_config.pool_*_bps`) | 0 |
| Payout schedule | `money.payout_schedule` (was `revenue_config.payout_schedule`) | weekly |
| Unclaimed period before escrow goes to the creator fund | `escrow.unclaimed_period` (was `revenue_config.unclaimed_period_days`); the contract's own period is fixed at deployment | 1095 (3 years) |
| Which chain the escrow contract is on, and whether it belongs to Opencast or to the Clear protocol beside its encumbrance | Phase 6 | the chain Clear uses by default |
| Which entity holds advertisers' prepaid money, and what that requires legally | lawyer, before launch | none |
| Final ownership terms for production orders | spots, Phase 4 | the business owns the spot; the maker may show it in samples |
| Rounding: per airing, or per statement line? The designs disagree by 7¢ (18 × $2.10 = $37.80 vs 18 × 262 × $8 ÷ 1,000 = $37.73) | ledger, Phase 6 | settle each airing in micro-dollars; round only when paying out |
| "One day of budget" for a spot with no daily cap | `spots.one_day_of_budget`, `oneDayOfBudgetMicros` | daily cap, else the total over its dates, else the whole total |
| When a spot pauses for balance: when available "runs out" (prompt) or "drops below a day of budget" (design) | spots, Phase 6 | the design's rule, below a day |
| Sponsorships: held monthly and released at month end (prompt), or accrued weekly (the earnings design shows weekly lines)? | ledger, Phase 6 | the prompt's rule, monthly |
| Code window: "used within 7 days" of an airing, but a saved offer shows "until" 14 days after saving | `spots.codes.window_days` | 7 |
| Can Opencast open a Clear business account on someone's behalf during sign-up, or must they open it in Clear first? A Clear business account lives in Clear's own systems and Privy app; Opencast reaches it only through the linked global wallet and Clear's API | `ClearClient.openAccount` (docs/clear-integration.md) | they open it in Clear first |

## Money behaviour decided while building Phase 6 (say if any should change)

| Behaviour | Built as |
|---|---|
| What resumes a spot paused for balance | Only a top-up. Money returning from a hold (an airing cheaper than held, one that didn't air) doesn't, or a spot at the edge would flap and notify each time |
| "How much open time that leaves" in the pause notice | The spot's average daily air time on that station over the last 7 days |
| Auto top-up | When on: once the runway is under the business's chosen days, from the default funding source, at most once a day |
| Low-balance warnings | Once per threshold (3 days, 1 day) until the next top-up, not daily |
| A disputed production order | Opencast reviews it: pay the maker, refund the business, or split (the maker gets part, the rest goes back; the business keeps the spot) |
| Payouts | Weekly on Mondays by default (`revenue_config.payout_schedule`); stations under $1, owing carriage fees, or without a finished payout account wait |
| The pool | Shared on the 1st for last month by `pool_base_bps` (equally among stations that aired), `pool_watch_time_bps` (by minutes tuned in) and `pool_fund_bps` (to the creator fund on-chain). All 0 until decided; the rest stays in the pool |
| Statements | Weekly for stations (Mondays), monthly for businesses (the 1st); CSV at `GET /v1/statements/:id/csv` |
| Cash carriage | Charged when the episode airs, once per log slot; per hour uses the slot's length |
| Opencast's settlement wallet | The chain job signs with `SETTLEMENT_PRIVATE_KEY`; with Clear, the settlement Clear account must be that wallet (docs/clear-integration.md) |

## Ads from partners (not built; docs/architecture.md says what's ready)

| Decision | Where it lives | Default |
|---|---|---|
| The provider: Google Ad Manager's Dynamic Ad Insertion, AWS Elemental MediaTailor, or another, behind the `adfill` interface | playout, when built | none: the switch (`BreakRule.adsFromPartners`) changes nothing yet |
| Whether to start through a FAST aggregator's demand, if exchanges won't take Opencast directly at launch | when built | through an aggregator, if needed |
| Opencast's share of ads from partners, and whether the pool applies | `revenue_config`, when built | 0 ("Not set yet"), as for spots |
| Whether the IAB mappings for Opencast's categories (`packages/domain/src/ads.ts`) are right, and which categories to add | domain | Classic maps to Movies and Television; Public affairs to Politics and Civic affairs |

## The escrow contract and the creator fund

| Decision | Now | Default |
|---|---|---|
| Upgradeable? | Yes, at the owner's request (2026-09-28), UUPS like the Clear protocol's contracts. The prompt asked for no upgrade path; a 7-day timelock that any verifier or steward can cancel keeps upgrades public and stoppable | 7-day delay |
| Who holds the verifier and steward keys, and the thresholds | Set at deployment, changeable only through the timelock | 2 of 3 each, held by different people; stewards needn't be the verifiers |
| The admin Safe | Proposes and executes admin changes through the timelock | Opencast's Safe |
| When the unclaimed clock starts | The station's first deposit | 3 years after it |
| What the creator fund pays for | Grants to new stations and programs, each with a public record (its hash on-chain) | Stewards decide; the rules for who qualifies aren't written yet |
| USDC sent to either contract directly | Escrow: stays there. Fund: counts toward grants | none |
| Chain | Base, Clear's chain; tested locally on anvil | Base Sepolia for staging |

## Rights and trust

| Decision | Where it lives | Default |
|---|---|---|
| Repeat-infringer threshold (3 upheld in a year pauses carriage offers) | the rules registry, `rights.repeat_limit` (since 2026-09-29; `trust.policy` still reaches it) | 3 (a placeholder) |
| Days to answer a claim | `rights.claim_dates.answerDays` (was `trust.policy.answer_days`). The desk-pages frame shows 5 days: the code keeps 14 until someone sets it | 14 |
| Claimant's time to reply after an answer | `rights.claim_dates.counterNoticeBusinessDays` (was `trust.policy.claimant_reply_business_days`) | 10 |
| Takedown and counter-notice wording and deadlines | lawyer | none |
| The claimable-station permission page wording | lawyer | none |

## Network desk: Settings and the catalog (added 2026-09-29, follow-up Phase 0 items 10 and 11)

Every Open rule is set in Network desk, Settings, Rules, from a date, with the old value kept in the change log (the rules registry, `network.rules`, read by the API's `settings.valueAt(key, at)`). Nothing is retroactive: a new version starts today or later. Migration 0027 started the registry with the values in effect before it, so nothing reads differently. Its definitions are `packages/contracts/src/rules.ts`.

| Decision | Where it lives | Default |
|---|---|---|
| Public domain in the US: works published this many years ago or more (the cut-off year moves every January 1) | `rights.public_domain_us.termYears` | 95 (in 2026, published in 1930 or earlier) |
| Works published after the cut-off and up to this year are public domain only if not renewed (a renewal search) | `rights.public_domain_us.renewalRequiredThrough` | 1963 |
| Works published up to this year are public domain if published without a notice | `rights.public_domain_us.noticeRequiredThrough` | 1977 |
| Sound recordings (the Music Modernization Act's terms for recordings from before February 15, 1972) | `rights.sound_recordings_us` | before 1923 free; 1923 to 1946, 100 years; 1947 to 1956, 110 years; 1957 to 1972, until February 15, 2067 (in 2026, published in 1925 or earlier) |
| Outside the US | the rules are US rules only | anything published elsewhere is checked by hand: the checklist can't be sent until the rules say it's public domain |
| The checklist and the renewal-search method | lawyer, once, before the catalog launches (desk-catalog 03's note) | the five lines drawn: the source, publication and notice, renewal, soundtrack, characters and trademarks |
| What counts as evidence | `shelf.send` | a file (PDF, picture or text, 20 MB), or a written record, on every line the rules don't answer |
| Who can do the second check | desk roles | a rights reviewer or an admin who didn't do the first; the database refuses the same person |
| Composing episodes: joined into one file (H.264/AAC, the tallest item's height up to 1080, 30 fps) and prepared once like any program | `shelf/compose.ts` | re-encoded, not stream-copied, so items from different sources join cleanly |
| Bumpers inside catalog episodes | not built | none: an episode is its items; the carrier's breaks bring bumpers |
| Prices, relay hours, live hours, the free allowance, platform limits | `prices.*`, `relays.platform_limits` | the starting price sheet from October 1, 2026 (docs/pricing.md; see "Pay-as-you-go" below); 10 GB and 5 live hours free; Twitch 48 hours, Facebook 8, YouTube saves under 12 (read by Phases 2 and 3) |
| Each market's numbering | `numbering.channels`, per market | TV 2 to 69 with subchannels; radio 88.2 to 107.8, even tenths (the user's decision; the frame's "88.1 to 107.9" is from before it). Stations choose only inside their market's range |
| Market leads: which pages | desk roles | the board, the creator pipeline (creators, works, asking, reminders), external sources and reservations of their own market; everything else is admins' |
| Escrow signer changes | Settings, Escrow signers | every other admin (as of the proposal) approves; any one refuses; one open at a time. Approved changes go to the timelock (contracts/README.md) |
| Taking admin away from someone in OPENCAST_ADMIN_EMAILS | accounts | it doesn't stick: the list makes them an admin again at their next sign-in (Settings says so) |

## Network desk: Catalog sponsors (added 2026-09-29, follow-up Phase 0 item 11, desk-pages 03)

The catalog's one credit an hour, sold by series and market (the Network desk's Catalog sponsors page). A catalog sponsorship is a sponsorship like any other underneath (`spots.sponsorships` with its `market_id`), so it's prepaid: held from the business's balance on the 1st, paid at the month's end, and lapsed when a month can't be held.

| Decision | Where it lives | Default |
|---|---|---|
| Whether Clear pays for the catalog slots it fills (the frame shows Clear at $400.00 a month) | each month's Clear-filled slots (series, market, credits aired) are recorded on the 1st in `spots.catalog_house_credits`, with `billed_micros`; nothing posts to the ledger | not billed: `billed_micros` 0, and the page says "Not billed". A bill can be made from those rows once it's decided |
| Where catalog sponsorship money goes (Opencast, the co-op pool, the creator fund) and in what split | the rules registry, `shares.catalog_sponsorship` (`opencastBps`, `poolBps`, `fundBps`; Settings, Rules, Shares). Read by nothing until it's decided | 0% each, "Not set yet". Until then it settles into the catalog station's earnings, as any sponsorship of the catalog station's programs would, with Opencast's share of spots and sponsorships (`shares.opencast.spotBps`, 0) and the pool (`shares.pool`, 0) taken as for any sponsorship |
| The price of a catalog slot: one series in a market, or every series in a market | `catalog.sponsor_prices`, per market (a market's own version wins; Settings, Rules, Catalog sponsors) | not set: no slot is for sale, and the credit thanks Clear everywhere |
| The house sponsor's name and line on air | `CATALOG_HOUSE_SPONSOR` in the contracts (not a rule) | "Clear", "The member-owned co-op" |
| Assigning a slot on a business's word (the desk's "Assign it"), besides offering it for the business to accept | `assignCatalogSponsorship`; who assigned is kept (`offered_by`, `decided_by`) | allowed to the market's lead or an admin with "They've agreed" ticked; its first month is held at once or nothing is assigned. The business app has no screen to accept an offer yet (the API has `answerCatalogOffer`) |
| A sponsorship that starts mid-month | as station sponsorships | the whole month is held and paid; credited from the moment it's agreed |
| Ending a sponsorship | the desk or the business | credited to the end of its paid month, not refunded, then Clear again |

## Watch data (added 2026-09-29, follow-up Phase 1)

Collected and stored only (`docs/schema.md`, "Watch data"). Nothing that decides what airs or how money is split reads it yet.

**Open, not built:**

| Decision | Where it would live | Now |
|---|---|---|
| Syndication market stats for stations deciding what to carry (how a program does elsewhere) | the market's offers, from `audience.airing_stats` added up across carriers | not built: no station sees another station's numbers, and offers show none |
| A "share by watch time" carriage deal type: a station's break revenue split among the makers it carried, by watch time, perhaps adjusted for time slot | a new `CarriageTerm`, settled from `airing_stats.watch_seconds` | not built: the deal types are barter, cash, cash plus barter and free, as before |
| Station-level skippable blocks (a jukebox hour; never spots, credits, station IDs, or carried programs unless the maker allows it) | the log and the player | not built: nothing is skippable |

**Decided while building (say if any should change):**

| Decision | Where it lives | Default |
|---|---|---|
| How long per-session rows are kept | the rules registry, `watch_data.retention` (Settings, Rules, group `watch_data`) | 30 days (2 to 90). Votes go sooner: once their airing is final, an hour after it ends |
| The minimum audience | `watch_data.minimum_audience` `{ viewers, carriedAirings }` | 20 viewers at once at some point **in that airing** (each airing is gated on its own, not the program once any airing reached it). Stored regardless |
| What a maker sees of other stations | `watch_data.minimum_audience.carriedAirings`, `audience.watch.forMaker` | other stations' airings only added together, at least 2 of them reaching the minimum between them; the maker's own airings always count. Otherwise they're left out and counted in `notCounted` (so one carrier's single airing can never be read off by subtracting the maker's own) |
| One "Not for me" per viewer per airing | `audience.not_for_me_votes` (session, log entry) | one per **session**, signed in or not: the person is never stored, so a signed-in viewer on two devices can vote twice. A vote is for the log entry on the station's log when it's sent, and counts from a session counted in 2 of the program's minutes |
| Bot filtering for watch data | `watch.ts` | a session ever flagged is left out entirely, including the minutes it was counted as tuned in before it was caught (the station's tuned-in line keeps those, as before) |
| The existing tuned-in figures on the Audience page's program rows (average, peak, stayed from the line) | `AudienceReport.byProgram` | unchanged, not behind the minimum: they're the station's own tuned-in counts from before. Only the new `watch` numbers are gated. Say if the minimum should hide them too |
| "Not for me" in the player | `features.not_for_me` (group `features`), read by the apps from `GET /v1/config` | off. The API takes votes either way. The desk's Rules page draws the `watch_data` and `features` groups (Settings, Rules), so the desk can change them |
| External stations' tuned-in time (Phase 6) | `airing_stats.external` (a `listed` station's airings) | recorded and labelled, left out of the maker's totals; nothing that pays reads `airing_stats` |

## Product

| Decision | Where it lives | Default |
|---|---|---|
| Whether political spots are allowed | `broadcast.blocked_categories` | no platform rule yet; each station can block the category |
| Whether viewers need wallets | accounts | no |
| Listing a stream from outside a market (a county meeting covering two markets) | network | not supported |
| When a maker's rotation is empty: is its barter share given back to the carrier, or filled with a station ID? | playout, Phase 5 | a station ID |
| The revenue split for licensed catalogs | catalog | none |
| Watch history when the setting was never touched (A2) | `accounts.keepsWatchHistory` | kept (unset counts as on, as the viewer's settings show it); off clears it |
| A grace period before an account is deleted (A3) | `accounts.deleteAccount` | none: at once, as the frames say "This can't be undone" |
| Deleting the account of someone who owns a business (A3) | `accounts.deleteAccount` | refused (409 `owns_business`) until a business can be closed or handed over (P21) |
| Deleting the Privy user (and its embedded wallet) with the account (A3) | accounts | not done: the wallet may be where a creator's escrow is paid |
| Quiet hours: which notices they hold back (O2) | `notifications.inQuietHours` | pushes in the viewer scope (reminders, switch over, presets going live, station news); on by default, 22:00 to 08:00 in the account's market's time |
| What moves up when a live block ends early (G3) | `log.endEarly` | the programs right after it, in order, until a gap, a live block, a carried program or a program whose breaks already hold spots; what's left becomes a gap the dead-air fill takes |
| How far ahead the switcher warns of dead air (A5) | `accounts.stationStatus` | six hours, on-air stations only |
| Who may upload a claim's attachment, and what (B6) | `trust.attach` | owner or operator (as answering); PDF, images or text, 20 MB |
| The offer on a code Opencast adds (P4, A116) | `spots.uploadSpotFile`, `spots.review` | the spot's title: nothing is promised until the business names an offer |
| How near a station has to be for a business to sponsor it (P16) | `spots.sponsorTargets` | 25 miles from one of its places (or its service area's radius, if larger); online businesses: their markets |
| Closing a business with an order being made (P21) | `spots.closeBusiness` | refused (409 `order_in_progress`) until it's approved, or cancelled after its delivery date |
| The Redeem tool's default (P12) | `Business.redeemOn` | on, except for online businesses |

## Apps, hosting and sign-in (decided; recorded 2026-09-29)

| Decision | What was decided | Where it lives |
|---|---|---|
| Where the four web apps are hosted | The user's decision: `apps/web` (viewer, master control and the desk), `apps/business`, `apps/tv` and `apps/site` are static builds deployed on Vercel, not Railway. Railway keeps the API and the worker | `docs/deploy.md` (Services, Staging); `.railway/railway.ts` and `nixpacks.toml` cover the API and worker only |
| What `apps/tv` shares with the viewer | `apps/tv` depends on `packages/ui`, `packages/player` and `packages/contracts` only, never on `apps/web`'s viewer code. What the TV needs from the viewer is copied into `apps/tv` and kept to the TV's own frames (its mocks, its guide logic, its settings) | `apps/tv/package.json`; `apps/tv/src` |
| Sign-in in `apps/business` | Business has its own copy of the auth layer (`apps/business/src/auth`), the same Privy app as `apps/web` with `createOnLogin` off. Signing in on one origin doesn't sign you in on the other yet: that needs Privy's session cookies (`privy-token`, which the API already reads) set on a shared parent domain, once the real domain exists (e.g. `app.<domain>` and `business.<domain>` under `<domain>`), with the Privy app's allowed origins and cookie domain set to match | `apps/business/src/auth/privyAuth.tsx`, `apps/web/src/auth/privyAuth.tsx`; `tokenFrom` in `apps/api/src/v1/auth.ts` |
| When a creator gets a wallet | At the claim, not at sign-in (see the design conflict "Stop pays an unclaimed creator" below) | `creatorWallet` in `apps/web/src/auth/privyAuth.tsx`; `recordWallets` in `apps/api/src/v1/modules/accounts/service.ts` |

## Invites and email (added 2026-09-29)

| Decision | Where it lives | Default |
|---|---|---|
| Whether accepting an invite made to an email needs that email on the signed-in account (a verified email sign-in, Google or Apple address, from Privy's linked accounts) | `INVITE_EMAIL_MATCH` (api; `deps.config.inviteEmailMatch`), `accounts.acceptInvite` | on: someone else is refused (403 `invite_email_mismatch`) and the invite's page offers "Sign in with another email". `off` lets anyone signed in with the link accept |
| An invite by phone | `accounts.invite`, `accounts.acceptInvite` | nothing is sent (there's no text-message provider), and with no address to check, anyone signed in with the link can accept it |
| The sending domain and address | `EMAIL_FROM` (api, worker) | **Open** until a domain is bought: Resend's test sender, which only reaches the Resend account's own email |
| How often an invite's email can go again | `RESEND_GAP_MS` in `accounts/service.ts` | 10 minutes apart; each send extends the invite a week |

The email provider is decided: Resend (the user's choice, 2026-09-29), through its HTTP API with no new dependency (`apps/api/src/v1/email.ts`).

## Built with a stand-in, to replace

| What | Now | Replace with |
|---|---|---|
| Money providers | `payments.ts` local fake: bank deposits arrive when told, cards at once, no real money | Clear (bank, USDC, encumbrances) and Stripe (cards, pledges), Phase 6 |
| Proving a claimant owns the source account | Recorded; an admin checks it before approving | OAuth with each platform (YouTube, Vimeo, SoundCloud…) |
| Title-safe and caption checks on spot uploads | Shown as pending, checked in review | Frame analysis and speech-to-text |
| Push and email delivery | Logged | A push provider and Resend (as the Clear apps use) |
| Midnight for daily caps | Los Angeles time | Each market's own time zone |
| Carried episodes' slot length | Rounded up to the next half hour, which leaves the barter break | The maker's own slot length, if the designs want one |
| Stations that take production orders | `takesOrders` on the station (studios always do) | Confirm with the design |
| "Cached for air" on an item's history (L5) | Prepared in every rendition of its band, with no claim on it (read from `prepared_renditions`; there's no worker cache) | Nothing: settled by prepare once |
| Live source quality and output bitrate (S14, G2) | Always null | The worker's feeds and muxer reporting resolution and bitrate |
| Captions (L7) | Tracks are uploaded or edited (WebVTT, SRT converted); nothing generates them, and they aren't in the playout output | Speech-to-text, and a subtitle rendition in the HLS (X2) |
| A spot's still colour on the market (P23) | Picked from eight colours by the business's id | A colour the business chooses, or a frame of the spot |
| Why an airing ran short (P15) | "The break was cut short" for every short airing | The as-run recording why (a live program ran over, a break cut) |
| Clear Pay uses (P20) | Clear Pay connects (a token is kept) but counts nothing | Clear's payment events, once Clear defines them (docs/clear-integration.md) |
| Checkout webhook secrets (P20) | Kept in `spots.connections.secret` as given | Encrypted at rest, or the provider's OAuth app with one app secret |
| Upload check boxes (P1) | Only the code's box; title-safe problems are checked in review | Frame analysis finding text outside title safe, with its box |

## Storage

| Question | Now | Proposal |
|---|---|---|
| Content IDs "in the IPFS CID format ... so any file can move to IPFS later without renaming" | Every object is keyed by a CIDv1 (raw codec, sha-256) of the whole file. That's a valid CID and dedupes exactly, but IPFS itself stores a file over about 1 MiB (more than one block; the exact size is the IPFS node's chunker setting) as chunked UnixFS, so pinning a video gives it a *different* CID (`bafybei…`, dag-pb) that names the chunk tree, not the bytes | **Recorded 2026-09-29:** this is why `contents.ipfs_cid` is stored separately from the content ID. The raw CID stays our key (it names the bytes; nothing renames); on publish the IPFS CID is recorded beside it. `sha256FromCid` refuses anything but a raw sha-256 CIDv1, so an IPFS CID can never be read as a content ID. The Pinata move copies each pin under its raw CID and relinks the rows that used the pin. Say so in the Export to IPFS copy: "published as bafybei…" |
| Which Pinata pins are catalog items | None yet: the catalog station has published nothing, and the migration keeps any `--keep <cid>` or `ipfs_reason = catalog` | Mark catalog pins before running `--unpin` |
| Pins made through Pinata's legacy API | The old project's key is scoped to the v3 Files API; the legacy pin list answers 403, so only v3 files were counted (1 file, 0.1 GB) | Check the Pinata dashboard's total, or use an admin key, before unpinning |
| R2 bucket | Decided: development stays on local disk (test uploads never reach a real bucket). No Cloudflare access is set up yet | Phase 7 creates `opencast-media-staging` and `opencast-media`, each with its own keys on api and worker only. At the production cutover, the pinned file is copied in (verified by hash) and unpinned after, since the old app still reads it from the gateway until then |
| Proof frames and previews on R2's lifecycle rules | Since 2026-09-29 previews play the prepared segments; the storage sweep deletes the old `previews/` renditions | A one-year lifecycle rule on `proof/`; none needed on `previews/` once the sweep has run |
| Worker scratch space | There's no worker cache any more: items are prepared from object storage into scratch space and written back | A small volume (or the container's disk) for `WORKER_SCRATCH_DIR`: the largest original being prepared, its renditions, and translators' buffers |

## Playout, to settle in deploy (Phase 7)

| Question | Now | Proposal |
|---|---|---|
| Where HLS lives when the worker and API are separate services | Same disk locally; the API serves `/hls` with cues | The worker writes HLS to R2 (or serves it itself); viewers play Livepeer's output, which carries the same stream |
| SCTE-35 through Livepeer | Livepeer takes RTMP in, and RTMP has no place for SCTE-35, so cues can't pass through it | Cues come from us: the API's playlist for our HLS, and the as-run/breaks for players on Livepeer's output |
| Pre-warming neighbouring channels | Not on the server | In the player: it loads the next and previous stations' playlists and first segments in the dial order (the apps prompt's `packages/player`) |
| Proof frames kept a year | Written to `storage/proof` | A retention job, and R2 in production |
| Several worker replicas | One leader airs everything | Shard stations across replicas when one machine can't encode them all |

## Design conflicts (for the design to correct; the backend follows the prompt)

| Conflict | Backend does |
|---|---|
| The market board holds call sign `SK8`, which has a digit; the rule is 3 to 5 capital letters | Rejects it |
| OCAT "moves to a free channel so the number can go to someone local", but channel numbers are fixed after first sign-on | A station's channel can't change after sign-on. A move would need a new channel row and a rule allowing it for the catalog station only |
| Escrow station IDs in the designs (#33, #101) match channel numbers | Each station gets its own stable `escrow_id`, since a channel can be released |
| Band and market are also shown as fixed after sign-on | Enforced: both are on the channel row, which is fixed |
| Hosts go live on their blocks, but the browser source is "Owners and operators" only | Hosts get go-live on their assigned programs (`host_assignments`) |
| A radio-band station is listed as a station "kind" in spot targeting | Band is its own field; categories stay categories |
| The waitlist has four roles, Phase 4 lists three | All four: viewer, station, producer, business |
| Stop pays an unclaimed creator "within a week", but they have no wallet until they sign in | The escrow pays Stop only to an approved creator wallet, after 72 hours in public. Privy makes no wallet at sign-in (`createOnLogin` is off in the web and business apps, for everyone). Instead, when a signed-in creator claims (or stops) from the permission page's Claim now or master control's claim page, the page makes their Privy embedded wallet first with `createWallet` (unless they already have a wallet: one they signed in with, or one made before), and the claim then reads their wallets from Privy and records it on the account, where approving finds it (`walletOf`). Approving reads Privy again if nothing was recorded, and refuses with `no_wallet` only when there's still none. Updated 2026-09-29 (catch-up report, section 5) |

## Pay-as-you-go for stations (added 2026-09-29, follow-up Phase 2)

Being on air is free; a station pays for storage, relays of everything it airs and live hours through Livepeer (docs/pricing.md, docs/stripe.md). Every price is in the rules registry with an effective date (Network desk, Settings, Rules, Pay-as-you-go), set by migration 0033 as the starting price sheet: cost plus a margin from the Phase 5 measurements, **every number for review**.

| Decision | Where it lives | Default |
|---|---|---|
| Storage price (originals and prepared segments together, GB a month, each day's GB averaged) | `prices.storage.perGbMonthMicros` | $0.04 from 2026-10-01 (cost about $0.018); not set before |
| Relays of everything a station airs (per hour, per station, however many platforms) | `prices.relay_everything.perHourMicros` | $0.20 from 2026-10-01 (cost $0.085 to one platform, $0.15 to two, $0.22 to three: three or more lose money) |
| Live hours through Livepeer | `prices.live_hours.perHourMicros` | $0.75 from 2026-10-01 (cost $0.33 plus $0.03 a viewer-hour; $0.48 at 5 viewers) |
| Radio live through the worker's own ingest (not Livepeer): billed, or free? | `prices.radio_live.perHourMicros`, its own usage type (`radio_live`), metered either way | free ($0; cost about $0.002 an hour) |
| The free allowance each month | `prices.free_allowance` (`storageGb`, `liveHours`) | 10 GB and 5 live hours (costs Opencast about $2.58 a station a month) |
| The grace period before relays and live hours pause, and the warning before its end | `billing.grace` (`days`, `warnDaysBefore`) | 14 days, warned 3 days before |
| Number and call sign licenses (yearly renewals) | reserved in the pricing table (`RESERVED_USAGE_TYPES`, packages/contracts billing.ts); not built | none |
| Who pays: independent stations and studios. Claimable stations (Opencast runs them for their creator), listed city streams and the catalog station | `BILLED_KINDS`, apps/api/src/v1/modules/ledger/billing.ts | not billed (their usage isn't metered) |
| Stripe's card fee on a usage charge: out of the price, or on top? | `recordCardPayment` | out of the price (a `card_fee` entry from `opencast_usage`); on top would be a surprise |
| Amounts under Stripe's card minimum ($0.50) | `CARD_MINIMUM_MICROS` | carried to the next month's bill; no grace for them |
| Which funding source pays when the owners haven't chosen | `resolveFunding` | an owner's linked Clear wallet with full access, else the card on file (the prompt's order); the owners can choose one |
| When earnings pay usage | `collectFromEarnings` | before every payout (weekly by default) and when the month closes: usage owed comes out of earnings before anything is paid out |
| Days and months for billing | the jobs | UTC (a month closes at 00:00 UTC on the 1st, 5 pm the day before in Los Angeles) |
| A GB | metering | 10^9 bytes |
| What a storage cap pauses | `USAGE_TYPES.storage.pauses` | new uploads and link imports (409 `storage_paused`); files already kept stay, at no more than the cap |
| A cap of $0 | `checkCapsFor` | reached by anything billable; usage inside the free allowance doesn't reach it |
| Metering before the first run | the jobs | none: metering starts the day it first runs, with no backfill |
| Stripe's Connect fallback (`PAYMENTS_PROVIDER=stripe_only`) on ClearLabs Inc's account | docs/stripe.md | stations would see ClearLabs Inc's branding in Express onboarding until Opencast has its own Stripe account |

## Platform connections and relay viewers (added 2026-09-30, follow-up Phase 3)

docs/platforms.md has the setup and how relay viewers are billed. What's decided here, and what's still Open:

| Decision | Where it lives | Default |
|---|---|---|
| **Open**: how long a local business's relay part waits for YouTube's location data before it's returned | rule `relays.location_wait` (Network desk, Settings, Rules, Relays) | 7 days; no version set, the fallback is the value |
| **Open**: Facebook by sign-in (Facebook Live API, a Facebook app, Meta's review) | `SIGN_IN.facebook` false; `PlatformList.signIn.facebook` | not built: Facebook is added by hand with its RTMPS address and key, can't be counted or marked as paid promotion (the station is reminded), and its 8-hour restarts are the station's (relay.md) |
| Opencast viewers a local business pays for | `relayViewers.opencastViewers`, `audience.placedTunedIn` | only viewers placed in its area by market: a signed-in viewer's chosen market, else a coarse location from the connection (GEOIP_URL). Viewers Opencast can't place aren't billed to local businesses, so without GEOIP_URL signed-out viewers never are. Online businesses pay for every viewer, as before |
| Which markets are "inside the area" | `areaFor`, apps/api/src/v1/modules/spots/relayViewers.ts | a market a business location is in (its centre within 50 miles), a market whose centre is within the area's reach, and the market of the station the spot aired on (matching only airs a local spot on a station inside the area) |
| Which of YouTube's places are inside the area | `inside` | within the area's reach (a service area's radius, or the spot's "within miles") of a location; with no reach set, in one of the area's markets. Places YouTube reports that can't be placed (no PLACES_URL, a name it can't find) count as outside |
| **To confirm on a real channel**: the YouTube Analytics `city` dimension's values (names, or IDs that need a lookup) | `youtubeClient().geography`, providers.ts | read as names and placed with PLACES_URL |
| YouTube's geography: per broadcast and per day, since one relay broadcast can run for days | `broadcast.platform_geography` (platform, broadcast, day) | the spot's day of its broadcast; asked from the next day (UTC), every 6 hours, until it comes or the wait is over |
| The relay estimate in a hold | `holdEstimate` | the platforms' usual viewers at that hour over the last week, at the spot's rate, inside the per-airing maximum; local businesses: all of YouTube's (a ceiling; what isn't used goes back), never Twitch's |
| How the held estimate is shared between platforms | `open`, relayViewers.ts | by their usual viewers (equal shares without history). A part that costs more than its share pays the rest from the balance, then Opencast absorbs it, as any per-thousand airing |
| When an online business's relay part settles | `COUNTS_SETTLE_MS` | 2 minutes after the spot ends (each platform is polled every minute) |
| The per-airing maximum with relay viewers | `capMicros` on each relay part | one maximum for the airing: what Opencast's viewers didn't use of it is what the relay parts can cost |
| What a relay part's settlement is in the ledger | `settle` entries, `source_type` `relay_viewers`, the label as the memo; returns `release` entries with the same source type | on the station's earnings and statements as their own lines, never inside "Spots" |
| YouTube Data API quota (10,000 units a day a project) | viewer counts, one `videos.list` a minute per connected YouTube (about 1,440 units a day each) | enough for about six relaying YouTube channels; ask Google for more before then, or batch viewer counts (50 videos a call) with one key, as later work |
| Twitch's "paid promotion" | `setPaidPromotion`, Modify Channel Information's `is_branded_content` (scope `channel:manage:broadcast`) | set automatically on signed-in Twitch while spots air, like YouTube's |
| Reminders for destinations Opencast can't drive (a paid-promotion mark, a restart, an end) | `broadcast.platform_events` (`remind_paid_promotion`, `remind_restart`, `remind_end`) | recorded for the Translators page (relay.ts's `RelayPlatformState.paidPromotion: "remind"`); no push or email yet |
| The old translators (`broadcast.translators`, stream keys in plain text) | stations module, `stationsApi.*Translator*` | kept and still accepted (additive only); new destinations go in `broadcast.platform_connections`, sealed. The old rows' keys moved over (sealed, the plain keys nulled) on 2026-09-30, the relay half: see "Relays" below |
| Removing a destination while it relays | `remove` | removed at once; the relay stops sending to it at its next read of `destinationsFor`. Its viewer history and relay bills stay |
| Development without PLATFORM_SECRETS_KEY | secrets.ts | a fixed development key (logged once); production refuses to store keys |
| The Google consent screen before verification | Google Cloud | Testing, with station owners as test users; their sign-ins expire after 7 days until the app is verified |

## Relays (added 2026-09-30, follow-up Phase 3, the relay half)

docs/relay.md has how the relay service works and how to move it. What's decided here, and what's still Open:

| Decision | Where it lives | Default |
|---|---|---|
| **Open, to confirm with Livepeer**: whether a stream with `profiles: []` (the per-station relay stream) is charged as transcoding minutes. Public pricing lists only transcoding ($0.33 an hour), storage and delivery; Studio's older invoicing billed transcoding by ingest (source) minutes | `RELAY_FAN_OUT` (`livepeer` or `direct`), the relay service's environment | `livepeer` when a key is set. If it's charged, `direct` (the relay pushes to each platform itself): on Railway cheaper up to six platforms; on a Hetzner server about the same as a free split, so `direct` there either way (docs/relay.md, the cost table) |
| **Open**: the platform limits table, and how restarts are timed | rule `relays.platform_limits` (`platforms[]` with `maxHours`, `savesUnderHours`, `rollEveryHours`, `restartNeedsSignIn`; `restart.windowHours`, `restart.marginMinutes`), a new version from 2026-09-30 (migration 0034) | Twitch 48 hours; YouTube saves under 12, rolls every 11 with "Save relays as YouTube videos" on; Facebook 8, automatic only when signed in; Kick none known. The last break's station ID within 2 hours of the limit, 15 minutes to spare; after a live block that runs past it, the first break after, 2 minutes to spare; with no break in the window, an earlier one within 6 hours, else at the aim |
| "Live shows only" on TV: the live source's own Livepeer stream multistreams to the platforms, turned on only while one of its live blocks airs | `runner.ts`, `syncStation` | the rehearsal before a block isn't relayed; the targets go on within a tick (5 s) of the block's start and off after its end. The platforms see the source as sent (no bug, and a break cued during the block isn't on the relay: Opencast's spots air only on Opencast) |
| "Live shows only" on radio: radio live comes through the worker's own ingest, not Livepeer | `runner.ts` | the relay service relays just the live block (its picture: the relay background or the station's colour), free (`relay_live_only`) |
| What counts as paid promotion on a relay | `isPaidPromotion`, relayBreaks.ts | a spot (`SPT`) or a sponsor credit (`UND`) that goes out as aired, once per broadcast per platform; nothing when breaks show the slate |
| Partner time on relays | `relayPicture` | a break's hold after the station's own spots, credits, bumpers and station ID, when "Ads from partners" is on, shows the station ID slate (today the hold is the slate anyway; this keeps it when the player starts filling it) |
| "Station bug on relays" | `station_relays.bug_on_relays` | on; off, the TV relay stream-copies (nothing re-encoded); radio's loop is drawn without it |
| Captions drawn into relays (X2) | the old translators' `burnCaptions` | on for the station's relay if any of its translators has it on, until the Translators page has its own switch |
| Several relay service instances | a Redis lease (`opencast:relay:leader`, 20 s) | one sends; others wait (a redeploy, or the move to another host). Without Redis, run exactly one |
| A relay that stops | `RELAY_ALERT_AFTER_MS` | 45 s with nothing going out: the station team and the Network desk get a notice (kind `relay`), and again when it's back. Down more than 5 minutes: the platforms' broadcasts count from the return |
| The worker's per-destination translators | retired | the worker no longer pushes anywhere; `stationsApi.*Translator*` and `broadcast.translators` stay (additive) and serve as destinations until the platforms module takes over (`platformsSeam`) |
| The relay's session in `translator_sessions` | `translator_id` = the station's ID | one sender per station; `relay_mode` and `platforms` on each session; billing reads the mode from it |
| Where the relay reads prepared segments | object storage (`R2_*`), else the worker's HLS origin (`HLS_PUBLIC_URL`) | R2 directly (no egress charge); the worker's origin only when this host has no storage keys |
| Paid promotion on a pasted key | `relay_targets.paid_promotion_reminder_at`, a `relay` notice | reminded once per broadcast until dismissed on the Translators page (the platforms module may also record `remind_paid_promotion`) |
| Moving the old translators' plain keys | `stations.moveTranslatorKeys` (jobs tick, hourly), migration 0036's `translators.platform_id` | each becomes a manual platform connection (sealed), the plain key nulled after the sealed copy is checked. Without PLATFORM_SECRETS_KEY (the development key doesn't count) nothing moves, with one warning |
| The relay setting taken from a station's translators (once, only if it has none) | `relays.adoptTranslatorSettings` | the station ID slate if any of its translators showed it (spots never go where the station said not); "Everything I air" if any was on (what they relayed) |
| Renaming an old translator | `updateTranslator` | the translator's name changes; its platform connection keeps the old name (re-sealing would reconnect the relay just for a name). A new key, address or service makes a new connection |
