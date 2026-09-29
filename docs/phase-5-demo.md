# Phase 5: a station's evening, end to end

Run locally on 29 September 2026 against the Docker Postgres and Redis, a throwaway database (`opencast_demo_2edf3f7f`, migrated and seeded, dropped afterwards), local object storage, and one real Livepeer stream. The worker ran as in production (`apps/worker/src/worker.ts`, full TV ladder, `veryfast`), and `apps/worker/scripts/demo-evening.ts` wrote the evening onto the log, compressed to about seven minutes. Station ECCT 12.1 ("Inland Beat"), carrying OSEX's Saturday Reel under barter. Times below are Pacific.

The evening ran five times. The first four found the bugs listed under **Fixed**; the fifth (11:38 am) is the one reported here, on the fixed code, with evidence from the fourth (11:27 am) where it adds something (a full minute of live, and every segment kept for offline checks).

## What happened

- 11:38:00 **Late Crate**, then its break: Orange Street Coffee's **Fall menu** spot (held $4.00 at 11:38:04, settled when its last segment was published; `ORANGE10` shown for its last 10 s), the underwriting credit, the station ID.
- 11:39:16 **Saturday Reel**, carried from OSEX under barter; in the break, OSEX's own spot in the producer's share (held, settled, and passed on to OSEX: `barter_split`), then the credit and the station ID.
- 11:40:16 **Crate Talk**, live: a 1080p30 test signal pushed with FFmpeg over RTMP to Livepeer, transcoded by Livepeer to the channel's ladder, and aired from Livepeer's segments; back to prepared segments at 11:40:40, on the segment boundary.
- 11:40:40 nothing on the log: the worker filled the gap from the library a minute ahead (Late Crate, "filled dead air … with 1 repeats"), with its break.
- 11:41:40 **signed off**: the sign-off slate for a minute, then `#EXT-X-ENDLIST`. Back at 11:43:48, from the station ID, in a new playlist.
- One translator relayed the channel the whole time to a local RTMP sink (FFmpeg listening on 127.0.0.1), compositing the bug.

## The as-run log

What the worker wrote as each item's last segment was published (`broadcast.as_run`; `npx tsx --conditions=source scripts/as-run.ts <station>` prints it).

