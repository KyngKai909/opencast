# New copy for review

Copy in the reference frames is final. Words the frames don't have are written in the style guide's Voice chapter and listed here for review. Each entry says where it appears, which state or screen needs it, and the words used. Nothing ships in an app without an entry here.

Phase 0 found where new copy will be needed. The words are added as each phase builds its screens.

## Needed (found in Phase 0)

### Viewer
- Settings panes with no frame: Account, Market, TVs and casting, Appearance, Privacy, Your data. Only Watching (web) and Notifications (phone) are drawn.
- Empty states:
  - You: no presets, reminders, pledges or TVs;
  - search: no results, and a number that matches no station;
  - You when signed out with no presets on the phone.
- Pledge errors: an amount below $1.00, a failed or expired card.
- Tuned in: the station is off air, or has no signal.
- First visit: a ZIP outside every market, location denied, an invalid ZIP.
- Share: an airing that's over.
- Permission page: the creator said no, the link is bad or expired, the creator stopped it.

### TV
- Settings sections with no frame: Remote and phones, Picture and sound, Account, About this TV.
- The reminder card at the start time. Its words are in a note only: "Beat Tape Live is starting on BEAT 12.1. OK to switch."
- Sleep timer: the fade notice with "30 more minutes".
- Sign-in: the code expired, and the hand-off when Remind me or Save this channel is pressed while signed out.
- A station's info ("About Inland Beat"), stand by, changing market.
- Settings footnote: a signed-out variant of "Saved to your account, so your other TVs use them too".
- Chips: a signed-out fallback for "Playing from Kai's phone".

### Master control
- Production orders, maker side: delivering, the notes on a scrub bar, "our mistake", disputes.
- A carriage request waiting for the maker's approval (B.3).
- The market:
  - a preview that isn't ready yet;
  - no programs fit;
  - offers paused by a station's rights standing.
- The offer form: a radio-band switch, a cash unit, the window in days.
- Carriers: giving notice and ending.
- Breaks: a paused spot with no backup rotation.
- Rights: a claim with no answer that counts as removed; answering on the phone with a file.
- A host's view of rail items they can't open.

### Business
- Upload: a check that blocks (wrong length or picture).
- Targeting: no stations match.
- The balance: a bank transfer that arrives after the spots have paused, the `paused_balance` page, a quote the balance can't cover.
- Errors: a code that's invalid, used before or expired; a statement with no activity yet.
- Checks and credit flags: the "!" marks are icons with labels, not text.

### Desk
- Pages with no frame: Catalog, Rights claims, Reserved call signs, Catalog sponsors, Settings.
- Forms and pages: Add a creator, List a source, a creator's detail page, sign-in and not-an-admin.
- Stage tags: Setting up, No answer.
- Held earnings statuses: On air, Claim pending, Claimed, Stopped.

### Site
- Waitlist errors: invalid or missing ZIP, call sign taken or invalid, network error.
- The success message for a ZIP outside every market.

## Written

### packages/ui (Phase 1)

Words the components say that no frame shows. Screen-reader-only words are marked (spoken).

