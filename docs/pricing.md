# Pay-as-you-go: the starting price sheet

Follow-up Phase 2. One channel per station, and **being on air is free**: playout, assembly, the playlists, preparing what a station uploads, and relays of live shows only cost a station nothing. A station pays for the three things that cost Opencast the most, measured each day and billed monthly. **Every number on this page is for review**: it's cost plus a margin, from the Phase 5 measurements (`docs/phase-5-demo.md`, "Cost per channel per month", prices checked on 29 September 2026), and none of it is decided (`docs/open-decisions.md`, Pay-as-you-go).

These prices are the rules registry's first set versions, from **October 1, 2026** (migration 0033), so staging has values; the desk changes them in Network desk, Settings, Rules, each with an effective date, like Opencast's share. Before October 1 they read "Not set yet" and nothing is charged.

## The sheet

| Usage | Unit | Cost to Opencast | Margin | Price | Rule |
|---|---|---|---|---|---|
| **Storage**, originals and prepared segments together | GB a month (each day's GB, averaged over the month) | **$0.018** (for review) | **$0.022**, 55% of the price (for review) | **$0.04** (for review) | `prices.storage` |
| **Relays, everything a station airs** | hour relayed, per station, however many platforms | **$0.085** to one platform, **$0.15** to two, **$0.22** to three (for review) | **$0.115** (58%) at one platform, **$0.05** at two, **−$0.02** at three (for review) | **$0.20** (for review) | `prices.relay_everything` |
| **Live hours** through Livepeer (ingest and transcoding) | hour live | **$0.48** at 5 viewers on average (for review) | **$0.27**, 36% (for review) | **$0.75** (for review) | `prices.live_hours` |
| Radio live through the worker's own ingest (not Livepeer) | hour live | **about $0.002** (for review) | none | **Free** (Open, for review) | `prices.radio_live` |
| Relays, live shows only (Phase 3) | | a relay's cost, only while live | none | **Free** | none |
| Number and call sign licenses (yearly renewals) | year | | | **Reserved**, not built (Open) | none yet |

**Free each month** (Open, the prompt's default, for review): **10 GB of storage and 5 live hours** (`prices.free_allowance`). A station keeping under 10 GB on average and going live for under 5 hours pays nothing. It costs Opencast about **$2.58** a station a month: 10 GB × $0.018 = $0.18, and 5 hours × $0.48 = $2.40 (for review).

## How each cost is worked out

**Storage, $0.018 a GB-month** (for review):

- R2 keeps each GB for **$0.015** a month (originals are in Infrequent Access, which is cheaper; the sheet uses the Standard price for both, so it's on the safe side).
- Preparing is once per file and isn't billed on its own, so its cost is spread over the storage it makes: the TV ladder takes 2.0 vCPU-hours per media hour at $0.0278 = $0.056, and makes 4.8 GB, so **$0.0116 a GB**; writing its segments (4,500 per media hour at $4.50 a million) is **$0.0042 a GB**. Spread over six months kept, **$0.0026 a GB-month**.
- Together about **$0.0176**, rounded to $0.018. On the radio band preparing costs a little more per GB (0.06 vCPU-hours for 0.1 GB) but the files are 48 times smaller.

**Relays, $0.085 an hour to one platform** (for review):

- CPU: 0.55 vCPU composited (the station bug drawn in) × $0.0278 = **$0.015**.
- Memory: 0.25 GB × $10 a GB-month ÷ 730 = **$0.0034**.
- Egress: 2.93 Mbps nominal is 1.32 GB an hour × $0.05 = **$0.066**, for each platform (the picture is composited once and sent to each).
- So $0.085 to one platform, $0.15 to two, $0.22 to three. The price is per station however many platforms (the prompt's rule), so three or more platforms lose money at $0.20 (for review). A radio station's relay is a still picture at 400 kbps: about $0.017 an hour to one platform.
- **Phase 3 (2026-09-30)**: the relay service sends **one** push per station, and Livepeer's multistream splits it to every platform, so on Railway a relay costs about **$0.085 an hour whatever the number of platforms**, *if* Livepeer doesn't charge a stream with no transcoding profiles (not confirmed: docs/relay.md). If it does ($0.33 an hour, like transcoding), about **$0.415**, a loss at $0.20; the fallback (`RELAY_FAN_OUT=direct`, the relay pushing to each platform) is the table above. On a Hetzner US server, about **$0.013 to $0.016** an hour either way with `direct` (for review).

**Live hours, $0.48 an hour** (for review):

- Livepeer transcodes at **$0.33** an hour.
- Livepeer delivers at **$0.03 a viewer-hour**, which grows with the audience. At 5 viewers on average (for review) that's **$0.15**. At 9 viewers the margin halves; past 14 an hour loses money. Worth watching once real live audiences are known.

**Radio live**: the worker's own ingest encodes AAC at 128 and 64 kbps (about 0.06 vCPU per live hour, $0.002), and its segments are stored with everything else. Free, and kept as its own usage type so it can be priced later (Open).

**Card fees**: Stripe's 2.9% + 30¢ on a usage charge comes out of the price, not on top ($0.59 on a $10 charge). Stripe won't charge less than **$0.50**, so a smaller amount waits for the next month's bill.

## What a month costs

The Phase 2 STOP demo (`npm run demo:billing -w @opencast/api`, checked by `apps/api/test/billing-month.test.ts`), October 2026 at these prices:

| Station | What it used | Bill |
|---|---|---|
| PREP 31.1 | 6 GB kept, one 3-hour live game | **$0.00**, inside the free allowance |
| BEAT 12.1 | 40 GB kept (30 over), relays to YouTube and Twitch 6 hours a day (186 hours, counted once), 10 live hours (5 over) | **$42.15**: $1.20 + $37.20 + $3.75, all from its earnings |
| REEL 24.1 | 25 GB kept (15 over), relays around the clock (744 hours) | **$149.40**: $0.60 + $148.80; its card was declined, so the grace period |

And a busy TV station as Phase 5 assumed it (300 hours kept prepared, 1,440 GB; a translator around the clock; 20 live hours): $57.20 + $146.00 + $11.25 = **$214.45** a month, against about $96.50 of cost.

## How billing works

- **Measured daily** (UTC), by the jobs: storage once an hour (what's kept at the time: every file a station's items, caption tracks and relay background point at, once each, plus the segments prepared from them); relay hours from `translator_sessions` (per station: sessions at the same time count once); live hours from the as-run log's `live` rows (a TV station's are Livepeer's; a radio station's are its own type). Independent stations and studios pay; claimable stations (Opencast runs them), listed city streams and the catalog station don't (Open).
- **Accrued** each day as a `usage` entry, after the free allowance (used first, from the 1st), at that day's price, and never past the station's cap.
- **Paid from earnings first**: before every payout (weekly by default) and when the month closes. What earnings don't cover is charged at month end to the **funding source**: the owner's linked Clear wallet if Clear gave Opencast full access (the owner approves the transfer on Clear's page), otherwise the card saved for the station (an off-session charge through Stripe). The owners can choose one instead.
- **Grace**: nothing to charge (no card, a declined card, a Clear payment not approved) starts a **14-day** grace period (`billing.grace`, Open). The owners are told on the day, 3 days before the end, and when relays and live shows pause. The channel never pauses. Paying (a new card, "Pay now", or from Clear) brings them back at once.
- **Caps**: a station can cap each type for the month. Reaching one pauses that usage (relays of everything it airs, live shows, or new uploads) until the month ends or the cap goes up, never the channel, and tells the owners. A month never costs more than its caps.
- **Statements**: the usage section on the weekly and monthly statements in Earnings, each type with its units and price, and what was taken from earnings before the payout.
