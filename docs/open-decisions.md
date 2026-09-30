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
| Prices, relay hours, live hours, the free allowance, platform limits | `prices.*`, `relays.platform_limits` | not set yet; 10 GB and 5 live hours free; Twitch 48 hours, Facebook 8, YouTube saves under 12 (read by Phases 2 and 3) |
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
| "Not for me" in the player | `features.not_for_me` (group `features`), read by the apps from `GET /v1/config` | off. The API takes votes either way. The desk's Rules page doesn't draw the `watch_data` and `features` groups yet (its `GROUPS` list); the API sets them |
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
| Where the four web apps are hosted | The user's decision: `apps/web` (viewer, master control and the desk), `apps/business`, `apps/tv` and `apps/site` are static builds deployed on Vercel, not Railway. Railway keeps the API and the worker | `docs/deploy.md` (Services, Staging); `railway.json` and `nixpacks.toml` cover the API and worker only |
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
