# Schedule map (Phase 0)

Phase 0 of the Schedule workspace (`docs/prompts/4-schedule.md`). It maps each frame of `docs/reference/control/opencast-schedule.html` (Control 08) to the code that already does it, and says what's missing.

Today the work is split across three places. The Program log page is `components/onair/LogPage.tsx`, also setup step 3. The Breaks page is under Money (`pages/money/Breaks.tsx`). The break rule lives in station settings (`components/station/settings/BreaksSection.tsx`). The blocks pages are separate again, under Programming (`pages/live/Blocks.tsx`), and get rebuilt as the reference's section 07 draws them. Most of the data is already there. Most of the work is in the layout: a time-scaled timeline becomes a list in air order, the break rule stops saving on every change and gets a draft with a preview, the edit pane becomes a tray and a drawer, and a block's page gains a live preview of how it looks on air.

The reference's sections are 01 to 09: 07 is Blocks, 08 On the phone, 09 For the build pass.

Paths are relative to `apps/web/src/control/` unless they start with `apps/` or `packages/`.

**Status:** **Exists** means it works as drawn, or near enough to move as is. **Reshape** means the code or data is there but the view, copy or behaviour changes. **Missing** means it has to be built. A Missing row whose data exists says so.

## 01 The day, as a rundown

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| Rail: "Schedule" in On air (Monitor, Audience, Schedule, Live sources) | `CONTROL_RAIL` and the `ControlPage` union in `packages/ui/src/shells/ControlShell.tsx`; `SEGMENT_PAGE` and `PAGE_SEGMENT` in `layout/ControlLayout.tsx`; `PAGE_ABILITY` in `station/abilities.ts`; `layout/badges.ts` | Add a `schedule` page and remove `program-log`, `breaks` and `blocks`. Blocks sits under Programming today, and the reference's Programming group is Library and Listings only. The Breaks badge (amber open time) has no place on the reference rail (open question 4) | Reshape |
| Head: "Schedule", the tabs Log, Templates, Blocks, Break rules, then Add and Edit | `ControlTitle` (`packages/ui/src/shells/ControlTitle.tsx`). `Tabs` (`packages/ui/src/primitives/Tabs.tsx`) is a tablist with `onChange`, not links | A Schedule page with tabs as routes, in the pill style the reference uses (`.sch-tabs`) | Missing |
| Day nav: arrows, "Saturday, Oct 3", Today, the chip `From "Saturdays", edited`, Day and Week | LogPage's weekday `Tabs` for the week shown, and `Segmented` with Day, Evening and Week. `DayOrigin` in `components/onair/RepeatDay.tsx` shows the template as a Notice (`dayOriginOf` in `templates.ts`, from `getLog.days`) | Arrows and Today replace the weekday tabs (`?day=` already takes a date). Evening goes. The origin becomes a chip | Reshape |
| The broadcast day, 6:00 am to 6:00 am, scrolled to now | `viewWindow("day")` and `broadcastDay` in `components/onair/time.ts`. The default view today is Evening (6 pm to 2 am) | Day becomes the default and opens scrolled to now, or to `?entry` or `?fill` | Reshape |
| Health chip: "On air: Saturday Reel, 17 min left" | `usePlayout` (`PlayoutStatus.now`) in `components/onair/data.ts`, and `currentIndex` in `rundown.ts` | A chip row. Each chip scrolls to its row | Missing (data exists) |
| Health chip: "Dead air at 11:40 pm, 20 min" | `openGaps` in LogPage (from `getLog.gaps` and `getDeadAir`). Today it's the amber Notice with "Fill it" | Becomes a chip | Reshape |
| Health chip: "1 item still preparing" | `PlayoutStatus.readiness`, read by `readinessLine` in `readiness.ts`: counts for the next 48 hours and the first item not ready. Per item there's only the library's upload `status` and `prepProgress` | A count for the day on screen isn't available. See open question 11 | Reshape |
| Health chip: "Off air 2:00 to 6:00 am, planned" | `getLog.offAir`, with the words from `components/onair/offAir.ts` | Chip | Missing (data exists) |
| Program and live rows: start, code, title, source, length | `buildRundown` and `entrySource` in `components/onair/rundown.ts`, to the second, with programs split around breaks inside them. `Rundown` and `ProgramLog` in `packages/ui/src/broadcast/`. `LogCode` | `LogCodeName` has no LIVE, BRK or GAP, and OFF means the off-air card. The live source's name ("Live source: Studio cam") needs `stationsApi.listLiveSources`. "Breaks cued from the booth" is new copy | Reshape |
| Break rows inline: thin, a fill bar by kind, "2 spots, credit, ID" | Each `BreakSlot.rows` entry (`BreakRow`: `code`, `whose`, `element`, `block`) becomes its own rundown row in `breakRows`. `BreakBar` (`packages/ui/src/broadcast/BreakBar.tsx`) knows only filled, added, barter and open | Collapse each break to one row (`breakId` is already on its rows). A new bar with seven kinds: bumper, spots, barter, credit, ID, open, up next. The mapping from `BreakRow` is clear (BMP with role `up_next` is up next; SPT with `whose: producer` is barter). Summary words are new copy. The reference hard-codes its seven colours as hex, so they need tokens for both grounds | Reshape |
| Dead air row, striped amber, with Fill | `gapRow` in `rundown.ts` ("Nothing scheduled", "Repeats from your library…"). `openGaps` drops what has passed. The Fill pane and sheet are in `components/onair/Fill.tsx` | The copy becomes "Dead air" and "Nothing until 12:00 am". Gaps that have passed come out of the rundown, as `timelineBlocks` already does. Fill opens the Add drawer at the gap | Reshape |
| Off air row, striped grey | `buildRundown` lists the hours as `off_air` rows and a sign-off as an entry. `offAirSource` and `backAtText` give the words | Copy: "Planned, back at 6:00 am". Style | Reshape |
| Block edge and label ("LATE CRATE NIGHTS Block, 9:00 pm to 1:00 am. Its own bumpers and ID") | `getLog.blocks` (`BlockSpan`: `entryIds`, `pieces`, `name`, `colour`). Today blocks are rails beside `LogTimeline` (`TimelineBands`). `spanSummary` is in `components/live/blocks.ts` | An edge on each member row (from `entryIds`) and a label row where the block starts. "Its own bumpers and ID" comes from `ProgramBlock.sequences` and `items` (`blocksApi.listBlocks`) | Reshape |
| Past rows dimmed; the row on air gets the red edge and ON AIR | `currentIndex`, and `Rundown`'s `nowId` (the tally edge) | Dim past rows; add the tag | Reshape |
| Pane: "Tonight at a glance" (programs, breaks, spots placed, open to the spot market, barter owed) | Nothing. Every number comes from `getLog`: entries; breaks' `filledMs`, `openMs`, `producerShareMs` and `rows`. `getBreakRule.openTimeTo` decides whether open time goes "to the spot market" | New pane | Missing (data exists) |
| Pane: "Next break, 8:59:20 pm", its strip and why | `nextBreak` and `breakLine` in `rundown.ts` | The strip, and the why line (see 02) | Missing (data exists) |
| Pane pieces today that the reference doesn't draw | LogPage's pane holds the break rule's mode (`breaksSection`), Repeat this day (`RepeatDaySection`), off air hours (`OffAirHoursSection`), the change history (`LogHistory`), a block's pane (`?block=`) and the fill pane | Each needs a new home. See open questions 2 and 3 | Reshape |
| Add and Edit buttons | "Edit log" in LogPage (`canEdit` is `s.can("programming")`) | Add opens the drawer and enters edit mode. The reference's drawer frame shows "Done editing" | Reshape |