| Aired | Runs | Code | Why | What | Money |
|---|---|---|---|---|---|
| 11:37:54 | :01 | OPEN | station_id_fill | Station ID slate (before the evening) | |
| 11:37:55 | :05 | SID | station_id_fill | Station ID | |
| 11:38:00 | :35 | PGM | planned | Late Crate, ep. 14 | |
| 11:38:35 | :15 | SPT | rotation | Fall menu (code ORANGE10), proof frame | $4.00 |
| 11:38:50 | :15 | UND | planned | Thank-you credit | |
| 11:39:05 | :06 | OPEN | planned | Station ID slate (the break's open time) | |
| 11:39:11 | :05 | SID | planned | Station ID | |
| 11:39:16 | :30 | PGM | planned | Saturday Reel, ep. 1 (carried from OSEX) | |
| 11:39:46 | :15 | SPT | rotation | OSEX's sponsor, in the producer's share, proof frame | $4.00, paid to OSEX |
| 11:40:01 | :10 | UND | planned | Thank-you credit | |
| 11:40:11 | :05 | SID | planned | Station ID | |
| 11:40:16 | :24 | PGM | live | Crate Talk (Livepeer) | |
| 11:40:40 | :35 | PGM | dead_air_fill | Late Crate, ep. 14 | |
| 11:41:15 | :15 | UND | planned | Thank-you credit | |
| 11:41:30 | :05 | OPEN | planned | Station ID slate | |
| 11:41:35 | :05 | SID | planned | Station ID | |
| 11:41:40 | 1:00 | OPEN | slate | Sign-off slate, then the playlist ends | |
| 11:43:43 | :05 | SID | planned | Station ID (back on) | |
| 11:43:48 | :35 | PGM | dead_air_fill | Late Crate, ep. 14 (the log was empty after the evening) | |

The ledger for the evening: two holds of $4.00 at 11:38:04 (when the breaks were filled), a settle at 11:38:50, and at 11:40:13 a settle plus the barter split to OSEX.

## The live block through Livepeer

**Stream:** `3b5d9297-f4d3-4901-8a6e-f882a8c3ed36`, named "ECCT live: Studio A" (playback ID `3b5dgy5d4118v9jx`). Created once, through the product's own path (`services.stations.addLiveSource`), with the TV ladder's profiles (fixed in `apps/api/src/livepeer.ts`): 1080p 5 Mbps, 720p 2.8 Mbps, 480p 1.4 Mbps, 360p 800 kbps, 30 fps, a keyframe every 4 s. Not deleted. Total live time across every push today, by Livepeer's own count: **568 s** (8 sessions, the longest 128 s).

**The renditions line up.** Every segment around both switches, as a player fetched it (evening 4, where the live block ran a full minute):

| Segment | From | v1080 | v720 | v360 |
|---|---|---|---|---|
| 853 (station ID) | prepared | 1920×1080 30 fps, AAC | 1280×720 30 fps, AAC | 640×360 30 fps, AAC |
| 854 (station ID) | prepared | same | same | same |
| 855 (live) | Livepeer | 1920×1080 30 fps High, AAC 48 kHz | 1280×720 30 fps High, AAC | 640×360 30 fps High, AAC |
| 856 … 869 (live) | Livepeer | same, 4.09 to 4.10 s each | same | same |
| 870 (Late Crate) | prepared | 1920×1080 30 fps, AAC | 1280×720 30 fps, AAC | 640×360 30 fps, AAC |

The one difference is the TS layout: prepared segments carry the picture on PID 0x100 and the sound on 0x101; Livepeer's carry the sound on 0x100 and the picture on a PID per rendition (0x102 at 1080p, 0x103 at 720p, 0x105 at 360p). See **What couldn't be shown**.

**The playlist switches cleanly at both boundaries.** `v720.m3u8` at 11:41:00 (evening 5), into the live block and out of it:

```
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="57bfa270-…-item",CLASS="org.useopencast.item",START-DATE="2026-09-29T18:40:11.000Z",DURATION=5,X-OC-CODE="SID",X-OC-CONTENT-ID="slate-4c89082782…",X-OC-TITLE="ECCT 12.1"
#EXT-X-DATERANGE:ID="f6243013-…",CLASS="org.useopencast.break",START-DATE="2026-09-29T18:39:46.000Z",DURATION=30,SCTE35-OUT=0xFC302000000000000000FFF00F05F62430137FFFFE002932E000000000000042AA920B,SCTE35-IN=0xFC301B00000000000000FFF00A05F62430137F5F00000000000065D846DB,X-OC-BREAK-ID="f6243013-…"
#EXT-X-PROGRAM-DATE-TIME:2026-09-29T18:40:11.000Z
#EXTINF:4.000,
/objects/prepared/slate-4c89082782…/v720/seg_00000.ts
#EXTINF:1.000,
/objects/prepared/slate-4c89082782…/v720/seg_00001.ts
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="64d09104-…-live",CLASS="org.useopencast.live",START-DATE="2026-09-29T18:40:16.000Z",DURATION=24,X-OC-LOG-ENTRY-ID="0bdeddf7-…",X-OC-SOURCE-ID="fa4d61dd-…"
#EXT-X-DATERANGE:ID="64d09104-…-bug",CLASS="org.useopencast.bug",START-DATE="2026-09-29T18:40:16.000Z",DURATION=24,X-OC-MODE="call_sign_and_channel",X-OC-CALL-SIGN="ECCT",X-OC-CHANNEL="12.1",X-OC-POSITION="bottom_right",X-OC-OPACITY=78
#EXT-X-PROGRAM-DATE-TIME:2026-09-29T18:40:16.000Z
#EXTINF:4.000,
https://nyc-prod-catalyst-0.lp-playback.studio/hls/video+3b5dgy5d4118v9jx/3_1/8021_12021.ts?tkn=…
… (6 segments of Livepeer's 720p rendition)
#EXTINF:4.000,
https://nyc-prod-catalyst-0.lp-playback.studio/hls/video+3b5dgy5d4118v9jx/3_1/28021_32021.ts?tkn=…
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="666ca577-…-item",CLASS="org.useopencast.item",START-DATE="2026-09-29T18:40:40.000Z",DURATION=35,X-OC-LOG-ENTRY-ID="aa21cd5a-…",X-OC-CODE="PGM",X-OC-CONTENT-ID="bafkreibmhyybd4e…",X-OC-TITLE="Late Crate"
#EXT-X-DATERANGE:ID="666ca577-…-bug",CLASS="org.useopencast.bug",…
#EXT-X-PROGRAM-DATE-TIME:2026-09-29T18:40:40.000Z
#EXTINF:4.000,
/objects/prepared/bafkreibmhyybd4e…/v720/seg_00000.ts
```

Media and discontinuity sequence numbers ran on through both switches (`#EXT-X-MEDIA-SEQUENCE:902`, `#EXT-X-DISCONTINUITY-SEQUENCE:202` in every snapshot from 11:39:54 to 11:41:40). `v1080`, `v480` and `v360` switch at the same segments, to Livepeer's rendition of their own size. `a128` (audio only) reads Livepeer's 360p rendition during the block, since Livepeer makes no audio-only rendition.

**Played straight through both switches:**

- **hls.js 1.5** in a browser, live, through a live block (evening 3) and replaying evening 4's segments from 11:28:46 to 11:31:06 (credit, bumper, station ID, a minute of live, Late Crate): 4,200 frames decoded (140 s at 30 fps), 0 errors, no stalls, 4 frames dropped at double speed; the picture resized 1280×720 → 1920×1080 → 1280×720 at the switches where the source's size differed (evening 3, before Livepeer transcoded) and not at all once it matched (evening 4).
- **FFmpeg, as the translator reads the channel:** the same 37 segments joined as the relay joins them (`TsRetimer`), then decoded: 0 errors, 4,200 video frames at 1280×720 and 6,562 AAC frames, 140.0 s each; the same at 360p.
- **The translator's own output**, across the live blocks of evenings 4 and 5: no frozen picture (FFmpeg `freezedetect`, 2 s threshold: the only stills are the credit and station ID slates and the bumper's bars, before the switch). Before the fix, evening 2's relay froze for 65 s from the station ID through the whole live block.