| Component | Words | Where |
|---|---|---|
| Tally | "On air", "Not on air", "Stand by", "Off air" (spoken) | The sign's accessible name; the visible words are the frames' ("ON AIR", "STAND BY", "OFF AIR") |
| Notice (standby) | "Needs attention." (spoken, before the notice) | Master control's frames use the phrase on screen |
| Toggle (locked) | "Always on" (spoken) | The frames use it as row text |
| AmountPicker | "Other amount" | The label of the Other field |
| Menu | "More" (spoken) | The "···" button |
| Timeline, StepRail | "Done: ", "Not yet: " (spoken) | Before each step |
| Checks (sign-on) | "Ready", "Needs attention" (spoken) | Each check's state |
| Checks (upload) | "Fine", "Fixed", "For you" (spoken) | From the frame's summary words ("4 fine, 1 fixed, 1 for you") |
| Movements | "When", "What", "Amount" (spoken column heads) | The table has no visible header in the frame |
| LineChart | "Time", "{value}, {series}" (spoken table heads) | The hidden table of the chart's numbers |
| Runway | "Auto top-up is on.", "about 1 day" | The singular of the frame's "about 44 days" |
| Station switcher | "Switch station" (tooltip) | The header's station button |
| Business switcher | "Switch business" (tooltip) | The header's business button |
| PlayerBar | "Play" | Pause, while paused |
| PlayerBar, MiniPlayer | "Player" (spoken); "Open player, {title}, {station}" (spoken) | The player regions and the mini player's open button |
| ShellSteps | ", done" (spoken) | After a finished step |
| DialRow | "Off air" (title), "Signs on again at 6:00 am" | An off-air row; the words are the style guide's slate |
| DialRow (radio band list) | "You're here" | The row you're tuned to, instead of a lit tally (open question A2); the words are the carried-from modal's |
| ProgressBar | "{h} hr {m} min left" | An hour or more left (the frames only show "18 min left") |
| BreakBar | "Under barter" | Barter time with no maker named |
| Broadcast (spoken) | "Tune in to BEAT 12.1: {title}", "BEAT 12.1, Inland Beat: station preview", "On now: ", "On air: ", "Break 2:00, 8:28 to 8:30 pm", "Dead air", "Position", "Radio band", "Preset 2, empty: add", "Preset 1, BEAT 12.1", "7, taken", code names "Program", "Spot", "Underwriting", "Bumper", "Station ID", "Open" | Row, slider, scale, key and channel names for screen readers |
| ShellRail (host) | A disabled item's reason, e.g. "Hosts see only their live blocks" (tooltip) | Rail items a host can't open (open question A6) |

Styles with no frame (no new words): a field's error line (standby amber, with the warning sign), disabled controls (faded), the tooltip, and destructive menu items (live red, like the settings' danger links).

### packages/player (Phase 2)

| Where | Words | Note |
|---|---|---|
| Paused | "Paused" (tag on the picture) | Not drawn; "Back to live" is the note's own words |
| Autoplay refused | "Tap for sound" | When a browser won't start with sound |
| Sleep timer fade | "Turning off in a minute.", "30 more minutes" | The note says the fade offers 30 more minutes; the first line is new |
| Number entry, no station | "Nearest: 7.1 CIVC, 12.1 BEAT" | The note says "No station on 13" and the nearest two; "Nearest:" is new |
| Banner, a station off air | "Off air" as the title | From the style guide's slate |
| Hint row, casting or mirroring with no name | "Playing from a phone", "Mirrored from an iPhone" | When the phone's name isn't known (signed out) |
| Spoken | "Channel 12.1"; "BEAT 12.1, Inland Beat: Saturday Reel"; "On air", "Not on air" | The panel and banner for screen readers |


### apps/viewer (Phase 3)

Settings' undrawn panes (Account, Market, TVs and casting, Appearance, Privacy, Your data) are written in full in `apps/viewer/src/components/settings/panes.tsx`; review them there. Everything else is below.

**Home, first visit, the radio band**

| Where | Words |
|---|---|
| Hero, nothing live | "Nothing is live in {market} right now. Your market's stations are below, in channel order." |
| Hero kickers | "Carried from {BEAT 12.1}", "Preset 1" |
| Category chips, no match | "Nothing on the dial is live right now.", "Nothing on the dial is in {Category} right now.", "Show all stations" |
| Empty band | "No stations on the TV band yet."; radio: "No stations on the radio band here yet. Open frequencies run from 88 to 108." |
| Reminder done | "Reminder set" (web), "Set" (phone) |
| Day labels | "Today", "Tomorrow", "Yesterday", "Mon, Oct 5" |
| Preset key sheet | "Preset {N}", "Choose a station for this key.", "Remove {CIVC 7.1}" |
| Thin market | "No stations so far", "{N} channels from 2 to 69 are open." |
| Market picker | "Enter a five-digit ZIP code."; "{ZIP} isn't in a market yet. The nearest is {market}, {N} miles away. Pick it below, or any other."; "There's no market near you yet. Pick the nearest one below, or enter a ZIP code."; "Location is off for this site. Enter a ZIP code or pick a market instead."; "Your location couldn't be found. Enter a ZIP code or pick a market instead."; "Not open yet" |

**Tuned in, the guide, the preview, pledge, share**