## 02 Opening a break

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| Picking a break row | `?entry=` picks a program; a break can't be picked on the log. The Money Breaks page has a Details button | A break selection. `BreakSlot.id` is null until the break is stored, so the parameter is the break's start (proposed: `?break=<startsAt>`) | Missing |
| Pane head: "Break, 10:29:10 pm", "After Late Crate, ep. 15. 0:50. Inside Late Crate Nights" | `BreakSlot.context`, `startsAt`, `lengthMs`. The block comes from the span whose `entryIds` include the program, or from a row's `block` | Words | Reshape |
| The strip, scaled by length | Nothing for the log. `BreakBar` is the nearest | One strip component, shared by the pane, the phone sheet, Break rules and its preview | Missing |
| The list, in air order, with whose time each part is | `BreakDetails.tsx` (`components/spots/`) and `rundownOf` build it from `getAvails`' `BreakContent`, in a modal on the Money Breaks page. `getLog`'s `BreakRow` has the same facts: `whose` (station, producer, backup), `note`, `element` (role, announces, fits), `block` | Move it into the pane and read the log's rows. One that didn't fit ("Didn't fit: Up next (:08)") is listed quieter, as `Rundown`'s `muted` does | Reshape |
| "Spots, placed at 10:09 pm. 0:30 open to the spot market until then" | An unplaced break has an OPEN row, "Filled from the rotation about 20 minutes before". The 20 minutes is `FILL_AHEAD_MS` in `apps/api/src/v1/modules/playout/engine/index.ts`, not in contracts | The app works out the start minus 20 minutes and says "about" | Reshape |
| The maker's barter in its own colour ("REEL's barter") | `whose: "producer"`, note "REEL's break time, barter" | Colour | Exists |
| Why line, linking to Break rules ("Bumpers open every break; the credit airs once an hour…") | `cadenceWords` and `cadenceDetail` in `components/station/breakRule.ts` give the parts. A block's own order comes from `ProgramBlock.sequences` | Put the line together; it's new copy | Missing |
| "Spot rotation" and "Block settings" buttons | `/spot-market/rotation`; the block's page | Links | Missing (trivial) |

## 03 The week

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| "Week of Sept 28", arrows, This week, Day and Week | `view=week` in LogPage: one `LogTimeline` per day of `weekOf(day)`, inside `.cc-week`, with no day tabs | Arrows and This week | Reshape |
| Day headers with the template, and "edited" in amber | `getLog.days` (`LogDay`) for the week's window. Not shown in the week today | Header | Missing (data exists) |
| Programs in their source colour | `timelineBlocks` gives `pgm` or `car`, with no colour. `Program` has no colour; `carriedFrom` (`StationIdent`) does | Colour by source (open question 12) | Reshape |
| A block as a bar down the edge | `LogTimeline` takes `bands`, but the week doesn't pass them | Pass them, drawn thin | Reshape |
| Dead air striped amber; off air striped grey | `dead` blocks and `OFF_AIR_MARK` in `timelineBlocks` | Styles | Reshape |
| The now line | `NowLine` (`packages/ui/src/broadcast/NowLine.tsx`) is horizontal, for the guide | A vertical now line on today's column | Missing |
| Clicking a day opens it in the Day view | Nothing | Set `view=day&day=<date>` | Missing |
| Week chips: "Dead air Thursday at 11:00 pm, 1 hr"; "Late Crate Nights, Fri and Sat" | `getLog(week).gaps` and `.blocks`. `getDeadAir` covers only 24 hours | Chips | Missing (data exists) |
| Edit on the Week view | Edit mode is off in the week today; starting it switches to Evening | Edit opens today's Day in edit mode | Reshape |

The week frame crops to 4 pm to 2 am. That's for the picture: the view should show whole broadcast days, scrollable, opening at the evening or now.

## 04 Editing, and filling dead air

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| Edit and Done editing (`?edit=1`) | `startEditing` in LogPage. `useLogEdit` in `components/onair/LogEditor.tsx` keeps the draft in sessionStorage, by station | Labels | Exists |
| "Editing. This date becomes an exception to 'Saturdays'" | `LogDay.templateId` and `edited`. The Notice today just says "Editing the log." | Copy, from the day's template | Reshape |
| Drag handles, and drag to move | `EditTimeline` drags in pixels on a time scale, to the minute (`dragTo`), with arrow keys too. The draft is in `logEdit.ts` (`withChange`, `draftEntries`) | In a list, a drag reorders rather than picking a time (open question 1). The rows aren't to scale | Reshape (large) |
| Moved rows in blue, a new row outlined, a removed row struck through | `DraftEntry.change` (moved, resized, replaced, inserted). `draftEntries` drops a removed entry, so it doesn't show | Keep removed rows in the draft view, struck through | Reshape |
| "Add here" between rows | `InsertDialog` puts something before or after an entry; `rippleFrom` moves the rest down | An inline line that opens the drawer at that time | Reshape |
| Remove | "Take off the log" in `EntrySection` | A row action | Exists |
| Resize for live blocks and sign-offs | `EntrySection`'s end field (`op: "resize"`). A block span's edges drag on `TimelineBands` (`block_resize`) | A row affordance; the typed field stays. A block's start and end become handle rows on the rundown (see 07) | Reshape |
| Breaks follow the programs ("Follows the programs", "Held spots move here") | `draftBreaks` | Copy. A warning's text names the held spots, but the warning isn't tied to a break, so a break row can't say which | Reshape |
| The tray: "4 changes, checked: nothing blocks publishing", its lines, warnings in amber, Discard, Check again, Publish 4 changes | `ChangesSection`: `result.summary`, each `changes[].line` with Undo, `problems`, `warnings`, Publish and Discard, in the pane | Becomes a floating tray at the bottom. "Check again" refetches the dry run, which already runs on every change | Reshape |
| Check, as a dry run | `useLogEdit`'s query with `dryRun: true` | — | Exists |
| Publish with the window's version | `publish()` sends `base: { from, to, version }` | The window becomes the whole broadcast day | Exists |
| The change record after publishing | `LogChangesResult.record`. The toast "N changes published"; `LogHistory` lists the last five | Show the record. History needs a home (open question 2) | Reshape |
| `409 log_changed`: reload and keep the draft | The conflict is caught, but `reload()` drops the draft ("Reloading drops your changes") | Rebase: refetch, take the new version, keep the changes and check again. Changes to entries that are gone come back as `not_found` problems | Reshape |
| Locked within `LOG_EDIT_LEAD_MS`, with the reason | `lockOf` in `logEdit.ts`, in the API's words ("On air now, too late to change.") | The row's "· locked" and its reason line | Exists |
| "3 viewers' reminders move to its next airing" | The `reminders` warning | — | Exists |
| Drawer: "Add at 11:40 pm", "20 min free, until Late Crate, ep. 13 at 12:00 am" | Nothing like it. `packages/ui` has `Modal` and `Sheet`, but no side drawer | A drawer | Missing |
| Drawer tabs: Library, Carried, Live, Sign off | `InsertDialog` has Library (`airable` in `repeat.ts`) and Carried (`catalogApi.listAgreements` and `getOffer`'s episodes). Sign off is an `off_air` insert, or `fillGap` with `sign_off` | Live is new: `listLiveSources`, then an insert with `kind: "live"`, `liveSourceId` and `endsAt`. Search filters in the app | Reshape and Missing |
| Fit badges: "Fits", "9 min over: ep. 13 moves to 12:09 am", "Next episode" | `wholeMinutes`, and `rippleFrom` for what gets pushed | "Next episode" and "Never aired" need to know what has aired, and `LibraryItem` doesn't say (open question 11) | Missing |
| Quick fill: "Repeat from your library" | `planRepeat` and `fillGap` with `repeat` (`useFill` in `Fill.tsx`) | Into the drawer. Its timing against a draft is open question 8 | Reshape |
| Quick fill: "Sign off until 12:00 am" | `fillGap` with `sign_off` | Into the drawer | Reshape |

## 05 Break rules, with a preview

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| The tab, and the link left in station settings | `BreaksSection` is rendered by `pages/station/Settings.tsx` (section `breaks`) | Move it. The section becomes a link | Reshape |
| Reset and "Save break rules" | `BreaksSection` saves every change at once (`setQueryData`, then `setBreakRule`) | A local draft with Reset and Save, and a prompt before leaving with unsaved changes | Reshape |
| "Every break, in air order", drawn to scale for a 2:00 break | `ladder`, `ladderWithPartners`, `spotMsPerBreak` and `FIXED_MS` in `breakRule.ts`. `FIXED_MS` has the credit at 15 s and a bumper at 10 s; the reference draws 0:10 and 0:05. The API uses `CREDIT_MS` and real item lengths | Draw the ladder as the strip; check the lengths it shows | Reshape |
| "Then between programs: Up next 0:05. Outside the break, so partner ads never replace it" | The between sequence (`POSITION_WORDS.between`) and `exampleLine` | Words | Reshape |
| Cadence chips per part: Spots, Thank-you credit, Bumpers, Station ID, Up next | `CADENCE_PARTS` (spots, underwriting, stationId) with selects from `cadenceOptions`: every break, after every program, after every 2, 3 or 4 programs, once an hour, never (not for the station ID). Bumpers' cadence is per sequence, in `SequenceBuilder.tsx`. Up next has no cadence: it's a role in `bumperSequences` | Chips, with never crossed out for the station ID, and N chosen with "Every 2 programs". Bumpers and Up next need a mapping (open question 5) | Reshape |
| Bumper sequences for opening, closing and between | `SequenceBuilder` (also used by `components/live/BlockEditor.tsx`) | Move | Exists |
| Timing: when breaks come, length, spot time per hour, same spot per hour | `BreaksSection` rows (`Segmented`, `ValueSelect` with `LENGTHS`, `CAPS`, `SAME_SPOT`) | Tiles | Reshape |
| Opener options | "Signing off and on" in `BreaksSection` (`stationIdAfterOpener`, `dailyOpener`) | Move | Exists |
| `BreakRule` fields the frame doesn't draw | The fill order (dragging spots and the credit), "Never on BEAT" blocked categories, the backup rotation, ads from partners. `openTimeTo` is shown on the log but nothing sets it | Open question 3 | Reshape |
| "Preview: 7:00 to 8:00 pm. Rebuilt with the rules as set. Nothing is saved yet" | Nothing | The Phase 3 endpoint (section 4 below) and the rows with strips | Missing |
| "Applies to breaks not yet filled. Breaks in the next 20 minutes keep what they have. Late Crate Nights uses its own bumper order during the block" | Blocks with their own order: `ProgramBlock.sequences` isn't null (`listBlocks`) | Which breaks keep what they have needs a flag from the preview | Missing (blocks' data exists) |

