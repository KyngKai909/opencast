# Platforms: connecting YouTube, Twitch and anything else

Follow-up Phase 3, the platforms half (the relay itself is `docs/relay.md`). A station's translators relay to the platforms it connects on master control's Translators page (step A4 of `docs/reference/control/opencast-master-control.html`):

- **YouTube**, by signing in with Google. Opencast creates one reusable live stream for the station (its key never changes) and a live broadcast bound to it that starts when the relay's stream arrives and stops when it stops. Before a restart it creates the next broadcast, carrying over the title and description, so viewers land on the new one.
- **Twitch**, by signing in with Twitch. Opencast reads the stream key. Twitch starts a new broadcast by itself when a stream reconnects.
- **Anything else** (Facebook, Kick, any RTMP or RTMPS address): added by hand with its address and stream key. Facebook by sign-in is **Open** (docs/open-decisions.md).

Signed-in YouTube and Twitch are also how Opencast counts **relay viewers**: the concurrent viewers each reports, every minute, billed for per-thousand spots (below). Manually added destinations can't be counted, so their viewers are never billed.

The code: `apps/api/src/v1/modules/platforms/` (`service.ts`, `routes.ts`, `providers.ts` for the real YouTube and Twitch clients, `fake.ts` for the fakes every test uses, `secrets.ts`), and `apps/api/src/v1/modules/spots/relayViewers.ts` for billing. Contracts: `packages/contracts/src/platforms.ts`. Migration **0035**.

## What you set up

### Google Cloud (YouTube)

1. Create a Google Cloud project for Opencast (or use the existing one), at console.cloud.google.com.
2. **APIs and services, Library**: enable **YouTube Data API v3** (broadcasts, streams, viewer counts, paid promotion) and **YouTube Analytics API** (viewer geography per broadcast).
3. **OAuth consent screen** (Google Auth Platform, Branding and Audience):
   - User type **External**; app name "Opencast", the support email, the app's home page and privacy policy links, and Opencast's domain under authorized domains.
   - Scopes (Data access): `https://www.googleapis.com/auth/youtube.force-ssl` and `https://www.googleapis.com/auth/yt-analytics.readonly`. Both are sensitive scopes, so the app needs **Google's verification** before anyone outside the test users can sign in.
   - Until it's verified: publishing status **Testing**, and add every station owner who'll connect YouTube as a **test user** (up to 100). In Testing, Google's refresh tokens expire after 7 days, so test stations have to sign in again weekly; verification removes that.
4. **Credentials, Create credentials, OAuth client ID**: type **Web application**. Authorized redirect URIs, one per API:
   - `https://<api>/v1/platforms/oauth/youtube/callback` (staging's and production's API origins, as `API_PUBLIC_URL` says them)
   - for local development, `http://localhost:8080/v1/platforms/oauth/youtube/callback`
5. Put the client's ID and secret in the API's variables as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Railway, never the repo).
6. **Quotas**: the YouTube Data API gives 10,000 units a day. Each connected YouTube costs about 1,440 a day for viewer counts (one `videos.list` a minute, 1 unit each) plus about 100 for each broadcast Opencast creates (`liveBroadcasts.insert`, `bind`, `transition`) and 50 for each paid-promotion change (`videos.update`). Past about six relaying stations, ask Google for more quota (IAM and admin, Quotas) before it runs out.
7. Each channel that connects must be **enabled for live streaming** on YouTube (YouTube Studio, Go live; it takes up to 24 hours the first time). Opencast can't do this for them.

### Twitch developer console