## A break with SCTE-35

`v720.m3u8`, the break after Late Crate (evening 5): the break's one cue for its whole length, and the spot's code for its last 10 s.

```
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="98560be6-…-item",CLASS="org.useopencast.item",START-DATE="2026-09-29T18:38:35.000Z",DURATION=15,X-OC-CODE="SPT",X-OC-CONTENT-ID="bafkreicjzgew7ih…",X-OC-TITLE="Spot"
#EXT-X-DATERANGE:ID="dfe9aa7c-3450-40ab-b384-53e2b1a732c1",CLASS="org.useopencast.break",START-DATE="2026-09-29T18:38:35.000Z",DURATION=41,SCTE35-OUT=0xFC302000000000000000FFF00F05DFE9AA7C7FFFFE00384E1000000000000002D2601A,SCTE35-IN=0xFC301B00000000000000FFF00A05DFE9AA7C7F5F000000000000ABB5FC4B,X-OC-BREAK-ID="dfe9aa7c-3450-40ab-b384-53e2b1a732c1"
#EXT-X-DATERANGE:ID="98560be6-…-bug",CLASS="org.useopencast.bug",START-DATE="2026-09-29T18:38:35.000Z",DURATION=15,X-OC-MODE="call_sign_and_channel",X-OC-CALL-SIGN="ECCT",X-OC-CHANNEL="12.1",X-OC-POSITION="bottom_right",X-OC-OPACITY=78
#EXT-X-DATERANGE:ID="98560be6-…-code",CLASS="org.useopencast.code",START-DATE="2026-09-29T18:38:40.000Z",DURATION=10,X-OC-SPOT-ID="562378d0-…",X-OC-CODE="ORANGE10",X-OC-OFFER="10% off",X-OC-QR-URL="http://localhost:5174/c/ORANGE10?s=48a9ba13-…"
#EXT-X-PROGRAM-DATE-TIME:2026-09-29T18:38:35.000Z
#EXTINF:4.000,
/objects/prepared/bafkreicjzgew7ih…/v720/seg_00000.ts
…
```