## 06 Templates

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| Template cards: name, pattern, "15 dates ahead", a square per date (plain if generated, amber if edited) | `listTemplates` (`DayTemplate`: `name`, `label`, `pattern`, `dates[{ date, edited }]`), `templateName`, `templateDetail` and `datesText` in `templates.ts`. Listed as rows in `RepeatDaySection` | Cards and squares | Reshape |
| "Once, Sat Oct 31. Overrides Saturdays that day" | The rule is in the contract: the more specific wins. Nothing works it out | Work it out in the app (a `once` template's `onDate` falling under another's pattern) | Missing |
| New template | `createTemplate` needs a `fromDay` (a day's log); a template can't start blank | "New template from a day" (open question 7) | Reshape |
| The template's rundown (programs, live, off air; no breaks or gaps) | `getTemplate`'s `entries` (`DayTemplateEntry`: `startTime`, `lengthMs`, `kind`, `title`) and `blocks`; `templateBlocksText` | Rows, drawn like the day's | Missing (data exists) |
| Edit template, with the same rundown editor | `updateTemplate` replaces `entries` and `blocks`, with no dry run, no version and no change lines | Open question 7 | Reshape (large) |
| "Oct 3 edited by Kai, 2 changes" | `DayTemplate.dates` has only `edited`. The change records (`listLogChanges`) say who, but not for which date | Open question 6 | Missing |
| "Reset Oct 3 to template" | No endpoint. An edited date is never made again (`apps/api/src/v1/modules/log/templates.ts`), and `applyLogChanges` marks a date edited, so the app can't rebuild it either | Open question 6 | Missing |
| Change and stop a template; G7's one-time copies | `RepeatDialog`, `StopDialog`, `removeRepeat` in `RepeatDay.tsx` | Move | Exists |

## 07 Blocks

The tab is drawn as a list on the left and the open block on the right. Today the list (`pages/live/Blocks.tsx`) and a block's page (`BlockEditor` in `components/live/BlockEditor.tsx`) are separate pages. The words are in `components/live/blocks.ts`, and a library item's "Part of a block" is in `components/live/BumperFields.tsx` (`BlockSection`). On the API side, `library/blocks.ts` builds `ProgramBlock` (with `schedule` from the log service's `blockSchedules`), and `log/blocks.ts` holds the membership rule. The contracts are in `packages/contracts/src/blocks.ts`.

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| The list: a card per block (colour, name), with the open one outlined | `BlockCard` in `Blocks.tsx` (`listBlocks`): swatch or logo, name, `schedule.label`, `nextWords` | A left column beside the open block, not its own page | Reshape |
| The card's schedule: "Fridays and Saturdays, 9:00 pm to 1:00 am" | `schedule.label` from `blockSchedules` (`apps/api/src/v1/modules/log/service.ts`): each template's label joined with "; " ("Every Friday, 9:00 pm to 1:00 am; Every Saturday, …"), else the next one-off date | Combining the days needs `onLog`, which only `getBlock` returns. The station page's `viewerLabel` ("Fridays, …") isn't on `ProgramBlock` | Reshape |
| The card's summary: "Its own look, bumpers and ID"; "Station's bumpers" | `items` (counts) and `sequences` | The summary words | Missing (data exists) |
| "Next: tonight at 9:00 pm" | `schedule.next` (the first member of the next span, else its start); `nextWords` says "Next Sat Oct 10" | Relative words ("tonight", "Monday") | Reshape |
| "Not on the log yet" and "Place on the log" | `schedule.label` is null. Nothing places a block from its page; `BlockEditor` says to use the Program log's edit mode or a template | Open question 15 | Missing |
| New block | `NewBlock` in `Blocks.tsx` (`createBlock`: name and colour, 409 `block_name_taken`) | Button place | Exists |
| Head: logo (or initials), name, the description in quotes, "Made by BEAT 12.1", "Place on the log", Save | `BlockEditor`'s "Name and look" (logo or first letter, name and description fields). `ProgramBlock.owner` isn't shown | Head layout. Editing the name and description isn't drawn (open question 17) | Reshape |
| What it airs: Intro (OPN) and Outro (CLS), with when, how many, length and a switch | `BlockEditor`'s "Intro and outro" (`Toggle`, `partLine`); `items.intro` and `items.outro` have lengths | Rows as drawn ("2 in rotation", 0:05) | Reshape |
| What it airs: Block ID (SID), "Airs where the station ID would. 3 in rotation" | `BlockEditor`'s "ID" section, `idLine`, `items.id` | Row | Reshape |
| What it airs: bumpers into the break, out of the break, and up next, each with how many, its length, or "Uses BEAT's" | `BlockEditor`'s "Bumpers" (all four roles, Any included) with `blockRoleSupply` ("2 in this block", "None yet, so BEAT's airs"). `items.bumpers` gives counts only | Lengths need the block's items (`getLibrary` with `programBlockId`). Whether "Uses BEAT's" is true needs the station's own pools (below the table). The reference leaves out Any | Reshape |
| "Add from the library" | A picker per kind and role (`Modal` and `candidates()`); "Upload" goes to `/library/blocks/:blockId` | One picker that asks what it's for | Reshape |
| Bumper order: "Its own, instead of BEAT's", with role chips for opening, closing and between | `Segmented` (same as the station, or its own) and three `SequenceBuilder`s (`ProgramBlock.sequences`) | Style | Exists |
| How it looks: the picture with the bug, and the banner reading "LATE CRATE NIGHTS / Beat Tape Live" with ON AIR | Nothing in master control. The player's `Banner` (`packages/player/src/react/Banner.tsx`) shows the block's name above the title from `channel.now.block`, and `Overlays` draws a logo bug (`bug.mode === "logo"`). `Bug` and `PictureFrame` in `packages/ui` (used by `IdentitySection`'s preview) show only the call sign and channel | Build the preview from the player's parts with a made-up channel, updating as the controls change. The program title needs the next span's members (open question 16) | Missing |
| How it looks: the guide band | `GuideGrid`'s bands (`GuideBlock`, `guideBands`, `packages/ui/src/broadcast/GuideGrid.tsx`) | A one-row guide with the block's members | Reshape |
| Colour, from swatches, checked at 4.5:1 | A hex field and `stationColourPasses` in `BlockEditor`. `ColourPicker` (`components/station/ColourPicker.tsx`: five swatches, any hex, the contrast line) is used only by `IdentitySection` | Use `ColourPicker` | Reshape |
| Logo: Replace | `uploadBlockLogo` and Remove (`removeLogo`) | — | Exists |
| "The bug shows": BEAT's, Block logo, Nothing | `Segmented` on `bug` (`station`, `logo`, `off`), with "Until it has a logo, your station's bug shows." | Labels | Exists |
| Where it airs: templates with their times and dates ahead, one-off dates, and Open | `onLogLines` from `getBlock`'s `onLog` (`templates`; `dates`, at most 20, each with its `templateId`; `ahead`) | Templates at the same times grouped ("Fridays and Saturdays templates"). Dates ahead per template counted from `dates`, which stop at 20. Open goes to the template or to the date on the log | Reshape |
| "Made by BEAT. Offering blocks to other stations … comes later with the syndication market" (`owner`, `carried`, `reskin`, read-only) | In `ProgramBlock`; nothing shows them | A read-only line | Missing (data exists) |
| Archive | `BlockEditor`'s archive, with "Take it off the log and archive" on 409 `block_on_log` | Not drawn; it stays at the foot (open question 17) | Exists |
| Save | The name, description and colour save with Save; the bug, intro, outro and order save at once (`updateBlock`) | One Save in the head (open question 14) | Reshape |
| On the Log in edit mode: handle rows "Late Crate Nights starts 9:00 pm. Drag to change. Programs that start inside it become its members" and "Ends 12:30 am, was 1:00 am" | `TimelineBands`' `onResize` on the time-scaled `EditTimeline`; `SpanSection` for typed times; `block_add`, `block_resize` and `block_remove` drafted by `withChange` and `draftSpans` in `logEdit.ts`; `AddBlockDialog`. The API checks each in `log/changes.ts` (`block_locked`, `block_overlap`, `too_soon`, at most 24 hours) | Handle rows in the list that drop between rows and take that row's start. The typed times stay in the pane (open question 1) | Reshape |
| Member notes: "Member. Its intro airs just before", "Member, runs to 12:29 am", "Not a member: starts after the block ends" | The rule is `isMember` and `memberships` in `apps/api/src/v1/modules/log/blocks.ts`; `spanPieces` and `spanAt` in `logEdit.ts` mirror it in the app. `BlockSpan.problems` has `overrun`, `empty`, `no_room_intro` | Words on each row | Reshape |
| "Its outro airs at 12:29:10 am" | The API's line for the change says "Late Crate Nights now ends at 12:30 am". The outro follows the last member's end | Worked out in the app | Reshape |
| Tray: "Crate Session 01 is no longer part of it: BEAT's bug and ID air from 12:30 am" | Nothing. The dry run's lines give only the new times, and no warning names members | Open question 13 | Missing |
| Ends by 6:00 am on a template; never overlapping; on air, only the end can move | `updateTemplate`'s 400 `block_crosses_day` and `block_overlap`; `applyLogChanges`' `block_overlap` and `block_locked` | Show the API's words | Exists |
| Blocks in the market (an open note) | The fields exist | Nothing to build | — |

**What the block page needs that the API doesn't return:**

- **Next airing.** `schedule.next` has it. Only the relative words are new.
- **The schedule in the list.** `listBlocks` gives only the joined template label. Grouping days ("Fridays and Saturdays") needs `onLog`, so either one `getBlock` per block or the label as it comes.
- **Where it airs.** `getBlock`'s `onLog` has the templates and up to 20 dates (`ahead` is the total). It has no per-template count of dates ahead, so a count over 20 dates is short.
- **Fallback per element.** No field says what airs for each part. The app has to apply the API's chain (`SequenceDecider.chain` in `apps/api/src/v1/modules/playout/engine/sequence.ts`): the block's role, the block's Any (not for up next), the station's role, then the station's Any (not for up next), each within its air window. For an intro or outro it's the block's own, else the automatic five-second card (TV only). For the ID it's the block's, then the station's, then the generated one. "Uses BEAT's" is only true when BEAT has one, which needs the station's library (`roleSupply` in `breakRule.ts` does this for the station). Otherwise it's "Nothing airs" or the automatic card.
- **Bumper lengths.** `ProgramBlock.items.bumpers` is counts by role. `getLibrary` with `programBlockId` returns the items with their lengths.
- **Members joining or leaving on a resize.** `LogChangesResult` doesn't say (open question 13).
- **The preview's program and the band's members.** `ProgramBlock` doesn't carry them. A `getLog` over the next span (`onLog.dates[0]`) does (open question 16).

## 08 On the phone

| Frame or element | What does it today | Missing or must change | Status |
|---|---|---|---|
| The rundown with health chips; breaks as thin lines | `useIsPhone` and `ControlPhoneShell`. LogPage draws the timeline on the phone too | The new rundown, compact | Reshape |
| A break as a bottom sheet | `Sheet`; `BreakDetails` is already a sheet on the phone | Its content from 02 | Reshape |
| Fill on the gap | LogPage's phone sheet with `FillOptions` (P.2, `?fill=`) | Fill's sheet content | Exists |
| Sign off and move a program on the phone | `EditTimeline` takes pointer events, never tried on touch | A touch drag, or a typed time and Move up and down | Reshape |
| The dead-air notification (30 and 12 minutes before) opens straight to the gap | `station.dead_air_warning` in `apps/api/src/v1/modules/notifications/service.ts` links to `/stations/:id/log` with no gap. `emailLink` turns that into `/control/<slug>/log` and passes a query through. LogPage already opens Fill from `?fill=` | The link needs `?fill=<gapStartsAt>`: a small API change, outside the contracts (open question 9) | Missing |
| Templates, blocks and rules stay on the desktop | Nothing | On the phone, those tabs say they're done on a computer | Missing |

## 09 For the build pass

The spec table repeats 01 to 08, its new Blocks row included (mapped in 07). These rows cover what it adds.

| Spec row | What does it today | Missing or must change | Status |
|---|---|---|---|
| Where it lives: one Schedule item; Rotations and the spot market stay under Money | Money Breaks also carries things the reference doesn't place: `PauseNotices` (shown only here), the C.3 "Just added" amber with its Undo toast (`components/spots/justAdded.ts`), "Edit rotation", "Fill from the spot market" and `MockPauseControls` | Open question 4 | Reshape |
| Blocks: list, block page, handles on the Log, syndication fields read-only | `pages/live/Blocks.tsx`, `components/live/BlockEditor.tsx`, `components/live/blocks.ts`; routes `blocks`, `blocks/new`, `blocks/:blockId` | Rebuilt as 07 draws it, under `/schedule/blocks`. Their own links (`${base}/blocks…`) change | Reshape |
| Data: no new backend for the views | `getLog`, `getDeadAir`, `getBreakRule` and `setBreakRule`, templates, blocks, `applyLogChanges` | True for the Log and Week views. Not true for "Reset to template", "edited by Kai", "Next episode" or "Never aired", the notification's gap, or members joining and leaving a block in the tray (open questions 6, 9, 11 and 13) | Reshape |
| Setup step 3 | `pages/onair/SetupLog.tsx` renders `LogPage` in the setup shell | Open question 10 | Reshape |

## Old routes and query parameters

Proposed tab routes: `/:callSign/schedule` is the Log tab, then `/schedule/templates` (and `/:templateId`), `/schedule/blocks` (and `/new`, `/:blockId`) and `/schedule/rules`. The Log tab keeps its query parameters. The rail treats the segment `schedule` as the page.

| Old | Parameters | Lands on |
|---|---|---|
| `/log` | none | `/schedule`: Day, today, scrolled to now |
| `/log?view=day` | `view` | `/schedule?view=day` |
| `/log?view=evening` (today's default, and from `logEntryHref` in `readiness.ts`) | `view` | `/schedule?view=day`, scrolled to 6:00 pm unless `entry` or `fill` say otherwise |
| `/log?view=week` | `view` | `/schedule?view=week` |
| `?day=sat` or `?day=2026-10-03` | `day` | Kept as is |
| `?edit=1` | `edit` | Kept. With `view=week`, it opens Day |
| `?fill=<gapStart>` | `fill` | Kept. Opens the drawer at the gap on the web, and the Fill sheet on the phone |
| `?entry=<entryId>` | `entry` | Kept. Picks the row and scrolls to it |
| `?block=<spanId>` (a `BlockSpan` id) | `block` | Kept. Picks the block's label row and opens its pane |
| `?place=<itemId>` (LibraryItem's "Schedule" button, ignored today) | `place` | `?edit=1&add=<itemId>`: edit mode with the drawer open on that item |
| (new) a break picked | `break` | `?break=<startsAt>` |
| `/log/place/:offerId?term=` (the market's B.3, which lights "Program log" on the rail today) | `term` | `/schedule/place/:offerId?term=`, lighting Schedule. Update `pages/market/Offer.tsx` and `components/market/ChooseTerms.tsx` |
| `/breaks` | none | `/schedule` (Day, today) |
| `/breaks?rotation=backup` or `main` | `rotation` | Unchanged: `/spot-market/rotation?show=<rotation>`. Update `BreaksSection`'s link to go there directly |
| `/breaks` as a studio | none | Unchanged: `/spot-rotation` |
| `/blocks` | none | `/schedule/blocks`: the list, with the first block open (or the empty state) |
| `/blocks/new` | none | `/schedule/blocks/new`: the list with the New block dialog |
| `/blocks/:blockId` | none | `/schedule/blocks/:blockId`: the list with that block open |
| (new) a block's "Where it airs", Open on a template | — | `/schedule/templates/:templateId` |
| (new) a block's "Where it airs", Open on a date | — | `/schedule?day=<date>&block=<spanId>` (`onLog.dates` has the span) |
| (new) "Place on the log", on a date | — | `/schedule?edit=1&day=<date>&addBlock=<blockId>`: edit mode with Add a block set to that block (open question 15) |
| `/settings/breaks` | none | Stays; the section becomes a link to `/schedule/rules`. Update the links in `pages/money/SpotMarket.tsx` and `pages/live/LibraryItem.tsx` ("Sign-off and sign-on") |
| `/library/blocks/:blockId` | none | Stays in the Library (a block's items) |
| `/setup/:stationId/log` | none | Stays in the setup shell |
| `?switch=1`, `?modal=sign-off` (on any page) | — | Carried through every redirect |
| A notice's `/stations/:id/log`, `/as-run`, `/breaks` (`CONTROL_PAGES` in the notifications service) | query passed through | Works through the redirects. Phase 4 points them at `schedule`, and the dead-air warning adds `fill` |

Links to update: `logEntryHref` (`components/onair/readiness.ts`, used by the Monitor); `BlockEditor.tsx` (`/log?day=`, and `/blocks` after archiving); LogPage's "Edit <block>" (`/blocks/:id`); `AddBlockDialog` (`/blocks/new`); the navigations inside `Blocks.tsx`; the routes in `Blocks.test.tsx`. The block's library list (`/library/blocks/:blockId`, its "Upload") stays where it is. Keep the old routes as redirects for good: emails and bookmarks carry them.

## Phase 3: the backend addition

**Recommendation: a new endpoint, `previewBreakRule`, rather than a dry run on `setBreakRule`.**

`setBreakRule` is a PUT that takes a `BreakRule` and answers a `BreakRule`. A dry run would need a window (a query on a PUT) and would answer a different shape: breaks, not a rule. That changes a published response, which `docs/contracts-changelog.md` rules out. It would also confuse the client: `useApiMutation` on `setBreakRule` refreshes `getBreakRule` and the avails on every call. A separate read keeps `setBreakRule` exactly as older builds know it.

**Shape** (in `stationsApi`, `packages/contracts/src/stations.ts`):

- `POST /stations/:stationId/break-rule/preview`, `auth: "user"`, owners and operators (as `setBreakRule`).
- Body: `{ rule: BreakRule, from: Timestamp, to: Timestamp }`, with `to - from` at most a few hours. The tab asks for the next hour.
- Response: `{ rule: BreakRule, entries: LogEntry[], breaks: PreviewBreak[] }`, optionally `blocks: BlockSpan[]` for the block band. `rule` is the rule as it would be saved, after the same merging `setBreakRule` does. `PreviewBreak` is `BreakSlot` (with `rows`) plus `keeps: boolean`: the break is already filled with spots, or settled, so it keeps what it has. That is what "breaks in the next 20 minutes keep what they have" needs.
- Errors: the same 400s as `setBreakRule` (`everyMinutes` missing, the station ID set to never, `n_programs` without `n`, a bad sequence). Nothing is written.

**How getLog builds breaks today** (`apps/api/src/v1/modules/log/service.ts`): `log()` calls `service.breaks()`, then `withStored()` over `generateBreaks()`, then `generateAll()`. Only `generateAll()` (around line 746) reads the rule, with `services.stations.breakRule(stationId)`. It walks from an hour back with `cadenceContext` (given `rule.cadence`) and decides each break's parts and bumpers. `withStored()` only reads (stored rows, `filledAt`, filled time). `breakContents()` turns each slot into rows from its parts, its elements and placed spots, and doesn't read the rule. `breakRow()` makes the contract's rows.

**Reusing it without saving:**

1. In `apps/api/src/v1/modules/stations/service.ts`, split `setBreakRule` in two. `resolveBreakRule(stationId, body)` does the validation, puts SID last in `fillOrder`, fills in the cadence and spots from what's stored, merges and defaults the sequences, and returns the `BreakRuleView` that `breakRule()` would return after saving. `setBreakRule` writes what it resolves.
2. In the log service, pass an optional `rule` down: `generateAll(stationId, from, to, everyPart, rule?)` uses `rule ?? await services.stations.breakRule(stationId)`, through `generateBreaks` and `service.breaks(stationId, from, to, { everyPart, rule })`.
3. Add `service.previewBreaks(stationId, from, to, rule)`. It's the breaks part of `log()`: `withStored`, then `breakContents`, then `breakRow`, with `keeps` from `filledAt` and the walk's `filled` set. It never calls `ensureBreaks` (which stores breaks) or anything else that writes. It can skip `templates.generate`; that only makes template dates, as `getLog` would.
4. The route in `stations/routes.ts` calls `resolveBreakRule`, then `log.previewBreaks`.

The answer is `getLog` after saving, not a promise about what airs: playout reads the saved rule elsewhere (`playout/engine/plan.ts`, `fill.ts`, `index.ts`). The mock needs the same: put the rule merging from `mocks/handlers/station.ts`' `setBreakRule` into a function, and let `ruleBreak` in `mocks/handlers/log.ts` take a rule rather than read `breakRuleOf(stationId)`. Record it in `docs/contracts-changelog.md`.

## Open questions

1. **What does dragging a row in the list do?** The rundown isn't drawn to scale, so a drag can't pick a time the way `EditTimeline`'s does. Recommendation: a drag reorders. The program dropped starts where the row above it ends, and the rows after it move down as `rippleFrom` does. The typed "Starts at" stays in the pane for exact times; up and down arrows move a row one place. A block's start and end handles (07) follow the same idea: they drop between rows and take the start of the row below, which is where membership changes anyway. `SpanSection` keeps typed times for anything else. Arrow keys move a handle one row. "Add a block" stays an edit-mode action.
2. **Where do the log pane's undrawn pieces go?** These are off air hours (the standing rule), Repeat this day, the change history and the block pane. Recommendation: off air hours on the Templates tab, under the list ("Every night, 2:00 to 6:00 am · Change"). Repeat this day becomes "Make a template from this day" on the Day view's template chip, and "New template" on Templates. History goes at the foot of "Tonight at a glance" ("Last changed by Kai at 8:42 pm"). The block pane opens from the block's label row.
3. **What happens to the `BreakRule` fields the frame doesn't draw?** These are the order of spots and the credit, blocked categories, ads from partners, the backup rotation and `openTimeTo`. Recommendation: keep them all on Break rules, since one `setBreakRule` saves the whole rule. Put them in a "What can air in your breaks" section under the timing tiles. The backup rotation is a link to Money. Spots and the credit stay draggable on the big strip.
4. **Where do Money Breaks' extras go?** These are the rail's open-time badge, the C.3 "Just added" amber with its Undo toast, and the paused-spot notices. Recommendation: put the paused-spot notices and the C.3 toast on the Spot market's rotation tab, with a "See tonight's breaks" link to Schedule. Open time shows in "Tonight at a glance". Drop the rail badge, as the reference's rail has none.
5. **What do the Bumpers and Up next chips write?** In `BreakRule`, bumpers are two sequences, each with its own cadence, and up next is a role, not a part. Recommendation: the Bumpers chips set `open.every` and `close.every` together, which is what `cadence.bumpers` means today. The Up next chips set `between.every` and put `up_next` into `between.roles`; Never takes it out. The sequence builders stay below the chips for order, and say so when the two positions differ.
6. **"Reset to template" and "edited by Kai, 2 changes".** Neither has an endpoint or data, and the prompt allows contract changes only in Phase 3. Recommendation: add a small `resetTemplateDate` endpoint in Phase 4 that makes one edited date again from its template. Log it in `docs/contract-requests.md` and the changelog, with your yes. Show "Oct 3 edited" without who or how many until a per-date record exists.
7. **Template editing.** `updateTemplate` replaces every entry, with no dry run and no version. `createTemplate` needs a day to start from. Recommendation: the same rows and drawer as the day. Changes gather in the tray, checked in the app for overlaps, and are saved as one `updateTemplate`. The tray says how many dates ahead will be made again (dates not edited). "New template" picks a day to build from. No break rows in a template, as the frame shows.
8. **Quick fill while a draft is open.** `fillGap` writes at once and changes the window's version, so a draft open at the same time gets a 409. Recommendation: with no changes in the draft, fill at once with `fillGap`, as the prompt says, then take the new version. With changes, add the plan to the draft as inserts, so one publish covers it all.
9. **The dead-air notification's link.** Opening on the gap needs `?fill=<gapStartsAt>` on the notice's link. That's an API change outside the contracts. Recommendation: make it in Phase 4. Point `CONTROL_PAGES`' `log`, `as-run` and `breaks` at `schedule` at the same time.
10. **Setup step 3.** It uses `LogPage`. Recommendation: setup shows the new Day view without the Schedule tabs or the Week. It keeps Fill and "Make a template from this day", and the foot with Back and Continue.
11. **Row data the API doesn't give.** "Next episode" and "Never aired" need to know what aired; per-row "Preparing for air, 62%" needs each item's preparation. Recommendation: "Next episode" is the episode after the program's latest airing in the loaded window. Drop "Never aired" until the API says. Rows use the library's `status` and `prepProgress`, and the chip uses `PlayoutStatus.readiness` for today. Log contract requests for `lastAiredAt` on `LibraryItem` and preparation per entry on `getLog`.
12. **The week's colours.** `Program` has no colour. Recommendation: carried programs in their maker's colour (`carriedFrom.colour`), the library in the station's colour, live in the live red, all checked for contrast.
13. **Members joining or leaving a block, in the tray.** The dry run says "Late Crate Nights now ends at 12:30 am" but not who joins or leaves. A new warning code would break older builds, because `warnings.code` is a closed enum they parse. Recommendation: work it out in the app, from `draftSpans` and `draftEntries` with the API's start-time rule (`spanPieces` and `spanAt` already mirror it). Show it as lines under the block's change ("Crate Session 01 is no longer part of it: BEAT's bug and ID air from 12:30 am"). Log a contract request for an optional `effects: string[]` on each change, so the API can say it later.
14. **Saving the block page.** The reference has one Save in the head. Today the name, description and colour wait for Save; the bug, intro, outro and order save at once. Recommendation: one draft for everything `updateBlock` takes, saved with Save, with the preview following the draft. Adding library items and uploading the logo stay immediate, because they're other endpoints. The page says so beside them ("Added at once").
15. **"Place on the log".** Nothing does it from the block's page. A template can hold blocks in the API (`updateTemplate.blocks`), but no screen edits them. Recommendation: a small menu. "On a date" opens the Log in edit mode with Add a block set to this block (`?addBlock=`). "In a template" opens the template editor (open question 7), which gets the same start and end handles as the day.
16. **What the look preview shows.** It needs a program title and the band's members. Recommendation: use the next span's members (one `getLog` over `onLog.dates[0]`), and "Your program" when the block isn't on the log. Draw the banner and the bug with the player's own `Banner` and `Overlays` rather than redrawing them, so the preview matches what viewers see. The web app already bundles the player for the viewer.
17. **Block page fields the reference doesn't draw.** These are editing the name and description, Archive, and Upload into the block. Recommendation: the name and description edit in place in the head; Archive stays at the foot of the page; Upload sits beside "Add from the library" and opens the block's library list.

## Risks

- **Setup and onboarding.** `SetupLog`, `SetupSignOn` ("Fill it") and the e2e flow's step 3 all go through `LogPage`. Rewriting it can break signing on a new station.
- **Drafts already saved.** The draft is kept in sessionStorage (`oc-log-draft:<stationId>`) with its window as the base. Day becomes the whole broadcast day, so a draft begun on Evening would conflict at once. Drop drafts whose base window doesn't match.
- **Rebasing after a 409.** Kept changes can point at entries that have moved or gone. The tray has to show those problems plainly, or publishing looks broken.
- **Drag in a list.** Reordering, ripples that run into locked rows, touch on the phone, and a keyboard way to do the same are all new. `EditTimeline`'s tests don't carry over.
- **Autosave to Save.** The break rule saves on every change today. With a draft, leaving the tab can lose work, so it needs an unsaved-changes prompt. The `BreaksSection.cadence`, `BreaksSection.identity` and `SequenceBuilder` tests move with it.
- **The preview's cost and fidelity.** `generateAll` walks from an hour back and reads the as-run log for bumper rotation. Each call is a real read, so the tab should wait a moment after a change and ask for one hour. The preview is `getLog` after saving; playout's own readers of the rule aren't covered.
- **Break length.** After every program, a break fills the slot's slack (`service.ts`, around line 1055). `lengthMs` only shapes breaks every N minutes, so "Drawn to scale for a 2:00 break" can mislead. Keep a helper line like today's "Live programs cue their own".
- **Rail and shell types.** `ControlPage`, `CONTROL_RAIL`, `ShellRail.test.tsx`, `ControlShell.test.tsx`, `PAGE_ABILITY`, the badges and hosts' disabled items all change in `packages/ui` and the app together.
- **Codes and words.** The reference's OFF chip is a planned off-air row. In `LOG_CODE_WORDS`, OFF reads "Off-air card", so a screen reader would say the wrong thing. LIVE, BRK and GAP are new and need words.
- **Colours.** The reference hard-codes the seven break colours. They need tokens for both grounds that pass `control.contrast.spec`.
- **Tests and e2e.** `control.flows.spec` (the Program log heading, the Breaks tonight flow and the rail's "Breaks" link), `control.flows.real.spec`, `control.a11y.spec` and `control.routes.real.spec` all open `/log` or `/breaks`. On the unit side: `LogEditor.test`, `LogPage.offair.test`, `RepeatDay.test`, `OffAirHours.test`, `readiness.test`, `readiness.pages.test`, `Blocks.test` and `Library.identity.test` (the `settings/breaks` link).
- **The week's weight.** `getLog` over seven days builds the contents of every break. That already happens on today's Week view; the new chips and colours mustn't add a second fetch.
- **Membership worked out twice.** If the app works out members for the tray and row notes (open question 13), its rule has to match `isMember` and `memberships` in `apps/api/src/v1/modules/log/blocks.ts` exactly. That includes start-time membership, overruns, and off-air time splitting a block. Otherwise the tray says something the publish doesn't do. Share test cases between the two.
- **Block handles on a list.** A handle can't land between two rows when they're the same program split by a break, or inside planned off air. On air, only the end can move. Handles need the same lock reasons as rows, and keyboard moves.
- **"Uses BEAT's" can be wrong.** Without the station's own pools and air windows, the row can promise a fallback that doesn't exist and nothing airs. The block page needs the station's library roles as well as the block's.
- **The player in master control.** Using `Banner` and `Overlays` for the preview couples master control to `packages/player`'s `Channel` type and CSS. A change there can quietly break the preview, so it needs its own test.
- **Blocks tests.** `Blocks.test.tsx` renders `/control/beat/blocks` and LogPage's block pane. A new Playwright flow resizes a block on the log, as the prompt asks.
- **New copy.** The why lines, summaries, chips, tray titles and fit badges go beyond the reference's examples. Each one goes in `docs/apps/new-copy.md`.

## Decisions (2026-10-02)

The user answered the open questions: "Go with your recommendations, but with these changes". The reference draws these decisions since e2d7a8e (its build-pass rows "Decisions from the first build pass" and "Contract requests"). Recorded as A246 in `docs/open-decisions.md`. Where a change asks the API for something, the request is in `docs/contract-requests.md` (G15 to G18, S20).

| # | Decision | Phase |
|---|---|---|
| 1 | **Changed.** A drag reorders, but only shifts rows up to the next fixed point: a live block, a carried program with a time window, a block edge, off air, or a row marked **"Keep at this time"** (a new option). Time freed or lost shows as dead air or an overlap in the tray. Typed "Starts at" and arrow keys stay as recommended. "Keep at this time" has to be stored per entry, and nothing can hold it today (`localNote` is free text): request G18, not built until it lands | 2 (the mark: after G18) |
| 2 | **Changed.** Off air hours are an every-day rule, so they sit **above the templates** on the Templates tab: a dashed "Every day" card first in the list ("Off air every night, 2:00 to 6:00 am. Applies to every template and date", Change), separate from the templates themselves; off air rows in the rundown link to it. Repeat this day becomes "Make a template from this day" on the Log tab's day nav (it starts a new template); the change history ("Changes to this day") sits under "Tonight at a glance"; the block pane opens from the block's label row | 1 (the tab's layout), 2 (the rest) |
| 3 | As recommended: every `BreakRule` field stays on Break rules ("What can air in your breaks"); the backup rotation links to Money | 3 |
| 4 | As recommended (paused-spot notices and the C.3 toast on the Spot market's rotation tab, with "See tonight's breaks"; open time in "Tonight at a glance"; no rail badge), **plus** a health chip on the Schedule when a paused spot affects tonight's breaks | 1 (the move), 2 (the chip) |
| 5 | **Changed.** Break bumpers and Up next stay **independent**: the Bumpers chips set `open.every` and `close.every`; the Up next chips don't touch the between-programs sequence. Up next has no cadence of its own in `BreakRule` today (it airs as often as whichever position holds it), so it needs `cadence.upNext`: request S20 | 3 (after S20) |
| 6 | Yes: a small `resetTemplateDate` endpoint ("Reset to template"), logged in the requests and the changelog. "Oct 3 edited" without who or how many until a per-date record exists | 4 |
| 7 | As recommended, **plus** saving a template says both how many dates will be rebuilt and how many edited dates are kept as exceptions | 4 |
| 8 | As recommended: with no changes in the draft, quick fill calls `fillGap` at once; with changes, the plan joins the draft | 2 |
| 9 | Yes: the dead-air notification links with `?fill=<gapStartsAt>`, and `CONTROL_PAGES` points `log`, `as-run` and `breaks` at `schedule` | 4 |
| 10 | As recommended: setup step 3 shows the new Day view without the tabs or the Week | 2 |
| 11 | **Changed.** "Next episode" and per-item preparation are logged as contract requests (G15, G16). Until they land, preparation uses the existing readiness check (`PlayoutStatus.readiness`) and the library's `status` and `prepProgress` where the app can reach them; "Never aired" is dropped | 2 |
| 12 | **Changed.** Live programs aren't solid red: they take the station's colour with a live marker. Red is only for "on air now". Carried programs in their maker's colour, the library in the station's, all checked for contrast | 2 |
| 13 | **Changed.** Membership is worked out in the app while dragging (for row notes), but the tray's lines come from the dry run. Request G17 asks `applyLogChanges` dry runs to report membership changes | 2, 4 |
| 14 | As recommended (one draft and one Save), **plus** a warning before leaving the block page with unsaved changes | 4 |
| 15 | As recommended: "Place on the log" is a menu (on a date, `?addBlock=`; in a template) | 4 |
| 16 | **Changed.** The look preview uses the next span's members; with no upcoming airing it shows a sample program, labelled as a sample | 4 |
| 17 | As recommended: name and description edit in the head; Archive at the foot; Upload beside "Add from the library" | 4 |

**Phase 1 as built.** Schedule replaces Program log and Breaks in On air, and Blocks leaves Programming; the tabs are routes (`/schedule`, `/schedule/templates`, `/schedule/blocks`, `/schedule/rules`, and `/schedule/place/:offerId`). Every old route redirects with its query: `/log` (with `view=evening` read as `day`, and `place=<id>` as `edit=1&add=<id>`), `/log/place/:offerId`, `/breaks` (`rotation=` still to the rotation tab; a studio to its Spot rotation), `/blocks`, `/blocks/new`, `/blocks/:blockId`. The Log tab is the program log page under the Schedule head, with Day and Week (Day the default); the break rule's summary and the off air hours left its pane (Repeat this day stays there until Phase 2). Templates has the off air hours at the top as the "Every day" rule, then the template list (`TemplateList`, out of Repeat this day). The rail's open-time badge is gone; the Breaks page's table of tonight's breaks waits for Phase 2's break rows and pane. Setup step 3 is unchanged. Blocks is the blocks pages inside the shell. Break rules is `BreaksSection` as it was; station settings' Breaks section says it moved, with a link. Decision 4's move is done: the rotation tab has the paused-spot notices, the C.3 toast and "See tonight's breaks".

**Phase 2 as built (2026-10-03).** The Log tab's Day view is a rundown (`components/onair/DayRundown.tsx`, its rows from `dayRows.ts`): programs, live blocks and sign-offs with the app's own codes (PGM, LIVE, BRK, GAP, OFF, each with screen-reader words), breaks as one thin row with a bar by kind (`BreakStrip`, packages/ui, seven kinds as `--brk-*` tokens), dead air striped amber with Fill, planned off air striped grey linking to the Templates tab, a block's colour down its rows with a label where it starts, past rows dimmed, the row on air red with ON AIR; it opens scrolled to now, `?entry`, `?break` or `?fill`. Above it the day nav (arrows, Today, the template chip, "Make a template from this day", Day and Week) and the health chips (on air, dead air, items not ready from `readiness`, planned off air, a paused spot), each scrolling to its row. The pane (`LogPane.tsx`): "Tonight at a glance" with "Recent changes" and the next break; a break (`?break=<startsAt>`) as a strip and a list with whose time each part is, "Spots, placed at …" before they're placed, and the why line linking to Break rules; a program; a block. The Week (`WeekView.tsx`): seven columns with their template and "edited", programs by source colour (live in the station's with "● Live"), blocks as an edge, dead air and off air striped, the now line; a day opens the Day. Edit mode: rows move by handle (drag or arrow keys) up to the next fixed point (`reorder.ts`; G18's "Keep at this time" built, migration 0050), "Add here" between rows, Remove, a live block's or sign-off's end, "Keep at this time" per row; the tray (`EditTray.tsx`) with the dry run's lines, warnings and problems, Discard, Check again and Publish; the record after publishing; 409 reloads and keeps the draft. The Add drawer (`AddDrawer.tsx`, `Drawer` in packages/ui): Library, Carried, Live, Sign off with fit badges and quick fill (`fillGap` with nothing drafted, inserts in the draft otherwise); `?add=<itemId>` opens it on that item. Setup step 3 is the same Day view without the tabs or the Week. Deviations are in A246.

**Phase 3 as built (2026-10-03).** Break rules is one draft (`components/station/settings/BreaksSection.tsx`) with Reset and "Save break rules", and a warning before leaving unsaved changes (`useLeaveGuard.tsx`: links, the Schedule's tabs, closing the tab). At the top, every break drawn to scale in air order (`BreakStrip`'s new `big` variant, from `recipeOf` in `breakRule.ts`), then between programs; the line under it says what's true for the mode (after every program a break is the time its program leaves, the map's surprise, so the length tile says it's for breaks cued live and between repeats). Cadence chips per part (spots, the credit, bumpers, the station ID with never crossed out, Up next), N chosen beside "Every N programs"; the Bumpers chips set the opening and closing sequences together; Up next's write `cadence.upNext` (S20, done: optional, additive, no migration, a station that never sets it airs exactly as before). "What can air in your breaks" holds the blocked categories, the backup rotation (a link to Money's rotation), the fill order and ads from partners; then timing tiles, the bumper order (A243's builders) and signing off and on (A242). On the right, the next hour rebuilt with the draft (`BreakPreview.tsx`, debounced 400 ms) through `previewBreakRule`, built as recommended above: `resolveBreakRule` in the stations service (the checks and merging `setBreakRule` now shares), `generateAll` taking the rule, and `previewBreaks` in the log service (the breaks part of `log()`, reads only, `keeps` per break). It's in `logApi` rather than `stationsApi` (an import cycle in the contracts). Under it, "Everything on this page saves together…" with the blocks that use their own bumper order. Deviations are in A246.

**Phase 4 as built (2026-10-03).** Templates (`components/onair/TemplatesTab.tsx`, `TemplateEditor.tsx`, `templateDraft.ts`): the dashed "Every day" card, then a card per template (pattern, label, three weeks of dates as squares, edited ones amber, and the precedence note on the one that wins a date); the template open beside the list with its edited dates, "Reset {date} to template" (decision 6: `resetTemplateDate`, G19, which says what comes off first) and "Edit template", what saving does ("Saving changes here rebuilds 3 upcoming Saturdays. Oct 3, edited by hand, is kept as an exception."), and its rundown drawn and edited as the day's (`DayRundown`, the Add drawer, the block handles; no breaks or dead air), checked in the app and saved as one `updateTemplate` that says the dates rebuilt and the edited ones kept (decision 7). Blocks (`pages/live/Blocks.tsx`, `components/live/BlockPage.tsx`, `BlockPreview.tsx`, `blockAirs.ts`): the cards (schedule, what's its own, next airing), and the block page with what it airs and where each part falls back (open question 7's chain, "Uses BEAT's" only where BEAT has one), its bumper order, the look previewed with the player's `Banner` and `Overlays` and `GuideGrid`'s band from the next airing or a labelled sample (decision 16), where it airs, the syndication fields read-only, one Save with a warning before leaving (decision 14), Add from the library and the logo saving at once, "Place on the log" as a menu (decision 15) and Archive at the foot (decision 17). On the Log in edit mode, and in a template, a block's start and end are handle rows (`blockHandles.ts`): they drop between rows onto the start of the row below, move a row with the arrow keys, keep to the day, never overlap, and on air only the end moves; while dragging the rows say who joins or leaves (open question 1's way; membership by the API's start-time rule), and the tray's line is the dry run's, which now says it in words (G17's fields stay open). The phone: the rundown with the day and its chips on top, a break (or a program, or the row being edited) as a bottom sheet, Fill's sheet, and Templates, Blocks and Break rules saying they're desk work with the way back to the Log. The dead-air warning links to `/schedule?day=…&fill=…` and the notices' log, as-run and breaks pages to the Schedule (decision 9). Deviations are in A246.
