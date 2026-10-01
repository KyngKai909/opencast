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
| R2 bucket | Decided: development stays on local disk (test uploads never reach a real bucket). Staging moved to Cloudflare R2 on 2026-09-30 | The buckets are `opencast-staging` (staging, public through its r2.dev address) and `opencast-production`, with keys on api, worker and relay. (An empty `opencast-media` was also created and isn't used.) At the production cutover, the pinned file is copied in (verified by hash) and unpinned after, since the old app still reads it from the gateway until then |
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
| Relays of everything a station airs (per hour, per station, however many platforms) | `prices.relay_everything.perHourMicros` | $0.20 from 2026-10-01 (cost about $0.085 an hour on Railway however many platforms, since Phase 3's one push, if Livepeer doesn't charge its split; $0.415 if it does). Proposed: relay on a Hetzner server ($0.013 to $0.016) and $0.05 an hour or a flat monthly price (docs/pricing.md, recommendations 1 and 2) |
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

## External stations (added 2026-09-30, follow-up Phase 6)

An external station has a channel, a call sign, a banner and a place on the dial, with its video straight from the source's own stream (`network/external.ts`). What's decided here, and what's still Open (numbered on from docs/apps/open-questions.md's A199):

| # | Decision | Where it lives | Default |
|---|---|---|---|
| A200 | **Open** (the reference's "Other markets' streams"): whether a source from outside a market can be an external station on its dial, for example a county meeting that covers two markets | rule `external.other_markets` (`{ allowed }`, no version yet: the fallback holds); `addListedSource.outsideMarket` | not allowed: such a listing is saved and waits (`waiting: "other_market"`); allowing it puts those listings on the dial at once |
| A201 | DASH stream links (decided 2026-09-30: played) | rule `external.dash_stream_links` (`{ played }`; fallback not played, a version `{ played: true }` from 2026-09-30); `listed_sources.stream_format`; `DialRow.playback.format` and `StationPage.playback.format` (`"dash"`); packages/player `engine/dash.ts` | played in Opencast's player. A DASH stream link with its evidence is on the dial with `playback: { kind: "hls", url, format: "dash" }`: a new optional field rather than a new `kind`, since apps built before it check `kind` against its two values and would reject the whole dial; they try the row as HLS, which fails, and show Stand by. The player loads dash.js (5.2.1) on demand, a chunk of its own (859 KB minified, about 256 KB gzipped), only when a DASH station is tuned: HLS viewers download nothing extra. The browser's own DASH is used only where it says "probably" (some TV browsers), otherwise dash.js on Media Source (Safari's ManagedMediaSource on iPhone from iOS 17.1). It goes through the same deck as HLS: the static until the first frame, Tuning in, Stand by at 8 s and on any error (loaded afresh, as a failing HLS stream link), the picture let go on a channel change, the heartbeat and watch data as an HLS stream link's. Picture quality maps onto dash.js's ABR by the hls.js rules: auto is its ABR, data saver caps at 480 lines, best holds the top (ABR after a stall). Captions: a text track in the manifest follows the caption setting (the mock stream has none). AirPlay isn't offered for a DASH picture (no HLS for the TV to fetch). The minute's checks read `<MPD` as up, as they did. Not played: saved, checked and waits (`waiting: "dash_not_played"`). Chromecast A225, devices without DASH A226, neighbours A227, clock A228 |
| A202 | How light the checks are | `checkStream`, `CHECK_TIMEOUT_MS` (5 s), `CHECKS_AT_ONCE` (8), apps/worker/src/externalChecks.ts | a stream link: one GET of its playlist with `Range: bytes=0-65535`, read to 64 KB at most, up when it starts `#EXTM3U` (or holds `<MPD`), never a segment; an embed: a HEAD (a 4 KB ranged GET when HEAD isn't allowed), down on 4xx/5xx, no answer in 5 s, or an `X-Frame-Options: DENY`/`SAMEORIGIN` or `frame-ancestors 'none'`/`'self'` (it no longer allows embedding). Every minute on the worker's leader, apart from the playout tick. Only listings whose evidence holds are checked |
| A203 | A blip under 5 minutes | `external_outages` | recorded in the history (down, back, never hidden), no notice; the Network desk hears only when a station leaves the dial and when it's back (kind `external_station`, push and email on by default) |
| A204 | What an external station is when nothing's scheduled right now | `stations/routes.ts` `dialRows`, the player's Banner | on the air while its stream is up (`onAir: true`, `now: null`), whatever its schedule says: the banner shows its name, External, "Live from {source}" and no progress bar; the dial row "From {source}'s own stream"; never "Off air" |
| A205 | The guide row of an external station with nothing listed in the window | web `components/guide/logic.ts` `gridRows`, the TV guide | every gap of 15 minutes or more around what the source lists (or the whole window when it lists nothing) is one cell with the station's name and "Live, nothing listed" (never a made-up title); the station column carries the dashed External tag |
| A206 | Where a stream link's written permission is kept | `network.stream_permissions` | its own record, kept like a claimable station's permission record: who said yes, the date, where the writing is kept (and a document link), exactly which stream address it covers, who recorded it and when; recorded once and never edited (409 `permission_recorded`). A lead's yes is recorded the same way, with the lead's creator id. The creator permission page (works, escrow) isn't used for streams |
| A207 | Listings from before 0039 | migration 0039 | "Allow embedding" was the evidence then: they're `basis: embed_terms` without a terms page, and stay on the dial; a calendar was their feed (`schedule_source: feed`, iCal). New embeds need the terms page and the day it was checked to go on the dial |
| A208 | Which IPTV lists the desk can read by address | `isIptvOrgAddress`, `previewIptvList` | iptv-org's own (https://iptv-org.github.io/… and raw.githubusercontent.com/iptv-org/…): the API fetches only those, up to 5 MB with a 15 s timeout, and never a stream in them. Any other list is pasted or uploaded. Up to 100 channels an import; a stream address already a lead or an external station is skipped |
| A209 | Watch data for external stations | `audience/watch.ts` `aggregateExternal`, `audience/service.ts` heartbeat | kept per scheduled airing (`listed:<airing>`) and per hour outside them (`external:<station>:<hour>`), `external: true`, only what someone watched; never in `minute_samples`/`minute_markets` (what the pool and per-thousand billing read), and `watchMinutes` leaves them out too. An official embed's time on screen counts as tuned in (Opencast can't see the source's player) |
| A210 | External stations in master control | `accounts` `OPENCAST_RUN_KINDS`, `externalGuard.ts` | admins no longer run them there (nothing to run); every playout, log, library, spots, sponsorship, money, relay, claim and team endpoint answers 409 `external_station` for one, whoever asks, and so do a sponsorship, an order or a carriage request naming one |
| A211 | Channel numbers for external stations | `external.ts` `checkChannel` | the band and the market's numbering, like any station, and never a number another station or a hold has; X.1 first, and a subchannel (9.2, 9.3, as the reference draws) only beside other external stations in the same major |
| A212 | How often schedules are read again | apps/worker/src/externalChecks.ts | hourly, and at once when a listing is added (or "Sync" on the desk); only airings from now on are replaced, so a meeting on air keeps its title. XMLTV guide data with several channels is read for the one the address's fragment names (`…/guide.xml#channel=NASA.us`) |
| A213 | A lead from an IPTV list that becomes an external station | `addListedSource.creatorId`, `recordListedEvidence`; the desk's stage strip | the lead gets the station and `listedSourceId`; its stage moves to On air only once the listing's evidence holds (their written yes, or confirmed public). The pipeline's stage strip leaves converted leads out (they're not claimable stations); their row says "External station {9.3 ICTV}" |
| A214 | A lead becoming a full station | the creator pipeline | the usual path (works catalogued, asked, said yes, set up from a recipe); a lead from a list has no works yet, so its row offers "List as external station" until they're added |
| A215 | Changing a listing (closed 2026-09-30; taking one off for good is A220) | `updateListedSource` (admins), `listListedChanges`; `network.listed_source_changes`, `stream_permissions.listed_source_id` (migration 0040); the desk's "Change" | its name, what it shows, the address, how it plays, the embed terms, what's on and its channel and call sign change by the rules for listing (A211, A222). An edit never puts it on the dial without evidence that covers what now plays: a written permission names one exact stream address, so a new address waits for new evidence (`waiting: needs_permission`), unless a permission recorded before for this listing names that exact address; embed terms stay for an address on the same host and wait (`needs_terms`) on another; a public basis is about the source, so it stays; a new way to play needs the new kind's evidence (the old kind's is set aside, and kept in the history). Permission records are never edited or deleted (the ones that no longer cover it show as "Earlier permission"). A new address or way to play starts its health afresh (`unchecked`; an open outage ends, `ended: address_changed`, and stays in the history); a new schedule drops the old feed's airings from now on and is read again at once. Every change is kept: who, when, each field from → to and what it did; addresses in full to admins, as their host to the rest of the desk. The desk's form says plainly, before saving, when saving takes it off the dial, then goes straight on to Record evidence |
| A216 | The TV's "Tune to {X}" offer on Stand by and off air | apps/tv `offAir.ts` `canSuggest` | still the nearest station on air that isn't external (as before Phase 6), though a stream link now plays as a picture |
| A220 | Taking an external station off the dial for good (A215) | `removeListedSource`, `restoreListedSource`; `listed_sources.removed_at` (migration 0040); the desk's "Taken off the dial" | archived, never deleted: its permission records, outages, change history, airings, watch data and lead link stay. It's marked signed off for good like a full station (`stations.status = signed_off`), so it leaves the dial, the guide, search and the swipe order at once; its checks and schedule reads stop, and an open outage ends (`ended: removed`). Its station page answers 404 "{COLT}, {City of Colton} is no longer on the dial." (a closed full station's is 404 too). Its pipeline lead goes back to the stage it had before the listing put it On air (`listed_sources.lead_stage_before`, else Found), loses the station and is a lead again, with Next "Was external station {9.2 COLT}. Taken off the dial"; re-listing it makes a new listing. "Put back on the list" (admins) brings it back on its channel, or another free one, with its evidence as recorded, waiting for its checks, its lead On air again |
| A221 | An external station's channel and call sign once it's taken off | `REMOVED_CHANNEL_HOLD_MS` (90 days), `syncExternalSchedules` (hourly), `waitlist.holdCallSign` | a closing full station's rules (the reference's station settings: "frees the channel after 90 days and keeps the call sign reserved for a year"): its channel stays its own 90 days (the board says "Taken off the dial"), then the hourly pass frees it (`channels.released_at`, `listed_sources.channel_released_at`); its call sign is held a year on the waitlist's side and, like a closed full station's, stays on the station row after that |
| A222 | Changing an external station's call sign | migration 0040 (`broadcast.stations_guard`), `updateListedSource` | allowed, by the listing rules (not refused, not taken or held): a full station's call sign stays fixed after first sign-on, an external station's can change (it has no playout, log or bug to carry it). The old one is held a year for it (`waitlist.holdCallSign`), so nobody else takes a name viewers know, and it can take it back |
| A223 | A full station's channel after it signs off for good (closed 2026-09-30) | `stations.releaseSignedOffChannels`, run in the hourly pass (`network.syncExternalSchedules`, apps/worker/src/externalChecks.ts); `CHANNEL_HOLD_AFTER_SIGN_OFF_MS` in packages/domain (90 days, shared with A221's `REMOVED_CHANNEL_HOLD_MS`) | freed 90 days after `stations.signed_off_at` (kinds station, claimable and catalog; external stations go with their listing, A221): the channel row gets `released_at`, so the number is open again (`availableChannels`, `chooseChannel`). Only the channel: the call sign stays on the station's row, held a year on the waitlist's side as before. A station back on the air before then (`status` no longer `signed_off`) keeps it. A waitlist hold on the number still wins once it's free (`channels_guard`). Idempotent: a freed channel isn't picked again. X.1 whose call sign a station on the air shares keeps its number until that one signs off too (A233) |
| A224 | **Open**: what a viewer sees of a station taken off the dial | web and TV players (`PlayerEngine.setChannels`), `accounts` presets and reminders | as a closed full station: off the dial at once; a viewer on it gets Stand by, with the words a down stream has ("{City of Colton}'s stream is down. Stand by."), until they leave; the web's tuned-in page then shows the station page's 404 ("… is no longer on the dial."). Presets keep it and do nothing when pressed, and reminders for its airings still go, as a closed full station's do. Whether Stand by should say it's gone for good, and whether presets and reminders should drop it, isn't decided |
| A225 | DASH stream links on a Chromecast (A201) | apps/tv `TvApp` (`neighbours.skipDash` in cast mode); the phone remote's rocker (`rockerNeighbours`) | played when chosen (from the phone, by number or from the guide): dash.js on the receiver's Media Source, one DASH picture at a time, never warmed. Up and down skip DASH stations there, so a Chromecast with little memory (1st to 3rd generation, 512 MB) only loads dash.js (about 860 KB of script, beside hls.js and the Cast framework) when someone picks one; the phone's rocker names what the Chromecast will tune. **For review**: not yet tried on a real Chromecast; if a 2nd or 3rd generation one struggles, leave DASH stations out on Cast altogether |
| A226 | A device that can't play DASH (A201): an iPhone before iOS 17.1 (no Media Source; the iPhone app wraps the web app), or any browser with neither Media Source nor its own DASH | packages/player `dashSupport()`, `PlayerEngine` status `unplayable`, `NeighbourOptions.skipDash`; the web's channel buttons and swipe (`neighbourOf`) | skipped when changing channel on that device (up, down, swipe); tuned directly (a number, the guide, a link) it says "Not on this device" and "{LOMA 9.7}'s stream is in a format this device can't play. Watch it on a computer or a TV.", and loads nothing. It stays on the dial and in the guide there (the dial is the market's), and no heartbeat is sent for it |
| A227 | Warming a DASH neighbour (A201) | `PlayerEngine.rewarm` | never: no manifest fetched, no hidden deck, no dash.js. Tuning a DASH station is a cold start (about 0.8 s on the mocks, dash.js included the first time), and a viewer who never tunes one fetches nothing for it. HLS neighbours are warmed as before |
| A228 | dash.js's clock for live DASH (A201) | `dashJsDriver` (`clearDefaultUTCTimingSources`) | the manifest's own UTCTiming, else the manifest's Date header where the source exposes it, else the device clock; never dash.js's default time server (time.akamai.com), which would send every viewer's request to a third party |

## Shared call signs (added 2026-09-30)

One brand's streams on one channel's subchannels can share a call sign, as real TV does (KCET, KCET-DT2): 15.1 RIVC, 15.2 RIVC, 15.3 RIVC. The channel tells them apart. Only the call sign (and the brand's display) is shared: evidence, checks, outages, earnings, spots, sponsors, billing, relays and watch data stay per station. Migration 0042.

| # | Decision | Where it lives | Default |
|---|---|---|---|
| A229 | Who may share a call sign, and how it's enforced | `broadcast.stations.shares_call_sign_with` (migration 0042): the unique index `stations_call_sign` leaves out a family's members; the foreign key `stations_call_sign_family_fk` (`shares_call_sign_with`, `call_sign`) → X.1's (`id`, `call_sign`), on update cascade; the constraint triggers `stations_call_sign_family` and `channels_call_sign_family` (checked at commit, `broadcast.call_sign_family_check`); `stations_guard` and `call_sign_reservations_guard` (a hold for X.1 counts for its family) | a station on X.n (n ≥ 2) may share the call sign of the station on X.1 in the same market and major: both external stations, or both full stations (kind `station`) the same owner runs; never mixed, never radio (no subchannels), never a chain (a member shares X.1's own). Everywhere else a call sign stays unique, as before, in the database whatever the API does: full stations, other markets, other majors, and waitlist holds for anyone else. A member taken off the dial or signed off for good is archived and skips the channel check. Addresses: `StationIdent.slug` (additive): X.1 keeps `/watch/rivc` (and `/rivc`, `/control/rivc`), a member is `/watch/rivc-15-2`; `GET /stations/:ref` takes an id, a call sign (X.1's), or call sign and channel (`rivc-15-2`, which also finds a station that shares nothing: `beat-12-1`); an old call sign held for a station (A222) still finds it and its family. `StationIdent.sharesCallSign` says to add the channel where only a call sign would show |
| A230 | **Open** (for review): full stations on an owner's own subchannel | rule `numbering.own_subchannels` (`{ allowed }`, fallback allowed, no version yet); `stations.chooseChannel`, `ownSubchannels`; `availableChannels.ownSubchannels`, `chooseChannel.shareCallSign` | allowed: before this, a full station got X.1 only ("Subchannels (12.2) are for 24/7 carriage", and 24/7 carriage isn't built). An owner who already has a station on X.1 can put another of theirs on X.n beside it, sharing X.1's call sign or not ("Share 12.1 BEAT's call sign", on by default in master control). "The same owner" means the person doing it holds the owner role on both stations (`accounts.station_memberships`); the database checks that at least one person does when the link is made. Off: a station gets X.1 only, as before; stations already on one keep it. Not for claimable or catalog stations, nor beside an external station. A full station's call sign stays fixed after its first sign-on, so a family's call sign doesn't change once X.1 has signed on, and a member can't join or leave by renaming after its own first sign-on (422 `fixed_after_sign_on`); before that, a member that takes its own call sign stops sharing. X.1 can't move while stations share its call sign (409 `family_channel`) |
| A231 | Taking an external X.1 off the dial for good while stations share its call sign | `removeListedSource` (`withFamily`), `restoreListedSource`; `listed_sources.removed_with`; `ListedSource.removed.withListing`; the desk's dialog | the whole family goes, after a confirmation naming each stream ("Take 15.1 RIVC and its family off the dial for good?"); without `withFamily` the API answers 409 `family` naming them, so an older client can't take a family off by accident. The name is held for X.1 (and so the family). "Put back on the list" on X.1 brings back the ones taken off with it (on their own channels while held, else the same subchannels beside X.1 if free; one whose channel has gone stays off, to put back on another). A member comes back only after X.1 (409 `family_removed`). A member taken off alone leaves the name with its family (no hold for it). Chosen over "X.1 can't be removed while members remain" because the family hangs off X.1's number and call sign: taking X.1 alone would leave its members sharing a name nobody's on the air with |
| A232 | **Open** (for review): "Same brand as X.1" on by default | the desk's List a source (`familyHeadFor`, `sameBrandLabel`) | on whenever X.1 is an external station on the list, as asked. The reference draws different cities in one major (9.1 RDLS, 9.2 COLT, 9.3 SBCO), so on those majors the desk has to untick it for each new city; the form shows the shared call sign locked in the Call sign field while it's on. Off by default, or on only when the name starts like X.1's, are the alternatives |
| A233 | A full-station family when X.1 signs off for good | `stations.releaseSignedOffChannels`; `broadcast.call_sign_family_check` | its members keep the call sign and stay on the air (it's on their rows too). X.1's number stays held while a member is on the air, since the family hangs off it; the hourly pass frees it once X.1 has been off 90 days and no member is on the air. The call sign is never freed by this: X.1's row keeps it, a year's waitlist hold keeps it from anyone else, and a new station on X.1 can't take it |
| A234 | A full-station family whose owners later differ (closed 2026-09-30: option (b), tell the Network desk) | `stations.checkCallSignOwners`, called after every change to a station's owners (`accounts.transferStationOwnership`, `acceptInvite`, a claim paid in `network.onEscrowEvent`); `broadcast.stations.owners_split_at` (migration 0043); event `station.call_sign_owners`, notice kind `call_sign_owners`; `MarketBoard.ownersApart` (`stations.callSignOwnersApart`); the desk's market board | nothing changes on air: an owner leaving one station doesn't undo a call sign that's fixed on air, and nothing is unlinked or renamed by itself. When X.1 and a full station sharing its call sign no longer have an owner in common, the Network desk hears once (in the app, push and email, like `external_station`): "{12.2 BEAT Beat Tapes} no longer shares an owner with {12.1 BEAT Inland Beat}", what changed ("Ownership of {12.2 BEAT} moved from {Kai} to {Jen}."), who owns each now, and that nothing changes by itself (before the member's first sign-on: its owner can give it a call sign of its own). A later change while they're apart says nothing more; an owner in common again clears it (silently), and a split after that is told again. The market board flags each under its figures ("Select 12" opens the slot), the slot's line for the member says the same, and the rail's Market board counts them. What to do is left to people: talk to the owners, then the member's owner (before sign-on) or the desk acts. External families and stations that share nothing are left alone. A member signed off for good is archived and isn't checked; one that takes its own call sign or links to another X.1 is cleared. An owner can't leave a station or delete their account while they own it, so today ownership moving (or an owner taking an invite to their own team) is how owners differ |
| A235 | Holds when a family's call sign changes | `updateListedSource`, `waitlist.holdCallSign` | a new call sign on X.1 is the family's; the old one is held a year for X.1 (and so for the family: old addresses keep working, and the family can take it back). A station joining a family has its own old call sign held for it (A222). A station leaving a family doesn't hold the family's name (the family still has it). Each member's change history records the change |

## TV live blocks from storage (added 2026-09-30)

A TV live block's channel playlists point at the worker's own copies of Livepeer's segments in R2 (`playout/engine/livecopy.ts`), never at Livepeer's delivery: the leader pulls each new segment of each rendition once, however many stations air the source or viewers watch (docs/pricing.md, docs/architecture.md).

| # | Decision | Where it lives | Default |
|---|---|---|---|
| A217 | How a live copy behaves when it can't keep up | live.ts `COPY_WAIT_MS` (750), `COPY_MAX_BACKLOG` (2), `COPY_IDLE_MS` (15 s); livecopy.ts `COPY_DEADLINE_MS` (6 s) | a poll waits up to 750 ms for the copy it started (once per source, however many stations read it), so a copy usually lands on the tick that listed it; a segment whose fetch or store fails is retried for up to 6 s, then skipped: the channel closes the live row and carries on from the next segment in a new row (a discontinuity). More than two segments waiting and the copy drops to the newest (a discontinuity, never more delay). Copies failing for three segments (or 8 s) count as not connected: the stand-by slate airs, and the copy starts again once the channel asks for the source. Copying starts only when the block asks for the source, not while it's read ahead, and stops 15 s after the channel stops asking |
| A218 | **Open** (for review): how Livepeer bills the worker's pull | docs/pricing.md | counted as one viewer per rendition pulled (4 an hour, $0.12; $0.15 kept as margin), since Livepeer's pricing page says only "Delivery $0.03 / 60 minutes"; to check against its first invoice with live blocks. Master control's preview of a live source (`LiveSourceView.previewUrl`) still plays Livepeer's own playback: a few operators, not viewers |
| A219 | **Open**: a takedown of what a live source aired | playout service `dropLiveCopies(liveSourceId)` | the copies can be deleted at once (every session a channel row points at), but nothing calls it yet: claims and takedowns name library items, and a live block isn't one. Until there's a claim path for live blocks, the copies go with their channel rows after two days, like radio live's |
