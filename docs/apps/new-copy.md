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

### apps/control (Phase 4)

Sign-in reuses the reference's sign-in words; "Master control is where stations run their dial. Watching never needs an account." is new. Mock-only error messages (in `src/mocks/`) aren't listed. Undrawn screens (A47) are written in full in their files: the maker's order states (`pages/money/Orders.tsx`), a studio's spot rotation and carriers, the statements list, Station account (`components/earnings/StationAccount.tsx`), Ownership (`components/station/settings/`), the Carried tab (`pages/market/Carried.tsx`).

**Shell and start**

| Where | Words |
|---|---|
| Not your station | "That station isn't one of yours.", "Choose one of your stations, or start another.", "Your stations" |
| Not found | "There's nothing here.", "Back to master control" |
| No station yet | "Start a station", "Pick a channel in your market, fill a log from your library and the market, and sign on. Each step saves as you go." |
| A host's rail | "Hosts see their own live blocks" (A27) |

**On air: setup, the log, the Monitor, sign off**

| Where | Words |
|---|---|
| Station form | "White text on it reads at X:1. A station colour needs 4.5:1, so this one can't be saved."; "Write it as # and six characters, like #8C3B7A."; "Sound only."; "Open frequencies in the … Taken ones are struck through."; "X is taken"; "Three to five capital letters"; "Fixed since the first sign-on" |
| Fill | "Nothing in your library can air yet"; "{A} and {B} both fit this slot" / "{A} fits this slot"; "See what fits this slot in the market"; phone "Late Crate 11 to 15, until 2:00 am", "From HALL 90.7, barter", "Back at 2:00 am"; "Dead air now"; "Fill the gap" |
| Log toasts | "Filled … from your library.", "Off air from …", "Repeats every Saturday through …", "Repeats every day through …" |
| Ready to sign on | "… need(s) fixing before you can sign on.", "All N are done.", "Starts with X, on until T"; fixes "Fill it", "Go to library", "Choose", "Write it"; "Test signal" |
| Monitor | "{CALL} isn't on air yet. Finish setting it up, then sign on.", "Continue setting up", "Off air.", "Nothing is on the log from now.", "Nothing on the log", "Nothing in the market fits your open time right now.", "For live programs", "Break cued. Back to {title} after the break." |
| Rundown and log rows | "Nothing scheduled", "Repeats from your library if no one fills it", "Off air", "Viewers see "Off air" and when you're back", "Next" |
| Sign off | "Sign off {CALL}?", "{CALL} stops going out now. Viewers see "Off air" until you sign on again. The log stays as it is.", "Stay on air", "Sign off"; "{CALL} is off air", "There's nothing to sign off.", "Close", "Only an owner can sign off.", toast "{CALL} is off air." |

**Live and programming**

| Where | Words |
|---|---|
| Studio | "Stop sharing"; "{title} is going out until {time}." / "{title} ended at {time}. The log took over."; "On air: viewers see this picture."; camera: "Master control can't use the camera.", "There's no camera here.", "This browser can't use a camera.", "Allow the camera and microphone for this site in your browser, then try again.", "Connect one, or go live from another computer or a phone.", "Try again"; "Viewers see this until the connection comes back. Reconnecting." |
| Encoder block | "Not connected yet", "Nothing is arriving from the encoder.", "Receiving, 1080p from Studio A", "{Title}, from {source}", "{Source}'s signal, with BEAT's graphics as viewers will see them." |
| Live controls | "Break cued: 2:00 from the rotation, then back to you." / "From the rotation, then back to you"; "End {title} early?", "The log fills the rest of the block, until {time}. It never goes to dead air.", "Keep going"; "Battery at N%, about N min left at this rate."; "Show the lower third", "Hidden", "Add a speaker", "Ended" |
| Live blocks | "No live blocks coming up", "When you're given a live block, it's here.", "Live blocks in the log are listed in Live sources.", "That live block isn't on the log.", "That block isn't one of yours." |
| Rehearsal | "Rehearsal, from this browser", "A private rehearsal only you see, with BEAT's graphics as viewers would see them.", "Done" |
| Live sources | "On air", "No source", "Remove this source", "{name} is removed.", "{name} has a new key. The old one stopped working.", "Server copied." / "Streaming key copied.", "Copy it now: this key is shown once."; Add a source "Encoder" / "Browser"; Hosts: "Hosts", "Hosts go live on their own blocks, change the lower third and cue a break. They see nothing else.", "No host yet", "Who hosts {program}?" |
| Listings | "This week on BEAT. Every listing is complete.", "Local note", "From REEL. BEAT can add a local note.", "Nothing else airs today.", "Nothing is on the log this week." |
| Library | "Couldn't prepare it for air. Replace the file."; the upload and import toasts; "Link"; "It hasn't aired yet.", "Nothing scheduled", "On IPFS", "Not offered", "Can't be offered for carriage", "Nothing uses it", "Removing it deletes the file from the library."; the Export to IPFS dialog; "Uploaded {date}" |

**Market**