1. At dev.twitch.tv/console, **Register your application**: name "Opencast", category "Broadcaster suite", client type **Confidential**.
2. OAuth redirect URLs: `https://<api>/v1/platforms/oauth/twitch/callback` for each API, and `http://localhost:8080/v1/platforms/oauth/twitch/callback` for local development.
3. Put the client ID and a new client secret in the API's variables as `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.
4. Scopes Opencast asks for: `channel:read:stream_key` (the key) and `channel:manage:broadcast` (Twitch's branded content flag, its paid promotion). Viewer counts (Get Streams, `viewer_count`) need no scope.
5. Optional: `TWITCH_INGEST_URL` (default `rtmp://live.twitch.tv/app`) to send to a nearer ingest server.

### The key that seals stream keys and tokens

`PLATFORM_SECRETS_KEY`: 32 random bytes, base64 or hex, e.g. `openssl rand -base64 32`. Optionally named: `v1:<key>` (the name is stored with every value it seals). Production refuses to store a key or connect a platform until it's set; development without it uses a fixed development key and says so once in the log.

**Rotating it**: generate a new key, set `PLATFORM_SECRETS_KEY` to it (with a new name) and add the old one to `PLATFORM_SECRETS_OLD_KEYS` (`name:key`, comma separated). Values sealed with the old key still open; the platforms job re-seals everything with the new key once a day (at the first tick of each UTC day, `resealSecrets`). When `select count(*) from broadcast.platform_connections where stream_key_enc like 'v1.<old name>.%' or access_token_enc like 'v1.<old name>.%' or refresh_token_enc like 'v1.<old name>.%'` is 0, drop the old key.

### The rest

- `API_PUBLIC_URL` must be the API's public origin: it's where YouTube and Twitch send the browser back.
- `APP_ORIGIN` is where the callback sends the browser after that: master control's Translators page (`/control/<call sign>/translators`, or the `returnTo` master control passed, e.g. the setup flow's step).
- `PLACES_URL` (already used for business locations) also places the cities YouTube Analytics reports, so local businesses can be billed for relay viewers inside their area. Without it, YouTube's cities can't be placed and local businesses aren't billed for relay viewers at all.
- `GEOIP_URL` (already used for the market from a connection) also places signed-out Opencast viewers by market, for local businesses' spots.

## Keys and tokens