## The master playlist and the sign-off

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=3208000,AVERAGE-BANDWIDTH=2928000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=30.000
v720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5628000,AVERAGE-BANDWIDTH=5128000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30.000
v1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1668000,AVERAGE-BANDWIDTH=1528000,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=854x480,FRAME-RATE=30.000
v480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=976000,AVERAGE-BANDWIDTH=896000,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30.000
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,AVERAGE-BANDWIDTH=128000,CODECS="mp4a.40.2"
a128.m3u8
```

The sign-off (`v720.m3u8` at 11:43:00): the slate with its back time, then the end.

```
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="0c2f321b-…-sign-off",CLASS="org.useopencast.sign-off",START-DATE="2026-09-29T18:41:40.000Z",DURATION=60,X-OC-BACK-AT="2026-09-29T18:43:48.000Z"
#EXT-X-PROGRAM-DATE-TIME:2026-09-29T18:41:40.000Z
#EXTINF:4.000,
/objects/prepared/slate-7ca21a100a…/v720/seg_00000.ts
… (15 segments)
#EXT-X-ENDLIST
```

At 11:43:50 the playlist started again (`#EXT-X-MEDIA-SEQUENCE:1060`, `#EXT-X-DISCONTINUITY-SEQUENCE:239`) from the station ID at 11:43:43.

## The translator

One translator (`service: rtmp`, "Local sink", `rtmp://127.0.0.1:19350/live`), composite mode (the bug drawn on), relaying the 720p rendition. What the sink received for evening 5 (FFmpeg `-listen 1`, stream-copied to a file):

```
ffprobe received-1.ts
stream|codec_name=h264|profile=High|width=1280|height=720|r_frame_rate=30/1
stream|codec_name=aac|profile=LC|sample_rate=48000|channels=2
format|duration=554.200333|size=73404600|bit_rate=1059611
```

Its egress, from `translator_sessions` (the figure the health endpoint and billing read):

| Session | Length | Bytes sent | Rate | Per hour |
|---|---|---|---|---|
| 11:23:32 to 11:32:23 (evening 4) | 8:51 | 73.4 MB | 1.11 Mbps | 0.50 GB |
| 11:33:23 to 11:42:46 (evening 5) | 9:23 | 67.7 MB | 0.96 Mbps | 0.43 GB |
| every session today (9) | | 534 MB in all | 0.85 to 1.43 Mbps | 0.38 to 0.64 GB |

The test content is mostly still slates and test patterns, so these are low: the relay's target is 2.8 Mbps video and 128 kbps sound, 1.32 GB an hour. The relay's FFmpeg used **0.42 of a core** (Apple silicon, measured over two sessions of 8 and 9 minutes), close to the 0.53 vCPU estimated before.

## Fixed

Each with a test that failed before the fix (`apps/api/test/`):