| Where | Words |
|---|---|
| Browse | "Show all", "No programs match these filters.", "N programs" / "N one-offs"; phone "1 program fits…", "1 more needs…", "No programs in the market fit this gap." |
| Toasts | "{Title} is in your log tonight at 11:40 pm"; "{Maker} has your request. {Title} goes in your log when they approve it."; "Crate Talk is offered. Stations can find it in the market."; "New terms saved. They apply to new carriers."; "…is no longer offered. Stations carrying it keep it until they end."; "Notice given. HALL carries Late Crate until October 5."; "Declined. NITE sees “Time slot”." / "…with no reason." |
| Program page | "Choose terms", "Fits BEAT's schedule", "A weak slot, from your audience", "No longer offered to new carriers.", "{Maker} doesn't offer it to radio band stations."; preview "The preview is still being made.", "Generated" / "From the maker" |
| Offer form | "{Title} terms", "Save terms", "Changes apply to new carriers. Stations carrying it keep their terms.", "Choose at least one deal.", "Up to 4:00, like 2:00.", "Set a price per airing, like $3.00." |
| Requests and carriers | "Decline NITE's request? NITE sees the reason you choose, never a note.", "No reason", "Back", "Picture and sound"; "End carriage", "End carriage with HALL?", "Give notice", "Keep it", "ends October 5", "Offer it again" |
| Place in the log | "Replaces: Nothing / One program", "2:00 of 4:00 an hour", "The second airing, within 30 days" |

**Spots: breaks, the spot market, orders, sponsors**

| Where | Words |
|---|---|
| Breaks | "No open time across N breaks."; "Nothing in it yet", "Both spots", "X and Y (backup)"; "Airing now", "Airing"; "The 8:44 pm break", "{context}. 2:00 long.", "Your rotation" / "Backup rotation", ", just added", "What fills this break shows once it's scheduled."; "No breaks tonight. Breaks come from your break rule in Settings." |
| Breaks toasts and notices | "3 spots added. They start in the 8:44 pm break."; "{Business} added. It starts in the {time} break."; "They air when there's open time."; "{Spot} is back in your rotation."; "Your station ID and bumpers fill it."; "Its balance ran out." / "{short} added money." |
| Spot market | "Never on BEAT: …. Change in Settings", "Nothing matches. Try a wider distance or another length.", "No businesses have listed spots near {CALL} yet."; "Budget", "No daily limit"; "Take out", "Add it back", "{short} paused it. Your backup rotation fills its time."; "The preview is still being prepared. The still is what viewers see first."; the rotation tab's lines ("Add a backup", "Add from the market", both empty states) |
| Orders | "Not quoted", "your price"; "The spot", "Deliver", "Deliver a new version", "Notes", "Reply", "Add the note", "We'll tell you when it's listed."; toasts "Quote sent to …", "You passed. … is told, and offered the other makers.", "Delivered to …" |
| Sponsors | "The business sees the reason:", "Keep it", "N more requests after this one."; "Starts Oct 1", "Doesn't renew", "Stop renewing", "It ends with its paid month", "No sponsors yet."; "Your credit, as it airs", "The credit, as it airs", "Full screen, :10 to :15, before the station ID."; toasts "{Business} approved.", "{Business} declined: {reason}." |
| Sponsorship settings | "Saved.", "Only BEAT's owners change minimums." |

**Earnings and audience**

| Where | Words |
|---|---|
| Earnings | "No airings yet", "No sponsors yet", "{n} sponsors", "Production", "Spots you made", "{n} orders for businesses", "No airings held", "Available now.", "Available now. Payouts start once you finish setting up where you're paid.", "Finish setting up", "Stays in Clear until it's moved", "This week so far" / "2026 so far", "new this week" / "new this year" |
| Move to bank | "Up to $X is available.", "Amount", "To", "Left available", "Arrives", "Held money isn't included. It becomes BEAT's when each airing runs.", "Move $X", "Enter an amount to move.", "Your bank", toast "$X is on its way to Chase ending 2231." |
| Statements | "Every weekly payout, with the airings and lines behind it.", "Week", "Paid out", "No statements yet. The first comes the Monday after a week of earnings is paid out.", "That statement wasn't found.", "Total" |
| Audience | "This week's peak, Saturday at 8:36 pm", "September's peak, September 19 at 9:40 pm", "Hours watched this week" / "in September", "Hours listened…", "Listeners with HALL as a preset", "Airings", "Live", "Nothing has aired yet tonight" / "this week" / "this month", "Last {weekday}"; phone "Peak this week" / "Peak this month N, {day} at {time}" |
| Station account | "Available now. Earnings settle here after each airing", "Payouts", "Weekly, to Chase ending 2231. Next on Monday, September 28", "Not set up yet. Earnings stay in Clear until they're moved", "None scheduled. Earnings stay in Clear until they're moved", "Paid out this month", "Finish setting up where BEAT is paid", "Until then, BEAT's earnings stay in its Clear account.", "Only owners move money or change where BEAT is paid." |

**Station: settings, translators, rights, claiming, the switcher**

| Where | Words |
|---|---|
| Identity | the failing-colour and hex lines (as the station form), "Only the owner can change BEAT's identity.", "Set until the first sign-on, then fixed", the logo hint |
| Breaks settings | "No backups yet", the arrow-key reorder hint |
| Team | the invite errors, "Invited today", "Expires tomorrow" / "today" / "Expired", "Remove from BEAT", the team toasts |
| Notifications | the web lede |
| Ownership | all of it (A47) |
| Translators | the Connect and Add forms, their errors and toasts, "relaying", "turned off" |
| Switcher | "Off air", "Owner. Studio" |
| Rights | "No claims about anything BEAT has aired.", the "offers paused" standing, the operator note, the answered and closed timeline lines, the remove confirmation, "Choose a file", the phone's "finish on a computer" line, the send blockers, the toasts. Every claim word is in `components/station/claimWords.ts` |
| Claiming a station | the verifying, waiting, completed and stop states; the wrong-account line; the stop dialog |
