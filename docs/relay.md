# The relay service

Follow-up Phase 3, the relay half. Translators simulcast a station to the platforms it connects (YouTube, Twitch, Facebook, Kick, any RTMP or RTMPS address) as **one continuous stream per station**, cheaply. Platform connections, keys and relay viewers are the platforms module's (docs/platforms.md). This page covers the relay itself: `apps/relay`, how it runs, how to move it to a host with cheap bandwidth, and what Livepeer charges for it.

## What it does

```
channel timeline (Postgres) ─┐
prepared segments (R2)       ├─> apps/relay: one sender per station ──RTMP──> Livepeer relay stream (profiles: [])
live blocks (Livepeer HLS)  ─┘   (join, retime, bug, breaks, codes)            │ multistream targets, each `source`
                                                                               ├──> YouTube
                                                                               ├──> Twitch
                                                                               └──> Facebook, Kick, custom
```

**Two modes, set per station** (`broadcast.station_relays.mode`, the Translators page's "What gets relayed"):

| Mode | What goes out | How | Billed |
|---|---|---|---|
| **Live shows only** (`live_only`, the default) | only live blocks | **TV**: the live source's own Livepeer stream (the one its encoder already pushes to) gets the platforms as multistream targets, each `source`, turned **on only while one of its live blocks airs** (a rehearsal before the block isn't relayed) and off when it ends. No relay service stream. **Radio**: radio live comes in through the worker's own RTMP ingest, not Livepeer, so the relay service relays just the live block, like "Everything I air". | free (`relay_live_only`, metered for the page) |
| **Everything I air** (`everything`) | the whole schedule, prerecorded and live, as one continuous stream | the relay service: one sender per station pushing one RTMP stream to the station's **Livepeer relay stream**, created once with `profiles: []` (no transcoding) and a multistream target per platform, each `source`. Livepeer sends the same stream to every platform. | per hour relayed, **per station** whatever the number of platforms (`relay_everything`, `prices.relay_everything`) |

Billing reads `translator_sessions`: the relay service writes one session per station at a time (`translator_id` is the station's ID, `relay_mode` says which mode, `platforms` how many it went to). Sessions at the same time count once (Phase 2's `unionHours`). A station whose relays are paused by pay-as-you-go (its `relay_everything` cap, or a bill unpaid past the grace period) falls back to "Live shows only": its live shows still go out, and its channel is never touched.

**One sender carries prerecorded and live hours**, so platforms see one stream with no interruption when a live block starts or ends: the sender reads the same timeline the channel's playlist publishes (Livepeer's live segments during a live block), joins everything into one MPEG-TS stream with continuous timestamps and one stream layout (`tsretime.ts`), and its push never reconnects at a live block's edges. `apps/api/test/playout-relay.test.ts` checks it: one session, one RTMP connection, timestamps running on across a live block.

