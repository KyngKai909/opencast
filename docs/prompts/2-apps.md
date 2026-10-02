# Opencast: apps prompt (every screen, from the reference files)

You're working in `github.com/KyngKai909/opencast`, the Opencast repo, after the platform prompt has restructured it into a monorepo. Your job is to build every app from the reference designs, on a shared UI package and a shared player. There are four:

- **`apps/web`, the Opencast app.** One account and one sign-in for viewers and creators, like Twitch: the viewer at `/`, master control at `/control`, and Network desk at `/desk` for Opencast admins.
- **`apps/business`, Opencast for business.** The advertiser side, a separate app for a separate kind of customer.
- **`apps/tv`.** A TV build of the same app for ten-foot screens, and the Chromecast receiver.
- **`apps/site`.** The marketing page.

A second prompt, the platform prompt, owns the backend at the same time: `apps/api`, `apps/worker`, `packages/domain`, `packages/contracts` and `contracts/`. You own everything else under `apps/` and `packages/ui` and `packages/player`. You meet at `packages/contracts`: read its schemas, never edit them. If you need a field that doesn't exist, add it to `docs/contract-requests.md` and build against a mock until it lands.

## Before you start

- Don't start until the platform prompt's Phase 2 (restructure) is merged into the `monorepo` branch. Check that `apps/web`, `apps/business`, `apps/tv`, `apps/site`, `packages/ui`, `packages/player` and `packages/contracts` exist. If they don't, stop and say so.
- Work on a branch called `apps`, from `monorepo`. Never force-push. Commit at the end of every phase.
- **Stop at every point marked STOP.** Say what you did and what you found, then wait.
- Anything marked **Open** isn't decided. Build it so it's easy to change, and list it in `docs/apps/open-questions.md`.

## The reference files

The designs are in `docs/reference/`, one folder per app. They are self-contained HTML files; open them in a browser. They are the source of truth for layout, copy, states and behaviour.

| Folder | Files | Builds |
|---|---|---|
| `brand/` | `opencast-style.html` (style guide), `opencast-site.html` | Tokens, type, voice; `apps/site` |
| `viewer/` | `opencast-home.html`, `opencast-you.html`, `opencast-station-pages.html`, `opencast-tuning.html` | `apps/web`, the viewer area at `/` |
| `tv/` | `opencast-tv.html`, `opencast-tv-update.html` | `apps/tv` and the Cast receiver |
| `control/` | `opencast-master-control.html`, `opencast-live-listings.html`, `opencast-station-settings.html`, `opencast-offering.html`, `opencast-market.html`, `opencast-earnings.html`, `opencast-rights.html` | `apps/web`, the master control area at `/control` |
| `business/` | `opencast-biz-funding.html`, `opencast-biz-spots.html`, `opencast-biz-results.html`, `opencast-sponsorships.html`, `opencast-production-orders.html`, `opencast-biz-settings.html` | `apps/business` |
| `desk/` | `opencast-network-desk.html`, `opencast-desk-catalog.html`, `opencast-desk-pages.html` | `apps/web`, the Network desk area at `/desk` |

`opencast-sponsorships.html` and `opencast-production-orders.html` show both sides: the business app and master control. Build both halves.

How to read them:
- Each file has an intro, numbered sections, frames (the screens) and notes beside each frame. **The notes are requirements**, not commentary. A note marked "Open" is an open question.
- Frames are drawn at fixed sizes (1280 wide for web, 406 for phones, 1920 by 1080 for TV) and scaled to fit. Build responsive layouts that match them at those sizes, not fixed canvases.
- **Copy is final.** Use the words in the frames exactly, including button labels, empty states, notices and error text. Don't write new copy where a frame has it. Where you need copy a frame doesn't show, follow the style guide's Voice chapter and list it in `docs/apps/new-copy.md` for review.
- People, stations, businesses and amounts in the frames are illustrations. Use them as mock data.
- Don't redesign. If something in a reference file looks wrong or can't be built as drawn, say so at the next STOP instead of changing it.

