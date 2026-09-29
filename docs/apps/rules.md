# Rules for every screen

From the apps prompt, the style guide and the reference files' intros and notes. Every screen is checked against this list before its phase's STOP. The source is in brackets.

## Look

- **Two grounds.** Dark is the default. Light is the alternative: it follows the system setting, with a manual override (viewer Settings, Appearance). TV mode is always dark. [prompt; style guide]
- **Tokens only.** Every colour, size, space, radius and font comes from the tokens in `packages/ui` (the style guide's Colour, Type, Space and Shape chapters). No hard-coded values in apps. [prompt]
- **Rules, not boxes.** Content is separated by rules. The picture is the only box. No cards where a frame has rules. [prompt; style guide "The picture is the only box."]
- **Fonts.** Archivo for display (width 125 for idents and headlines), Public Sans for text and buttons, IBM Plex Mono only for the clock, channel numbers, amounts and log codes. All three are self-hosted, with fallback stacks. [prompt]
- **Amounts and times in mono.** Amounts are right-aligned in tables; a time column comes first and sits left, as every frame draws it (open question A15). [prompt; frames]
- **Station colours** carry white text everywhere, and must hold 4.5:1 against white. A colour that fails can't be saved, and the reason is shown. Check it wherever a station colour is chosen. [prompt; master control A1; station settings]
- **Buttons on a station's colour** use white and outline, so they pass on any station colour. [station pages 01]
- **Standby amber** means "committed, not yet on air" or "needs attention": holds, newly added spots, incomplete listings, unconfirmed rights, requests with a deadline. Don't use it for anything else. [biz funding 03; master control C; live-listings 03; offering 01]

## The tally

- It lights only when something is actually on air. It switches on once, with a single flicker lasting 1.6 seconds, and never blinks or pulses. With reduced motion it just appears lit. [prompt; style guide]
- On viewer screens, only the player shows a lit tally: the player bar, the mini player and the full player. Home's hero is "Preview, muted" and has no tally. Live programs in the guide say Live in red text, never with the tally. [home 01, 05]
- In master control the tally sits in the header and on the program monitor. Before sign-on it sits unlit above the Sign on button, so signing on is the tally lighting in the same place. [master control A5]
- A live source before its block shows the amber standby sign and a countdown, not the tally. [live-listings]

## Words

- **Copy is final.** Use the frames' words exactly: labels, empty states, notices and errors. Copy a frame doesn't have follows the style guide's Voice chapter and goes in `docs/apps/new-copy.md` for review. [prompt]
- **Broadcast vocabulary:** station, channel, call sign, tune in, presets, listings, sign on, spot, underwriting, carry. "Preparing for air", not processing. "Tuned in", not views. [prompt; master control A2, A7]
- **12-hour clock** ("8:00 pm"). Durations as `:30`, `28:30`, `1:02:15`. [prompt]
- **No exclamation marks, no emoji.** [prompt]
- **"Not set yet"** is how any undecided money line reads, at $0.00. It stays visible, so the page doesn't change shape the day the value is decided. [prompt; earnings 02]
- **States use the shared labels** in `packages/contracts/src/states.ts`: the business app and master control show each side's words for the same state, and they change together. [prompt]

## Numbers people see

- **Viewers never see audience numbers.** No view counts, ratings or trending in the viewer app or TV mode. The only counts a viewer sees are station counts (market picker), member counts (next to Pledge), and carriage counts ("Carried by"). [prompt; home 03, 08; station pages]
- **Stations see only their own numbers.** No leaderboard, and no other station's audience. Translators' counts are labelled as theirs and never added to "Tuned in". [earnings; offering 04]
- **Businesses see only their own results.** No benchmarks against other advertisers. Stations never see a business's balance, only a spot's runway in days. [biz results 01; biz funding 05]
- "Tuned in, added up" is never called reach or unique viewers. [biz results]

## Order and navigation

- **The dial is in channel order,** the same every time. There's no recommendation feed. The hero is the market's live programming first, never a pick by popularity. [prompt; home 01]
- **Numbers tune.** Typing a channel or frequency anywhere a viewer can type tunes to it: search's "Tune to" row, the TV keypad, the phone remote keypad. [prompt; station pages 03]
- **The radio band is on even tenths,** 88.2 to 107.8 (8, 8, 4 tunes 88.4; a dot fills the first one, 88. is 88.2). Real US FM stations are only on odd tenths, so a typed odd one (99.1) is never a station: it says "No station on 991" and names the nearest two, as any empty number does. TV numbers are Opencast's own and may match broadcast ones. [platform prompt, changed 2026-09-29; A139]
- **Keys on the web:** 1 to 6 tune presets from anywhere; the arrow keys change channel on the tuned-in page; `/` opens search; Esc closes search and returns you to exactly where you were. [prompt; home 01; station pages 03]
- **No scrub bar** except the syndication market's episode preview and production-order review, where a station or business is checking something rather than watching it. Players show a progress bar. [prompt; market 03; production orders 05]
- **Sign-in appears only** when someone saves, reminds or pledges. It names that action and completes it afterwards. There's no sign-in wall. [prompt; you 01]
- **Web vs phone:** on the web, modals; on the phone, sheets with the same content and buttons. On the phone, settings sections are screens with a back arrow, never modals. [home 07; you 06]
- **Toast with Undo** instead of a confirmation modal, where the pane already showed every fact: reminders, adding to the log, approving a request. [home 07; master control B3; offering 05]

## Money

- **What a business sets is what it pays.** Nothing is added on top. A card fee is Stripe's at cost, shown in dollars; bank and Clear show "No fee". [biz funding]
- **Warnings are in days,** not dollars. [biz funding]
- **Alerts that protect what's on air can't be turned off:** dead air for stations, "Spots about to pause" for businesses. They show a lock, not a toggle. [station settings 05; biz settings 04]
- **Neither choice leans:** when both options are legitimate (answering or removing a claim, Cue a break and Sign off on the phone), both are ghost buttons. [rights 02; master control P]
- **Sign on uses the ink button,** because it changes what goes out to viewers. [master control A5]

## TV (ten feet)

- Nothing is under 21px at 1080p. There's one focus ring at a time, in signal cyan. Everything sits inside the 90% title-safe area. [tv intro]
- D-pad spatial navigation, and never a keyboard: sign-in and payment hand off to the phone with a code or QR. [prompt; tv]
- Arrows ▲ ▼ on the picture change channel. Everything else is one press away. [tv 01]

## Access

- Every control is reachable by keyboard, with a visible focus ring. Every icon button has a label. Nothing depends on colour alone: states have words as well as colours. [prompt]
- Reduced motion turns off the tally flicker and other animation. The radio screen's burn-in drift is kept, because it protects the screen, but it moves only a few pixels a minute. [prompt; tv 05]
- Axe runs on every route in both grounds (Phase 9).
