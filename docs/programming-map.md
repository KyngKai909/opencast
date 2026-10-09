# Programming map (Phase 0 of `docs/prompts/5-programming.md`)

What exists today for each of the six items, what's missing, and which files change. Read on
`programming` at `35b8f8e` (dev). The `schedule` work merged into dev in #11, so Phase 3 isn't
held up by it.

## The three questions

**Does a prepared item's key change when the prepare pipeline changes?** No. The key is the
file's content ID (`refKey` in `playout/engine/prepare.ts:95`), or `loc-<hash>` for files from
before content IDs. Nothing about the pipeline goes into it. `objectKey.prepared(key, rendition)`
(`storage.ts:666`) is just `prepared/<key>/<rendition>`, and `prepared_items.key` and
`prepared_renditions (key, rendition)` use the same key. Only slates carry a version (`|v1` in the
hash, `prepare.ts:634`). So a changed filter graph never re-prepares anything already prepared,
and Phase 1 needs its own versioning for the items it changes (see item 3).

**Can a log entry be traced back to the template entry that made it?** Only to the template and
the date, not to the entry. `log_entries.repeat_group_id` is the template and
`log_entries.template_date` the broadcast date (`schema/broadcast.ts:668`, `:678`). Within a date,
`generate` matches rows to template entries by a key of start, end, kind, asset, live source and
agreement (`templates.ts:653`), not by an id. And `day_template_entries` ids don't last: `update`
deletes every entry and inserts them again (`templates.ts:458`), so even a stored id would point
at nothing after the next edit. Phase 3 needs a stable slot id (see item 1).