## Stack

- Vite, React and TypeScript for every app, as the repo already uses. React Router for routing. TanStack Query for data, against the Zod schemas in `packages/contracts`.
- Mock Service Worker for every endpoint until the real one exists, with fixtures built from the reference files' illustration data and validated against the contract schemas. Each app runs fully on mocks with `npm run dev:mock`.
- Styling: the tokens are CSS custom properties, defined once in `packages/ui` from the style guide's Colour, Type, Space and Shape chapters. Every colour, size, radius and font in every app comes from those tokens. If you keep Tailwind (the repo has it), configure it to read the tokens; no hard-coded values.
- Fonts: Archivo (display, width 125 for idents and headlines), Public Sans (text and buttons), IBM Plex Mono (clock, channel numbers, amounts, log codes only), self-hosted with fallback stacks.
- Sign-in: Opencast's own Privy app (its app ID from configuration, never Clear's), email first, then Apple, Google and wallets, as in `viewer/opencast-you.html`. "Connect Clear" uses Privy's cross-app linking (`useCrossAppAccounts`) with Clear as the provider; show the linked Clear account in settings, and handle Clear sharing read-only (payout address only) as well as full access (funding by a transfer the user confirms).
- Tests: Vitest for components and logic, Playwright for the flows listed in Phase 9, axe for accessibility.

## Rules that apply everywhere

From the style guide and the reference notes. Put them in `docs/apps/rules.md` and check every screen against them.

- **Two grounds.** Dark is the default; light is the alternative, following the system setting with a manual override. TV mode is always dark.
- **The tally light** (the ON AIR sign) lights only when something is actually on air. It switches on once with a single flicker (1.6 seconds) and never blinks or pulses. With reduced motion it just appears lit. On viewer screens, only the player shows a lit tally.
- **Rules, not boxes.** Content is separated by rules. The picture is the only box. Don't add cards where the frames have rules.
- **Voice.** Broadcast vocabulary (station, channel, call sign, tune in, presets, listings, sign on, spot, underwriting, carry). A 12-hour clock ("8:00 pm"). Durations as `:30`, `28:30`, `1:02:15`. No exclamation marks, no emoji.
- **Viewers never see audience numbers.** No view counts, ratings or trending anywhere in the viewer app or TV mode. Stations see their own numbers only; businesses see their own results only.
- **The dial is in channel order,** the same every time. No recommendation feed.
- **Amounts and times in mono,** right-aligned in tables.
- **Undecided money lines stay visible,** reading "Not set yet" at $0.00, as in the earnings file.
- **Numbers tune.** Typing a channel or frequency anywhere a viewer can type tunes to it.
- **Contrast.** Station colours must hold 4.5:1 against white; check it wherever a station colour is chosen.
- **Accessibility.** Every control is reachable by keyboard with a visible focus ring. Every icon button has a label. Nothing depends on colour alone.

## States that must match across apps

The business app and master control are two sides of the same transactions. Each state on one side has a named state on the other, and they change together. Put this table in `packages/contracts` as shared enums with display strings, and use it on both sides.

| Thing | Business sees | Station sees |
|---|---|---|
| Spot | Draft, In review, Listed, In rotation on N stations, Paused until midnight, Paused (budget spent), Ended | Not visible, not visible, In the market, In rotation, (still in rotation, not scheduled), Paused notice with what filled the gap, Gone |
| Spot resumed | Waiting for you, then back in the market | "It's back" notice with Add it back; never re-added automatically |
| Sponsorship | Waiting for [station], Approved, Credited on air, Lapsed | New request, Approved, In the credit, Removed from the credit |
| Production order | Quote requested, Quote ready (your turn), Paid, in the making, Delivered (review by date), Approved, it's a spot now | New request, Quoted, Accepted, make it, Delivered, waiting, Approved, money released |
| Carriage request | (station to station) Asked | Review request, Approved, Declined with a reason |
| Rights claim | n/a | Off air, days to answer, Answered, Back on air, Removed |
| Claimable station | Creator: permission page, Said yes, Claim ready | Network desk: Found, Already licensed, Asked, Said yes, Setting up, On air, Claimed, Declined |

