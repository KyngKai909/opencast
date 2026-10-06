# Pay-as-you-go: the starting price sheet

Follow-up Phase 2. One channel per station, and **being on air is free**: playout, assembly, the playlists, preparing what a station uploads, and relays of live shows only cost a station nothing. A station pays for the three things that cost Opencast the most, measured each day and billed monthly. **Every number on this page is for review**: it's cost plus a margin, from the Phase 5 measurements (`docs/phase-5-demo.md`, "Cost per channel per month", prices checked on 29 September 2026), and none of it is decided (`docs/open-decisions.md`, Pay-as-you-go).

These prices are the rules registry's first set versions, from **October 1, 2026** (migration 0033), so staging has values; the desk changes them in Network desk, Settings, Rules, each with an effective date, like Opencast's share. Before October 1 they read "Not set yet" and nothing is charged.

## The sheet

| Usage | Unit | Cost to Opencast | Margin | Price | Rule |
|---|---|---|---|---|---|
| **Storage**, originals and prepared segments together | GB a month (each day's GB, averaged over the month) | **$0.018** (for review) | **$0.022**, 55% of the price (for review) | **$0.04** (for review) | `prices.storage` |
| **Relays, everything a station airs** | hour relayed, per station, however many platforms | **$0.085** on Railway with Livepeer splitting it, whatever the number of platforms, *if* Livepeer doesn't charge the split (unconfirmed; **$0.415** if it does). **$0.013 to $0.016** on a Hetzner server (recommendation 1) (for review) | **$0.115** (58%) today; **−$0.215** if Livepeer charges; **$0.034 to $0.037** (about 70%) at recommendation 2's $0.05 on Hetzner (for review) | **$0.20** today; **$0.05** proposed (recommendation 2) (for review) | `prices.relay_everything` |
| **Live hours** through Livepeer (ingest and transcoding) | hour live | **$0.48**, flat, whatever the audience (since 2026-09-30: viewers play the worker's copies from R2; for review) | **$0.27**, 36% (for review) | **$0.75** (for review) | `prices.live_hours` |
| Radio live through the worker's own ingest (not Livepeer) | hour live | **about $0.002** (for review) | none | **Free** (Open, for review) | `prices.radio_live` |
| Relays, live shows only (Phase 3) | | a relay's cost, only while live | none | **Free** | none |
| Number and call sign licenses (yearly renewals) | year | | | **Reserved**, not built (Open) | none yet |

**Free each month** (Open, the prompt's default, for review): **10 GB of storage and 5 live hours** (`prices.free_allowance`). A station keeping under 10 GB on average and going live for under 5 hours pays nothing. It costs Opencast about **$2.58** a station a month: 10 GB × $0.018 = $0.18, and 5 hours × $0.48 = $2.40, now a flat cost however many watch those 5 hours (before 2026-09-30 it was $2.40 only at 5 viewers on average; for review).

## How each cost is worked out

**Storage, $0.018 a GB-month** (for review):

- R2 keeps each GB for **$0.015** a month (originals are in Infrequent Access, which is cheaper; the sheet uses the Standard price for both, so it's on the safe side).
- Preparing is once per file and isn't billed on its own, so its cost is spread over the storage it makes: the TV ladder takes 2.0 vCPU-hours per media hour at $0.0278 = $0.056, and makes 4.8 GB, so **$0.0116 a GB**; writing its segments (4,500 per media hour at $4.50 a million) is **$0.0042 a GB**. Spread over six months kept, **$0.0026 a GB-month**.
- Together about **$0.0176**, rounded to $0.018. On the radio band preparing costs a little more per GB (0.06 vCPU-hours for 0.1 GB) but the files are 48 times smaller.

**Relays, $0.085 an hour today** (for review; updated 2026-09-30 after follow-up Phases 3 to 6):

Since Phase 3, a station's relay is **one push**, from the relay service (`apps/relay`, on Railway) to the station's Livepeer relay stream, which sends it on to every platform. So the cost no longer grows with the number of platforms. Per station per relayed hour, composited (the station bug drawn in):

- CPU: 0.55 vCPU × $0.0278 = **$0.015** (stream-copied, with no bug, about $0.001).
- Memory: 0.25 GB × $10 a GB-month ÷ 730 = **$0.0034**.
- Egress, the one push: 2.93 Mbps is 1.32 GB an hour × Railway's $0.05 = **$0.066**. This is almost all of it.
- Reading the channel's segments: from R2 (Phase 4 onward), no egress and 900 reads an hour, **under $0.001**.
- **About $0.085 an hour, however many platforms**, on one condition: that Livepeer doesn't charge for a stream with no transcoding (`profiles: []`). That isn't confirmed (docs/relay.md, "Livepeer's billing"). If Livepeer charges it like transcoding ($0.33 an hour), it's **about $0.415**, and every relayed hour loses **$0.215** at $0.20. The fallback, `RELAY_FAN_OUT=direct` (the relay pushes to each platform itself), costs $0.085 to one platform, $0.151 to two and $0.217 to three on Railway.
- A radio station's relay is a still picture at 400 kbps: about $0.017 an hour.
- "Live shows only" relays stay free: Livepeer sends the live source's own stream to the platforms, and nothing runs on our side.

**Recommendation 1: run the relay on a Hetzner US server, with `direct`** (not done; for review):

- Egress is almost free there: 1 TB included, about $1.20 a TB beyond, against Railway's $50 a TB. A push around the clock is about **$1.20 a station-month instead of $48**.
- With `direct`, Livepeer isn't in the relay path at all, so its billing question no longer matters.
- **About $0.013 an hour to one platform, $0.014 to two and $0.016 to three** (docs/relay.md, "The cost difference").
- The catch is a fixed server: about $0.02 a vCPU-hour, and a 4-vCPU server runs about 6 composited stations around the clock (more stream-copied), paid whether it's busy or not. The per-hour figure assumes it's kept reasonably full; with few relays, a smaller server. Check Hetzner's current prices before choosing.
- Moving is a handover, not a rebuild: the same image and variables, then Railway's relay goes to 0 replicas (docs/relay.md, "Moving it to a cheap-bandwidth host").

**Recommendation 2: charge less for relays** (not done; for review; only once recommendation 1 is done):

- **$0.05 an hour** per station, however many platforms: about **$0.034 to $0.037 of margin (about 70%)** on Hetzner. Around the clock that's $36.50 a month instead of $146.
- **Or a flat monthly price** for "Everything I air" around the clock, for example **$25 a station-month**, against about $12 of cost on Hetzner (a margin of about 53%). Easier to understand, and cheaper than hourly for stations that relay most of the day.
- **On Railway, $0.05 would lose money** ($0.035 an hour with a free Livepeer split, $0.365 if charged), so recommendation 2 waits for recommendation 1.
- Both are rules in the registry (`prices.relay_everything`, with an effective date), so either is a desk change, not a deploy. A flat monthly price needs a new rule shape (for review).

**Live hours, $0.48 an hour, flat** (for review; since 2026-09-30):

- Livepeer transcodes at **$0.33** an hour.
- **Viewers never fetch from Livepeer.** The worker's leader pulls each new segment of each of Livepeer's renditions **once** and stores it in R2 (`prepared/live-<source>-<session>/`, `engine/livecopy.ts`); the channel's playlists point at those copies, which R2 serves with no egress charge. So the live-hour cost no longer grows with the audience (before, every viewer was Livepeer delivery at $0.03 a viewer-hour, and past 14 viewers an hour lost money).
- **The worker's pull, about $0.12 to $0.15 an hour.** Livepeer's pricing page (checked 30 September 2026) says only "Delivery $0.03 / 60 minutes" and doesn't define the unit. It's counted here as a viewer per rendition pulled: the worker reads 4 of Livepeer's renditions (1080p, 720p, 480p, 360p; the audio-only one is cut from the 360p bytes already pulled, and stations airing the same source share one pull), so **4 viewer-hours, $0.12**, and $0.15 is kept as a margin of safety (5 viewer-equivalents). If Livepeer meters delivery by bytes or by playback sessions instead, it's in the same range or less. **Flag for review** against Livepeer's first invoice with live blocks (its usage page by stream).
- R2 for the copies: 4,500 writes an hour (5 renditions, 900 segments) at $4.50 a million is **about $0.02** (inside R2's first million writes a month while live hours are few), and keeping about **4.8 GB per TV live hour for two days** (the copies go with their channel rows) is negligible: 20 live hours a month is about 6.4 GB on average, **about $0.10 a month**, part of the live-hour cost, not a station's storage (which counts only what its items point at). Relays read the copies from R2 as well (reads at $0.36 a million).
- The worker's CPU for copying: about **130 CPU-seconds per live hour** (measured, `playout-live-copy-realtime.test.ts`: fetching, hashing, storing and cutting the sound out with FFmpeg), $0.001.
- So **$0.33 + $0.15 = $0.48** an hour (about $0.50 counting R2's writes once past the free allowance), whatever the audience: **$0.27 of margin at $0.75 (36%)**, and the free allowance's 5 live hours cost $2.40 however many watch.

**Radio live**: the worker's own ingest encodes AAC at 128 and 64 kbps (about 0.06 vCPU per live hour, $0.002), and its segments are stored with everything else. Free, and kept as its own usage type so it can be priced later (Open).

**Being on air, free to the station** (what it costs Opencast; for review):

- **Viewers**: segments come straight from R2, which charges no egress, only reads: at 4-second segments a viewer-hour is 900 reads at $0.36 a million, **about $0.0003** (and R2's first 10 million reads a month are free). The playlists come from the worker on Railway: a refresh every segment, a few KB each, about 2 MB a viewer-hour at $0.05 a GB, **under $0.0001**. So 1,000 viewer-hours cost about **$0.40**, on any station, prerecorded or live.
- **Uploads** go from the browser straight to R2 (follow-up Phase 4): nothing passes through Railway, so there's no Railway egress for them, and a file already on the platform is stored once.
- **External stations** (follow-up Phase 6): one small request per listing a minute, and a schedule feed read hourly (2026-10-03: and every 2 minutes while its guide is about to run dry, one read per address a pass); nothing stored or served. A249: a large XMLTV guide (a platform's, about 1 MB gzipped) is asked "changed since?" first and downloaded only when it has changed, once a pass for every station on it, and at most every 30 minutes while running dry; it's read as it downloads (a few MB of memory, well under a second for 7 MB), never held whole.
- **External stations' `http://` stream links through the HTTPS relay** (A237, docs/stream-relay.md; check current prices): a Cloudflare Worker, about **1,200 requests per viewer-hour** at 6-second segments (playlist refreshes and segments) and no bandwidth charge. The free plan's 100,000 requests a day cover about 80 viewer-hours a day; the paid plan is $5 a month with 10 million requests (about 8,000 viewer-hours), then $0.30 a million, **about $0.0004 a viewer-hour**. Nothing is stored. A238: https stream links whose server blocks browsers (no CORS header) go through it too, at the same cost per request (all of their segments). Links that answer over https, https links browsers can load and embeds cost nothing here.
- **Before production**: `R2_PUBLIC_BASE` on staging is the bucket's `r2.dev` address, which Cloudflare rate-limits and meant for development. Production should have a custom domain on the bucket (docs/deploy.md, step 3), which Cloudflare's cache sits in front of, saving reads too; without one, files go out by signed URLs.

**Card fees**: Stripe's 2.9% + 30¢ on a usage charge comes out of the price, not on top ($0.59 on a $10 charge). Stripe won't charge less than **$0.50**, so a smaller amount waits for the next month's bill.

## What a month costs

The Phase 2 STOP demo (`npm run demo:billing -w @opencast/api`, checked by `apps/api/test/billing-month.test.ts`), October 2026 at these prices:

| Station | What it used | Bill |
|---|---|---|
| PREP 31.1 | 6 GB kept, one 3-hour live game | **$0.00**, inside the free allowance |
| BEAT 12.1 | 40 GB kept (30 over), relays to YouTube and Twitch 6 hours a day (186 hours, counted once), 10 live hours (5 over) | **$42.15**: $1.20 + $37.20 + $3.75, all from its earnings |
| REEL 24.1 | 25 GB kept (15 over), relays around the clock (744 hours) | **$149.40**: $0.60 + $148.80; its card was declined, so the grace period |

And a busy TV station as Phase 5 assumed it (300 hours kept prepared, 1,440 GB; a relay to one platform around the clock, 730 hours; 20 live hours), costs worked out on 2026-09-30:

| | What it pays | What it costs Opencast | Margin |
|---|---|---|---|
| **Today** (relay on Railway, Livepeer split free) | $57.20 + $146.00 + $11.25 = **$214.45** | $25.92 + $62.05 + $9.60 = **$97.57** | $116.88 |
| Today, if Livepeer charges the split | **$214.45** | $25.92 + $302.95 + $9.60 = **$338.47** | **−$124.02** |
| **Recommendation 1** (relay on Hetzner, `direct`) | **$214.45** | $25.92 + $9.49 + $9.60 = **$45.01** | $169.44 |
| **Recommendations 1 and 2** ($0.05 an hour) | $57.20 + $36.50 + $11.25 = **$104.95** | **$45.01** | $59.94 |
| Recommendations 1 and 2 (flat $25 a month) | $57.20 + $25.00 + $11.25 = **$93.45** | **$45.01** | $48.44 |

So recommendation 1 alone cuts the relay's cost by about 85% and removes the Livepeer risk; recommendation 2 passes most of that saving on to stations. The other examples at recommendation 2's $0.05: BEAT's 186 relay hours would be $9.30 instead of $37.20, and REEL's 744 hours $37.20 instead of $148.80 (or $25 flat).

## How billing works

- **Measured daily** (UTC), by the jobs: storage once an hour (what's kept at the time: every file a station's items, caption tracks and relay background point at, once each, plus the segments prepared from them); relay hours from `translator_sessions` (per station: sessions at the same time count once); live hours from the as-run log's `live` rows (a TV station's are Livepeer's, transcoded there and copied once into R2; a radio station's are its own type). Independent stations and studios pay; claimable stations (Opencast runs them) and the catalog station don't (Open). External stations (follow-up Phase 6) never use any of it: nothing is stored, relayed or transcoded for them, since viewers play the source's own stream.
- **Accrued** each day as a `usage` entry, after the free allowance (used first, from the 1st), at that day's price, and never past the station's cap.
- **Paid from earnings first**: before every payout (weekly by default) and when the month closes. What earnings don't cover is charged at month end to the **funding source**: the owner's linked Clear wallet if Clear gave Opencast full access (the owner approves the transfer on Clear's page), otherwise the card saved for the station (an off-session charge through Stripe). The owners can choose one instead.
- **Grace**: nothing to charge (no card, a declined card, a Clear payment not approved) starts a **14-day** grace period (`billing.grace`, Open). The owners are told on the day, 3 days before the end, and when relays and live shows pause. The channel never pauses. Paying (a new card, "Pay now", or from Clear) brings them back at once.
- **Caps**: a station can cap each type for the month. Reaching one pauses that usage (relays of everything it airs, live shows, or new uploads) until the month ends or the cap goes up, never the channel, and tells the owners. A month never costs more than its caps.
- **Statements**: the usage section on the weekly and monthly statements in Earnings, each type with its units and price, and what was taken from earnings before the payout.