**Is there any record of which episode of a program last aired from a given slot?** No. `as_run`
has `log_entry_id`, `asset_id` and `program_id` (`schema/broadcast.ts:1071`), so "the last
episode of this program that aired" can be read, and the `as_run_station_asset_time` index helps.
But nothing links an as-run row, or its log entry, to a template slot. An entry that aired can't
be deleted (as-run's foreign key holds it; `removeRows` leaves it, `templates.ts:315`), so a slot
written onto the log entry is reachable from as-run through `log_entry_id`.

## 1. Template slots that air the next episode (Phase 3)

**Exists**
- `log/templates.ts`: a template's entries (`day_template_entries`) each name one item
  (`assetId`), and `desiredFor` copies that same item onto every date it covers
  (`templates.ts:609`). Rights, pulled items and carriage limits are checked per date; what can't
  air is counted as skipped.
- Dates are recorded in `day_template_dates` (`generatedAt`, `editedAt`, `entries`, `skipped`).
  An edited date is an exception and never generated again; a template edit regenerates every
  future date that isn't one (`force`). Generation takes a per-station advisory lock.
- The contract `DayTemplateEntry` / `DayTemplateEntryInput` (`contracts/src/log.ts:136`, `:159`)
  carries `itemId`, `programId`, `episodeTitle`, `episodeDescription`, `keepTime`.
- G18 "Keep at this time" and the ripple rules exist in `log/service.ts`.
- Web: `TemplateEditor.tsx`, `TemplatesTab.tsx`, and `AddDrawer.tsx` (with a template mode).

**Missing**
- A "What airs" setting on a template entry (this episode, next episode, fill the slot, same as
  earlier slot), its program list for a mix, its order, and its end-of-program rule (start over
  or stop).
- A **stable slot id**. Template entries are deleted and reinserted on every save. Recommendation:
  a `slot_id` uuid column on `day_template_entries` that the editor sends back with each entry
  (new entries get a new one), so a slot keeps its identity, and its walk, across edits.
- A link from a log entry to its slot: `log_entries.template_slot_id` (nullable, no foreign key,
  since template entries are reinserted). As-run reaches it through `log_entry_id`, which holds
  because an aired entry can't be deleted. Copying it onto `as_run` too isn't needed; skip it
  unless the count query is slow.
- The position derivation: aired count for the slot from `as_run` before the date, plus the
  slot's entries already on the log for generated dates before it. The walker (item 2) takes that
  position.
- `generate`'s matching key includes the asset, so a Next-episode date whose episode changes
  (because an earlier date became an exception) is replaced rather than kept. That's the wanted
  behaviour; it just has to be ordered date by date so each date's position counts the ones
  before it.
- The end-of-series log warning, the "Next episode" mark on log entries, the preview line.

**Files that change**
- `packages/db/src/schema/broadcast.ts` (+ migration 0061): `day_template_entries` gets `slot_id`,
  `what_airs`, `order`, `program_ids` (for a mix), `at_end`, `same_as_slot_id`;
  `log_entries.template_slot_id`.
- `packages/contracts/src/log.ts`: `DayTemplateEntry` and `DayTemplateEntryInput` get the
  optional fields; a log entry gets `templateSlot` (which slot and template). Additive.
- `apps/api/src/v1/modules/log/templates.ts`: `fromInput`, `views`, `desiredFor` (the walk),
  `generate` (dates in order, positions), the end warning.
- `apps/api/src/v1/modules/log/service.ts`: the warning on the log, the entry's slot in its view.
- Web: `TemplateEditor.tsx`, `AddDrawer.tsx` (template mode), the log row (`DayRundown.tsx`,
  `dayRows.ts`) and its details, `docs/apps/new-copy.md`.

## 2. Playback orders (Phase 2)

**Exists**
- Episodes: `assets.episode_number` (integer, nullable), `program_id`, `created_at`. No season.
  `library.episodes(programId)` orders by episode number, then date added (`library/service.ts:784`).
- Dead-air fill: the worker's `fillDeadAir` (`playout/engine/index.ts:458`) calls
  `log.fillDeadAir` (`log/service.ts:2001`), which takes `library.repeatable(stationId, 20)` (the
  20 newest ready programs, `library/service.ts:878`) and cycles through them from the first, in
  newest-first order, every time. So each fill starts again at the same items. As-run marks these
  `dead_air_fill` (`plan.ts:766`, by `DEAD_AIR_NOTE`).
- "Repeat from your library": `planRepeat` (`web/src/control/components/onair/repeat.ts`) picks the
  program with the newest item, then its latest episodes in episode order, as few as cover the
  gap. Runs in the web app, not the API.
- The Add drawer's fit badges already have "Next episode", worked out in the app from the loaded
  log window (`AddDrawer.tsx:5`, `:53`).
- `packages/domain` exists (ads, credit, licence, spots, station), with tests; no walker.
- Uploads keep `originalFilename`; nothing guesses an episode number from it (only the web mocks
  turn a filename into a title).

**Missing**
- `assets.season_number`, and a multi-part grouping (`part_of` plus a part number). Both on the
  contract (`LibraryItem`, the update input, `uploads.ts`), editable where the episode number is.
- Filename guessing (`S02E05`, `2x05`, "Season 2 Episode 5", "Part 1", "(1)") at upload.
- The `PlaybackOrder` enum and copy in contracts.
- The walker in `packages/domain`.
- "Last aired from this program" for fill: an as-run read by program (the index is by asset;
  a `(station_id, program_id, started_at)` index may be wanted, or read through assets).
- `neverAired` and `nextEpisode` on library items for a station (answers schedule-map Q11).
- `planRepeat` choosing the episodes with the walker: it runs in the web app, so it needs the
  station's "next episode" per program from the API (the new library fields carry it).

**Files that change**
- `packages/db/src/schema/broadcast.ts` (+ migration): `assets.season_number`, `assets.part_of`,
  `assets.part_number`.
- `packages/contracts/src/library.ts`, `uploads.ts`: the fields, `PlaybackOrder`, `neverAired`,
  `nextEpisode`.
- `packages/domain/src/episodes.ts` (new) and its tests: the walker and the filename guesser.
- `apps/api/src/v1/modules/library/service.ts`: the fields, the guesses on upload, the aired facts.
- `apps/api/src/v1/modules/log/service.ts`: `fillDeadAir` with the walker, from the last episode
  in as-run.
- `apps/web/src/control/components/onair/repeat.ts`, `AddDrawer.tsx`, the library item editor.

## 3. Cleaner pictures from prepare (Phase 1)

**Exists**
- `prepare.ts`'s `probe` (`:176`) reads only duration, stream types, codec names, attached-picture
  disposition and subtitle language. The upload probe (`apps/api/src/v1/media.ts`) reads duration,
  media kind, width, height and audio channels. Neither reads colour, field order or rotation.
- The filter graph (`prepare.ts:262`): `fps=30,format=yuv420p,split`, then per rendition
  `scale … force_original_aspect_ratio=decrease,pad,setsar=1`; sound loudnorm to -24 LUFS; libx264
  high profile. No tonemap, no deinterlace, no colour tags on the output. FFmpeg's autorotate is on
  by default, so a rotated clip is probably upright already; nothing tests it.
- `ffmpegTranscoder` is injectable (`PreparerOptions.transcoder`), so tests can check the args it
  builds.
- The prepared key doesn't include the pipeline (see the questions above).

**The ffmpeg in our build.** Railway builds with Nixpacks: `nixpacks.toml` installs nixpkgs'
`ffmpeg`. I couldn't check that build from here (no Railway SSH in the cloud session). This
container's ffmpeg (Ubuntu 6.1.1) has `zscale`, `tonemap`, `bwdif`, `idet`, `blackdetect` and
`silencedetect`, so the tests can run here. Whether nixpkgs' default `ffmpeg` is built with zimg
(which `zscale` needs) is the thing to check first in Phase 1: run `ffmpeg -filters | grep zscale`
on the worker. If it's missing, the change is `nixPkgs = ["nodejs_22", "ffmpeg-full", "yt-dlp"]`.
The relay's image (`apps/relay/Dockerfile`, Debian's ffmpeg) doesn't prepare anything.