**The picture** (`sender.ts`, moved from the worker's `translator.ts`):

- **Station bug on relays** (on by default): the TV band's bug is composited (x264, the 720p rendition's bitrate). **Off**, or a station with no bug, the relay **stream-copies**: nothing is re-encoded. Radio relays are always stream-copied: the relay background loop (prepared once at upload, `background.ts`) with the bug drawn in once when the relay starts, the station's sound laid over it.
- A spot's code, offer and QR for its last 10 seconds, as the player draws them (TV: drawn into those segments only; radio: a loop of its own, prepared once per code).
- Captions drawn in only where the station chose it (`burnCaptions`, still the old translators' setting).

**Breaks** (`relayBreaks.ts`): one setting for every relay, "During breaks, relays show: **Your spots** / **Station ID slate**" (`station_relays.break_handling`; it replaces each translator's `break_handling`, which is kept and no longer read). Time that **ads from partners** would fill (the break's hold after the station's spots, credits and bumpers, which the player fills per viewer) always shows the station ID slate. When spots or sponsor credits go out on a relay, **connected** YouTube (and Twitch's branded content) is marked as containing paid promotion through the platforms module (`setPaidPromotion`), once per broadcast; for a pasted key, the relay records a reminder the Translators page shows (`RelayPlatformState.paidPromotion: "remind"`, dismissed with `dismissPaidPromotionReminder`) and the station gets a notice.

## Restarts for platform limits

Each platform caps one broadcast. The limits are a rule (`relays.platform_limits`, Network desk, Settings, Rules, Relays; **Open**, migration 0034's version):

| Platform | Limit | What the relay does |
|---|---|---|
| Twitch | 48 hours per stream | restarts before it (required) |
| YouTube | none, but only broadcasts under 12 hours are saved | with "Save relays as YouTube videos" on (off by default), rolls to a new broadcast about every 11 hours (`rollEveryHours`) |
| Facebook | 8 hours | automatic only when connected by signing in (`restartNeedsSignIn`); with a pasted key, the station is told when it's due |
| Kick, others | none known | nothing; add limits to the rule as they're found |

Rules for every restart (`limits.ts`, `runner.ts`):

- **Timed to a break**: the station ID in the last break before the limit (in the last `restart.windowHours`, 2 by default, `marginMinutes`, 15, to spare). If a live block runs past that window, the first break after it ends, still inside the limit (2 minutes to spare). With no break, at the aim, and planned again at every check as the log fills.
- **Only that platform**: its Livepeer multistream target is turned off and on (`PATCH /multistream/target/:id`); the stream and the other targets are untouched. In direct mode, only that platform's push restarts.
- **Connected accounts**: the next broadcast is made through the platforms module first (`prepareNextBroadcast`, which carries the title and description over), the target moved to it if its address or key changed, and only then the current one ended (`endBroadcast`).
- **Logged**: `broadcast.relay_restarts` (scheduled, done, failed, due, cancelled), with the next one per platform on the Translators page: "Twitch restarts Saturday at 11:59 pm, during a break".

## Health and failure

`GET /health` on the relay service answers relay hours, bandwidth (bytes and kbps over the last minute) and errors per station (contracts `RelayHealth`). It's always 200 while the process is up; `ok` is false while a relay it runs has stopped.

A relay with nothing going out for `RELAY_ALERT_AFTER_MS` (45 s) while it should be relaying is **stopped**: `station_relays.status` says so, the station team and the Network desk get a notice ("BEAT's relays stopped"; kind `relay`), and it keeps retrying (a dropped push starts again every few seconds; a failed encoder too). When bytes flow again, "BEAT's relays are back". If it was down for more than 5 minutes, the platforms' broadcasts count from the return (their limits start again).

**Opencast's own channel is never affected**: the relay service is its own process on its own host, reads the channel's timeline and segments, and writes only its own tables and `translator_sessions`. The worker no longer pushes to any platform (its per-destination translators are retired). `relay.test.ts` fails a relay while the engine airs a channel and checks the channel carries on.

## Configuration

Everything comes from the environment (`apps/relay/src/config.ts`):

| Variable | Needed | What |
|---|---|---|
| `DATABASE_URL` | yes | Postgres: the channel's timeline, relay settings, sessions. From outside Railway, its public TCP proxy with SSL |
| `REDIS_URL` | recommended | a lease (`opencast:relay:leader`), so only one relay instance sends at a time (a second one, during a redeploy or a move, waits) |
| `LIVEPEER_API_KEY` | for `livepeer` fan-out | the relay streams and their targets. Without it the relay pushes to each platform itself |
| `LIVEPEER_API_BASE`, `LIVEPEER_RTMP_INGEST_BASE`, `LIVEPEER_PLAYBACK_BASE` | no | Livepeer's addresses (defaults: `https://livepeer.studio/api`, `rtmp://rtmp.livepeer.com/live`, `https://livepeercdn.studio/hls`) |
| `RELAY_FAN_OUT` | no | `livepeer` (default with a key) or `direct` (a push per platform; see Livepeer's billing below) |
| `HLS_PUBLIC_URL` | recommended | the channel playlist base (the worker's HLS origin): prepared segments are read there when object storage isn't configured here |
| `R2_*` / `S3_*` | optional | object storage, read directly (no egress through the worker). Without them, `HLS_PUBLIC_URL` |
| `PORT` or `RELAY_PORT` | no | the health endpoint (8789) |
| `RELAY_SCRATCH_DIR`, `STORAGE_ROOT` | no | scratch space (`/tmp/opencast-relay`) |
| `RELAY_TICK_MS`, `RELAY_ALERT_AFTER_MS`, `RELAY_LEASE_SEC` | no | 5000, 45000, 20 |
| `PREPARE_LADDER_SCALE` | development only | the same as the worker's |

## Running it on Railway (first)

`.railway/railway.ts` defines the `relay` service (**not applied**; `railway config plan`, then `railway config apply` with the owner's OK): the Dockerfile builder (`apps/relay/Dockerfile`, built from the repository root), one replica, `/health`, and the variables above from the project's Postgres, Redis and bucket. `LIVEPEER_API_KEY` is a preserved secret, set in Railway.

Locally:

```bash
docker build -f apps/relay/Dockerfile -t opencast-relay .
docker run --rm --env-file relay.env -p 8789:8789 opencast-relay
curl localhost:8789/health
```

## Moving it to a cheap-bandwidth host (a Hetzner US server)

Relaying is almost all egress (1.32 GB an hour per push at 2.9 Mbps, `docs/phase-5-demo.md`): about **$48 a station-month on Railway** ($0.05 a GB) against about **$1.20** on a Hetzner US cloud server (1 TB included, about $1.20 a TB beyond, as of September 2026; check current prices). The image and its configuration are the same; only where it runs changes.

1. **A server**: a Hetzner Cloud server in Ashburn (us-east) or Hillsboro (us-west), Ubuntu 24.04. Size by CPU: a composited relay takes about 0.5 vCPU, a stream-copied one about 0.05; 4 shared vCPUs (CPX31) run about 6 composited stations. Put it near Postgres (Railway's us-west2: Hillsboro) and Livepeer's ingest.
2. **Docker**: `curl -fsSL https://get.docker.com | sh`.
3. **The image**: build it there from the repository (`docker build -f apps/relay/Dockerfile -t opencast-relay .`), or push it from CI to a registry (GHCR) and `docker pull` it.
4. **Configuration**, in `/etc/opencast/relay.env` (mode 600): the same variables as Railway's service, with two changes:
   - `DATABASE_URL`: Railway Postgres' **public** address (its TCP proxy, `DATABASE_PUBLIC_URL`) with `?sslmode=require`;
   - `REDIS_URL`: Railway Redis' public address (or leave it out and run exactly one relay).
   Keep `HLS_PUBLIC_URL` (the worker's public domain) and the `R2_*` keys (R2 has no egress fees, so reading segments directly is free).
5. **Run it**: `docker run -d --name opencast-relay --restart unless-stopped --env-file /etc/opencast/relay.env -p 127.0.0.1:8789:8789 opencast-relay`. The health endpoint needs no public port; point an uptime monitor at it through an SSH tunnel or a firewall rule for the monitor only.
6. **Hand over**: with Redis, start the new one first (it waits for the lease), then set the Railway service's replicas to 0 (or remove it from `.railway/railway.ts` and apply): the lease passes within `RELAY_LEASE_SEC` and the Hetzner relay starts sending. Platforms see a few seconds' reconnection, like a restart. Without Redis, stop Railway's first.
7. **Check**: `curl localhost:8789/health` shows each station relaying, with its kbps; the Translators page shows "Relaying".

Nothing else changes: the relay's Livepeer relay streams and targets are in the database, so the new host carries on with them.

## Livepeer's billing (Phase 3's question)

**Does a stream with `profiles: []` avoid transcoding charges? Not confirmed.** What's public (checked 30 September 2026):

- Livepeer Studio's pricing page lists three meters only: **transcoding $0.33 per 60 minutes**, storage $0.09, delivery $0.03 per viewer-hour (and a $100 monthly minimum on pay-as-you-go). **Multistreaming has no price of its own**, and the page doesn't say how transcoding minutes are counted or whether a stream with no renditions is charged.
- The docs say only that transcoding is disabled with an explicit empty `profiles` array, and that multistream targets can send `source`.
- Studio's own code (livepeer/studio, `controllers/stripe.ts`) bills "Transcoding" from a usage metric its analytics compute (`transcode_total_usage_mins`, not public). Its older invoicing billed transcoding by **source segments' duration** (`sourceSegmentsDuration`), i.e. by ingest minutes whatever the renditions. That suggests a source-only stream may still be metered as transcoding minutes.
- A forum answer claiming per-rendition billing was written by ChatGPT (its author says so), so it isn't evidence either way.

So the relay is built both ways, behind one switch, `RELAY_FAN_OUT`:

- `livepeer` (the prompt's design, the default when a key is set): one push per station; Livepeer splits it.
- `direct` (the fallback): the relay pushes to each platform itself (one stream-copying FFmpeg per platform, a few percent of a core each). Restarts restart only that platform's push. "Live shows only" on TV then goes through the relay service too (the live block from Livepeer's playback), since the live stream's own multistream is Livepeer's.

**To confirm** (needs the account owner, nothing here calls Livepeer): create one stream with `profiles: []` on the free sandbox, push 10 minutes to it with one multistream target, and read `GET /api/data/usage/query` the next hour (`TotalUsageMins`), or ask Livepeer support in writing. If it's charged, set `RELAY_FAN_OUT=direct`.

**The cost difference**, per station per relayed hour (composited; stream-copied saves the CPU line):

| | Livepeer, source-only free | Livepeer, charged at $0.33 | Direct, 1 platform | Direct, 2 | Direct, 3 |
|---|---|---|---|---|---|
| On Railway ($0.0278 a vCPU-hour, $0.05 a GB) | **$0.085** | **$0.415** | $0.085 | $0.151 | $0.217 |
| On a Hetzner US server (about $0.02 a vCPU-hour, $1.20 a TB) | **$0.013** | **$0.343** | $0.013 | $0.014 | $0.016 |

On Railway, if Livepeer charges, direct is cheaper up to six platforms ($0.415 against $0.018 + $0.066 a platform). On Hetzner, egress is so cheap that direct costs about the same as a free Livepeer split, so **direct is the safer choice there either way** (and it doesn't depend on Livepeer's billing). At the $0.20 an hour price (docs/pricing.md), a charged Livepeer split loses $0.215 an hour on every station; direct on Hetzner keeps the margin at any number of platforms.

## The old translators' keys

Before Phase 3 a translator (`broadcast.translators`) kept its stream key in plain text. They're now platform connections like any other destination (docs/platforms.md): `stations.moveTranslatorKeys` (run by the jobs tick, hourly and at the worker's first tick) adds each translator to the platforms module as a manual connection with its key **sealed** (`PLATFORM_SECRETS_KEY`), links it (`translators.platform_id`, migration 0036), checks the sealed copy opens to the same key, and only then nulls the plain `stream_key` (the column stays). It's idempotent. The station's relay setting (if it has none) takes its translators' break setting (the slate if any of them showed it) and "Everything I air" (what the worker's translators relayed). Without a configured `PLATFORM_SECRETS_KEY` nothing moves: the keys stay where they are, a warning is logged once, and the relay still reads them.

The old translator endpoints keep working (additively): adding one, or changing its key, address or service, seals the key into a new connection (the old one removed, its secret erased); its name, break setting and switches stay on the translator; removing one erases its sealed key; turning one off leaves it out of the relay. In production without `PLATFORM_SECRETS_KEY`, adding or re-keying one answers 409 `secrets_key_missing`, like adding a platform.

## Code

- `apps/relay`: the service (entry, config, lease, health endpoint, Dockerfile, its own tests).
- `apps/api/src/v1/modules/relays`: the relays module (the setting and the Translators page's API; `runner.ts`, what the relay service runs; `limits.ts`, restart planning; `livepeer.ts`, Livepeer's API; `platforms.ts`, the seam with the platforms module).
- `apps/api/src/v1/modules/playout/engine/sender.ts` (the sender, from the worker's translator), `fanout.ts` (the pushes), `relayBreaks.ts` (breaks and paid promotion), with the shared `tsretime.ts` and `background.ts`.
- Tables (migration 0034): `broadcast.station_relays`, `broadcast.relay_targets`, `broadcast.relay_restarts`; `translator_sessions.relay_mode`, `.platforms`. Migration 0036: `translators.platform_id`, and `translators.stream_key` nullable.

## Tests (never real Livepeer, never a real platform)

- `apps/api/test/relay.test.ts`: modes (live-only multistreams the live source's stream and no relay; everything uses the relay stream with `profiles: []` and `source` targets), copy and composite, breaks and partner time, paid promotion, restart timing (a live block past the window), one target toggled, the next broadcast before ending, Facebook's reminder, direct fan-out, the failure alert with the channel unaffected, the page's API. Against a fake Livepeer API (`test/fake-livepeer-api.ts`) and a stubbed platforms seam.
- `apps/api/test/playout-relay.test.ts` (`test:realtime`): real FFmpeg, local RTMP sinks as Livepeer's ingest: one continuous stream across a live block, stream-copied, the slate in breaks, the bug composited.
- `apps/api/test/playout-relay-background.test.ts` (`test:realtime`): radio relays over the background, and codes.
- `apps/api/test/translator-keys.test.ts`: the old translators' keys sealed, checked, nulled; idempotent; left in place without a key; the old endpoints through the sealed storage.
- `apps/relay/test`: configuration, the lease, the health endpoint.