- Sealed with AES-256-GCM, a fresh IV each time, the row and field as additional data (a sealed key can't be moved to another row), and stored as `v1.<key name>.<iv>.<tag>.<ciphertext>`. The database never holds one in the clear (a check constraint also requires them erased once a destination is removed).
- Opened only in memory, for the call that needs it: the relay's `destinationsFor`, and each call to a platform. Nothing logs them; errors from the platforms are reduced to the step, a status and an error code. Revoking sends the token in the request body, never the address.
- Never returned: the API says only `hasStreamKey`.
- **Remove** is one click (owners): the tokens are revoked where the platform allows (Google's and Twitch's revoke endpoints), the key and tokens erased, and the row kept with `removed_at` for its viewer history and bills. It's removed even if revoking fails; its history says `revoke_failed`.
- A platform that refuses Opencast's token (the owner revoked access on YouTube, the refresh token expired) is marked `needs_sign_in`: it isn't polled, the relay sees it as not connected, and the Translators page asks the owner to sign in again, which reconnects the same account with the same stream and key.
- Sign-ins use a one-time `state` (32 random bytes, 15 minutes) stored with the station and the person who started it, and PKCE for Google.

## The relay service's seam

`services.platforms` implements `PlatformsSeam` from `packages/contracts/src/relay.ts`:

| Call | YouTube (signed in) | Twitch (signed in) | By address and key |
|---|---|---|---|
| `destinationsFor(stationId)` | its ingest address and key, `connected: true` while signed in | the same | `connected: false` |
| `prepareNextBroadcast(platformId)` | creates the next broadcast bound to the same live stream (same address and key), title and description carried over; asked twice before the restart, the same one | `null`: Twitch starts one itself | `null`, and the station is reminded (`remind_restart`) |
| `endBroadcast(platformId, broadcastId?)` | ends that broadcast (or the current one) and moves on to the prepared one; paid promotion follows to the new video | nothing | nothing, and the station is reminded (`remind_end`) |
| `setPaidPromotion(platformId, on)` | the video's `paidProductPlacementDetails.hasPaidProductPlacement`: `{ applied: true }` | Modify Channel Information's `is_branded_content`: `{ applied: true }` | `{ applied: false }`, and the station is reminded (`remind_paid_promotion`) |

Every call is in the destination's history (`broadcast.platform_events`).

## Counting relay viewers

Every minute (the jobs' tick), each connected, signed-in YouTube and Twitch is asked for its concurrent viewers: YouTube's `liveStreamingDetails.concurrentViewers` for the current broadcast, Twitch's Get Streams `viewer_count`. Each answer is a row in `broadcast.platform_viewer_samples` (station, platform, minute, viewers, and the platform's broadcast), like Opencast's own `minute_samples`. Attribution is by time: a spot's relay viewers are the platform's reported viewers averaged over the spot's as-run window, a program's over its own (`viewersDuring`). Audience shows each platform's latest count apart from Opencast's viewers.

## Billing relay viewers

For per-thousand spots only; flat per-airing spots are unaffected.

- **Online businesses** ("where your customers are: online") pay for Opencast's viewers plus every relay viewer, at the spot's rate.
- **Local businesses** (a location or a service area) pay only for viewers Opencast can place inside the spot's area:
  - **Opencast viewers** are placed by market, once per viewing session: the viewer's chosen market when signed in, else the market of a coarse location from the connection (`GEOIP_URL`). Only the market is kept. Each minute's tuned in is counted by market too (`audience.minute_markets`). A market is inside the area when a business location is in it, its centre is within the area's reach, or it's the market of the station the spot aired on (matching only airs a local spot on a station inside its area). Viewers Opencast can't place aren't billed.
  - **Relay viewers** only where the platform says where they are: YouTube Analytics' views by city for the broadcast on the spot's day (a day or two late). The share of those views inside the area (cities within the area's reach of a location, or in its markets when it has no reach) is applied to the relay viewers during the spot. Twitch doesn't report location, so Twitch viewers are never billed to local businesses. Where YouTube returns no location data (below its privacy thresholds), those viewers aren't billed.
- **The money.** A spot's hold covers Opencast's viewers plus an estimate for the relay share (the platforms' usual viewers at that hour over the last week; local businesses: YouTube's only), inside the spot's per-airing maximum. When the spot airs, Opencast's part settles and the relay estimate stays held, shared between the platforms by their usual viewers. Each platform's relay part (`spots.relay_charges`) then settles on its own:
  - online: a couple of minutes after the spot, once the platform's counts are in;
  - local, YouTube: when the location data arrives (asked for every six hours from the day after);
  - local, Twitch: not billed, straight away;
  - no data within `relays.location_wait` (7 days, a rule in the registry, **Open**): not charged, and what was held returns to the business's balance.
  What a part costs past its share of the hold comes from the balance, and past that Opencast absorbs it, as for any per-thousand airing.
- **Where it shows.** Results: each airing's relay parts (`ResultsAiring.relayViewers`: "Relay viewers, as reported by YouTube", or "Relay viewers, waiting for YouTube's location data" until it settles), a line per platform (`Results.relayViewers`) and `totals.relaySpentMicros` / `relayWaitingMicros`. Business statements: "Relay viewers, as reported by YouTube" (and Twitch) as their own lines, and this month's "Relay viewers, waiting for YouTube's location data" (held, shown). Station earnings (`lines.relayViewers`) and station statements: the same lines, apart from Spots. In the ledger they're `settle` entries with `source_type` `relay_viewers` and the label as the memo; returns are `release` entries with the same source type.

## To confirm with real accounts (not possible in tests)

- The shape of YouTube Analytics' `city` dimension: the client reads each row's first value as the city's name and places it with `PLACES_URL`. If YouTube answers with IDs instead, add the lookup from ID to name (or use `province` for coarser placing) in `providers.ts`, `youtubeClient().geography`.
- That a reusable live stream bound to a second broadcast before the first ends switches over cleanly with `enableAutoStart` (the seam's order: prepare, then end).
- Twitch's `is_branded_content` needs `channel:manage:broadcast`; Opencast asks for it at sign-in.
