# Opencast: programming that runs itself, cleaner pictures, and the dial in other apps

Six improvements, five of them with ideas taken from ErsatzTV (github.com/ErsatzTV/legacy, zlib license, and github.com/ErsatzTV/next, MIT). We take **ideas and algorithms, not code**. They're C# and Rust, we're TypeScript. Where a phase names a file of theirs, read it as a reference only. If any logic ends up following theirs closely, add a credit line in `docs/credits.md` with the repo, the file and the license.

What we're building:

1. Template slots that air **the next episode** each time, not the same episode every week.
2. **Playback orders** for those slots and for dead-air fill: in episode order, shuffle, and the rest.
3. **Cleaner pictures** from prepare: HDR phone video tonemapped, interlaced video deinterlaced.
4. **Suggested break points** inside programs, from chapter marks and fades to black.
5. **The dial in other apps**: a public M3U channel list and an XMLTV guide, so TiviMate, Jellyfin, Channels DVR, Kodi and VLC can tune Opencast.
6. **Where it can air**: rights that say which outlets, territories and dates each program is cleared for, enforced on relays and other apps, and a monthly report of minutes aired per licensor.

Not in this prompt: a delivery feed for FAST platforms (Samsung TV Plus, Plex's free channels and others) and splitting platform revenue between licensors, creators and Opencast. Those wait for the first aggregator conversation, because the aggregator's spec decides the feed. Phase 6 lays the groundwork both of them need.

## Ground rules

- Work on a branch called `programming`, from `dev`. Commit at the end of each phase. Never force-push.
- **Stop at every STOP**, say what you did, and wait.
- Phase 3 touches the template editor, as does the Schedule workspace (`docs/prompts/4-schedule.md`). If the `schedule` branch hasn't merged into `dev` when you reach Phase 3, ask before starting it.
- Contract changes are additive. Log each one in `docs/contracts-changelog.md`.
- New copy goes in `docs/apps/new-copy.md`. Anything this prompt leaves undecided goes in `docs/open-decisions.md`, with your recommendation.
- Save this prompt as `docs/prompts/5-programming.md`.

## Phase 0: Map it

Read these:
- `apps/api/src/v1/modules/log/templates.ts` (how templates generate dates)
- the `DayTemplateEntry` contracts in `packages/contracts/src/log.ts`
- `planRepeat` in `apps/web/src/control/components/onair/repeat.ts`
- the worker's dead-air fill in `apps/api/src/v1/modules/playout/engine/`
- `prepare.ts` and the probe it calls
- `breakPointsMs`: `setBreakPoints` in `modules/library/service.ts`, and how `log/service.ts` splits programs around break points
- the `as_run` table in `packages/db/src/schema/broadcast.ts`
- how `objectKey.prepared(key, …)` gets its `key` in `apps/api/src/v1/storage.ts`

Write `docs/programming-map.md`: for each of the five items, what exists, what's missing, and which files change. Answer these explicitly:
- Does a prepared item's key change when the prepare pipeline changes? (This matters for Phase 1.)
- Can a log entry be traced back to the template entry that made it?
- Is there any record of which episode of a program last aired from a given slot?

**STOP.**

## Phase 1: Cleaner pictures from prepare

Today `prepare.ts` does fps, `format=yuv420p`, scale and pad, loudnorm, then libx264. HDR sources come out washed out and grey, and interlaced sources come out combed. iPhones record HDR (HLG, or Dolby Vision with an HLG base layer) by default, so this affects most phone uploads.

- **Probe more.** Add `color_transfer`, `color_primaries`, `color_space`, `field_order` and the rotation side data to the probe.
- **HDR to SDR**, on the CPU:
  - When the transfer is `smpte2084` (PQ or HDR10) or `arib-std-b67` (HLG), tonemap to BT.709 before scaling.
  - Use `zscale` with `tonemap` (hable, `desat=0`), with the input transfer set from the probe.
  - First check that the ffmpeg in our build has `zscale` (`ffmpeg -filters | grep zscale`). If it doesn't, change the build to an ffmpeg that does, say how, and stop there.
  - Dolby Vision files: tonemap from the HLG or HDR10 base layer, and ignore the enhancement layer.
- **Deinterlace** when `field_order` is `tt`, `bb`, `tb` or `bt`, using `bwdif=mode=send_frame`.
  - For files with no field order, run a short `idet` sample during probe and treat a clear interlaced result the same way.
  - Order matters: deinterlace, then fps, then tonemap, then scale.
- **Rotation:** make sure a vertical phone clip comes out upright and pillarboxed, not sideways. Add a test.
- **Tag the output** as BT.709 (`-colorspace`, `-color_primaries`, `-color_trc`), so players don't guess.
- **References:** ErsatzTV next's `crates/ffpipeline/src/color.rs` (detection) and `pipeline.rs` around HDR format and deinterlace ordering. Read them; don't copy them.
- **Tests:** generate small fixtures with lavfi (an HLG-tagged clip, a PQ clip, an interlaced clip, a rotated clip). Check the filter graph that gets built and the output's colour tags.
- **What's already prepared:**
  - If Phase 0 found that the prepared key doesn't include the pipeline, add a prepare version only to items that the new probe flags as HDR or interlaced.
  - Add a one-off job that re-prepares those items. Store them alongside the old prepared copy, and switch over when they're ready, so nothing on the log loses its readiness.
  - Everything else keeps its segments.
- **Library:** an item that was tonemapped or deinterlaced says so in its details ("Converted from HDR", "Deinterlaced").

**STOP.** Show a phone HDR clip before and after, an interlaced clip before and after, and how many existing items the re-prepare job would touch.

## Phase 2: Seasons and playback orders

**Data:**
- Add `seasonNumber` (nullable) beside `episodeNumber` on library items, editable where the episode number is. Uploads guess both from the filename (`S02E05`, `2x05`, "Season 2 Episode 5"), and the creator can correct them.
- Add an optional `partOf` grouping, so a multi-part episode ("Part 1", "Part 2", or "(1)", "(2)" in a series) can be kept together. Guess it from titles, and let the creator correct it.

**The orders.** Put them in contracts with their copy:

| Order | Meaning |
|---|---|
| In order | Season, then episode, then date added |
| Newest first | The newest episode not yet aired from this slot, then back through the rest |
| Shuffle | Every episode once, in a random order, before any repeats; then a new random order |
| Shuffle shows, keep each in order | For a slot that draws on several programs: which program is random, and each program's episodes stay in order |
| Marathon | A whole season in a row, then the next season |

- Leave out a plain "Random" that can repeat. ErsatzTV keeps one, and it's the one people complain about.
- Multi-part episodes always air together, in every order.

**The walker:** one pure function in `packages/domain` that takes the episodes, the order, a seed and a position, and returns the next episode or episodes.
- It must be deterministic. Shuffle is a seeded permutation per cycle (seed from the slot's id and the cycle number), so the same inputs always give the same episode and generation stays idempotent.
- New episodes join at the right place: in order, when the walker reaches them; newest first, next.
- An episode that isn't ready is skipped for this airing, not lost from the cycle.
- Unit-test every order, including adding episodes partway through a cycle, multi-part groups, and an empty program.

**Dead-air fill and "Repeat from your library":**
- Both use the walker with **In order**, picking up after the last episode of that program in `as_run`. Fill then stops airing the same episodes again and again.
- `planRepeat` keeps choosing *which* program to fill with. Only the episode choice changes.

**"Never aired" and "Next episode":** add these to library items for a station, from `as_run`. This answers open question 11 in `docs/schedule-map.md`, and the Add drawer's fit badges can now use them.

**STOP.** Show the walker's tests, a gap filled twice with different episodes, and the filename guesses on a sample of real uploads.

## Phase 3: Template slots that air the next episode

Today a template copies the same entries onto every date it covers, so "Saturdays" re-airs the same episodes each week.

**A template program entry gets a "What airs" setting:**
- **This episode** (today's behaviour, and the default for existing entries).
- **Next episode**, from one program or several (a mix), with an order from Phase 2.
- **Fill the slot**: next episodes, as many as fit the slot's length, in the order. This is for long blocks such as a 24/7 lofi station's night or a Saturday-morning cartoon run. Time left over goes to the log's usual fill.
- **Same as earlier slot**, pointing at an earlier entry on the same template: a same-day rerun of what that slot aired.

**How a "Next episode" slot moves on:**
- It walks its program in its order, one step each date it actually airs.
- **Derive the position; don't store a counter.** The position is how many times this slot has aired before this date: in `as_run` for dates that have passed, and on the log for dates already generated. This needs a log entry to know which template entry made it. Add that link if Phase 0 found it missing.
- A date where the slot didn't air (edited into an exception, taken by a live block, or off air) doesn't use up an episode. The next date gets it.
- Editing the template regenerates future dates that aren't exceptions, as today. The walk carries on where it was; it doesn't restart.
- At the end of a program: **start over** by default, with a log warning a week before the last episode airs ("Late Crate airs its last new episode Sat Oct 24, then starts over"). Also offer **stop**: the slot becomes dead air from then on, which the usual dead-air warnings catch.

**Length:**
- An episode shorter than the slot leaves time for breaks and fill, as today.
- An episode longer than the slot uses the existing ripple and Keep-at-this-time rules. When it would push an entry kept at its time, it's a template warning with the episode and the minutes.
- Fill the slot never overruns: it stops before the end.

**Guide and listings:** generated dates already carry the real episode title three weeks ahead. Check that the guide, the station page and reminders use it.

**UI:**
- In the template editor and the Add drawer's template mode: "What airs" as a segmented control under the program, the order as a select, and a preview line ("Next 4 Saturdays: ep. 13, 14, 15, 16").
- On the log, an entry from a Next episode slot shows a small "Next episode" mark, and its details say which slot and template.

**STOP.** Show a Saturdays template advancing over three generated weeks, a date edited into an exception passing its episode to the next week, a Fill-the-slot night, and the end-of-series warning.

## Phase 4: Suggested break points

`breakPointsMs` is set by hand today, and the log splits programs around those points.

**During prepare:**
- Read the file's chapters (`ffprobe -show_chapters`). Each chapter start becomes a suggested break point, except in the first and last two minutes and between chapters closer than five minutes.
- For files with no chapters, run `blackdetect` together with `silencedetect`. A stretch of at least 0.3 s that's both black and silent is a candidate; keep the strongest one in each stretch of eight minutes or more. Old TV episodes have these where the commercials were.
- Store the suggestions apart from the creator's own break points, with where each came from (chapter or fade).

**In the library item's details:**
- "Suggested break points: 3, from chapter marks", with Use these and Dismiss, and each point previewable (the existing preview player, cued two seconds before the point).
- Accepted points become `breakPointsMs`.
- Never apply them on their own. A bad break in the middle of a sentence is worse than none.

**Carriage:** episodes offered for carriage keep the maker's break points as they are. Suggestions are only for the station's own library.

**STOP.** Show suggestions on a file with chapters and on an old TV episode without them.

## Phase 5: The dial in other apps (M3U and XMLTV)

These are public, cached, and read-only.

**`GET /v1/iptv/channels.m3u`:**
- Every Opencast station that's on the air: independent, claimable and the catalog station. Leave out External stations (their permission covers our apps only) and waitlist numbers.
- Filters: `?market=` and `?band=tv|radio`.
- Each entry has `tvg-id` (stable, from the station id), `tvg-chno` (the dial number, `12.1`), `tvg-name` (the call sign), `tvg-logo` (the station's mark), `group-title` (the market), and `radio="true"` on the radio band. The stream URL is the station's `master.m3u8` with `?via=iptv` added.

**`GET /v1/iptv/xmltv.xml`** (and `.xml.gz`):
- Channels: the same ids, with display names (call sign, number, name) and icons.
- Programmes: from the published log, two hours back to seven days ahead. Breaks fold into the program around them.
- Each programme has its title, `sub-title` (the episode title), `desc`, `category`, `episode-num` (`xmltv_ns` when the season and episode are known, `onscreen` otherwise), `rating` from the advisory, `<live/>` for live blocks, and `<new/>` for a first airing (from Phase 2).
- Planned off air is a programme of its own: "Off air", with the back time in the description.
- Regenerate on log publish. Use an ETag, and gzip.

**Counting:**
- Playlist requests carrying `via=iptv` are counted as an audience source, "Other apps", by station and market (from IP, as the viewer does).
- There are no beacons, so treat a session as a run of playlist polls.
- Don't count these viewers toward spot billing until Kai decides. Add the question to `docs/open-decisions.md` with your recommendation.

**Known limit:** the bug, lower thirds and the spot's code and QR are drawn by our player from `DATERANGE` tags, so other apps won't show them. Station IDs and spots still air. Write this in `docs/iptv.md`; don't burn anything in.

**Viewer app:**
- A "Watch in other apps" section in You, with both URLs, copy buttons, and one line each for TiviMate, Jellyfin, Channels DVR, Kodi (PVR IPTV Simple) and VLC.
- Plex has no M3U support of its own; say so plainly.

**STOP.** Show both files validating (the XMLTV against the DTD), loaded into VLC and one IPTV app, and the "Other apps" audience count.

## Phase 6: Where it can air

Today rights answer only "may this station air it?" (`Rights.basis` on library items; carriage `Terms` between stations). Nothing says where else it may go. That's already a gap: a relay in "Everything I air" mode sends carried programs to YouTube and Twitch whether or not the maker allowed it. Phase 5 adds other apps, and FAST platforms come later.

**Outlets.** Add an enum to contracts:
- `opencast`: our own apps, web, TV and Cast. Always allowed when the item can air at all.
- `other_apps`: the M3U and XMLTV from Phase 5. It's our stream, played in someone else's player.
- `relays`: YouTube, Twitch, Facebook and the other relay platforms.
- `fast`: FAST platforms. Leave room for naming individual platforms later.
- `recording`: viewers may record it (for Phase 7).

**Where the clearance is recorded:**
- **A station's own items.** `made_it` and `public_domain` are cleared everywhere. `owner_permission`, `permission_record` and `licence_record` get an outlets list. Existing rows get `opencast` and `relays`, since relays already carry them; flag that default in `docs/open-decisions.md`. CC licences: `cc_by` and `cc_by_sa` allow every outlet, keeping their attribution.
- **Carriage offers.** The maker chooses which outlets the carrier may use, with `opencast` always on. Existing agreements keep what they have today (`opencast` and `relays`), and the maker can narrow it for new carriers only, as other terms work.
- **Network licences: a new record.** It holds the licensor, the programs or items it covers, outlets, territories (ISO country codes, or worldwide), a start and an end date, and the deal (rev share percent, flat fee or none; plain fields, no money moves yet). Catalog items the network licenses from distributors hang off one of these.
- **End dates count everywhere.** An item whose licence has ended is off the air: the log warns two weeks before, and dead-air fill never picks it.

**Enforcement.** One function in `packages/domain` takes an item, an outlet and a country, and says cleared or not, with the reason. Use it in three places:
- **Relays.** An item not cleared for relays airs on the relay as the station's slate with "Airing on Opencast, channel 12.1", for the item's length. This is the same mechanism as the relay's break setting, so reuse it.
- **Other apps.** Playlists requested with `via=iptv` get the same swap: a variant playlist with the slate's prepared segments in place of the item. Prepare once makes this nearly free. The XMLTV says "Airing on Opencast" for those slots.
- **The log.** An entry not cleared for an outlet the station uses shows a quiet note ("Not on your YouTube relay"), not a warning.

**Licensor minutes.** A monthly report per network licence, from `as_run`: minutes aired, by station, by outlet (from where viewers watched), and viewer hours where watch data has them. Show it in the Network desk, under the licence, with a CSV download. Every rev-share deal will ask for this, on our own dial too, before any FAST money exists.

**STOP.** Show a carried program swapped to the slate on a relay and in an IPTV app, a licence ending with its warning, and one month's minutes report.

## Phase 7 (check only): An HDHomeRun address for Plex

ErsatzTV lets Plex add it as an HDHomeRun tuner over HTTP (`discover.json`, `lineup.json`, `lineup_status.json`).

**Don't build anything yet.** Find out whether Plex Live TV accepts a public HTTPS address for a tuner, or only a LAN address, and write the answer and its sources in `docs/iptv.md`.

If it only takes a LAN address, the answer for Plex users is Threadfin or xTeVe pointed at our M3U and XMLTV. Say so in the viewer app's line for Plex.

Note one more thing for Kai: Plex would let viewers record. If a tuner is built later, it carries only stations whose programs are all cleared for `recording` (Phase 6), or it swaps the rest to the slate, as relays do.

**STOP.**
