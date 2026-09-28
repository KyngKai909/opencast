# Open decisions

Things that aren't decided yet. Each is built as configuration with a safe default of zero or off. When one is decided, change its default and move it to "Decided" with the date.

## Money

| Decision | Where it lives | Default |
|---|---|---|
| Opencast's share of spot revenue | `ledger.revenue_config.opencast_spot_share_bps` | 0 ("Not set yet") |
| Opencast's share of pledges | `revenue_config.opencast_pledge_share_bps` | 0 |
| Whether Opencast's share applies to production orders | `revenue_config.opencast_production_share_bps` | 0 |
| The pool: its share, and the split between base, watch time and fund | `revenue_config.pool_*_bps` | 0 |
| Payout schedule | `revenue_config.payout_schedule` | weekly |
| Unclaimed period before escrow goes to the creator fund | `revenue_config.unclaimed_period_days` | 1095 (3 years) |
| Which chain the escrow contract is on, and whether it belongs to Opencast or to the Clear protocol beside its encumbrance | Phase 6 | the chain Clear uses by default |
| Which entity holds advertisers' prepaid money, and what that requires legally | lawyer, before launch | none |
| Final ownership terms for production orders | spots, Phase 4 | the business owns the spot; the maker may show it in samples |
| Rounding: per airing, or per statement line? The designs disagree by 7¢ (18 × $2.10 = $37.80 vs 18 × 262 × $8 ÷ 1,000 = $37.73) | ledger, Phase 6 | settle each airing in micro-dollars; round only when paying out |
| "One day of budget" for a spot with no daily cap | `spots.one_day_of_budget`, `oneDayOfBudgetMicros` | daily cap, else the total over its dates, else the whole total |
| When a spot pauses for balance: when available "runs out" (prompt) or "drops below a day of budget" (design) | spots, Phase 6 | the design's rule, below a day |
| Sponsorships: held monthly and released at month end (prompt), or accrued weekly (the earnings design shows weekly lines)? | ledger, Phase 6 | the prompt's rule, monthly |
| Code window: "used within 7 days" of an airing, but a saved offer shows "until" 14 days after saving | `spots.codes.window_days` | 7 |

## Rights and trust

| Decision | Where it lives | Default |
|---|---|---|
| Repeat-infringer threshold (3 upheld in a year pauses carriage offers) | `trust.policy.upheld_per_year_to_pause_offers` | 3 (a placeholder) |
| Days to answer a claim | `trust.policy.answer_days` | 14 |
| Claimant's time to reply after an answer | `trust.policy.claimant_reply_business_days` | 10 |
| Takedown and counter-notice wording and deadlines | lawyer | none |
| The claimable-station permission page wording | lawyer | none |

## Product

| Decision | Where it lives | Default |
|---|---|---|
| Whether political spots are allowed | `broadcast.blocked_categories` | no platform rule yet; each station can block the category |
| Whether viewers need wallets | accounts | no |
| Listing a stream from outside a market (a county meeting covering two markets) | network | not supported |
| When a maker's rotation is empty: is its barter share given back to the carrier, or filled with a station ID? | playout, Phase 5 | a station ID |
| The revenue split for licensed catalogs | catalog | none |

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
| Stop pays an unclaimed creator "within a week", but they have no wallet until they sign in | Not built yet (Phase 6). The escrow only pays a creator account, which exists only after they sign in |