## Phase 0: Read and inventory

Read every reference file, the platform prompt's `docs/architecture.md` and every schema in `packages/contracts`.

Write `docs/apps/inventory.md`: for every frame in every reference file, the app, the route, the components it needs, the data it needs (which contract), and its states. Note each "Open" item. List anything that can't be built as drawn, and anything the contracts don't cover yet.

**STOP.** Summarise the inventory: how many screens per app, the component list, and the contract gaps.

## Phase 1: `packages/ui`

Build the design system once:
- **Tokens** for both grounds, and the TV's always-dark set, from the style guide.
- **Primitives:** buttons (primary, ghost, text, small, block), fields, toggles, segmented controls, chips, tags (including Live and External), the tally, tooltips, toasts with Undo, modals (web) and sheets (phone), notices (the amber standby notice and the plain one).
- **Broadcast components:** channel number and call sign ident, station colour band, title card, picture frame with bug, lower third, listing row, dial row, guide grid with now-line, program log timeline with codes (PGM, SPT, UND, BMP, SID), break bar, schedule list with the tally edge on the current row, progress bar (not a scrub bar), radio band scale with needle, level meter.
- **Data components:** stat rows (the ruled number groups), key-value lists, tables with mono amounts, timeline (done, current, future), step rails, permissions table, charts (line with a comparison line and shaded breaks, as in the audience page).
- **Shells:** viewer web (header, nav, market button, player bar), viewer phone (top bar, four tabs, mini player), master control (header with station switcher, clock and tally; rail; setup step rail; the studio variant with no on-air pages), business (header with business switcher and balance; rail; setup step rail), Network desk (header with the Internal mark), and the settings layout (sub-rail and pane) used by viewer, station and business settings.

Add `apps/gallery`: every component in both grounds and every state, with the reference frame it comes from.

**STOP.** Show the gallery. Compare five components side by side with their reference frames.

## Phase 2: `packages/player`

One player used by the viewer app, TV mode and the Cast receiver:
- HLS playback with hls.js (native on Safari). Tuning in joins live, mid-program. No scrub bar, except in the syndication market's station preview.
- Channel changes keep the previous picture until the new one is ready. Pre-warm the neighbouring channels (their playlists and first segment) so up and down are fast.
- **The player draws the station's bug, lower thirds and on-screen codes and QR** as overlays, timed from `#EXT-X-DATERANGE` tags in the channel's playlist. They aren't in the picture: channels are assembled from segments prepared once, as the platform prompt describes. Place them inside the style guide's safe areas, exactly as the reference frames show them.
- Handle `#EXT-X-DISCONTINUITY` between items and the switch into and out of live blocks without a visible glitch.
- The banner on every change: ident, what's on, progress, what's next, clock and tally, for 5 seconds (a setting on TV).
- Captions (with the size setting), background audio on phones, pause that holds for 30 minutes then offers Back to live.
- A tuned-in heartbeat every 30 seconds with station and session, as the platform prompt specifies.
- An **input adapter** interface: TV remote keys, Cast messages, and the iPhone external-display bridge all become the same commands (channel up and down, number entry, guide, info, back, presets, pause, sleep timer). See the "One TV mode, three inputs" table in `tv/opencast-tv-update.html`.

**STOP.** Show the player tuning between three mock stations, the banner, number entry and pre-warming.

## One app, three areas