1. **Held spots aired as the station ID slate** when a station went on air between the worker's hourly readiness checks: its spots, bumpers and station IDs weren't queued for preparation until the next check, so the spots placed in its breaks (money held) weren't ready at air time. Now a station going on air is checked on the next tick, and spots are queued as they're placed (`engine/index.ts`; `playout-evening-fixes.test.ts`).
2. **A live block never left the stand-by slate** if the worker read the source before the encoder connected: Livepeer answers "Stream open failed" in a playlist, and the source kept that answer as its map for the whole block. Now it's not kept; the master is also read again until every rendition is listed (Livepeer lists the source first), again after the source reconnects (a new session at new addresses, its media sequence from 0), relative addresses follow redirects to the regional node, and a source counts as lost after three of its segments with nothing new, not 8 s (`engine/live.ts`; `playout-live-source.test.ts`).
3. **The translator froze for the whole live block**: Livepeer's segments carry the sound on the PID prepared segments use for the picture. The relay now puts every segment in one layout (picture 0x100, sound 0x101, one program table, continuity counters carried on), fits the picture to its size before compositing, and writes a session's end before the worker exits (`engine/tsretime.ts`, `engine/translator.ts`; `playout-tsretime.test.ts`).
4. **Livepeer streams weren't created at the ladder's renditions** (Livepeer's defaults: 240p to 720p, no 1080p). Now `livepeerProfiles()` builds them from `ladder.ts` (`src/livepeer.ts`; `playout-live-source.test.ts`).
5. **Taking an entry off the log failed (422)** once the break after it was stored, which happens 20 minutes ahead. Now its empty breaks go with it and a break with spots held stays without it (`log/service.ts`; `playout-evening-fixes.test.ts`).
6. **Log edits near air didn't reach playout** until its 15-minute plan ran out: adding, changing or removing an entry within 30 minutes now tells a station on air to read its log again (`log/service.ts`; `playout-evening-fixes.test.ts`).
7. **The as-run log stopped** when an item's entry or break was taken off the log after the item was written to the channel: its as-run insert failed on the reference, and the row was retried every second ahead of every newer row. Now the missing references are left empty, and a row that fails is retried a minute later without holding up the rest (`engine/assemble.ts`; `playout-evening-fixes.test.ts`).

The demo script: runs against the worker's own port (`WORKER_HEALTH_PORT`), creates the live source through the product (one Livepeer stream when a key is set), takes `DEMO_LEAD_S`, `DEMO_LIVE_S`, `DEMO_TRANSLATOR_URL` and `DEMO_STATION` (the evening again on a station an earlier run made, reusing its Livepeer stream), and tells a station on air to read its log again. `as-run.ts` names the sign-off slate.

## Cost per channel per month

Prices: Railway $20 per vCPU-month ($0.0278 per vCPU-hour), $10 per GB of memory a month, $0.05 per GB of egress; R2 $0.015 per GB-month, $4.50 per million writes, $0.36 per million reads, no egress charge; Livepeer Studio $0.33 per hour transcoded, $0.03 per hour delivered (the Growth plan's $100 monthly minimum is for the platform, not a channel). Checked on 29 September 2026.

**Assumptions** (per channel; change them and the lines scale): on air 730 hours a month; **60 hours of new material prepared** a month (about two hours a day of new programs, spots, bumpers and credits; repeats and carried programs aren't prepared again, and a carried program's preparation is shared by every station that airs it); **300 hours kept prepared** in storage; **20 live hours**; one translator relaying around the clock. A Railway vCPU is taken as equal to one core of the Mac this ran on (Apple silicon); an x86 vCPU may be somewhat slower, so the preparation and translator CPU lines could be up to about 40% higher.

**Measured here:**

- Preparation, TV ladder (all five renditions, one FFmpeg pass, `veryfast`, loudness levelled): a 60-second 1080p file took 88 CPU-seconds (a test pattern) to 134 (a noisy, detailed picture), 13 to 21 s on the clock. That's **1.5 to 2.2 core-hours per media hour**, higher than the 1.16 vCPU-hours estimated before; 2.0 is used below. The worker's health endpoint during the evenings: 1,046 s of preparation per media hour at one at a time. Livepeer's transcode API would be $0.33 per media hour, about five times FFmpeg on the worker.
- Preparation, radio band (AAC 128 and 64 kbps): 3.5 CPU-seconds per minute, **0.06 core-hours per media hour**.
- Prepared size: **4.8 GB per media hour** for TV (1080p 2.3 GB, 720p 1.3, 480p 0.7, 360p 0.4, audio 0.06), **0.1 GB** for radio. 900 segments per rendition per hour to write.
- Assembly: the worker used **0.014 of a core** with one channel on air (the leader lock, the jobs, dead-air checks and the assembler). A playlist render takes **6.4 ms**; with the one-second cache that's at most five renders a second per channel, 0.03 of a core however many watch. A 30-minute media playlist is about 110 KB, **8 KB gzipped**.
- Live: Livepeer counted 568 s of source for everything pushed today (about $0.05).
- Translator: **0.42 of a core** composited; 0.9 to 1.4 Mbps of egress on this content, 2.9 Mbps nominal for real pictures.

| Per channel, per month | TV | Radio band | How |
|---|---|---|---|
| Preparation | **$3.80** | **$0.10** | 60 h × 2.0 (radio 0.06) vCPU-h × $0.0278, plus memory while preparing. Livepeer instead: $19.80 either band |
| Assembly | **$1.50** | **$1.00** | 0.02 to 0.05 vCPU and a little memory on the worker, and the playlist renders |
| Storage | **$22.90** | **$0.95** | 300 h × 4.8 GB (radio 0.1 GB) × $0.015, plus $1.20 (radio $0.50) of writes for the month's 60 new hours |
| Live hours | **$6.60** | **$6.60** | 20 h × $0.33 at Livepeer (Livepeer transcodes a radio source's still picture at the same rate) |
| Translator (one, around the clock) | **$61.70** | **$12.30** | TV: 0.55 vCPU $11.00, 0.25 GB $2.50, 963 GB of egress (2.93 Mbps) $48.20. Radio (still picture at 400 kbps with the sound, not measured here): 0.1 vCPU $2.00, 0.15 GB $1.50, 175 GB $8.80 |
| **Total without a translator** | **$34.80** | **$8.65** | |
| **Total with one translator** | **$96.50** | **$20.95** | |

What scales with viewers rather than channels: segments come from R2 with no egress charge (900 reads per viewer-hour, $0.0003, less behind Cloudflare's cache), playlists from Railway (7 MB per viewer-hour gzipped, $0.0004), and during live blocks Livepeer's delivery at $0.03 per viewer-hour. The translator is the largest per-station cost, and almost all of it is egress: a translator only while a station wants one keeps it proportional.

## What couldn't be shown

- **A plain `ffmpeg -i v720.m3u8` doesn't play through the switch into Livepeer.** FFmpeg's HLS reader keeps one TS demuxer across discontinuities, and Livepeer's segments lay their streams out differently (sound on PID 0x100, the picture on 0x102, 0x103 or 0x105 by rendition, sound listed first), so it feeds Livepeer's sound to the picture decoder. Players that start again at a discontinuity (hls.js, checked above; Safari and ExoPlayer do the same) play through, and so does the translator now. Preparing with Livepeer's layout isn't possible, since its picture PID differs per rendition; the alternative is passing live segments through the platform (remuxing them, or copying them into R2), which the design avoids. A decision for later if an FFmpeg-based consumer matters.
- **Livepeer's live segments disappear when its session ends** ("Stream open failed" a minute later), so the playlist's 30-minute window can't replay a live block after it's over (pause, catch-up), and a translator running more than a few seconds behind can't fetch them. Copying live segments into R2 as they're published would fix both; not built.
- **The audio-only rendition carries video during a live block** (Livepeer's 360p): players on `a128` get pictures they don't show, and a radio-band live block would need an audio-only source path. Not built.
- **Livepeer didn't transcode this morning.** Its sessions from 10:32 to 11:03 produced source segments only (the channel's renditions all read the 1080p source then, and players changed picture size at the switch); at 11:14 it transcoded a third of the segments, and from 11:28 every one. Two pushes at the start (a 45 s check, and a 35 s test with one of Livepeer's default profiles, which transcoded nothing either) were spent finding that out. The platform follows what Livepeer lists.
- **Evening 5 needed help after four evenings on one station**: the dead air filled between evenings (with a break every minute) had spent the spots' daily caps and the station's same-spot-per-hour limit, so the script now tops the business up and raises the caps when it reuses a station; for this run I also raised the station's hourly spot limits and reopened the two breaks the worker had already marked filled, in the throwaway database. A fresh run (a new database) needs none of this.
- **hls.js live during evening 5**: the page was seeked back by something outside the test at the switch, so evening 5's live player log isn't used; evenings 3 (live) and 4 (the same segments, replayed) are.
- **The radio band wasn't run as a channel**: its costs come from preparing a 60-second file for the radio band, and its translator's cost is estimated.
- The run used an Apple silicon Mac; see the vCPU assumption above.