| Where | Words |
|---|---|
| Off air | "Off air", "{CIVC 7.1} signs on again at {6:00 am}."; preview: "Signs on at {6:00 am}" |
| Unknown station | "That station wasn't found.", "Back to the dial" |
| Controls | "Play", "Mute", "Unmute"; spoken "Down is {X}, up is {Y}" / "Down is {X}, up wraps to {Y}" |
| Share link, not started | "{Title} starts at {9:00 pm} on {BEAT 12.1}.", "Remind me" |
| Share link, ended | "{Title} has ended. {BEAT 12.1} is on now.", "OK"; share sheet: "{Title} has ended, so this shares the station." |
| Guide, presets filter | "None of your presets are on the TV band." (and the radio band) |
| Carried from | "In your market:", "No station in your market has it on the schedule.", "1 station carries it" |
| Pledge | "Enter an amount in dollars, like 12.50.", "Pledges start at $1.00.", "$20.00 goes to Inland Beat, once.", "Your name on air", "Stations read it as you write it.", "Pledge $10.00 and go back" |
| Pledge toasts | "Pledged $10.00 a month to Inland Beat", "Pledged $20.00 to Inland Beat" |
| Share | "{Title}, on now" / "tomorrow at {time}" / "{Weekday} at {time}", "On BEAT 12.1 now", "On Opencast", "BEAT 12.1, Redlands", "Link copied", "Couldn't copy the link. Select it and copy it instead." |

**Station, program, search**

| Where | Words |
|---|---|
| Station page | "In your presets", "Nothing is listed for this day yet.", "Nothing else tonight.", "Off air", "Listed from the city's stream", "Back to the dial" |
| Program page | "Not scheduled yet", "Not scheduled in your market yet.", "Aired", "Tonight at {time}" / "Today at {time}", "Program" (phone back bar) |
| Search | "Type a channel, a call sign or a program."; "Nothing on the dial matches “{x}”. Try a call sign, a channel or a program's name."; "No station on 13", "Nearest: 9.1 RDLS and 12.1 BEAT"; "On now, until {time}"; "live now" / "on now" (phone rows); "Enter" and "Off air" on the Tune to row |
| Spoken | "Loading the station", "Loading the program", "Searching", "Preset {N}. Open presets", "Remind me: {episode}" |

**Sign-in, You, presets, pledges, settings**

| Where | Words |
|---|---|
| Sign-in | "Enter your email address, like name@example.com."; "We sent a new code to {email}."; "One thing before you go back to CIVC." / "…before you go back."; "Keep what's on this device" (web); "Done" (sign-in from the header) |
| Kept on the device | "CIVC 7.1 saved on this device", "Reminder set on this device for {title}, {time}" |
| Presets | "You have {N} on this device. Keep it/them on your TV too."; "Stations saved with no key are kept here."; "Move left", "Move right", "Remove"; "{X} moved to key {N}"; "Removed {X} from presets"; "{X} is on key {N}[. {Y} moved to More presets.]"; "{X} saved to More presets"; "Key {N}" / "Free" |
| You | "Nothing coming up. Press Remind me on anything in the guide."; "No pledges yet. Pledge from a station's page, monthly or once."; "Since June", "Ends after September"; "Keys 1 to 6 on the web, your phone and your TV."; "Reminder removed for {title}, {station}"; "{TV} is signed out"; "{station}, on air" / "off air" |
| Add a TV | "Open Opencast on the TV. It shows a code; enter it here.", "Code on the TV", "Sign in the TV", "The code on the TV has six letters and numbers.", "The TV is signed in" |
| Manage a pledge | "It won't be charged again after {month}."; "Add the name stations call you in Settings, Account, first"; "{card}, expired"; "Keep pledging"; "Ends", "After {month}. You won't be charged again."; "Hide"; "Your pledge to {station} is saved" |
| Receipt | "on {date}", "Amount", "Once"; "{Station} says pledges to it are tax-deductible" / "aren't tax-deductible" / "hasn't said whether pledges to it are tax-deductible" |
| Settings, signed out | "These apply on this device until you sign in.", "Saved on this device until you sign in."; "In this browser" (web Notifications); the note when the browser blocks notifications |