`apps/web` holds the viewer, master control and Network desk as areas of one app, each with its own shell exactly as drawn in the reference files.
- **One session.** A viewer who starts a station, or a station owner who wants to watch, never signs in twice. The avatar menu shows "Master control" to people with a station role and "Network desk" to admins; master control's header has "Back to watching".
- **Lazy-load each area** by route, so viewers never download master control or the desk.
- **Roles decide access,** checked by the API on every request. Hiding a route is not security.
- **`apps/business`** is separate, with its own sign-in screen for businesses, but the same Opencast account: someone who runs a station and also advertises signs in once and can open either.
- **`apps/tv`** shares the viewer area's code and the player, built for TV screens with the TV shell.

## Phase 3: `apps/web`, the viewer area (web and phone)

From `viewer/`: off air stations on the dial and in the guide with the time they're back, the home and dial, tuned in, the guide, station preview, carried from, pledge, share, reminders, first visit and thin markets, sign-in, You, presets (with the replace dialog), managing a pledge, settings (eight sections), the station page, the program page, search (with "Tune to" for numbers) and the radio band.

- Number keys 1 to 6 tune presets from anywhere on the web; arrow keys change channel on the tuned-in page; `/` opens search.
- Sign-in appears only when someone saves, reminds or pledges, and completes the action afterwards.
- A "Run a station or offer your programs" link on You opens the master control area in the same session.
- It's a PWA; the Capacitor wrapper comes in Phase 8.

**STOP.** Show the viewer app on mocks, web and phone widths, both grounds.

## Phase 4: `apps/web`, the master control area (`/control`)

From `control/`, plus the station halves of `business/opencast-sponsorships.html` and `business/opencast-production-orders.html`:
- **Sign-on flow A1 to A5** and the Monitor, with the "From the market" suggestions.
- **Program log** as a timeline with breaks, dead air, and scheduled off air hours (drawn differently from dead air, and never warned about), with "Repeat this day" (every Saturday, weekdays, every day, once) and the off air hours setting.
- **Library:** item page and folders.
- **Live sources** and going live from a browser and a phone, with stand by, countdown, lower thirds and the speaker list.
- **Listings** with previews.
- **Breaks, and the spot market** with runway, blocked categories and paused notices, plus the Production orders tab.
- **Sponsors,** with requests.
- **The syndication market:** browse with "Fits your schedule", the program page for stations, preview with break marks, Offered by, Carried by, requests and carriers.
- **Audience and Earnings,** with held money and statements.
- **Rights** with claims and answers.
- **Translators.**
- **Settings:** identity, breaks (including the "Ads from partners" switch, which only sets a flag until the backend supports it), sponsorship, translators, team, notifications, station account, ownership.
- **The station switcher.**

Roles decide what's visible: owner, operator (sees earnings, can't move money) and host (only their assigned live blocks, lower thirds and cue break). A studio (a station with no channel) gets the studio shell with no on-air pages.

The rail is the same on every screen: On air (Monitor, Audience, Program log, Live sources, Breaks), Market (Syndication market), Programming (Library, Listings), Money (Spot market, Sponsors, Earnings), Station (Translators, Rights, Settings).

**STOP.** Show a station's full evening on mocks: sign on, the log, a break filling, a live block going out from the browser, a paused spot handled by the backup rotation, and the earnings page.

## Phase 5: `apps/business` (Opencast for business)

From `business/`:
- **Getting started:** business details, where customers are, funding.
- **Balance:** available, held and spent, the runway in days, movements, taking money out.
- **Spots:** list, upload with the checks drawn on the frame, rate, budget, targeting with named stations, the paused page.
- **Where it aired:** month, every airing with its proof frame, codes and customers, statements.
- **Sponsorships:** list, new, and the credit rules check.
- **Made for you:** orders, brief, quote, paying into a hold, review with pinned notes.
- **Settings:** profile, team (owner, manager, viewer), money and receipts, notifications, connections.
- **Phone:** balance warnings, spots, redeeming a code, the weekly summary.

Check every state against the table above.

