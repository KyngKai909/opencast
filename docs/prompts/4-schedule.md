# Opencast: the Schedule workspace

Redesign master control's program log and break scheduling into one **Schedule** workspace, from `docs/reference/control/opencast-schedule.html`. Open it in a browser and read every frame and note before starting; the notes are requirements and the copy is final.

This is a UI pass on top of what exists. The data model, API and playout stay as they are, with one small backend addition (Phase 3).

## Ground rules

- Work on a branch called `schedule`, from `dev`. Commit at the end of each phase. Never force-push.
- **Stop at every STOP**, say what you did, and wait.
- Reuse what's there: `LogPage`, `LogEditor`, `logEdit`, `Fill`, `RepeatDay`, `OffAirHours`, `templates`, `rundown`, `readiness`, the blocks code, and the `packages/ui` broadcast components. Move and reshape them rather than rewriting them.
- Don't change contracts except where Phase 3 says. Anything you think needs changing goes in `docs/contract-requests.md`.
- New copy that isn't in the reference file goes in `docs/apps/new-copy.md`.

## Phase 0: Map it

Read the reference file, then the current Program log page, the Breaks page under Money, the break settings in station settings, and the blocks pages. Write `docs/schedule-map.md`: each frame in the reference file, the existing component or endpoint that already does it, and what's missing.

**STOP.**

## Phase 1: One workspace

- Add **Schedule** to master control's On air group (Monitor, Audience, Schedule, Live sources), replacing "Program log" and "Breaks". Redirect the old routes to the matching tab, keeping their query parameters (`day`, `view`, `edit`, `fill`, `entry`, `block`).
- Four tabs: **Log** (Day and Week views), **Templates**, **Blocks**, **Break rules**.
- Move the break rule out of station settings and the log page into Break rules, and leave a link behind in station settings. Rotations and the spot market stay under Money.

**STOP.** Show the new navigation and that every old link still lands in the right place.

## Phase 2: The Log tab

- **Day view as a rundown:** rows in air order with start, code, title, source and length.
  - Breaks are inline thin rows with a fill bar by kind (bumpers, spots, the maker's barter, the credit, the station ID, open time).
  - Dead air is striped amber with Fill; planned off air is striped grey.
  - Programming blocks show as a coloured edge with a label where they start.
  - Past rows dim, the row on air gets the red edge and the ON AIR tag, and the view opens scrolled to now.
- **Health chips** above the rundown: on air now, the next dead air, planned off air, items not yet prepared, and the day's template and whether it was edited. Each chip scrolls to its row.
- **Side pane:**
  - With nothing selected: "Tonight at a glance" and the next break.
  - With a break selected: its contents in air order as a strip scaled by length and as a list, whose time each part is, "placed 20 minutes before air" before spots are placed, and the why-line linking to Break rules.
  - With a program selected: its details, as today.
- **Week view:** seven broadcast days as columns, each headed with its template and an edited marker, programs in their source colour, blocks as an edge bar, dead air and off air striped, and the now-line. Clicking a day opens it in the Day view.
- **Edit mode:**
  - Drag to move, "Add here" between rows, remove, and resize for live blocks and sign-offs.
  - Changes collect in a tray at the bottom with their lines and warnings, from `applyLogChanges` run as a dry run.
  - Publish sends the window's version. On `409 log_changed`, offer to reload and keep the draft.
  - Rows within `LOG_EDIT_LEAD_MS` of air are locked, with the reason shown.
  - Editing a date made from a template says it will become an exception before publishing.
- **Add drawer:**
  - Tabs: Library, Carried, Live, Sign off.
  - Fit badges against the space: Fits, minutes over and what it pushes, Next episode.
  - Quick fill: repeat from the library (`fillGap` with `repeat`), or sign off until the next program.

**STOP.** Show tonight's rundown, a break opened, the week, a four-change edit checked and published, and the dead air filled from the drawer.

## Phase 3: Break rules, with a preview

- The scaled strip of one break in air order, plus "Up next" between programs.
- Cadence choices per part: spots, the credit, bumpers, the station ID and up next. The options are every break, after each program, every N programs, once an hour, and never. The station ID can't be never.
- Timing and limits: when breaks come, length, spot time per hour, same spot per hour. Also the bumper sequences, and the opener options already in `BreakRule`.
- **The live preview:** the next hour rebuilt with the unsaved rule, before saving. Add the backend support:
  - Add a dry-run option to `setBreakRule` (or a new `previewBreakRule` endpoint) that takes a full `BreakRule` and a window.
  - It returns the breaks with their rows, exactly as `getLog` would after saving, without saving anything.
  - Record the contract change in `docs/contracts-changelog.md`.
- Show that new rules apply to breaks not yet filled, and name any programming block that uses its own bumper order.

**STOP.** Show a cadence change visibly rebuilding the preview before saving, then saving.

## Phase 4: Templates, blocks and the phone

- **Templates:** the list with pattern, label, and dates ahead (generated, and edited in amber), with the precedence note when one is overridden. Opening a template shows its rundown, edited with the same rundown editor. "Reset to template" for an edited date.
- **Blocks:** move the existing blocks pages under this tab, unchanged except for the shell.
- **Phone:**
  - The rundown with health chips, breaks as thin rows, and a break as a bottom sheet.
  - Fill a gap, sign off and move a program work on the phone; templates, blocks and rules stay desktop-only.
  - The dead-air notification opens straight to the gap.
- Tests: update the existing log, edit, repeat and off-air tests for the new layout. Add Playwright flows for opening a break, publishing an edit, filling dead air from the drawer, and previewing then saving a break rule.

**STOP.** Report test results, anything that differs from the reference file, and the new copy list.