**Missing**
- Probe fields: `color_transfer`, `color_primaries`, `color_space`, `field_order`, rotation side
  data; a short `idet` sample when the field order is unknown.
- The graph: `bwdif` → `fps` → `zscale` tonemap → `scale/pad`; output tagged BT.709.
- Versioning for changed items. Recommendation: a prepare version in the key only for items the
  new probe flags (`<contentId>.p2`), so `prepared/<contentId>.p2/…` sits beside the old copy.
  The playout reads the key from `refKey`, so the switch is in one place: `refKey` returns the
  versioned key once that key is ready, else the old one. That needs the flag stored by content ID
  (a small `prepared_versions` table, or columns on `prepared_items`: `hdr`, `interlaced`,
  `pipeline`).
- The re-prepare job, and "Converted from HDR" / "Deinterlaced" on the library item.

**Files that change**
- `apps/api/src/v1/modules/playout/engine/prepare.ts`: probe, graph, tags, versioned key.
- `apps/api/src/v1/modules/playout/engine/index.ts`, `readiness.ts`, `assemble.ts`, `sender.ts`,
  `proof.ts`, `playout/service.ts`, `storageMaintenance.ts`: wherever `refKey` /
  `objectKey.prepared` is used (21 call sites), if the versioned key isn't hidden inside `refKey`.
- `packages/db/src/schema/broadcast.ts` (+ migration): what was found and which version is current.
- `packages/contracts/src/library.ts`: the item's conversion notes. Web: the item's details.
- `nixpacks.toml`, if the build's ffmpeg lacks `zscale`.
- New: `apps/api/scripts/` (or a job) to re-prepare flagged items; fixtures made with lavfi in tests.

## 4. Suggested break points (Phase 4)

**Exists**
- `asset_break_points (asset_id, offset_ms)` (`schema/broadcast.ts:511`), set by hand through the
  library's update (`setBreakPoints`, `library/service.ts:480`), exposed as
  `LibraryItem.breakPointsMs`.
- The log splits programs at them: with a break every N minutes the maker's points replace the
  clock (`log/service.ts:1145`); with clock times or long-program breaks the points replace the
  clock times (`:1054`). Each is snapped to a segment boundary, and kept clear of the start and
  end (`MIN_RUN_MS`).
- Carriage: the catalog shows the maker's points (`catalog/service.ts:548`).

**Missing**
- Reading chapters (`-show_chapters`) and a `blackdetect` + `silencedetect` pass during prepare.
- Somewhere to keep suggestions apart from the creator's points, with their source (a
  `asset_break_suggestions` table keyed by content ID or asset: `offset_ms`, `source`
  (`chapter` | `fade`), `strength`, `dismissed_at`).
- The UI: "Suggested break points: 3, from chapter marks", Use these, Dismiss, preview at -2 s.

**Files that change**
- `apps/api/src/v1/modules/playout/engine/prepare.ts`: the detection, in the same pass or a second
  cheap one (`-vf blackdetect -af silencedetect -f null`).
- `packages/db/src/schema/broadcast.ts` (+ migration), `packages/contracts/src/library.ts`
  (`suggestedBreakPoints`), `library/service.ts` (read, accept, dismiss).
- Web: the library item's details and its preview player. Carried episodes: leave the maker's
  points as they are (`catalog/service.ts` unchanged).

Note: Phase 1 and Phase 4 both change `prepare.ts`'s probe and graph; they run in one lane.

## 5. The dial in other apps (Phase 5)

(see below)

## 6. Where it can air (Phase 6)

(see below)

## Phase 7

Nothing in the code; it's research for `docs/iptv.md`.

## The cloud session

- Postgres, Redis and ffmpeg are installed in this container (`psql`, `redis-server`, `ffmpeg`
  6.1.1 with `zscale`). Docker is present too. The API tests can run here once Postgres and Redis
  are started.
- No Railway SSH: anything that needs staging (the worker's ffmpeg, counting items to re-prepare
  on real data) is a question to answer there, or a script to run there.
- The next migration is `0061`.