**STOP.** Show a business's month on mocks: sign up, fund, list a spot, get it paused and resumed, sponsor a program, order a spot and approve it, and read the results.

## Phase 6: `apps/tv` and the Cast receiver

From `tv/`: watching with the banner, number entry, the guide with its options dialog, the menu rail, presets strip, radio (with drift to protect screens), off air, first launch with a sign-in code, pledge by QR, TV settings (five sections, all left and right), and the sleep timer.

- Ten-foot rules: large type as drawn, one focus ring at a time, spatial navigation with the D-pad (Norigin Spatial Navigation or equivalent), never a keyboard.
- The same web build runs as the Android TV and Fire TV app (Phase 8) and as the **Cast Web Receiver** (a `receiver.html` entry using Google's Cast Application Framework), driven through the input adapter. The phone remote in the viewer app sends Cast messages.
- While casting or mirroring, the hint row says where the controls are ("Playing from Kai's phone", "Mirrored from Kai's iPhone").

**STOP.** Show TV mode at 1920 by 1080 with keyboard arrows standing in for the remote, and the receiver responding to mock Cast messages.

## Phase 7: the Network desk area (`/desk`) and `apps/site`

- **Network desk,** from `desk/`: the market board, the creator pipeline (including "Already licensed"), asking permission with the station preview, setting up from a recipe, external sources, the creator's permission page (which needs no account), and held earnings with the escrow's station IDs. Admin sign-in only.
- **The site,** from `brand/opencast-site.html`: one page, the working tuner in the hero, the waitlist with four roles (viewer, station with a held call sign, producer, business) posting to the API's waitlist endpoint.

**STOP.** Show both.

## Phase 8: Native wrappers

- **The Opencast app (`apps/web`) on iOS and Android with Capacitor,** so creators get master control on their phones too, including going live, as the reference files show.
  - **Casting:** the Google Cast sender SDK through a Cast plugin, so iPhones can cast to Chromecast too.
  - **Mirroring:** a custom Swift plugin for the iPhone's external display. When Screen Mirroring connects, it opens a second web view on the external display that loads TV mode with the bridge input adapter, and passes messages between the phone's web view and the TV's. The flows are in `tv/opencast-tv-update.html`: the one-time guide, switching to the remote automatically, the keep-open warning with battery, and "Mirroring stopped" after a lock. Keep the screen awake while mirroring.
  - Lock-screen controls for channel up, down and pause.
- **TV mode on Android TV and Fire TV** with a Capacitor Android build using the leanback launcher, D-pad input and the TV's channel keys where they exist.
- Don't submit anything to an app store. Write `docs/apps/native.md` with what each build needs to ship.

**STOP.** Show the viewer app running on an iOS simulator casting to a mock receiver, the external-display plugin on a simulator with an external display, and TV mode on an Android TV emulator.

## Phase 9: Real data, tests and cleanup

- Switch each app from mocks to the real API module by module, as the platform prompt's endpoints land. Keep the mocks for tests and for `dev:mock`.
- Playwright flows, one per product:
  - **Viewer:** first visit, tune in, save a preset (sign-in), set a reminder.
  - **Master control:** sign on for the first time, carry a program, fill a break from the spot market, approve a sponsorship.
  - **Business:** fund, list a spot, pause and resume it, sponsor a program, order and approve a spot.
  - **TV:** change channel by number and arrows, open the guide, set the sleep timer.
  - **Desk:** set up a claimable station from a recipe.
- axe checks on every route in both grounds. Contrast checks on station colours.
- Remove any leftover master control code from before the redesign.

**STOP.** Report test results, anything still on mocks, and the open questions list.

## Deliverables

- The apps and packages above, running on mocks and on the real API.
- `docs/apps/inventory.md`, `rules.md`, `new-copy.md`, `open-questions.md`, `native.md`, and `docs/contract-requests.md`.
- A section in the root `README.md` on running each app, the gallery, and the mocks.
