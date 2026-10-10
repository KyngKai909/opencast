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

Settings' undrawn panes (Account, Market, TVs and casting, Appearance, Privacy, Your data) are written in full in `apps/web/src/viewer/components/settings/panes.tsx`; review them there. Everything else is below.

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
| Station page | "In your presets", "Nothing is listed for this day yet.", "Nothing else tonight.", "Off air", "External, the city's own stream" (was "Listed from the city's stream"; station-pages 03 now says "external, the city's own stream"), "Back to the dial" |
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
| Statements | "Every weekly payout and each month's usage, with the airings and lines behind them." (was "Every weekly payout, with the airings and lines behind it.", 2026-09-30), "Statement" (was "Week"), "Paid out", "No statements yet. The first comes the Monday after a week of earnings is paid out.", "That statement wasn't found.", "Total" |
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

### apps/business (Phase 5)

Sign-in reuses the reference's words; its foot line "Local spots on local stations, paid for only when they air." is new. Mock-only panels (the station's answers, spending a budget) and mock error messages aren't listed. Screens no frame draws are written in full in their files: Close account (`components/settings/CloseSection.tsx`), the web Add money modal (`components/money/AddMoney.tsx`), the order states after a quote (`pages/deals/Order.tsx`), the redeem states other than "good" (`components/results/CheckResult.tsx`).

**Getting started and money**

| Where | Words |
|---|---|
| Step 1 | "Choose one"; preview "Your business", "Category and town"; service area "Town", "mi", "Used to target by distance. Stations see the town you work from."; online "Stations see "Online". Your spots can air across the markets you choose."; errors "Say what the business is called.", "Choose a category.", "That doesn't look like a web address.", "Give the address customers come to.", "Give the town you work from.", "Between 1 and 200 miles.", "Choose at least one market."; reach "{6} of {8} stations can carry {alcohol}", "…PREP and HALL don't carry it.", "No station in the {Inland Empire} carries {x} yet"; "Connected" |
| Step 2 | "Instant, from 0x1234…abcd", "Shared read-only: money is added inside Clear", "Not available here yet"; "Add $250 by card", "Add $250 from your Clear account", "Connect Clear", "Confirm in Clear", "Continue"; "Add at least $1.00."; "Auto top-up didn't turn on. You can turn it on from the balance."; "Go to the balance"; "At $4.00 an airing, $250 is roughly 62 airings." / "$250 is roughly 62 airings." |
| Balance | "Today", "less than a day", "No airings yet this month, so there's no pace to go by."; "Nothing held for scheduled airings", "{Name}. No spots listed yet."; "Nothing yet. Money you add, and every airing, shows here.", "Nothing of that kind yet.", "Show earlier"; "Nothing linked yet"; "By card", "From your Clear business account", "Arrives tomorrow / today / {October 5}"; "At about $9.20 a day, what's available lasts until {Monday evening}, before this arrives. Your spots pause then, and resume when it does." |
| Add money | "Add a way to pay first, in Settings.", "The owner hasn't added a way to pay yet."; "$7.55 fee, Stripe's at cost"; "From Clear", "Not connected yet", "Shared read-only", "Clear shares your account read-only, so money is added inside Clear. Send USDC to your balance at this address, and it's available once it arrives."; "$250 is in your balance", "Undone. The $250 won't be added." |
| Take money out | "Type an amount, like $300.00.", "That's more than is available.", "{$0.00}, nothing scheduled", "What's left is under a day of airings, so your spots pause and stations are told. They resume when you add money.", "$300.00 is on its way to {source}" |
| Movements | "Added by card", "Card fee" / "Stripe's fee, at cost", "Added from Clear" / "From 0x…", "Taken out" / "To {source}" |

**Results and redeeming**

| Where | Words |
|---|---|
| Periods and empties | "All spots, August 1 to September 26.", "All spots, September 20 to 26."; "Nothing has aired this month. Spots air once stations put them in their breaks.", "Nothing has aired yet.", "This spot hasn't aired yet."; "In a break" |
| Proof | "…, :12 of :30"; "175 × $8.00 ÷ 1,000, for :12 of :30 = $0.56"; "$4.00 an airing = $4.00"; "No frame was captured for this airing. The log entry below is the record." |
| Codes | "Codes used at checkout online. Counted automatically"; "Connect Clear Pay to count codes used at the counter by themselves"; "{CODE} isn't one of your codes."; "Codes and customers aren't available yet."; "Change the offer", "{CODE}. Customers see it when they save the offer.", "Offer changed for {CODE}." |
| Statement | "Ended the month"; "{Business}. August 1 to 31."; "None this month"; "Card fees, Stripe's at cost"; "Taken out", "Made for you", "Refunds"; "That statement wasn't found."; "Your first statement starts with the first money you add." |
| Redeem | "{CODE} isn't one of your codes. Check it with the customer."; "This customer used {CODE} on {Saturday, September 26}. It's once per customer."; "This saved offer ran out on …"; "It won't count as a customer: no airing in the last 7 days."; "Type another code", "Type a code instead"; "Hold the customer's screen up to the camera."; "Redeem is off for this business. Turn it on in Settings to mark codes used at the counter."; "Redeemed ORANGE10, 10% off."; "Online uses are counted by themselves." |

**Sponsorships and Made for you**

| Where | Words |
|---|---|
| Toasts | "Sent to BEAT.", "Sent to BEAT for a quote.", "$140.00 held for Holiday gift cards.", "{title} is in your Spots now.", "Sent to Opencast for review.", "BEAT said no: We're full.", "Cancelled. $X is back.", "It ends with its paid month, {date}.", "Ended." |
| Empties | "No sponsorships yet.", "No orders yet. A station or Opencast's studio can make your first spot.", "Nothing near you takes sponsors yet." |
| New sponsorship | "Write your credit to send.", "Choose what to sponsor.", "Checking your credit.", "Enter the amount a month.", "BEAT's minimum is $75.", "Your balance can't cover the first month. Add money to send.", "Fix the flagged phrase to send."; the price flag ""10% off" is a price or an offer" / "Credits don't carry prices or offers. That belongs in a spot"; "…, full"; "BEAT's reason: We're full." |
| A sponsorship | "Held next", "Ends", "Reason", "Withdraw it before BEAT answers.", "Ending stops the renewal. It ends with its paid month." |
| Orders | "Not quoted", "Cancel the order", "Accept BEAT's quote", "Ask another maker", "Set a rate and budget", "Cancel and get $X back"; "Asked {date}. BEAT quotes here before anything is paid.", "BEAT passed on this one…", "BEAT is making it…", "With Opencast for review…", "Held from your balance"; "Your available balance is $X. Add money to accept."; "Give it a name.", "Say what it's about.", "Pick a date.", "Pick a date after today." |
| Review | "Pause where something's wrong and pin a note to that moment.", "A note at :06", "Pin it", "BEAT marked it their mistake. It doesn't use a round.", "Ask for the fixes", "Ask for changes, using your last round" / "1 of your N rounds", "Ask Opencast to review it" |

**Settings and the switcher**

| Where | Words |
|---|---|
| Team | "Only the owner changes the team."; "Invited today", "Invite expired", "Viewer. Invited Friday"; "Make them a manager", "Make them a viewer", "Remove from {business}", "Resend the invite"; "{name} is now a manager" / "…a viewer", "{name} no longer has access to {business}", "Invite sent to {email}", "Invite sent again to {email}"; "{email} is already on the team.", "{email} already has an invite waiting. Resend it from the list.", "Enter an email address." |
| Profile | "Only the owner and managers change the profile."; the service-area and online where-lines; "Add a second location. Spots can target either or both", "Another location?", "Spots can target any of your locations"; the category re-check notice; the logo, address and location errors; the location dialog ("Add a location" / "Add a service area", "Name it", "Optional", "Address", "Private. Stations see the city", "Miles around it") |
| Money and receipts | "Nothing connected yet", "Add money from the Balance page to connect a bank or card"; "On. Adds $200.00 from Chase ending 8810 when about 3 days of airings are left"; "Make default", "Not set"; "That's your default. Make another one the default first."; "An EIN is nine digits, like 12-3456789."; "No receipts yet. Adding money, orders and each month's statement are listed here."; "Add as a source" |
| Connections | "Only the owner connects or disconnects these.", "Not connected", "Connect Clear isn't set up here yet.", "Connect Clear", "Waiting for Clear", "Disconnect", "{0x1234…abcd}. Linked Sept 26", "Payouts and withdrawals can go here. Money is added inside Clear." / "You can also add money from Clear. You confirm each transfer in Clear."; "{Square} is connected. Codes used online are counted too", "Connecting isn't available here yet." |
| Close account | all of it (see the file) |
| Switcher and invites | "Your businesses", "Add a business"; "That invite didn't work." |

**Connect Clear in master control (Settings, Station account)**

| Where | Words |
|---|---|
| Your Clear wallet | "Your Clear wallet"; "Connect Clear isn't set up here."; "Link your Clear wallet to pay {BEAT} out to it. You approve it on Clear's page, and Clear decides what it shares."; "Clear wallet, 0x1234…abcd"; "Full access: payouts can go here, and you confirm any transfer in Clear" / "Read only: payouts can go here. Money moves inside Clear"; "{BEAT} is paid out to this wallet" / "{BEAT} is paid into its Clear account"; "Pay {BEAT} out here", "Pay into {BEAT}'s Clear account instead", "Disconnect"; toasts "Clear is connected.", "Clear is disconnected.", "{BEAT} is paid out to your Clear wallet." |
| Earnings, ads from partners on | "{$12.50} to come. Paid when partners pay, 30 to 90 days after airing" |

**Spots (the business side)**

| Where | Words |
|---|---|
| New spot | "Upload the finished spot. Opencast checks it will air cleanly and adds its code; then you set a rate and a budget."; "The spot", "Choose the file" / "Choose another", "A :15, :30 or :60 video"; "It's checked the moment it arrives: length, picture, safe areas, captions and loudness. Opencast adds its code and QR."; "Upload and check" / "Uploading and checking"; "Shrunk to fit" / "The whole spot is slightly smaller, so everything is inside title safe"; "Choose the same file again to shrink it"; "The length or picture won't air as it is. Upload a new cut to go on." |
| Code | "Change the code", "Customers scan it or type it, and save the offer.", "What customers get: 10% off, a free pastry", "3 to 16 letters and numbers" |
| Rate page | "Enter a rate, like $8.00", "Enter a budget, like $300.00", "Enter an amount, or leave it empty for no cap", "The most per day can't be more than the total"; "No cap", "About N airings in all.", "Listing needs a day of budget available, $12.00. Add money first."; "Choose at least one kind of station.", "Choose at least one time of day.", "Markets"; "No stations will see it yet", "Try a wider distance, or more kinds of station"; "every kind", "any time of day", "farther than N mi", "left out" |
| A spot | "Raise the budget"; "Pause {title}", "Stations are told and fill its time. Bring it back when you like", "Pause it"; "End {title}?", "…and it can't be listed again.", "Keep it"; "That's more than your $X available. Add money first, or raise it by less."; "{title} is paused until you add money.", "Your available balance is under a day of airings…", "Add money and it's back in the market by itself…"; "You paused {title}."; "It comes back by itself at midnight."; timeline "Balance under a day of airings", "Still to air", "1 airing already held still airs", "No station had it in rotation", "Won't be told" |
| List | "No spots yet. Upload one and Opencast checks it will air cleanly, then you set a rate and a budget." (phone "No spots yet."); phone tags "Budget spent", "Balance", "Back"; "Its $300 budget is spent", "Not listed yet", "Not uploaded yet"; "In rotation on 1 station" |
| Viewers | "…Spots are run by the owner and managers." |

### apps/tv and the phone remote (Phase 6)

TV screens no frame draws follow the drawn ones' pattern: About a station, choosing a market, four of the five settings sections, the reminder card, stand by, after the sleep timer. Mock-only switches and mock error messages aren't listed.

**TV: watching and menus**

| Where | Words |
|---|---|
| Menu rail | "Sleep timer", "Off", "Until 12:22 am"; "TV band" (on the radio band); "Pledge" with the station's name; "Sign in" (signed out) |
| Off air | "CIVC 7.1 signs on again Tuesday at 7:00 pm." (more than a day away); "CIVC 7.1 is off air." (no sign-on time, nothing else on) |
| Stand by | "CIVC 7.1 is waiting for its signal. BEAT 12.1 is on now." (under Slate's "Please stand by") |
| Reminder card | "Beat Tape Live is starting on BEAT 12.1. OK to switch." (from the tv 02 note) |
| Sleep timer | "It's 11:52 pm. Turning off at 12:22 am." (a timer already set); after it: "Turned off by the sleep timer.", "OK to watch again." |
| Presets strip | "Off air" on a key |
| Pledge | QR label "A code that opens BEAT's pledge on your phone" |
| Casting chip | "Playing from a phone" (signed out); "Mirrored from an iPhone" (no name) |

**TV: the guide**

| Where | Words |
|---|---|
| Guide | "Tune in" (the OK hint on something on now); cells "Off air", "Signs on at {time}" |
| Options | "Off air now" (Tune detail); "Reminder set" / "OK to remove"; "Switching over at {9:00}" / "OK to turn off" |
| Signed out | "Reminders are kept with your account. Sign in on your phone, and this one is set for you.", "Sign in on your phone", "Not now" |
| About | "On now", "Next at {9:00 pm}", "Tune to {CALL} now", "Pledge to {station}", "About the station" (loading) |

**TV: settings and sign-in**

| Where | Words |
|---|---|
| First launch | "That code ran out, so here's a new one. Scan it, or go to useopencast.org/tv and enter:"; "Your market: {name}. Change it any time in the menu."; "No market is open near this TV's connection yet, so it's showing {name}. Change it any time in the menu." |
| Settings line | "Saved on this TV. Sign in to use them on your other TVs too." (signed out) |
| Watching | Captions "Off", "On", "Muted only"; Caption size "Small", "Medium", "Large"; "Down the dial" / "Down the dial, 9.1 to 7.1"; "3 seconds", "8 seconds"; "1 second", "1.5 seconds", "3 seconds" |
| Remote and phones | "Who on the Wi-Fi can change the channel" / "While a phone is playing to this TV" / "Any phone", "The phone that started"; "Open the menu" / "On a remote without a Menu key, press ▶" / "Menu" |
| Picture and sound | "Picture quality" / "Auto follows your connection" / "Auto", "Data saver", "Best"; "Even out the sound" / "So one station isn't much louder than the next" |
| Account | "Signed in as" (the email as help); "Sign out of this TV" / "Your presets and reminders stay on your account"; "Not signed in" / "Signing in adds your presets, reminders and pledges from your phone"; "Sign in" / "With a code, on your phone" |
| About this TV | "Version", "Your market", "This TV"; "Opencast app on Fire TV", "Web browser", "TV browser" |
| Market | "Your market", "{n} stations", "OK to choose, Back to close", "No markets are open yet." |

**Phone: casting and mirroring**

| Where | Words |
|---|---|
| Watch on | "Playing here" (This phone, not casting); "Open the remote"; "Watch on this phone"; "Connecting to {TV}"; "Cast to {TV}", "Mirror to {TV}", "Open the app on {TV}"; "A TV with Chromecast", "Cast to a TV", "Opencast app"; "No TVs found on this Wi-Fi." |
| Can't cast | "Casting isn't available here.", "Casting isn't available in this browser.", "Casting didn't start." |
| Mirroring | "Turn on Screen Mirroring and choose {TV}." (toast), "How to turn on Screen Mirroring"; "Battery: {n}%, charging." |
| Remote | "{name} changed the channel."; "Remote" (no TV); "Not casting", "Choose a TV with the cast button on the tuned-in page.", "Choose a TV" |
| /tv | "Done" after "The TV is signed in" |

### apps/site (Phase 7)

The waitlist's words the reference doesn't draw, and the tuner's number entry (the rules' "Numbers tune"; the reference's tuner has only channel up and down). The headline after joining is the API's `message`.

| Where | Words |
|---|---|
| ZIP code | "Enter your ZIP code." (empty); "A ZIP code is five digits." (fewer) |
| Call sign, live check | "{CS} is free." (as master control's station form says it); "{CS} is taken. Try another." (the API's 409 words, shown as it's typed too); "A call sign is three to five letters." (one or two letters) |
| Waitlist, can't send | "We couldn’t reach Opencast. Check your connection and try again." Other API errors show the API's own message |
| Joined, station without a call sign | "We’ll write when your market opens." (the reference's station paragraph promises a held call sign) |
| Joined, ZIP outside every market (`market: null`) | Viewer: "Your ZIP isn’t in a market yet. We’ll write when a dial opens near you."; station with a call sign: "Your ZIP isn’t in a market yet. We’ll write when one opens near you, and your call sign is held until then."; station without: "Your ZIP isn’t in a market yet. We’ll write when one opens near you." Producer and business keep the reference's paragraphs |
| Joined, viewer, market already open | "The {market} dial is already on. We’ll write when there’s more to watch." |
| Joined, viewer, market not open | "We’ll write when the {market} dial opens." (the reference's static "the Inland Empire dial", with the response's market name) |
| Tuner, a number with no station | "No station on 13" (the viewer app's words) |

### apps/desk and the creator's permission page (Phase 7)

The frames' words are used as drawn. Below is what they don't have. Mock-only panels (the creator's side under the pipeline) and mock error messages aren't listed. The permission page's words, drawn and new, are all in `apps/web/src/viewer/components/permission/copy.ts`, versioned for the lawyer (open question 15).

**Desk: signing in and the frame**

| Where | Words |
|---|---|
| Sign in | "Sign in to Network desk"; foot "Opencast's own tool for building a market. For the Opencast team only." |
| Not on the team | "This desk is for the Opencast team."; "You're signed in as {email}, but that account isn't on the team. If you run a station, master control is where you run it."; "Sign out"; the API's 403 "Network desk is for the Opencast team." |
| Couldn't check | "Network desk didn't open."; "We couldn't check who you are just now. Try again in a minute." |
| Rail (screen readers) | "{4} yeses to set up", "{1} not on the dial yet" (was "not listed yet"), "{$227.00} held", "{26} reserved"; the avatar "{Dee A.}: settings" |
| Not built yet | "This page isn't designed yet. It comes after the pages the desk needs first."; Catalog "Opencast's own programs: the public-domain catalog every station can carry."; Rights claims "Claims against programs on any station, and the answers."; Catalog sponsors "Businesses that sponsor the catalog station's programs." |
| Not found | "There's nothing here.", "Back to the market board" |
| Settings | "Your own settings for Network desk, on this device."; "Appearance", "Ground", "Dark is the default. The system setting decides unless you choose here.", "System", "Dark", "Light"; "You", "Signed in as {email}. On the Opencast team.", "Sign out" |
| Reserved call signs | "{26} call signs reserved from the waitlist in the {Inland Empire}, {4} with a channel held."; columns "Call sign", "Channel held", "Held until", "Asked", "From"; "None yet"; "Nobody in the {market} has reserved a call sign yet." |

**Desk: the board**

| Where | Words |
|---|---|
| Stats | nothing airing "Off air" / "Nothing airs here tonight yet"; one "Claimable station on air, waiting to be claimed", "Creator who said yes, not set up yet"; none "Stations with dead air coming"; a market with nothing "No stations yet." |
| Selected slot | "Claimable. {Mojave Field Recordings}'s work is published under {CC BY 4.0}. Recipe set, signs on …"; "Claimable. {name}'s station is being set up"; "Claimable, on air. {name}'s station, waiting to be claimed"; "Independent station. {Inland Beat}, {Redlands}"; "Opencast catalog. {Opencast Classics}"; "Listed city streams: 9.1 RDLS, 9.2 COLT, 9.3 SBCO" (and a row each); "Listed city stream. {name}"; "Held for the waitlist. {TACO} asked for this number, so nothing else goes on it"; "Open. No station, and nobody on the waitlist has asked for it"; buttons "Listed sources", "Reserved call signs"; nothing chosen "Choose a channel" / "See what's on it, who it's for, and where to go next" |

**Desk: the pipeline and asking**

| Where | Words |
|---|---|
| Tags | "Setting up" (standby), "No answer" (dashed), from states.ts |
| Next | "Waiting for an answer"; "Reminder due {Oct 1}"; "Reminder overdue since {Sept 24}"; "Reminded {Sept 26}. No more after this"; "No answer after the reminder"; "Don't ask again" (found, do not ask); "On air with credit"; "Set up with credit, then invite them to claim"; "Set it up from a recipe"; "Setting up"; "Claim invite sent {date}"; "On air. Waiting to be claimed"; "Claimed. Running it themselves"; "Said no. Don’t ask again"; "No answer after the reminder. Don’t ask again"; the platform "Their own site" |
| Buttons and toasts | "No answer"; "Reminded {name}. That's their one reminder."; "{name}: No answer. Nobody will ask again." (Undo) |
| Empties | "Nobody at this stage."; "No creators in the {market} yet. Add the first one you find." |
| Add a creator | "Add a creator", "Someone making things in the {market}. Nothing is asked or copied yet."; "Name" / "As they call themselves: a channel, a crew, a person."; "The person behind it"; "What they make" / "One line: “Skate films, Joshua Tree”."; "Their work lives on", "Link"; "Email" / "Asking goes to them on their platform, and here too if there's an address."; "Optional"; "Cancel", "Add them"; errors "Say what they're called.", "Paste the link to their channel or page.", "That doesn't look like an email address.", "Keep it under 200 characters."; toast "{name} is on the pipeline, as Found." |
| Ask | "A radio band station" (band only); a single work's length, "Length not known"; "Nothing found on their {Vimeo} yet. Their works are catalogued from the source, by title and length, before asking."; the preview's empty note "Your note goes here."; "Tick at least one work to ask about."; sent "Sent to {name}." / "If they don't answer in a week, the pipeline says a reminder is due." / "Back to the pipeline"; asked "Asked {September 19}." / "They get one reminder after a week, then it stops."; "No answer after the reminder." / "Nobody asks again."; "Already licensed, under {CC BY 4.0}." / "No need to ask: their station can go on air with credit while they're invited to claim it." / "Set up"; "They said yes {September 25}." / "Set up"; a work unticked when asking "Left out when asking" |

**Desk: setting up, external sources (was "listed sources"), held earnings**

| Where | Words |
|---|---|
| Setup | before a yes "A station comes after a yes." / "Ask first. Their station can be set up once they say yes, or straight away if their work is already published under a licence that allows it."; "Already licensed under {CC BY 4.0}. Covers …"; "Their {recordings}" (no pronoun); "No recipe for this band yet"; channel "From the board", "The waitlist holds {95.5} for {GOSP}. Pick another", "{12.1} is {BEAT}'s. Pick another", "The waitlist holds {95.5}, so this is the nearest open one", "None open"; call sign "Choose a call sign.", "Three to five capital letters.", "No K or W at the start: those are US broadcast prefixes.", "{LUPE} is taken. Try another."; rights "Published under a licence, {CC BY 4.0}, for the {15} licensed {recordings}", "Nothing is covered yet: no yes on record, and no licence that allows carriage", "Missing"; import "{48} to import"; held "Given at setup"; run by "Nobody yet"; "Not scheduled", "On air since"; after setup "Sign-on scheduled" / "{Monday, 6:00 am}. {31} of {48} prepared for air so far", "On air, waiting to be claimed" / "Since {date}", "Set up"; toast "{LUPE 33.1} is set up. It signs on {Monday} at {6:00 am}."; the values' labels "Change the channel", "Change the call sign", "Change who runs it", "Change when it signs on" |
| External sources (the frame's title and description since handoff 6) | "No calendar yet"; "Not on the dial" (the frame's words; was "Not listed"); one wording for a synced calendar, "Synced from the agenda calendar"; "No external stations in the {market} yet." (was "No public streams listed in the {market} yet."); "No catalog station in the {market} yet." |
| List a source | "List a source", "A station on the {market} dial that plays the source's own stream. No playout, no spots." (was "A public stream on the {market} dial. Viewers get the source's own player."); "Whose stream" / "“City of Redlands”, “San Bernardino County”."; "What it shows"; "Band", "TV band", "Radio band"; "Channel"; "Call sign"; "Stream"; "Agenda calendar" / "Where they publish meetings. They become listings with their real titles and times."; "Their terms", "Allow embedding", "Unclear" / "It's saved but not on the dial. Someone asks them first." (was "…but not listed…"); "Cancel", "List it"; errors "Say whose stream it is.", "A channel like 9.4.", "A frequency like 89.1.", "Paste the link to their stream.", "That doesn't look like a link.", "Keep it under 160 characters."; toasts "{City of Rialto} is on the dial at {9.4}." (was "…is listed on {9.4}."), "{name} is saved. It goes on the dial once their terms allow embedding." |
| Held earnings | statuses "On air, not invited", "Claim being checked", "Claimed", "Stopped"; "Not scheduled to sign on yet"; "Claim invitation out" (one); the unclaimed period unknown "Not set yet"; "Nothing held yet. A claimable station's earnings show here from its first week on air."; no contract yet "Not deployed yet. Earnings are recorded, and move into it when it is" |

**The creator's permission page (viewer `/permission/:token`)**

| Where | Words |
|---|---|
| Page | the tab's title "Your station on Opencast"; radio "A radio station, run for you"; "Your {videos} through the day, …" when their work airs by day |
| After yes, set up | "Your station is {33.1 LUPE}. The call sign is yours to keep." |
| No thanks | "Understood. We won't ask again."; "Nothing of yours goes on the air. If you change your mind, write to us." |
| Stop | toast "Stopping it." (Undo); "Stopped."; "It comes off the dial within a day. What it earned is yours: once you sign in and we've checked it's you, it's paid to you." |
| Claim now | sign-in "To claim your station", "Claim it and go back"; "Your claim has started"; "We check it's you, then the station is yours to run from master control"; "Open master control" |
| Bad link | "This link doesn't work."; "It may be mistyped, or replaced by a newer one. Write to us and we'll send it again." |
| Errors | "That didn't go through. Try again."; the API's "This has been answered. Write to us to change it." |

### apps/viewer: TV apps, the relay and pairing (Phase 7)

| Where | Words |
|---|---|
| Watch on | "Den TV isn't on. Open Opencast on the TV and try again."; rows "Opencast app on Fire TV", "Opencast app, not on now" |
| Pairing | "Use a code from the TV", "On the TV, open Settings, then Remote and phones. Enter the 4-digit code it shows.", "Pair this phone", "Pairing", "Back to Watch on", "The code on the TV has four numbers." |
| The TV ending it | "Den TV unpaired this phone. Use a code from the TV to pair again.", "Den TV was signed out.", "Couldn't reach the TV. Check the connection and try again." |
| /tv | "Enter the code the TV shows: six letters and numbers, or four numbers.", "Four numbers from the TV's Remote and phones make this phone its remote.", "This phone is paired with {TV}, but the remote didn't open. Try Watch on." |
| Your TVs | ", on now" |
| TV, Remote and phones | "Pair a phone" / "For a guest's phone. Phones signed in to your account don't need a code" / "Show a code", "Hide the code"; "On the phone, go to {host}/tv and enter:", "Changes in N minutes", "Changes in 1 minute", "Changes in under a minute"; "Phones that can change the channel"; "Signed in to your account", "Paired with a code", ", connected now", "Remove"; "No phones yet", "Phones signed in to your account appear here once they connect", "Pair a phone to use it as a remote" |

### apps/web: one app, three areas (handoff 4)

"Master control", "Network desk" (the avatar's menu) and "Back to watching" (master control's header) are the apps prompt's own words. What the frames don't have:

- The avatar's menu on the web viewer, for people with a station role or on the Opencast team: **You** (their page, where the avatar went before), then **Master control** and **Network desk** as they apply. Everyone else's avatar still goes straight to You, with no menu.
- The browser tab's title while master control is open: **Master control · Opencast** (master control's own title before), and **Network desk** on the desk.


### apps/web: the account's data, pledge cards, timing, claim invites (contracts of 2026-09-28)

Words for what the API answers now (A1, A2, A3, O2, N3, N5). The API's own messages are shown as they come for the rest (`no_email`, `no_card_to_change`, `new_pledge_needed`, `pledge_ended`, `no_contact`, `no_station`, `in_progress`, `nothing_to_claim`).

| Where | Words |
|---|---|
| Any area, the API ended the sign-in (401 `signed_out`) | toast "You were signed out everywhere. Sign in again to use your presets, reminders and pledges." |
| Any area, the account was deleted elsewhere (401 `account_deleted`) | toast "This account was deleted, so you're signed out. Signing in again starts a new one." |
| Settings, Your data, Download | toast "We emailed a link to {email}. Open it to download the file."; the link (`/settings/data?download=1`) signed out: sign-in "To download your data", "Download and go back"; done: "Your data is downloaded" |
| Settings, Your data, Delete refused (409) | `owns_station`: "You own {BEAT 12.1}. Make someone on its team the owner in master control first, then delete your account."; `owns_business`: "You own a business on Opencast. Write to us to hand it over first, then delete your account." |
| Settings, Notifications | "How early": "At the start", "{N} minutes before", "An hour before", "{N} hours before"; Quiet hours: "Nothing between {10:00 pm} and {8:00 am}" from the account's window |
| Desk, a set-up station's Claim row | "Claim"; "{Crate} hasn't been invited to claim it yet", "Claim invite sent {Sept 24}", "Claim link sent {Sept 20}"; buttons "Invite to claim" (on air, not invited yet), "Send the claim link", "Send the link again"; toasts "Claim invite sent to {name}.", "Claim link sent to {name}." |
| Desk, a station set up before setups were kept (N5 null) | "It was set up before its recipe was kept, so its recipe, sign-on time and import aren't shown here." |

### apps/business: the landed requests (contracts of 2026-09-29)

Words for what the API answers now (P11, P12, P20, P21, E4). The API's own messages are shown as they come for the rest (`logo_size`, `not_an_image`, `default_source`, `deposit_pending`, `order_in_progress`, `no_source`, `redeem_off`, P10's `not_available`).

| Where | Words |
|---|---|
| Settings, Connections, the checkout | after choosing one: "Shopify's app secret" / "In Shopify, under your app's API credentials"; "Stripe's signing secret" / "In Stripe, on the webhook's page. It starts whsec_"; "Square's signature key" / "In Square, on the webhook subscription's page"; "Connect {Stripe}", "Back"; "Paste {Stripe's signing secret} to connect."; toast "{Stripe} is connected."; connected, the owner sees "Send {Stripe}'s order webhooks to" and the address; "Disconnect" on Clear Pay and the checkout |
| Settings, Connections, Clear Pay (Clear's connect flow isn't in the app) | "Clear Pay connects from Clear, and that isn't set up here yet." |
| Settings, Connections, the Redeem tool | "Redeem in the app", "Owners and managers mark codes used at the counter, from Redeem on their phone"; managers and viewers see "On" / "Off" |
| Redeem, while it's off | the "Settings" button under "Redeem is off for this business…" |
| Settings, Close account | "{$20.00} can't go back to a card. Add a bank or Clear account in Money and receipts first." (money available, only cards); "What's available goes back to your bank or Clear account." (nothing to name); after a refusal, "Made for you" (an order being made) or "Money and receipts" (nowhere to send the money) |
### apps/web: master control on its new endpoints (contracts of 2026-09-29)

Words for what the API answers now (A4, A5, B3, B6, C4, G3, G5, G7, L5 to L7, N10, P24, S15, S17). The API's own messages are shown as they come for its refusals (`not_live`, `not_on_air`, `ended`, `from_the_maker`, `speakerId`, `not_an_upload`, `claim_open`, `preparing`, `unreadable_file`, `wrong_kind`, `too_long_for_log`, `not_open`, `wrong_file_type`, `too_big`, `decided`). "Listings can't be edited here yet." is gone: the listings always load.

| Where | Words |
|---|---|
| The claim page, a station set up under a licence (N10 `saidYesAt` null) | lede without the yes: "Opencast's team has run {works} on the {Inland Empire} dial. Everything below becomes yours when you claim it." |
| Place in the log, a request that needs the maker's approval (C4) | the toast "{Maker} has your request. {Program} goes in your log when they approve it." now has Undo, which withdraws the request |
| Listings, Captions (L7) | the language by name from its code ("Generated live, English" from `en`); turning captions on keeps the program's language, else English |
| A library item, Prepared for air, Captions (L7) | "Uploaded, English" (the caption track's language, by name) |
| Audience, By program, Stayed to the end (U1) | an airing that has ended with no one at its first minute: "–" |
| The studio, a lower third the API refuses (S15) | toast with the API's message; the lower third stays as set on the screen |
| Program log, Repeat this day, Once (G7) | no new words: choosing "Once" takes the day's repeat off the log from now on (another pattern replaces it) |

### apps/web: master control's day templates and off air hours (G8, G9, contracts of 2026-09-29)

"Repeat this day", "Every Saturday", "Weekdays", "Every day", "Once", "Off air hours", "Sign off", "Sign back on", "Changing one date changes only that date; changing the template changes every future repeat." and "Planned off air hours aren't dead air: no warnings, nothing fills them, and viewers see when you're back." are master-control A3's (its pane and notes); "Off air", "Back at …", "Off air, back at …" and "Signs off at …" are the apps prompt's and handoff 5's. The API's own words are shown as they come for its refusals (`onto`, `until`: "Choose the day to copy to.", "Choose a day from tomorrow on.", "It has to repeat after the day it's built from."; `setOffAirHours`: "Sign off and back on can't be the same time.") and for the sign-on check "Off air hours planned" with its detail. What the frames don't have:

| Where | Words |
|---|---|
| Program log, planned off air on the timeline (a calm band, not dead air) | the off air hours: "Off air" / "Off air hours. Back at {6:00 am}"; a sign-off entry: "Off air" / "Sign off at {11:40 pm}. Back at {6:00 am}" (the fill choice's own words) |
| Program log, above the timeline: which template made the day | "Made from {Every Saturday}." / "Changing the template changes this date too."; edited since: "Made from {Every Saturday}, then edited." / "Changes to the template leave this date as it is."; the day a template is built from: "{Every Saturday} repeats this day." ("{A} and {B} repeat this day.") |
| Repeat this day, the dialog | eyebrow "{Sunday}, {September 27}" (making one) or "Repeat this day" (changing one, titled with its name); the choices' group "Repeats"; "Copy to" (Once); "Until" / "Leave it empty to keep repeating."; "Name" (changing one); buttons "Repeat this day" (making), "Save" (changing), "Cancel" |
| Repeat this day, what it made | titled with the template's name or label ("Once, Sun Oct 4"); "Dates made", "Entries placed", "Skipped for conflicts", and when there are some "Taken off the log", "Edited dates left as they are"; with skips: "Entries that overlap something already on a date are skipped there."; "Done" |
| Repeat this day, the templates list | a template's line: "{Weekdays}. Built from {Mon Sep 21}, until {Fri Nov 20}. {15 dates ahead}, {1 edited}." ("1 date ahead", "No dates ahead"; the label leads only when the template has a name); the link "Next {Mon Sep 28}" opens that date on the log; "Change", "Stop"; a one-time copy from before templates (G7): "Copied from {Sat Sep 19}, until {Sat Oct 31}. {4} entries to come." ("1 entry"), "Take off" |
| Stopping a template (or taking off a copy) | "Stop repeating {Every Saturday}?"; "Future dates that weren't edited will be cleared. What already aired stays in the as-run log."; "Stop repeating", "Keep it"; toast "{Every Saturday} stopped. {12} entries came off the log." ("1 entry") |
| Program log pane, Off air hours | "Change"; with several rules, a "Sign off" row per rule with the API's label ("Weeknights, 11:00 pm to 6:00 am"); "Next": "{Sun 2:00 am} to {6:00 am}", or "Off air now, back at {6:00 am}"; none: "No off air hours. {BEAT} stays on around the clock." |
| Off air hours, the form | title "Off air hours"; "Signs off on" (the nights, Mon to Sun); "Sign off", "Sign back on"; "Remove"; "Add off air hours" (up to seven); "Choose at least one night."; "Save", "Cancel"; toast "Off air hours saved." |
| Monitor | "Right now" gains "Off air hours": "Off air, back at {6:00 am}" or "Signs off at {2:00 am}" (within 24 hours); while off air on the schedule the line under "Monitor" reads "Off air, back at {6:00 am}." and there's no Sign on; the rundown's off air hours: "Off air" / "Back at {6:00 am}", and a sign-off reads "Back at {6:00 am}" |
| Ready to sign on | the API's "Off air hours planned" line shows as ready with its detail and no fix, and isn't counted in "{Five} checks." |

### apps/web: master control, prepare once, then assemble (contracts of 2026-09-29)

"Prepared for air", "Being prepared" and "Couldn't be prepared" are the contract requests' words; the example "12 of 13 items ready for the next 48 hours; Borrowed Tape at 8:40 pm is being prepared" is too. The API's own words are shown as they come for the sign-on check "Items prepared for air" and its detail ("11 of 12 in the next 24 hours. The rest are being prepared; anything not ready at air time airs station ID and bumpers"; what failed, G14, below), and for the output check ("Output ready", "Assembled from prepared items"). The log's times are on 4-second boundaries, with no new words: the setup foot's "Programs are placed in whole minutes; breaks are placed for you." stays true (every whole minute is a boundary). What the frames don't have:

| Where | Words |
|---|---|
| Monitor, Right now (and the phone's Monitor) | "Prepared for air": "{12} of {13} items ready for the next 48 hours" ("1 of 1 item …"); with one not ready, "; {Late Crate, ep. 15} at {10:00 pm} is being prepared" (queued or preparing), "couldn't be prepared" (failed) or "isn't prepared yet" (not asked for); another broadcast day's time says its day ("at {8:00 pm Sunday}"). Standby when one couldn't be prepared, or one airs within the hour unprepared; no line when the next 48 hours have no items |
| Ready to sign on | the API's "Items prepared for air" line: shown as fine and not counted in "{Four} checks." while everything is prepared; while something isn't, a warning ("… one is a warning you can sign on through.") with the API's detail; the fix "Go to library" (already approved for this list), to the item, only when one couldn't be prepared (G14), none while items are only being prepared |
| Ready to sign on, the API's words (G14) | the "Items prepared for air" detail when something failed: "{11} of {12} in the next 24 hours. {1} couldn't be prepared (its file needs replacing); anything not ready at air time airs station ID and bumpers" ("{2} couldn't be prepared (their files need replacing)"); with some still on their way: "… (its file needs replacing) and {1} is being prepared; …" ("{2} are being prepared") |
| Ready to sign on, the output check (the API's words) | "Output ready", detail "Assembled from prepared items", in place of the frame's "Test signal received" / "720p at 3.2 Mbps, audio at −16 LUFS" (there's no test encoder any more: the channel is assembled from prepared items). "Watch it" and its "Test signal" window stay as drawn, once the output has a playback address |
| Monitor, Right now: the item named (G13) | no new words: the item's title in "Prepared for air" is a link to that airing on the program log, which picks it out |
| A library item, Prepared for air | "For air": "Prepared for air", "Being prepared" (queued or preparing) or "Couldn't be prepared", in place of "Ready for tonight: Cached on the playout server"; no line until something asks for it (`not_asked`) |

### Captions in the stream (X2, contracts of 2026-09-29)

The channel's playlists now carry captions (a WebVTT subtitle rendition on the TV band). The viewer's and the TV's caption settings ("Captions" On, Off, Muted only; "Caption size") are the frames' words and are unchanged. What's new:

| Where | Words |
|---|---|
| The subtitle rendition's name, as a device's own caption menu shows it (Safari and iOS, Apple TV, a Chromecast's) | The language's name in itself: "English", "Español" (from the station's programs' captions language; "English" when none is set). No other words |
| Upload with a caption file, and Upload captions (L7): when the file is neither WebVTT nor SRT | "That isn't WebVTT or SRT captions." (the API's words, shown as they come; unchanged from L7) |
| Master control, a translator (no screen yet; proposed): the choice | "Draw captions into the picture"; help "Off: {YouTube} gets the picture without captions. On: captions are part of the picture there, for everyone watching." Off by default |

### Radio live and the relay background (contracts of 2026-09-29)

Radio stations go live through Opencast's own ingest (sound only), and choose the picture their translators relay under their sound. No frame draws either; the words follow the Translators page and Live sources. A140 and A141 in open-questions.md.

| Where | Words |
|---|---|
| Live sources, a radio station's encoder, under "For OBS, vMix or a hardware encoder. Paste these into its stream settings." | "Sound only: {WAVE} takes the audio and packages it at 128 and 64 kbps. Any picture is left out." (the Server row shows Opencast's own ingest; Streaming key and Reset key as before) |
| Translators page and Settings, Translators (radio stations only), the section below the relays | title "Relay background"; "What YouTube, Twitch and other services show under {WAVE}'s sound. Listeners on Opencast never see it." |
| Relay background, the line beside the preview | none: "None yet. Relays show {WAVE}'s colour with its call sign and channel."; a picture: "{wave.png}, held still."; a GIF or video: "{spin.gif}, looping every {2.4} seconds."; while it's prepared: "{waves.mp4} is being prepared. Relays keep showing what they show now until it's ready."; if it couldn't be: the API's words, "That file couldn't be made into a loop. Try another." |
| Relay background, help and buttons | "An image, a GIF, or a video up to 30 seconds. Its sound is left out. Spots' codes show over it for their last 10 seconds, as they do on TV."; "Upload" (none yet) or "Replace"; "Remove" |
| Relay background, toasts | after an upload: "{waves.mp4} is being prepared. Relays show it once it's ready."; after Remove: "Background removed. Relays show {WAVE}'s colour again." |
| Relay background, the preview's label (screen readers) | "The relay background, {wave.png}, with the bug"; without one: "What relays show: {WAVE 88.4} in {WAVE}'s colour" |
| Relay background, the API's refusals (shown as they come) | "Use a PNG, JPEG or WebP image, a GIF, or an MP4, MOV or WebM video." (`wrong_file_type`); "Use a file of 100 MB or less." (`too_big`); "Use a video of 30 seconds or less. It loops." (`too_long`); "That file couldn't be read as a picture or a video." (`unreadable_file`); "Backgrounds are for radio stations' relays. A TV station relays its own picture." (`not_radio`, not shown: TV stations don't see the section) |
| An encoder with the wrong key (no screen: the encoder's own error) | RTMP `NetStream.Publish.BadName`, "That stream key isn't a live source here." |

### Station IDs, bumpers and credits: how often, and the generated station ID (the user's requests, 2026-09-29)

Master control's setup lets every step be passed (only signing on checks what's needed); Settings, Breaks gains "How often" for the station ID, bumpers and the thank-you credit; a station with no station ID of its own sees the generated one in its library. No frame draws any of it: the rows follow Settings, Breaks' "Length" row and the library's table. A142 to A144 in open-questions.md.

| Where | Words |
|---|---|
| Setup, Library (A.2), the foot's note | "Signing on needs at least one program on the log. Without a station ID of your own, the generated one airs." in place of "A station needs at least one program and a station ID to sign on." "Continue to program log" is never disabled |
| Settings, Breaks, the section under "In every break, in this order" | title "How often"; beside it "Open time always airs your station ID and bumpers" |
| Settings, Breaks, How often: the rows | "Station ID", "Bumpers", "Thank-you credit"; each a choice of "In every break", "After every program", "After every {2} programs" (2, 3 or 4), "Once an hour", and (bumpers and the credit only) "Never". Screen readers: "How often: {Station ID}" |
| Settings, Breaks, How often: the line under each | Station ID: "Last in every break"; "Last in the first break after the top of the hour" (once an hour); "Last in the break, when it airs" (after programs). Bumpers: "In their place in the order above"; "Breaks hold on the station ID slate instead" (never). Thank-you credit: "In its place in the order above"; "Sponsors and members aren't thanked in breaks" (never) |
| Settings, Breaks, "Say after how many programs." | the API's refusal, shown as it comes (the choices always send a number, so it isn't seen) |
| Program log, the Breaks pane's "Station ID" row | the cadence's words in place of the frame's fixed "In every break": "In every break", "After every program", "After every {3} programs", "Once an hour" |
| Program log, a break's rows where bumpers don't air (the API's words) | "Station ID slate" (`OPEN`) in place of "Bumpers and station ID slate" |
| Ready to sign on, "A station ID at least once an hour" (the API's words) | when the cadence leaves more than an hour without one (a warning): "Up to {2 hr} without one, from how often it airs in breaks. {12} times a day"; the mock's: "Some hours have no station ID, from how often it airs in breaks. {12} times a day" |
| Library (setup's and the station's), the generated station ID's row | title "Generated station ID"; "Made for {BEAT}. Replaced by any station ID you upload"; type SID (not a choice); runs "0:10"; status "Ready for air", "Being prepared" or "Couldn't be prepared"; "Preview". Only in All items, not in a folder or the needs-attention lists |
| The generated station ID's preview (a dialog; a sheet on the phone) | eyebrow "Made for you", title "Generated station ID", a picture of it ({BEAT} large, {12.1}, "{Inland Beat} · {Redlands}"; screen readers: "{BEAT 12.1} in {BEAT}'s colour"); TV: "Ten seconds over a soft sound bed, where {BEAT} needs a station ID: in breaks, in open time and when it signs back on." Radio: "Ten seconds of a soft sound bed, where {WAVE} needs a station ID. Relays show {WAVE}'s colour with its call sign and channel over it." Then "It's made again when {BEAT}'s name, call sign, channel or colour changes, and any station ID you upload replaces it."; "Done" |
| The generated station ID itself (on air, no app words) | {BEAT} (or the station's name before it has a call sign), {12.1}, "{Inland Beat} · {Redlands}", white on the station's colour |

### Spots: how often; bumpers into and out of the break (the user's decisions, 2026-09-29)

Settings, Breaks' "How often" gains spots, and its rows follow the ladder's order; the ladder draws a bumper into the break and one out of it (A143, answered). No frame draws any of it. A150 in open-questions.md.

| Where | Words |
|---|---|
| Settings, Breaks, How often: the rows | "Spots", "Thank-you credit", "Bumpers", "Station ID", in that order (was Station ID, Bumpers, Thank-you credit). Spots: the same choices as bumpers and the credit, "Never" included. Screen readers: "How often: Spots" |
| Settings, Breaks, How often: the line under Spots | "In every break, up to the hourly cap"; "Up to the hourly cap. Other breaks are only as long as the rest needs" (after programs, once an hour); "Breaks are only as long as the rest needs. Nothing is sold in them" (never) |
| Settings, Breaks, How often: the line under Bumpers | "One into the break and one out of it" in place of "In their place in the order above"; "No bumpers in breaks" (never) in place of "Breaks hold on the station ID slate instead" |
| Settings, Breaks, the ladder ("In every break, in this order") | a first row, fixed: "A bumper into the break", "Before the spots. With one bumper in your library, it opens and closes the break", ":10". The bumper's row (fixed, before the station ID): "A bumper out of the break", "Before the station ID. Time left over holds on the station ID slate", in place of "A bumper", "Fills any time left over". Spots run "0:00 – {1:20}" (both bumpers taken off). Only the spots and the credit can be dragged; "Ads from partners" sits before the bumper out of the break. Screen readers, after a move: "{Spots from your rotation}, now {3} of {5}" |
| Program log, the Breaks pane | a "Spots" row, before "Station ID", when spots don't air in every break: "After every program", "After every {3} programs", "Once an hour", "Never" |
| Program log and the Monitor's rundown, a break's rows (the API's words) | the bumper's own title, with "Into the break" under the first and "Out of the break" under the one after the credit; time left over is "Station ID slate" (`OPEN`, "Holds on the station ID slate" under it) in place of "Bumpers and station ID slate"; a break spots don't air in has no "Open" row |
| The mock's break rows (a break spots don't air in) | "Station ID slate" in place of "Open" |
| Business app, a spot's stations (the API's reason, shown as it comes) | "doesn't air spots" for a station whose breaks never air spots |

### Back to live, on the web, the phone, TV mode and the phone remote (the user's request, 2026-09-29)

"Back to live" is the reference's own words (home 03's "No scrub bar" note; you 01's "Pause holds for"). It now shows whenever the picture is behind live (from a pause until Back to live or a channel change, paused or playing on), not only after the 30-minute hold. No frame draws where; A145 and A146 in open-questions.md. The words below are what's new around it.

| Where | Words |
|---|---|
| TV, the hint row on the banner, while behind live with the remote on the picture | "Hold" [OK] "Back to live" (the key drawn as the other key hints are). Last in the row; it stays after the week that hides the other key hints. Not casting or mirroring (the phone has the button) |
| TV, the chip on the picture while playing behind live (top left, where "Paused" sits; top right when the station's bug is top left) | "Hold" [OK] "Back to live" with the remote; "Back to live" alone casting or mirroring. Screen readers: "Back to live". Hidden while the banner is up (its hint row says it) and in the guide's window |
| Web, the controls under the picture; the phone's full player (beside the tally, and under the play row on the radio band); the paused sign on the picture | "Back to live" (button); no new labels |
| The phone remote, under the rockers while the TV is paused or behind live | "Back to live" (button) |
| Keys (no words on screen) | Web: l or End. TV: hold OK on the picture, ⏩ (MediaFastForward), next track (MediaTrackNext), l |

### AirPlay in "Watch on", and the remote's Guide on the TV (the user's requests, 2026-09-29)

No frame draws either. "Watch on" (tv 06.2) keeps its Chromecast and TV app rows as drawn; Safari adds a row for its own AirPlay list. The remote's Guide now opens the TV's guide (A147, A148); AirPlay's limits are A149.

| Where | Words |
|---|---|
| Watch on, the AirPlay row (Safari, while an AirPlay TV is around) | title "AirPlay"; second line "Apple TV and AirPlay TVs", or "Playing on AirPlay" while it is; the primary button "AirPlay to a TV", or "Stop AirPlay" while it plays. "This phone"'s second line while AirPlaying: "Stop AirPlay" |
| The tuned-in page, web: the controls under the picture | icon button "AirPlay" (screen readers and tooltip), beside sound and full screen, while an AirPlay TV is around |
| The tuned-in page, web and phone, while the picture plays on an AirPlay TV | "Playing on AirPlay" and "Stop" (a status line under the picture). WebKit doesn't say which TV, so there's no "Playing on {TV name}" |
| The phone remote, Guide | Pressed while the TV's guide is open (it closes there again) |
| The phone remote, the d-pad in the rockers' place while the TV's guide is open | screen readers: "Guide on the TV" (the group), "Up", "Down", "Left", "Right"; "OK"; "Back" |
| The phone remote, under Guide, Info, Keypad and Last | "Guide on this phone" (text button: the phone's guide, where choosing a program tunes the TV) |


### Invites that reach people: the emails and the invite's pages (2026-09-29)

No frame draws an email or an invite's page. The emails are plain text with a simple HTML copy of the same words (the wordmark, the title, the body, one button with the link written out under it, and a line on why it came). The invite's pages are the sign-in card (viewer/you 01.1) with the invite on it. The role lines come from the references: station-settings' "Runs the station day to day, but not money or the team" and "Goes live on the blocks you give them", biz-settings' "Managers can spend, not withdraw" and "Viewers see results and statements but can't spend or change anything".

**The invite's email** (both kinds)

| Part | Words |
|---|---|
| Subject and title | "Join {Inland Beat} on Opencast" |
| Body | "{Kai} invited you to {Inland Beat}'s team on Opencast, as {an operator}. {role line}" (without a display name: "You're invited to {team}'s team on Opencast, as {a viewer}."), then "Sign in with this email address to join. The invite lasts a week." |
| Role lines | operator: "Operators run the station day to day, but not money or the team." host: "Hosts go live on the blocks they're given." manager: "Managers can run spots, add money and approve orders; only the owner takes money out." viewer: "Viewers see results and statements, but can't spend or change anything." |
| Button | "Join {Inland Beat}" (and "Or open this link: {link}" under it; the text version: "Join {team}: {link}") |
| Footer | "{Kai} on {Inland Beat} typed this address. If you weren't expecting it, ignore this email: nothing happens unless you sign in and join." ("Someone" without a display name) |

**Other emails** (their titles and bodies are the notices' and the desk's own words, unchanged)

| Email | Button | Footer |
|---|---|---|
| A notice, business | "Open Opencast for business" | "You can turn these emails off in Settings, Notifications." Always-on kinds: "Opencast always sends this one; it can't be turned off." |
| A notice, station | "Open master control" | the same |
| A notice, viewer | "Open Opencast" | the same |
| The desk asks a creator; the reminder | "Answer on the page" | "Opencast's team sent this about your work. Yes or no, one tap on the page." (the reminder: "Opencast's team sent this about your work.") |
| A copy of the creator's answer | "See your answer" | "A copy of what you answered on Opencast's permission page." |
| The claim invite; the claim link | "See your station"; "Claim your station" | "Opencast's team sent this about the station made from your work." |
| Your data (A3) | "Download your data" | "You asked for this in Settings, Your data. The link needs you signed in." |
| Any other email | "Open Opencast" | "You're getting this because of your Opencast account." |

**The invite's page** (master control `/control/invites/:id`, business `/invites/:id`)

| State | Words |
|---|---|
| Open, signed out | kicker "Master control" / "For business"; title "Join {Inland Beat}"; "{Kai M.} invited you to {BEAT, Inland Beat}'s team, as {an operator}. {role line}" (business: "…to {Orange Street Coffee}'s team on Opencast, as {a viewer}."; without a name: "The owner of {team} invited you…"); "Sign in with {d…@example.com} to join." (a phone invite: "Sign in to join."); button "Sign in to join"; foot, master control: "Master control is where stations run their dial. Each person signs in with their own account."; business: "Each person signs in with their own account, from anywhere." |
| Signed in as someone else | kicker the team; title "This invite is for another email."; "This invite is for {d…@example.com}; you're signed in as {sam@example.com}." and "Sign in with {d…@example.com} to join. If you don't use that address, ask {Kai M.} to invite the one you do."; buttons "Sign in with another email", "Back to master control" / "Opencast for business" |
| Expired | title "This invite has expired."; master control: "Invites last a week. Ask {Kai M.} to send it again from Settings, Team."; business: "Invites last a week. Ask {Jess Lin} to send it again." |
| Used by someone else | title "This invite was already used."; "Each invite joins one person. If that wasn't you, ask {Kai M.} for a new one." |
| Joining failed | title "That invite didn't work."; the API's message; buttons "Try again" and the way back |
| Couldn't load | title "That invite didn't open."; the error; "Try again" |
| Unknown invite | the apps' own "There's nothing here." |

**The API's words** (shown as they come: the Team sections' toasts, the invite's pages)

| When | Words |
|---|---|
| Accepting with another email (403 `invite_email_mismatch`) | "This invite is for {j…@example.com}; you're signed in as {kai@example.com}. Sign in with {j…@example.com} to join." (no email on the account: "…you're signed in as an account with no email.…") |
| Someone else used it (409 `invite_used`) | "This invite was already used. Ask for a new one if you still need to join." Resending one: "They've already joined." |
| Resent too soon (429 `resend_too_soon`) | "It went out {4 minutes} ago. You can send it again in {6 minutes}." ("less than a minute ago" under a minute) |
| The email didn't go (502 `email_not_sent`) | "The email didn't go out. Try again in a few minutes." |

### Small fixes from the catch-up report (the follow-up, 2026-09-29)

"External" replaces "Listed" wherever viewers and the desk see it, in the references' words (final, not new): the dashed tag "External" (home 01, the tuned-in page, the remote, the dial rows), guide cells "Began 7:00, external" and on the TV "External, until 9:15", station lines "RDLS 9.1, external, the city's own stream" (search results, and the home's coming-up line, which the home frame's data still writes the old way), You's reminders "RDLS 9.1, external", the desk's "External sources" (rail and page, with the frame's description) and the board key "External city stream". "Tuning sound" and its help lines are the frames' words (you 01 settings, tv-update 04.1). The words below are new. Internal names (`kind: "listed"`, the `listed` tag variant, `/admin/listed-sources`, the tables) are unchanged.

| Where | Words |
|---|---|
| Station page, About (external stations) | "External, the city's own stream" |
| Desk, the board | the market line "{3} external city streams"; a selected slot "External city stream. {name}", "External city streams: {9.1 RDLS, 9.2 COLT}"; its button "External sources" |
| Desk, External sources and List a source | the reworded lines in the desk table above ("Not on the dial", "No external stations in the {market} yet.", the modal's subtitle, the toast and the unclear-terms note); the rail's count for screen readers "{1} not on the dial yet" |
| TV settings, Watching, Tuning sound | the value "On" beside the frame's "Off" (◀ ▶ step between them) |
| Tuning sound's help line, TV settings and You settings | "Static and a click when changing channel" (and on You, ", on the TV and radio bands. On unless you turn it off"), for the frames' "A soft hiss…": the sound became an old TV set's static and thump, and the radio dial's sweep, both with a click as the station lands (2026-10-06) |
| Business settings, Where your customers are, Online | the market picker "Markets" (chips, as when starting a business); help "Stations see "Online". Spots reach the whole {Inland Empire and High Desert}. A location or a service area targets a distance instead." (the market's name from the chosen markets, no longer fixed), or with none chosen "Stations see "Online". Choose the markets your spots can air across."; error "Choose at least one market." (the start page's words) |
| Business settings, a service area's city | "Enter a city in the {market}." (the business's real market; was "Enter a city in the Inland Empire, like Riverside.") |
| Business, a viewer on the Balance page | "Viewers see results, airings and statements." (the rail's reason), buttons "Where it aired" and "Statements"; on a statement page with nothing to show, a viewer's button is "Where it aired" instead of "Balance". No balance in the header ("Available …" isn't shown to viewers) |
| Network desk, approving a claim with no wallet (the API's `no_wallet`) | "The creator has no wallet yet. It's made when they claim, signed in: ask them to claim again from their link." (was "The creator needs to sign in first: their wallet is where the escrow pays.") |
| The claim (permission page's Claim now, master control's claim page) | none: the wallet is made without a screen of its own; if it fails, the pages' own errors ("That didn't go through. Try again.", "Something went wrong. Try again.") |

### Edit mode on the program log (the user's request, 2026-09-29)

No frame draws it: the log page's own title bar, timeline and pane (A.4), with "Edit log" beside the view choices. Owners and operators only (setup step 3 too). The API's words (the summary's lines, problems and warnings) are shown as they come.

| Where | Words |
|---|---|
| The title bar | "Edit log" (a button beside Day, Evening, Week; Week isn't offered while editing) |
| Over the timeline, editing | "Editing the log." and, on air, "Nothing changes on air until you publish. What's on now, and anything starting in the next 20 seconds, stays as it is."; off air, "Nothing changes until you publish." |
| The timeline (screen readers) | the list "The log, being edited"; after a block's times, its state: "moved", "resized", "replaced", "new", "locked", "has a problem" |
| The pane, Your changes | heading "Your changes"; none yet: "No changes yet. Drag a program to move it, or pick one to change it."; checking: "Checking your changes…"; the API's summary ("3 changes: Late Crate moves to 9:10 pm, …", four lines at most, then ", and {2} more") and one line per change with "Undo" (screen readers: "Undo: {line}"); problems, each "Problem: {line}: {message}"; warnings as they come; buttons "Publish changes" and "Discard" ("Done" with no changes); under them "Everything goes out at once. On air, the channel switches at the next item." |
| A stale draft (409 `log_changed`) | "The log changed since you started editing." / "Reloading drops your changes. Make them again on the log as it is now." and "Reload" |
| Published | toast "{1} change published." / "{3} changes published." |
| The pane, a picked entry | its title and "{9:00 pm} to {9:30 pm}", "Close"; "Starts at" (help "Snapped to the nearest 4 seconds, where the channel can change.", error "Type a time like 9:10 pm or 21:10."); a live block's "Ends at", a sign-off's "Back on at"; a program's "Airs" (the library's programs, "{title} ({28:00})"); "Put on before", "Put on after"; "Take off the log" |
| A locked entry | the API's words: "On air now, too late to change.", "Airs in {20} s, too late to change.", "It has already aired.", "It has already started." (off air); a live block on now: "End early in the studio" (to its studio, where End early is) |
| Putting something on | eyebrow "{After} {Late Crate}, {10:28 pm}" ("Before" too); title "Put something on"; subtitle "What comes after it moves down to make room."; "Your library" / "Programs you carry", "Program" ("{Saturday Reel}, from {REEL}"), the list "What goes on" with each length; "Nothing in your library can air yet.", "You don't carry anything yet."; "Find more in the syndication market. Your changes are kept while you look."; "Cancel", "Put it on" |
| The pane, not editing: Changes | heading "Changes"; "Last changed by {Kai M.} at {8:42 pm}" ("{Sat 8:42 pm}" after 20 hours; "Last changed at …" without a name); the last five batches, each its summary and "{Kai M.}, {8:42 pm}" ("Someone" without a name) |

**The API's words** (`applyLogChanges`)

| When | Words |
|---|---|
| Each change | "{Late Crate} moves to {9:10 pm}" ("{Sun 9:10 pm}" on another day), "{Beat Tape Live} now ends at {10:15 pm}", "{Crate Talk} replaces {Slow Hours} at {8:50 pm}", "{Night Desk} at {9:20 pm} comes off the log", "{Crate Talk} goes on at {9:20 pm}", "An entry that isn't on the log any more" |
| The summary | "{1} change: …" / "{3} changes: …" (lines joined with commas; after four, ", and {2} more") |
| Problems | locked (above); "That's too soon: the channel is already set for the next 20 seconds." (off air: "That's in the past."); "{Slow Hours} would overlap {Late Crate} at {8:30 pm}."; "That entry isn't on the log any more."; "It's already coming off the log."; "Only a program's item can be replaced."; and a single edit's own words (rights, carriage limits, "The slot is shorter than the item.", "It has to end after it starts.") |
| Publishing with a problem (422 `log_changes_refused`) | the first problem's words |
| A stale draft (409 `log_changed`) | "The log changed since you started editing. Reload it to see what changed, then make your changes again." |
| Warnings | "Dead air from {9:40 pm} to {10:00 pm} ({20 min})."; "{1} held spot in the break {after Late Crate} moves to the next break." ("{2} held spots … move …"); "{2} barter spots in the break {during Saturday Reel} move with it."; "{2} barter spots in the break … are returned if they don't air." (its program comes off); after publishing, if one found no room: "{1} held spot couldn't move to another break and is returned if it doesn't air." |

### Reminders when an airing comes off the log (the catch-up report's follow-up, 2026-09-29)

An airing a viewer set a reminder for comes off the log (a single remove, a batch remove, a carried slot placed over it, or its item pulled): the reminder moves to the same program's next airing on that station, no sooner than the one that went and within a week of it, or it's cancelled. Each viewer gets a notice (kind `reminder`: in the app, and push and email per their settings). A move or a new length keeps the entry, so its reminders follow it, at its new start.

| When | Words |
|---|---|
| The notice, moved | title "{Late Crate} moved to {Friday 9:00 pm} on {BEAT 12.1}" ("{October 9}, {9:00 pm}" a week or more away); body "Your reminder moved with it." |
| The notice, cancelled | title "{Late Crate} was taken off {BEAT 12.1}'s schedule"; body "It was on for {Friday 9:00 pm}. Your reminder is cancelled." |
| Edit mode's warning (`applyLogChanges`, code `reminders`, dry run and published) | "{1} viewer set a reminder for this; they'll be told." / "{3} viewers set reminders for this; they'll be told." |
| Edit mode's problem, a batch putting a carried episode on past its limit (code `airing_limit`) | the single edit's words: "The agreement allows {2} airings of each episode." |

### Network desk: Settings and the catalog's shelf (follow-up Phase 0, items 10 and 11, 2026-09-29)

Words the frames (desk-pages 04, desk-catalog 01 to 03) don't have. The frames' own words are used where they exist.

| Where | Words |
|---|---|
| Settings, the sections' leads | Team "Who's on the Opencast team, and what each role can do."; Markets "Each market's numbering ranges."; Escrow signers "The keys that approve a creator's claim on held earnings."; Change log "Every change made here, newest first."; You "Your own settings for Network desk, on this device." (Rules keeps the frame's) |
| Team | the frame's note as its lead; role tags "Admin", "Rights reviewer", "Market lead, {High Desert}"; "(you)"; "Admin by OPENCAST_ADMIN_EMAILS"; buttons "Add someone", "Change" |
| Team, the form | "Add someone to the team" / "{Rae T.}'s roles"; "They need an Opencast account: ask them to sign in once first." / "Take every role away to take them off the team."; "Changes rules, the team and escrow signers."; "Does the second check on catalog items, and handles claims."; "Runs the pipeline and reservations in this market."; toasts "{email} is on the team.", "{Rae T.}'s roles are changed.", "{Rae T.} is off the team." |
| Team, refusals | "No one has signed in to Opencast as {email} yet. Ask them to sign in once, then add them."; "Opencast needs at least one admin. Make someone else an admin first."; "Only an admin can change that."; "Only a rights reviewer or an admin can do that."; "Only this market's lead or an admin can do that." |
| Rules | values: "{$0.02} a GB a month", "{$1.50} an hour", "{10}% of spots, {0}% of pledges, {5}% of production", "{5}%: base {50}%, watch time {40}%, fund {10}%", "Weekly"/"Monthly", "{3} years", "{14} days, {10} business days", "{3} platforms", "{2} of {3}", "As deployed"; a rule not drawn: "Payouts / How often stations are paid what they earned", "Sound recordings in the US / Published this year or earlier. Recordings from before February 15, 1972 have their own terms", "Escrow signers / The verifier keys. A change needs the other admins' approval, then the timelock"; the next version "{2} from {October 1}" |
| Rules, the form | "Now {3}. The old value stays in the change log."; field labels ("Price a GB a month", "Spots and sponsorships", "Years after publication", "Upheld claims in 12 months" and the rest in `components/settings/rules.ts`); "Empty: not set yet"; "Takes effect" with "From midnight that day (UTC). Never before today: statements say which value applied."; "Note"; "Set it"; toast "{Repeat limit}: set from {October 1}." |
| Rules, refusals | "A change takes effect from today or later, never before: statements say which value applied."; "That value doesn't fit this rule: {reason}."; "Escrow signers change through a proposal the other admins approve (Settings, Escrow signers)." |
| Markets | lead "Each market's numbering ranges, so a market can grow without code. TV 2 to 69 with subchannels; radio 88.2 to 107.8, on even tenths so no number matches a real FM station."; rows "TV {2} to {69}, with subchannels", "Radio {88.2} to {107.8}, even tenths", "Opencast-wide" / "From {September 1}"; the form "{High Desert}'s numbering", "TV from", "TV to", "Radio from", "Radio to"; a station choosing outside it: "TV channels here run from {2}.1 to {36}.9. Choose a number in the market's range." |
| Escrow signers | lead "The multi-sig verifier keys that approve a creator's claim. {Read from the escrow contract / Read from configuration (ESCROW_VERIFIERS) / No keys configured yet}. A change needs every other admin's approval here, then goes through the timelock on-chain."; "Key {1}"; "Approvals a claim needs"; "Approved {date}, waiting for the timelock: {Replace 0x90F7…b906 with 0x15d3…6A65: 2 of 3}."; "Proposals"; states "Waiting", "Approved", "Refused", "Withdrawn"; "{Sam K.}: approved"; buttons "Propose a change", "Approve", "Refuse", "Withdraw" |
| Escrow signers, the form and refusals | "Propose a signer change"; "It takes effect here once every other admin approves it. On-chain, keys change only through the timelock."; "Add a key", "Remove a key", "Replace a key", "Change how many approve a claim"; "The key that goes", "The key that comes", "Why"; toasts "Proposed. Every other admin has to approve it.", "Approved.", "Refused. Nothing changes.", "Withdrawn."; "A signer change needs another admin to approve it. Add a second admin first."; "Another signer change is waiting for approval. Decide or withdraw it first."; "You proposed it: the other admins decide it." |
| Change log | "Everything", "Rules", "Team", "Signers"; columns "When", "Who", "What", "Takes effect"; summaries "{Repeat limit}: {3} to {2}", "Made {Rae T.} a rights reviewer", "Took {Lee R.} off as market lead for the {Inland Empire}", "Proposed replacing {key} with {key}: {2} of {3}", "{Sam K.} approved the signer change", "Signer change approved: {2} of {3}. Next, the timelock", "Started the registry with the value in effect"; "Since the start"; who "Opencast" for the migration |
| The shelf | "New series"; the empty shelf "Nothing on the shelf yet. Add a series, then its first item."; the rules line "Works published in {1930} or earlier are public domain in the US; sound recordings published in {1925} or earlier. Both move every January 1 (Settings, Rules)."; state "Not offered yet" |
| A series | lead "{40} episodes of {30 minutes}, {138} items checked. {notes}"; "Episode {14}" with "{River boats and paddle wheels}. {4} items, {29:10}"; "Not built yet", "Building", "Couldn't build"; the note ""{Down the River}" came out when its check failed ({renewal found in 1962}). Episode {14} was rebuilt: stations carrying it air the new version from their next airing, and nothing aired with it after {September 21}."; "Removed {Sept 21}"; "Not free to air"; "Items", "{5} items, each with its own rights record", "New episode", "Change episode {14}"; check tags "Checking", "Second check", "Checked twice", "Failed"; the pane's "Rebuilt" with "{Sept 21}: Episode {14} rebuilt after "{Down the River}" failed ({renewal found in 1962}). {38} unchanged." or "Nothing yet. An episode is rebuilt when an item in it fails, and only what changed is prepared again."; "Carried by {12 stations, 3 markets}" / "Nobody yet" / "Not offered yet" |
| Add an item | "Add an item"; "From its source: one film or recording, with its own rights record. US works only, for now."; "Series", "File" ("Uploaded to the catalog station's library first. The original, not a restoration."; "Nothing new in the library"), "Title" ("As stations will see it. The file's name if left empty."), "Source" ("“1932, original 35 mm print, Library of Congress”."), "What it is" ("A film", "A sound recording"), "Published", "A US government work" ("Made by an agency's own staff: public domain by law, whatever the year."); "Start the rights check"; errors "Choose the file from the catalog station's library.", "Say where it's from: the print or recording, and who holds it.", "The year it was first published." |
| New series | "New series"; "Made on the catalog station, and offered to every station at no cost."; "One line", "Rights basis", "Basis, in a line", "Made of" ("Films", "Sound recordings"), "Episodes" ("30 minutes", "60 minutes", "2 hours"), "Coming, not offered yet" ("On the shelf so the team can see it, until its terms are set."); "Add the series"; toast "{title} is on the shelf." |
| The rights check | checklist lines the rules write: "Published {1929}, before {1931}"; "A US government work"; "Copyright not renewed" with "Renewal would have been due in {1959} or {1960}. Search the Copyright Office renewal records for the title and studio" or "Published before {1931}: no renewal search needed"; "Published without a copyright notice"; "Still in copyright"; "What's recorded" (sound recordings); helps for each line (in `packages/contracts/src/publicDomain.ts`); "not needed", "record kept"; answers "Yes", "Yes, with a caution", "Not free to air", "Not answered"; "What you found", "The record" ("If the evidence isn't a file"), "Attach evidence", "Answer"/"Change", toast "{file} is kept with the item."; "The rules today: {Published 1932: public domain only if its copyright wasn't renewed}. US works only; published in {1930} or earlier is public domain, and the year moves every January 1 (Settings, Rules)." |
| The rights check, sending and the second check | the reason it can't be sent: ""{line}" isn't answered yet.", ""{line}" has no evidence: attach a file or write down the record.", ""{line}" says it isn't free to air.", "The rules don't make it public domain: {reading}."; toast "Sent for the second check."; "Waiting for a rights reviewer or admin other than {Dee A.}"; "Confirm: it's free to air", "Send back for more evidence", "It isn't free to air"; "{Rae T.} reviewed the evidence and confirmed, {September 21}"; "You did the first check. Someone else does the second."; the pane's "Then": "Ready for an episode", "In episode {14}", "Out of the catalog: {reason}" |
| Taking an item out | "Take it out of the catalog"; "Take out "{title}""; "It comes out of every episode it's in, those episodes are rebuilt, and stations air the new version from their next airing."; "Why" ("Renewal found in 1962"); "Take it out"; toast ""{title}" is out. Episode {14} rebuilt without it." / "…It wasn't in any episode."; "Only items checked by two people go into episodes: {"title"} isn't yet." |
| An episode's items | "An episode's items"; "Items checked by two people, in the order they air."; "Episode", "Title"; "Nothing has passed both checks yet."; "Save the episode"; toast "Episode {15} is set. Rebuild to put it together."; "Every item in it came out. Choose items to build it again." |

### Network desk: Rights claims (follow-up Phase 0, item 11, 2026-09-29)

Words the frame (desk-pages 01) doesn't have. The frame's own words are used where they exist ("Rights claims", "Claims against programs on any station, and the answers.", Open / Closed / By station, the four figures, "Program and claim", "State", "Next", "Carriers", "Off air", "Counter-notice sent", "{SAZN} answers by {Oct 1}", "Privacy, not copyright", "Claim received", "Off air on {BEAT} and {3} carriers", "Pulled from every log at once", "{BEAT} answered", "Counter-notice sent to the claimant", "See evidence", "Message {BEAT}", the closing note). Every line is in `apps/web/src/desk/components/claims/claims.ts`, for the lawyer's review (#12).

| Where | Words |
|---|---|
| The figures | "Open claims, {3} off air" / "Open claims, none off air" / "Open claims"; "Station answers due, the first {today / tomorrow / in 2 days}"; "Station answers due in the next {3} days" |
| The rows | the claim line "{Northside Records}: {two tracks in the second half}"; states "Upheld", "Removed by {BEAT}", "Removed, no answer", "Withdrawn", "Back on air"; Next "{Northside} has until {Oct 14}", "Closed {Sept 9}" |
| The timeline | "{BEAT} answers or removes it" with "{9} days left. With no answer, it's removed from the library" ("Due today"); "{"The owner gave permission"} / {"We made it"} / {"It's in the public domain"}", with ", with the licence attached"; "With {BEAT}'s legal name and contact. They were told it stays on air unless they take legal action"; "Back on air on {BEAT} and {3} carriers" / "In every log that had it, from the next scheduled airing"; "{Northside}'s time to take legal action ends" / "If {Northside} hasn't filed suit, Opencast closes the claim and it stays on air"; privacy: "Privacy complaint received", "Opencast reviews it" ("Now") / "A privacy complaint follows its own path: no answer window, and it stays off air until it's decided"; outcomes "Removed by {BEAT}" / "Removing isn't counted against a station", "Removed from the library" / "No answer by the date. Counts as removed, not upheld", "Upheld" / "It stays off every log, and counts toward {BEAT}'s repeat limit for a year" (privacy: "It stays off every log. Privacy complaints don't count toward the repeat limit"), "{Northside} withdrew it", "No further action from the claimant" (privacy: "Restored after review") |
| The pane | the station line "{BEAT 12.1}" (privacy: "{CIVC 7.1}. Privacy, not copyright"); "Carriers" with "{2} airings pulled", "Carries it, nothing scheduled", "Back on air"; "Record the outcome"; the privacy note "Not every claim is copyright. A privacy complaint follows its own path: Opencast reviews it, and it doesn't count toward the repeat limit." |
| Evidence | "Evidence"; "From", "Their contact", "Received", "What's claimed" ("{31:10 to 44:15}, {Two tracks in the second half}", "Not said"), "Sworn statement" ("Included, as the law requires" / "Not included"), "{BEAT}'s answer", "File" / "Files" ("The file attached to the answer"); "Close" |
| Record the outcome | "Record the outcome"; "What happened"; "Upheld" / "It's removed from the library and every log, and counts toward {BEAT}'s repeat limit for a year" (privacy: "... Privacy complaints don't count toward the repeat limit"); "Withdrawn" / "The claimant took it back. It's back on air on {BEAT} and {3} carriers"; "Restored" / "No legal action by the date. It's back on air on {BEAT} and {3} carriers" (privacy: "Reviewed and not upheld. ..."); "Cancel", "Record it"; "Choose what happened."; toasts "Upheld. {title} is removed from {BEAT}'s library.", "Withdrawn. {title} is back on air.", "Restored. {title} is back on air." |
| By station | "Station", "Open", "Closed", "Upheld in 12 months" ("{1} of {3}"), "Standing" ("Good", "Near the limit", "At the limit, offers paused"); "Stations with upheld claims are counted against the repeat-infringer policy: {3} upheld claims in 12 months pauses a station's carriage offers. Privacy complaints don't count. The number is set in Settings." |
| Empty | "No open claims. When a rights holder files one, it shows here with the date it's due."; "No closed claims yet."; "No station has had a claim." |
| The API's refusals | "A privacy complaint isn't answered with a rights basis. Opencast reviews it and will be in touch." (`answerClaim`, 422 `privacy_claim`); "That claim has been dealt with." (`resolveClaim`, 409 `not_open`); "Only a rights reviewer or an admin can do that." (403 `desk_role`) |
| Master control | a privacy complaint's tag "Off air, privacy complaint" |

### Network desk: Reserved call signs (follow-up Phase 0, item 11, 2026-09-29)

Words the frame (desk-pages 02) doesn't have. The frame's own words are used where they exist ("Reserved call signs", "{26} held from the waitlist in the {Inland Empire}, {9} with a channel held.", "Invite the next 10", the columns Call sign, Channel, Reserved by, Since, State, the states "Invited, signing on", "Waiting for an invite", "Same name twice", "Not allowed", "Ends tomorrow", and the buttons Open, Invite, Decide, Suggest, Extend, Release).

| Where | Words |
|---|---|
| The table | states "Invited", "Held after sign-off", "Ends today", "Ends {Oct 3}"; "Reserved by" for a hold after a sign-off "A station that signed off" with "Held for it for a year"; "{2} people" with each one's line ("A skate crew, Fontana; A church, Fontana"); the footnote "Reservations last {120} days, unless the person signs on or the desk extends them. {14} days before the end, they get a reminder."; empty "Nobody in the {Inland Empire} has reserved a call sign yet." |
| Stations against the rules | "On the dial, against the rules now"; "These stations chose their call signs before today's rules. They keep them; nothing changes on the air."; columns "Call sign", "Channel", "Station", "Why" |
| Invite the next 10 | "Invite the next {10}"; "In reservation order, in the {Inland Empire}. Each gets an email to set up their station with their call sign."; "{12} more after these."; "Send {10} invites"; "Nobody to invite" with "Everyone waiting in the {Inland Empire} has an invite, or needs a decision first."; toast "Invited {10}: {TACO, SKAT, …}." / "Nobody was waiting for an invite." |
| Decide | "{VALE}: {2} people asked"; "The earlier one usually keeps it, but the fairest answer isn't always the earliest. The others keep their place in line with the name held for them instead, and get an email."; "Who keeps {VALE}" with "{A skate crew, Fontana}. Asked {Sept 8}. holds {37.1}"; "Hold instead for {Pastor Ellis}" with "Free and allowed. Empty: the first free suggestion."; "Keep it for {Dani R.}"; toast "{VALE} stays with {Dani R.} {VALEY} is held instead for the other." |
| Suggest | "{KFRO} isn't allowed" with the reason; "{J. Park} keeps their place in line and any channel held, and gets an email saying why, with the other names as well."; "Hold instead" with each "Free, and allowed"; "Or another name"; "Hold {FRO} instead"; toast "{FRO} is held for {J. Park} instead of {KFRO}." |
| Release, Open, Extend, Invite | "Release {HOOP}?" with "{Ruth O.}'s hold ends now, and channel {52.1} is free again. They get an email saying so."; toast "{HOOP} and {52.1} are free." / "{DUSK} is free."; Open: "Email", "Reserved", "Ends" ("No end date"), "Channel held" ("None yet"), "Invited" ("Not yet"), "Their station" ("Being set up", "Not started"), "Invite" / "Invite again"; toasts "{TACO} is held until {January 25}.", "Invited {Marco T.} to sign on as {DUSK}.", "Invited {Ruth O.} again." |
| Refusals (the API) | "Four letters starting with K or W look like a real broadcast call sign."; "{ESPN} belongs to someone else." / "{ESPNX} looks like {ESPN}, which belongs to someone else."; "Opencast doesn't allow that name." (the denylist's word is never repeated); each followed by " Try {FRO} or {FROS}." (" Try another." / " Choose another." when nothing's free); "{WREN} isn't allowed either. {reason}"; "{VALE} is taken. Choose another."; "Someone else asked for {VALE} too. Opencast's team is deciding who keeps it, and will write to you." (setup, 409 `call_sign_undecided`); "Two people asked for {VALE}. Decide who keeps it first."; "{KFRO} isn't allowed. Suggest another name first."; "There's no email to send the invite to."; "Nobody else is waiting for {MESA}."; "{GRIT} is allowed: there's nothing to suggest."; "Only this market's lead or an admin can see its reservations." |
| The waitlist (API and site) | "{VALE} is on hold for you. Someone else asked for it too: Opencast's team decides who keeps it, and writes to you either way."; "{VALE} is already on hold for you."; "{VALE} is taken. Try {VALES} or {VALEY}."; the site's check "Someone else asked for {VALE} too. You can still ask: Opencast decides who keeps it." |
| Emails | Invite: "Sign on as {DUSK}" / "The {Inland Empire} is opening on Opencast, and {DUSK} is held for you until {January 1}. So is channel {35.1}. Sign in with {email} to set up your station. It starts with {DUSK} as its call sign and {35.1} as its channel: nobody else can have them." (changed 2026-09-29, below: it was "Choose {DUSK} as its call sign and {35.1} as its channel: nobody else can.") / "Set up your station". Reminder: "{GOLD} is held until {September 29}" / "Your hold on {GOLD} ends on {September 29}. Set up your station before then to keep it. After that, anyone can reserve it." Ended: "Your hold on {GOLD} has ended" / "{GOLD} was held for you until {September 29}. If it's still free, you can reserve it again on the waitlist." Released: "Opencast's team ended your hold on {DUSK} and channel {35.1}. If it's still free, you can reserve it again on the waitlist." Not kept: "{VALE} went to someone else" / "Two people asked for {VALE}, and Opencast's team gave it to the other. We've held {VALEY} for you instead, in the same place in line. You can choose another call sign when you set up your station." (no suggestion: "You can reserve another on the waitlist."). Not allowed: "{GRIT} isn't allowed" / "{reason} We've held {GRAN} for you instead, in the same place in line. {GRAY} is free too, if you'd rather. You can choose another call sign when you set up your station." Footer "You're getting this because you reserved a call sign on Opencast's waitlist." |
| Settings, Rules | group "Call signs"; "Reserved call signs are held for" with "From the day they're reserved, unless the person signs on or the desk extends it. A reminder goes before the end" and "{120} days, a reminder {14} days before"; "Call signs Opencast won't allow" with "Checked on the waitlist and at station setup. Stations already on the dial keep theirs" and "K or W and three letters, {25} brands and stations, {3} on the denylist"; fields "Refuse K or W and three letters" (Yes, No), "Brands and stations", "Denylist" ("Capital letters, a comma between."), "Reminder, days before the end"; "{NO-WAY} isn't 2 to 12 letters." |

### Network desk: Catalog sponsors (follow-up Phase 0, item 11, 2026-09-29)

Words the frame (desk-pages 03) doesn't have. The frame's own words are used where they exist ("Catalog sponsors", "Businesses and organizations thanked in the catalog's credit.", "Add a sponsor", the four figures' captions, "Sponsor", "Credited in", "Where", "A month", "Credits", "Clear", "The house sponsor, thanked wherever nobody else is", "Every catalog series", "Every market", "Since {August}", "Open slot", "{Inland Empire Libraries'} credit", "{Nights at the observatory} is made possible by", "Checked against the same credit rules as station sponsorships: who they are, not what they sell.", "Airs on", "{6} {Inland Empire} stations", "Renews", "{October 1}").

| Where | Words |
|---|---|
| The figures | "Market with a local sponsor slot open" (one); "Share to the creator fund" (once it's set) |
| The list | Clear's "A month": "Not billed"; a sponsor's line "Offered, waiting for their answer", "Starts {October 1}", "Ends {October 31}", "Credited this month", "Ended", "Lapsed: a month it couldn't pay", "Said no"; the market switcher "All markets" |
| The grid | "By series and market" with "Who the credit thanks in each, and what a slot costs a month"; "Series"; cells "{$150.00} a month", "Open slot, {$150.00} a month", "Not for sale: no price set", "Offered to {Orange Street Coffee}", "Starts {October 1}. Clear until then", "Its every-series sponsor", "Taken"; the note "A slot is a series in a market: its credit airs once an hour where the series airs there, on the catalog station and every station that carries it. Prices are set in Settings, Rules." |
| The pane, a sponsor | "Ends", "Starts", "Offered" with "Waiting for their answer", "Not renewing", "A month", "Offered by" / "Assigned by", "No {Los Angeles} stations this week"; "End sponsorship", "Withdraw the offer" |
| The pane, a slot | "{Cartoons, 1928 to 1936} in {Inland Empire}"; "Nobody has bought it, so the credit thanks Clear."; "Price" ("{$150.00} a month", "Not set yet"); "Airs" ("Airs {12 times a day / once a day / less than once a day} here, on {5} stations", "Not airing here this week"); "Credits in {September}"; "Offered to" "{Orange Street Coffee}, waiting for their answer"; "Offer it", "Assign it"; "Not for sale until its price is set in Settings, Rules." |
| The pane, Clear | "Clear is thanked anywhere no other sponsor has bought the slot, so the catalog is never unsponsored."; "Thanked in" "{16} of {18} slots"; "Billed" "Not billed. Whether Clear pays for the slots it fills isn't decided"; "Last month" "{14} slots, {2,298} credits" / "Nothing recorded yet" |
| Offer or assign a slot | "Offer a slot" / "Assign a slot"; "A series in one market, credited once an hour where it airs there, including on the stations that carry it. Held and renewed monthly, like any sponsorship."; "How" ("Offer it", "Assign it"); "Series", "Market", "Every catalog series"; "{$150.00} a month, from Settings. {5} stations air it there." / "Not for sale: its price isn't set yet (Settings, Rules, Catalog sponsorship)." / "Someone has this slot, or has been offered it. End that first."; "Find the business" ("Name"); "Business" ("{Orange Street Coffee}, {Redlands}", "Nobody by that name"); "Their credit" with "Who they are and where. No prices, offers or calls to action: the same rules as station sponsorships."; the slate's stand-ins "Their name", "Their credit"; "Starts" ("{September 1}, this month", "{October 1}") with "Held on the 1st of each month from then, and renewed while they can pay."; "They've agreed to sponsor it" with "Their first month, {$150.00}, is held from their balance {now / on October 1}."; "Find the business first.", "Write their credit: who they are and where.", "Only assign it once they've agreed."; "Send the offer", "Assign it" |
| Toasts | "Offered to {Orange Street Coffee}. It's theirs to answer."; "{Orange Street Coffee} is thanked from {October 1}."; "The offer to {Orange Street Coffee} is withdrawn."; "{Inland Empire Libraries} is thanked to the end of {September}, then Clear again." |
| The API's refusals | "This slot isn't for sale yet: {a series' / every series'} price in {Los Angeles} isn't set (Settings, Rules, Catalog sponsorship)." (422 `not_for_sale`); "{Cartoons, 1928 to 1936 / Every catalog series} in {Inland Empire} is taken or offered. End that first." (409 `slot_taken`); "Choose the 1st of this month or a later one." (422 `bad_month`); "{Tumbleweed Books} doesn't have {$300.00} available to hold for the first month." (422 `insufficient_balance`); "{Tumbleweed Books} has closed its account." (422 `business_closed`); "The business answers this offer itself." (422 `catalog_offer`); "That offer has been answered, or withdrawn." (422 `already_answered`); a credit that fails the rules gets the station sponsorships' words |
| Settings, Rules | the group "Catalog sponsors"; "Catalog sponsorship" with "A month: one catalog series in a market, or every catalog series in a market. A slot is for sale once its price is set" and "{$150.00} a series, {$400.00} every series a month"; "Where catalog sponsorship goes" with "Opencast, the co-op pool and the creator fund. Until it's set, it stays with the catalog station" and "{10}% Opencast, {5}% the pool, {5}% the creator fund"; fields "One series in a market, a month", "Every series in a market, a month", "Opencast", "The co-op pool" |
| On air and in master control | the catalog credit "{Nights at the observatory} is made possible by" / "{Inland Empire Libraries}" / their line, or "Clear" / "The member-owned co-op", in the series' colour; the log's credit row "{Clear}" with "{Nights at the observatory} is made possible by"; the hold's memo "Held for a month of catalog sponsorship" |
| Mock mode | "Mock mode: the business's side"; "They say yes", "They say no" |

### Waitlist invites open station setup (the follow-up to Reserved call signs, 2026-09-29)

No frame draws a waitlist invite's link. Master control's `/control/new?reservation=<id>` is setup step 1 (A.1) with what's held filled in; its other states are the team invite's card (the sign-in card, viewer/you 01.1). The invite's email keeps its title, button and footer.

| Where | Words |
|---|---|
| The invite's email | body, second paragraph: "Sign in with {skat@example.com} to set up your station. It starts with {SKAT} as its call sign and {38.1} as its channel: nobody else can have them." (no channel: "It starts with {SKAT} as its call sign: nobody else can have it.") |
| Your station, from the invite | under the call sign, locked: "Held for you on the waitlist"; under the channels: "{38.1} is held for you. If you choose another, {38.1} is let go." |
| Signed out | kicker "Master control"; title "Sign on as {SKAT}"; "{SKAT} is held for you in the {Inland Empire} until {December 29}. So is channel {38.1}."; "Sign in with {s…@example.com} to set up your station." ("Sign in to set up your station." without an address); button "Sign in to set up"; the team invite's foot "Master control is where stations run their dial. Each person signs in with their own account." |
| Signed in as someone else | kicker "Sign on as {SKAT}"; title "This invite is for another email."; "This invite is for {s…@example.com}; you're signed in as {sam@example.com}." and "Sign in with {s…@example.com}, the address {SKAT} was reserved with, to set up your station."; buttons "Sign in with another email", "Back to master control" |
| Ended | title "This invite has ended."; "{GOLD} was held for you until {September 25}. If it's still free, you can reserve it again on the waitlist." (someone else's station has it: "A station has already been set up as {SKAT}. You can reserve another call sign on the waitlist."); buttons "Join the waitlist" (the site's waitlist), "Back to master control" |
| Couldn't load | title "That invite didn't open."; the error; "Try again". An unknown one: "There's nothing here." |
| The API's words | "This invite is for {s…@example.com}; you're signed in as {sam@example.com}. Sign in with {s…@example.com} to use it." (403 `reservation_email_mismatch`); "This invite has ended: {GOLD} isn't held for you any more. If it's still free, you can reserve it again on the waitlist." (422 `reservation_ended`); "A station is already being set up as {SKAT}." (409 `reservation_used`); "A studio has a handle, not a call sign." (422 `studio`) |

### Network desk: Settings, Storage maintenance (2026-09-29)

No frame draws it. A section of Settings (desk-pages 04's frame: the sub-rail, the pane, the rules' rows and dialogs), for admins only: rights reviewers and market leads don't see it in the sub-rail, and its address takes them to Rules.

| Where | Words |
|---|---|
| The sub-rail and pane | "Storage maintenance"; "The one-off storage steps, checked and applied on the server. Admins only."; the pane's first line "The one-off storage steps, run on the server. Check first: it only reports. Apply changes what the check says, in the background; each apply goes in the change log. Nothing here unpins from Pinata or deletes an original." |
| Each job | "Files stored by location" with "Files from before content IDs, found by a disk path or a URL. Apply stores each one by its content ID, points its row there and carries over what was prepared from it."; "Pinata pins" with "Pins copied off Pinata into Opencast's storage and checked by hash; the items that used a pin then play the copy. The catalog's pins stay on IPFS, and nothing is unpinned here."; "Items on their 720p copies" with "Items stored before September 29 still air from a copy capped at 1280 px wide. Apply queues their originals for the worker to prepare, then moves each item onto its original once it's ready."; buttons "Check", "Apply" (spoken "Check: {Pinata pins}", "Apply: {Pinata pins}") |
| A check's summary | "{3} files stored by location" (", {1} can't be read"; none: "No files stored by location"); "{0} Pinata pins to copy" (" ({1.2 GB})"; ", {2} catalog pins stay on IPFS"); "Pinata isn't connected here" with "Set PINATA_JWT on the API to connect it. Until then there's nothing to copy."; "{2} items still airing from 720p copies" (none: "No items left on their 720p copies") with "{2} to prepare, {0} ready to move, {1} with no original stays on its copy."; before any: "Not checked yet"; a check that stopped: "The last check stopped" |
| While it runs | "Checking, {1} of {3} files" / "Applying, {0} of {1} pin" / "Checking…" beside a progress bar (spoken "{Files stored by location}: checking") |
| After an apply | prepare from originals: "Queued for the worker: {2}. Left to prepare: {2}. Ready to move: {1}. Apply again once the worker has prepared them." and, when done, "Nothing queued or left to prepare." |
| The last runs | "Last check: {Dee A.}, {September 27 at 8:42 pm}." and "Last apply: {Dee A.}, {September 27 at 8:42 pm}. {1 item moved onto its original, 1 queued for the worker}." (others: "{2} files stored by content ID, {1} couldn't be read and stays where it is"; "{3} pins copied and checked, {4} files now play the copy. Nothing unpinned"); a run that stopped: "Stopped: {why}."; "Download report" (spoken "Download report: {Pinata pins}, last check"), a JSON file |
| The Apply dialog | "Store {3} files by content ID?" with "Each file is read, stored by its content ID in Infrequent Access, and its row points there. What was prepared from it carries over, so nothing is prepared again." and "Files that can't be read are left as they are. Nothing is deleted.", button "Store them"; "Copy {2} Pinata pins?" with "Each pin but the catalog's is copied into storage ({800 MB}) and checked by hash; the items that used it then play the copy." and "The pins stay on Pinata. Unpinning is a separate step, and it isn't done here.", button "Copy them"; "Prepare from the originals?" with "{2} originals are queued for the worker, soon after what airs within the hour.", "{Items / 2 items} whose originals are ready move onto them, as new file versions. The 720p copies go once nothing points at them; originals are never deleted." and "Apply again once the worker has prepared what's queued, until nothing is left.", button "Apply"; the subtitle "From the last check, {September 25 at 10:02 am}." or "Not checked yet: Check first to see what it would do."; "Cancel" |
| Toasts | "Checking: {Files stored by location}."; "Applying: {Items on their 720p copies}. It's recorded in the change log." |
| Change log | the filter "Storage"; each apply: "{Files stored by location}: Stored {2} files by content ID of {3} stored by location; {1} couldn't be read"; "{Pinata pins}: Copied {1} Pinata pin of {1} into storage, checked by hash, and relinked {1} row. Nothing unpinned"; "{Items on their 720p copies}: Moved {2} items onto their originals; {0} queued for preparing" ("; {1} couldn't be prepared"); a stopped apply: "{Job}: the apply stopped. {why}" |
| The API's words | "{Files stored by location}: {Dee A.} started {a check / an apply} that's still running. Wait for it to finish." (409 `already_running`); "Pinata isn't connected here (PINATA_JWT isn't set on the API), so there's nothing to copy." (422 `pinata_not_connected`, and the check report's note); "It's still running: its report comes when it finishes." (409 `still_running`); a run nothing was heard from: "It stopped: nothing heard from it for 30 minutes (the API may have restarted). What it did before that stays done." |

### Watch data: the Audience page, Offering your programs, "Not for me" and the desk's rules (follow-up Phase 1, 2026-09-29)

No frame draws them (docs/apps/open-questions.md A180 to A184). The API's own note, "Not enough viewers yet", is used as it comes.

| Where | Words |
|---|---|
| Audience, By program (master control, web) | column "Watch time" (the radio band: "Listening time"); values "{48} min", "1 hour", "{1.5} hours", "{368} hours"; "Counting…" (on now, or not worked out yet); "Not enough viewers yet"; "–" (no watch data); under the program's title, the tune-away line's sentence "Most left around {9:24 pm}" or "Nobody left before the end", then "{4} said “Not for me”" when any counted |
| Audience on the phone | a row's line "{8:00 pm}. {21 hours} watched" ("listened" on the radio band), or "{8:00 pm}. Counting…", "{8:00 pm}. Not enough viewers yet" |
| Offering your programs (Offered by {BEAT}, and a studio's Your programs) | heading "Across every station" with "The last 30 days"; lead "Every station that aired your programs, added up. Other stations' airings are counted together once there are enough of them, so no station's own audience shows."; a program's line "{34} airings on {2} stations", "Radio band, {27} airings on {1} station"; "{3} airings not counted yet" / "1 airing not counted yet"; figures "Watch time" / "Listening time", "Peaks, added up", "Stayed to the end"; the line's sentence "Most left {14} minutes in" / "Most left a minute in" / "Nobody left before the end"; "Not enough viewers yet"; empty "None of your programs aired in the last 30 days."; the list's spoken name "Your programs across every station" |
| The player, web and phone | the button "Not for me" (spoken "Not for me: {Saturday Reel}"); after it, "Noted"; toasts "Noted. Only a count is kept, never who said it.", "You've already said {Saturday Reel} isn't for you.", "Nothing is airing right now." |
| TV mode, the menu rail | the item "Not for me" with the program's title beside it, "Noted" once said; the line under the items: "Noted. Only a count is kept, never who said it.", "You've already said {Saturday Reel} isn't for you.", "Nothing is airing right now." |
| Network desk, Settings, Rules | groups "Watch data" and "Features"; the form's fields "Days" (how long sessions are kept), "Viewers at once", "Other stations' airings, together", and "In the apps" with "On" / "Off". The rules' titles, details and values are the registry's (`packages/contracts/src/rules.ts`) |

### Pay-as-you-go notices (added 2026-09-29, follow-up Phase 2)

To a station's owners (push, email and the notice in master control; always on, like low balance), from `apps/api/src/v1/modules/ledger/billing.ts`. Month names, amounts, dates and card labels are filled in; examples are from the STOP demo (`npm run demo:billing -w @opencast/api`). The Station account pane's own words come with its screens.

- **Usage summary**, when a month closes, inside the free allowance: "October: inside the free allowance" / "Storage 6.00 GB-months; Live hours 3 hours. Nothing to pay."
- **Usage summary**, something to pay: "October's usage: $42.15" / "Storage 40.00 GB-months; Relays, everything you air 186 hours; Live hours 10 hours. $42.15 came from your earnings. Nothing is due." (or "… $X was charged to Visa ending 4242", "… $X was paid from Clear", "$X is still due.", "$X is added to next month's bill.")
- **Charge failed**: "Your card wasn't charged for October's usage" / "Visa ending 0002: Your card was declined. $149.40 is due. Relays and live shows keep going until November 15, then pause until it's paid. Your channel stays on air. Add another card or pay from Clear in Station account."
- **Nothing to charge** (grace starts): "October's usage is due" / "$31.00 is due and there's no card or Clear wallet to charge. Relays and live shows keep going until November 15, then pause until it's paid. Your channel stays on air. Add a card or connect Clear in Station account."
- **Approve in Clear** (grace starts): "Approve October's usage in Clear" / "$52.00 is due. Approve the payment from your Clear wallet in master control, Station settings, Station account. Relays and live shows keep going until November 15, then pause until it's paid. Your channel stays on air."
- **Grace ending**: "Relays and live shows pause in 3 days" / "$149.40 is still due for October's usage. Pay by November 14 to keep them going. Your channel stays on air either way."
- **Paused**: "Relays and live shows are paused" / "$149.40 is still due for October's usage. Your channel is still on air. Pay from your card or Clear in Station account to bring relays and live shows back."
- **Resumed**: "Relays and live shows are back" / "Thanks: what was due is paid, so relays and live shows are running again."
- **Paid during grace** (before anything paused): "Your usage is paid" / "Thanks: nothing is due. Relays and live shows carry on as they were."
- **Cap reached**: "Relays, everything you air reached $2.00 for December" / "You capped “Relays, everything you air” at $2.00 a month. Relays of everything you air are paused until January 1, or raise the cap in Station account. Your channel stays on air." (storage: "New uploads and imports are paused…"; live hours: "Live shows are paused…")
- **Errors** (API): "Storage reached its cap for December ($0.00). New uploads wait until January 1, or raise the cap in Station account." (409 `storage_paused`); "Nothing is due." (409 `nothing_due`); "Add a card first." (409 `no_card`); "$0.30 is under the card minimum, so it's added to next month's bill." (409 `under_card_minimum`); "The station pays from Clear: approve the payment from your Clear wallet." (409 `pay_from_clear`); "Clear lets Opencast only read your Clear wallet, so it can't pay from it. Add a card instead." (409 `clear_read_only`); "Relays, live shows only is free, so it has no cap." (422 `not_cappable`).
- **Statement lines** (Earnings, the usage section): "Usage, taken from earnings"; each type's own line, e.g. "Storage" with "40.00 GB-months, 10.00 free, at $0.04 a GB-month", "Relays, everything you air" with "186 hours, at $0.20 an hour"; "Usage still owed" with "Taken from earnings before the next payout; what earnings don't cover is charged at month end"; on a month's statement "Usage taken from earnings when the month closed", "Usage charged to Visa ending 4242", "Usage paid from Clear", "Usage still due" with "Charged to your funding source; relays and live shows pause if it isn't paid within the grace period".

### Station account, the statement's usage section and the banners (follow-up Phase 2, 2026-09-30)

No frame draws them (docs/apps/open-questions.md A185 to A191). Amounts, months, dates and card labels are filled in; the examples are the mocks' (BEAT paid from earnings, HALL in grace, at the reference's Saturday). The API's own words (its errors, a Clear wallet's "why") are used as they come.

| Where | Words |
|---|---|
| Settings, Station account, the lede | "Being on air is free. {BEAT} pays only for storage, relays of everything it airs and live hours, from its earnings first."; a studio: "{Inland Sound Lab} pays only for what it uses past the free allowance, mostly storage, from its earnings first." |
| This month | heading "This month" with "{September} so far, estimated to {September 30}"; columns "So far", "Month, estimated" (the first, spoken, "Usage"); each type's name as the contract has it ("Storage", "Relays, everything you air", "Live hours", "Radio live", "Relays, live shows only"); tags "Cap reached", "Paused"; the detail "{37.80 GB-months} so far, {42} GB kept today." / "{156.9 hours} so far, about {180 hours} by the month's end." then the allowance "{10} GB free a month, all used", "{3.5} of {10} GB free left", "{5} free hours a month, all used", "{3.5} of {5} free hours left", then the price "{$0.04} a GB-month", "{$0.20} an hour", "Free", "Price not set yet", "Always free" (live shows only); amounts or "Free"; "Total"; under it "Free each month: {10} GB of storage and {5} live hours. Left in {September}: {0} GB and {3.5} live hours. The estimate is storage as it stands today and hours at this month's pace." |
| Caps | heading "Caps" with "A month never costs more than its caps"; a row's detail "No cap. At a cap: {relays pause for the rest of the month}; your channel stays on air.", "{$31.39} of {$60.00} so far. At the cap: …", "Reached {$5.00}. {Relays pause for the rest of the month}; your channel stays on air. Raise the cap to bring it back."; what each pauses: "Relays pause for the rest of the month", "New uploads and imports pause for the rest of the month", "Live shows pause for the rest of the month (station ID and bumpers air instead)"; the value "{$60.00} a month" or "No cap"; buttons "Set a cap", "Change", "Remove" (spoken "Set a cap: {Live hours}", "Change: {…}", "Remove cap: {…}"), and editing, the field (spoken "Monthly cap for {Live hours}"), "Save", "Cancel"; "Enter a dollar amount, like 25.00."; toasts "{Live hours} is capped at {$10.00} a month.", "{Relays, everything you air} has no cap." |
| What pays | heading "What pays" with "Earnings first, always"; "{BEAT}'s earnings" with "Usage is taken from earnings first, before each payout and when the month closes. Available now"; "Then, what earnings don't cover" (spoken "What pays what earnings don't cover"); options "Your Clear wallet" with "{0x1111…1111}. You approve each payment in Clear" (or the API's why: "Connect Clear first.", "Clear lets Opencast only read your Clear wallet, so it can't pay from it.", or "Clear can't pay here"), and "{Visa ending 4242}" with "Charged at the month's end, off session" (expired: "Expired. Replace it to pay with a card"), or "A card" with "Add a card to choose it"; under them "You haven't chosen, so {the card / your Clear wallet} pays: a Clear wallet with full access first, otherwise the card.", "Your choice. Choose the other any time.", or "Nothing can pay what earnings don't cover yet. Add a card, or connect Clear with full access below."; the card's row "{Visa ending 4242}" with "Expires {August 2029}. Saved with Stripe" ("Expired {March 2027}"), buttons "Replace", "Remove" (spoken "Remove {Visa ending 4242}"), or "No card" with "A card saved with Stripe pays what earnings don't cover" and "Add a card" ("Cards can't be saved on this server"); toasts "Clear pays what earnings don't cover.", "{Visa ending 4242} pays what earnings don't cover.", "{Visa ending 4242} is removed."; operators: "Then, what earnings don't cover" with the source's name or "Nothing yet" |
| Bills | heading "Bills" with "Each month's usage, newest first"; a month's name, the tag "Due"; details "So far. {$26.06} from earnings, {$5.21} to take at the month's end.", "{$38.94} from earnings.", "{$38.94} from Clear.", "{$18.94} charged to {Visa ending 4242}.", "{$96.40} due. {Visa ending 0002}: {Your card was declined}.", "Inside the free allowance.", "Taken from earnings before each payout", "Paid"; none yet: "No bills yet. The first comes when this month closes." |
| The standing (the pane's notice) | in grace: "{$96.40} is due for {August}'s usage" with "Relays and live shows keep going until {October 4} ({7 days} / 1 day), then pause until it's paid. Your channel stays on air." then the last try "{Visa ending 0002}: {Your card was declined.}"; paused: "Relays and live shows are paused" with "{$96.40} is still due for {August}'s usage. Your channel is still on air. Paused: {Relays of everything you air; Live shows (station ID and bumpers air instead)}." then the last try and "Pay it to bring them back."; with nothing to pay from: " Add a card or connect Clear with full access to pay it."; due while ok: "{$0.30} is due for {August}'s usage" with "Nothing is paused."; operators: " An owner can pay it here." and, above the sections, "Only owners change caps and what pays, or pay what's due." |
| Pay now | buttons "Pay now" (the card), "Pay from Clear", "Add a card" (nothing to pay from); a declined card: "{Your card was declined.} Replace the card to pay it." (", or choose Clear" when it can); toasts "{$96.40} is paid. Relays and live shows are back." / "{$96.40} is paid. Nothing is due." |
| Add a card (modal on the web, sheet on the phone) | title "Add a card" or "Replace the card", "For {BEAT}'s usage."; Stripe's own form; with no Stripe key, the stand-in "Stripe's card form goes here" with "This server has no Stripe publishable key, so no card number is asked for. Saving adds the test card, Visa ending 4242."; the note "Stripe keeps the card; Opencast never sees its number. Usage comes out of {BEAT}'s earnings first, and the card pays only what they don't cover. Charges show OPENCAST on the card's statement."; buttons "Save card", "Save test card"; errors "Stripe's card form didn't load. Try again.", "Stripe's card form didn't load. Check the connection and try again.", "That card wasn't saved. Try again.", "Stripe is still checking the card. Try again in a moment."; toasts "{Visa ending 4242} is saved." / "{Visa ending 4242} is saved, and {$96.40} is paid. {Relays and live shows are back. / Nothing is due.}" |
| Payouts (the pane's existing part, now headed) | heading "Payouts" with "Where {BEAT}'s earnings go" |
| The banner (Monitor and Earnings, grace or paused) | "Relays and live shows pause on {October 4}" with "{$96.40} is due for {August}'s usage. Your channel stays on air."; "Relays and live shows are paused" with "{$96.40} is still due for {August}'s usage. Your channel is still on air."; the button "Station account" |
| A statement's usage section (Earnings) | heading "Usage" with "Taken from earnings before the payout"; each type's line "{38.50 GB-months}, {10.00} free, at {$0.04} a GB-month", "{168 hours}, at {$0.20} an hour", "{3 hours}, free", "{42 hours}, price not set yet"; the note "Each type is shown with its units and price. Only what was taken from earnings counts in the total."; a monthly statement's title "{August}" and "{August 1} to {31}." |

### Platform connections and relay viewers (follow-up Phase 3, 2026-09-30)

No frame draws most of these beyond step A4's Translators page (`control/opencast-master-control.html`); the words below are the API's and the mocks'. Names, counts and amounts are filled in.

| Where | Words |
|---|---|
| Translators, a connected platform | "{YouTube}" with "{Inland Beat channel}, signed in. Opencast starts each broadcast for you"; "{Twitch}" with "{inlandbeat}, signed in"; a manual one: "{Facebook}" with "Added with its address and key. Viewers there can't be counted"; "Remove" |
| Translators, needs signing in again | "{YouTube} needs you to sign in again" with "It stopped accepting Opencast's sign-in, so viewers there aren't counted and paid promotion isn't marked. Relays keep going with its key." and "Sign in again" |
| Add a platform | "Sign in to YouTube", "Sign in to Twitch", "Add another service"; the form's fields "Name", "RTMP or RTMPS address", "Stream key" with "Stream keys are encrypted and never shown again."; signing in isn't set up on the server: "Signing in to {YouTube} isn't set up here yet. Add it with its address and stream key instead." (409 `sign_in_not_set_up`); "Use an rtmp:// or rtmps:// address." |
| Back from signing in (the callback's `?platform=…`) | connected: "{YouTube} is connected."; `error=denied`: "{YouTube} wasn't connected: the sign-in was cancelled."; `expired`: "That sign-in took too long. Try again."; `scopes`: "{YouTube} needs every permission Opencast asked for. Try again and leave them all on."; `failed`: "{YouTube} didn't connect. Try again in a moment."; `secrets_key_missing`: "Stream keys can't be stored until PLATFORM_SECRETS_KEY is set on the server." |
| Paid promotion, a manual destination | "Spots are airing on {Facebook}. Mark the stream as containing paid promotion there." |
| Business results, an airing's relay line | "Relay viewers, as reported by YouTube" with "{200} × {60%} in your area × {$8.00} ÷ 1,000 = {$0.96}" (online: "{200} × {$8.00} ÷ 1,000 = {$1.60}"); "Relay viewers, waiting for YouTube's location data" with "{$1.60} held until it arrives"; "Relay viewers, as reported by Twitch" with "Twitch doesn't report where viewers are, so they aren't billed to local businesses"; "YouTube had no location data for these viewers, so they aren't billed"; "YouTube's location data didn't arrive in time, so this wasn't charged"; "No viewers were reported during the spot" |
| Business results, Opencast's viewers for a local business | "{70} in your area (of {100} tuned in) × {$8.00} ÷ 1,000 = {$0.56}" |
| Business statements | "Relay viewers, as reported by YouTube" (and Twitch) with "{1 airing}"; "Relay viewers, waiting for YouTube's location data" with "{3 airings}" (shown, included above); the ledger's returns: "Returned: no location data from YouTube in time", "Returned: Twitch relay viewers not billed" |
| Station earnings and statements | "Relay viewers, as reported by YouTube", "Relay viewers, as reported by Twitch" |

### Relays: modes, breaks, the bug, restarts and alerts (follow-up Phase 3, the relay half, 2026-09-30)

Step A4 (`control/opencast-master-control.html`) draws the Translators page's relay mode ("Live shows only", "Everything {BEAT} airs"), "During breaks, relays show: Your spots / Station ID slate", "Station bug on relays" and "Relayed this month"; those words are the frame's. The API and the mocks (`apps/web/src/control/mocks/handlers/relay.ts`) add these. Names, times and amounts are filled in.

| Where | Words |
|---|---|
| Translators, a platform's next restart (`RelayRestart.label`) | "{Twitch} restarts {Saturday} at {11:59 pm}, during a break" (the weekday within a week, else "{October 9}"); with no break inside the limit: "{Twitch} restarts {Saturday} at {11:59 pm}"; a restart the station has to do (a pasted Facebook key): "{Facebook} needs a restart by {Saturday} at {11:59 pm}. Restart it there, during a break"; the log: "{Twitch} restarted {Friday} at {12:59 am}, during a break", "{Twitch} couldn't restart {Saturday} at {11:59 pm}" |
| Translators, "Save relays as YouTube videos" (the switch; no frame) | "Save relays as YouTube videos" with "YouTube saves only broadcasts under 12 hours. With this on, Opencast starts a new broadcast about every 11 hours, during a break." |
| Translators, the relay's state (no frame) | stopped: "Relays stopped" with "Your channel is still on air on Opencast. The relay keeps trying and starts again on its own."; paused: "Relays of everything you air are paused" with "{The cap for relays is reached for this month / A bill is unpaid}. Live shows still go out, and your channel stays on air." |
| Notice (kind `relay`), a relay stopped (station team and the Network desk) | "{BEAT}'s relays stopped" with "The relay to your other platforms stopped ({Connection refused}). Your channel is still on air on Opencast. The relay keeps trying and starts again on its own." |
| Notice, back | "{BEAT}'s relays are back" with "The relay to your other platforms is sending again." |
| Notice, a restart due (a pasted key) | "Restart your stream on {Facebook}" with "{Facebook} needs a restart by {Saturday} at {11:59 pm}. Restart it there, during a break: it can't run longer than its limit, and Opencast can't restart a stream added with a key." |
| Notice, a restart failed | "{Twitch} couldn't restart" with "Opencast tried to restart your stream on {Twitch} before its limit and couldn't ({reason}). It tries again at the next break." |
| Notice, paid promotion on a pasted key | "Mark your stream on {Facebook} as paid promotion" with "Spots are airing on your relay to {Facebook}. Opencast can't mark that stream for you, so turn on its paid promotion setting there." |
| Translators, the paid-promotion reminder's button (no frame) | "Done, it's marked" (dismisses `dismissPaidPromotionReminder`) |

### Translators, relay viewers on results and earnings: the screens (follow-up Phase 3, 2026-09-30)

Step A4 (`control/opencast-master-control.html`) draws the Translators page; its words are the frame's ("Connected platforms", "Add a platform" with "Sign in to YouTube or Twitch, or add any other service with its RTMP address and stream key", "What gets relayed", "Live shows only", "Everything {BEAT} airs" with "The whole schedule as one continuous stream, to every connected platform at once. Pay as you go, per hour relayed, not per platform", "On every relay", "During breaks, relays show" with "Your spots" / "Station ID slate" and its note, "Station bug on relays", "Relayed this month" with "Nothing yet", the note on counting viewers, and the foot "If a relay stops, {BEAT} keeps airing on Opencast. Only the copies elsewhere pause, and they restart on their own."). The platform lines, sign-in returns, restarts, the relay's state, "Save relays as YouTube videos" and the paid-promotion reminder are the section above ("Platform connections and relay viewers", "Relays"). These are new; names, times and amounts are filled in. A192 to A199 in open-questions.md.

| Where | Words |
|---|---|
| Translators, the lede (the page, setup step 4, Settings) | "Simulcast {BEAT} to the platforms you already use. Opencast stays {BEAT}'s home; everything here is optional and can be added any time." (the frame's, now on all three) |
| Translators, YouTube or Twitch not connected | "Not connected. Sign in, and Opencast starts each broadcast and counts viewers" (YouTube), "Not connected. Sign in, and Opencast gets the stream key and counts viewers" (Twitch); buttons "Connect with Google", "Connect with Twitch"; signing in not set up on the server: "Signing in to {YouTube} isn't set up here yet. Add it with its address and stream key instead." |
| Translators, a platform added by key with its own name | "{Inland Beat Page}. Added with its address and key. Viewers there can't be counted" |
| Translators, keys can't be stored (`canStoreKeys` false) | "Stream keys can't be stored on this server yet, so nothing can be connected or added. Platforms already connected keep relaying." (Connect and Add are off) |
| Back from signing in, `error=not_set_up` and `error=secrets_key_missing` (replacing the developer's words above) | "Signing in to {YouTube} isn't set up here yet. Add it with its address and stream key instead."; "{YouTube} wasn't connected: stream keys can't be stored on this server yet. Nothing was saved."; any other error: "{YouTube} didn't connect. Try again in a moment."; the notice's button "Dismiss" |
| Remove (confirmed) | "Remove" (spoken "Remove {YouTube}"); the dialog "Remove {YouTube}?" with "{BEAT} stops relaying there at once. Its stream key and sign-in are erased from Opencast. Viewer numbers and bills so far stay." (a key only: "Its stream key is erased…"), "Cancel", "Remove"; toast "{YouTube} removed. {BEAT} no longer relays there." |
| Add a platform (modal on the web, sheet on the phone) | title "Add a platform" with the frame's line; "Sign in to {YouTube}", "Sign in to {Twitch}" (those not connected yet) with "Signing in lets Opencast start broadcasts, mark paid promotion and count viewers."; heading "Add another service"; fields "Platform" (Facebook, Kick, "Another service"; YouTube and Twitch when signing in isn't set up), "Name" (placeholder the platform's name, or "My server"), "RTMP or RTMPS address", "Stream key" with "Stream keys are encrypted and never shown again."; "Viewers on a service added by key can't be counted, and Opencast reminds you to mark paid promotion there."; button "Add"; errors "Give it a name.", "Use an rtmp:// or rtmps:// address.", "Paste the stream key."; toast "{Facebook} is added." |
| What gets relayed | "Live shows only" with "Your live blocks go to every connected platform. The rest of {BEAT}'s schedule stays on Opencast." and "Free"; "Everything {BEAT} airs" with "{$0.20} an hour" (or "Price not set yet"); under them "Relays of everything {BEAT} airs are billed with the Station account, from {BEAT}'s earnings first." and the link "Station account"; toasts "{BEAT} relays its live shows only, free.", "{BEAT} relays everything it airs, at {$0.20} an hour." ("{BEAT} relays everything it airs. The price isn't set yet, so nothing is charged.") |
| Relayed this month | "{156.9 hours}, {$31.39} so far" with "About {$36.00} by the month's end, at {$0.20} an hour. Capped at {$60.00} a month. Live shows relayed free: {4 hours}." (no price yet: "The price isn't set yet, so nothing is charged."); live shows only: "{3.5 hours} of live shows, free"; nothing: the frame's "Nothing yet" |
| Restarts | heading "Restarts" with "Platforms cap how long one broadcast runs. Opencast restarts one platform at a time, during the station ID in a break, so the others keep streaming."; list "Next restarts" (the API's label) with "{Twitch} caps how long one broadcast can run. Only {Twitch} restarts; the other platforms keep streaming." ("So YouTube saves each broadcast as a video. Only YouTube restarts; …"; a key: "Opencast can't restart a stream added with a key. The other platforms keep streaming." and the tag "Due"); none: "No restarts planned."; "Lately" (the last five), a failed one with "It tries again at the next break." |
| Relays paused, the notice's button | "Station account" |
| The paid-promotion reminder, dismissed | toast "No more reminders for {Facebook} until its next broadcast." |
| Operators | "Only owners connect platforms and change what's relayed." |
| The rail's Translators count (spoken) | "{2} platforms connected" ("1 platform connected") |
| Business, Where it aired | the "Spent" figure: "Spent, {$8.64} of it on relay viewers"; section "Relay viewers": "Relay viewers, as reported by YouTube" with "{31} airings, {1,840} viewers added up, {610} billed" (and ". {$0.42} returned: no location data in time"); "Relay viewers, as reported by Twitch" with "{31} airings, {212} viewers added up. Twitch doesn't report where viewers are, so they aren't billed to local businesses"; "Relay viewers, waiting for YouTube's location data" with "{3} airings. Held until it arrives; returned if it doesn't within 7 days" (held, shown quiet); the note "Viewers on YouTube and Twitch, as those platforms report them, counted apart from Opencast's. With a location or a service area, you pay only for relay viewers the platform places inside it."; the phone's "Spent" row: "{$8.64} of it on relay viewers" |
| Business, an airing's proof | "Tuned in on Opencast" (when relayed); each platform's line: the API's working when settled; "{200} tuned in. {$1.60} held until it arrives"; "{40} tuned in. {reason}"; "{reason}. {$0.56} went back to your balance"; "Counting. The platform's numbers come in a few minutes after the spot"; the CSV's working adds "{label}: {the same words}" after Opencast's |
| Station earnings | "Relay viewers, as reported by YouTube" (and Twitch) with "{31} airings, for viewers {YouTube} reported during your spots" ("No airings yet"); the phone's one line "Relay viewers" |

### Direct uploads: the upload list and its errors (follow-up Phase 4, 2026-09-30)

Files go straight to storage in parts (docs/uploads.md). Each drop zone and file button in master control and the business app shows the files under it while they're on their way. No frame draws this list. The drop zones keep their frame words ("Drop video or audio files here", "Choose files", "Upload and check", "Replace file", "Shrink to fit", "Add files", "Deliver") and their toasts ("{2} files are being prepared for air.", "{name} is being prepared for air. {title} keeps its history and schedule.", "{name} is being prepared. Relays show it once it's ready.", "Delivered to {Orange Street Coffee}."). Names, sizes and percentages are filled in.

| Where | Words |
|---|---|
| A row, while it's sent | the file's name, its size ("4.2 GB", "21 MB", "86 KB"), a progress bar (spoken "{name}, uploaded"), "Uploading, {45}%" |
| Paused | "Paused at {45}%" |
| Every part in, the API reading it | "Checking" |
| Finished, by screen | Library: "Uploaded. It's in the library below" (the row goes after 4 seconds); Replace file (L6): "Uploaded. It airs once it's prepared"; Relay background: "Uploaded. Preparing the loop"; a production order's delivery (master control): "Delivered. Being prepared for their review"; a new spot and Shrink to fit (business): "Checked"; a brief's files: "Attached"; anywhere else: "Preparing for air", or "Done" |
| Back after a reload, a big file the browser didn't keep | "Stopped at {45}%. Choose the file again to carry on." |
| Failed on the way (after its own retries) | "The connection dropped. Retry to carry on from where it stopped." |
| Failed at the API | the API's words (the old endpoints': "That file can't be read as video or audio.", and so on); none given: "That upload couldn't be finished. Try again." |
| Buttons | "Pause", "Resume", "Retry" (failed on the way only), "Cancel" (while it's on its way), an × to clear a finished or failed row; spoken "Pause {name}", "Resume {name}", "Retry {name}", "Cancel {name}", "Clear {name}" |
| The lists' names (spoken) | "Uploading to the library", "Replacing the file", "Uploading the background", "Delivering", "Uploading the spot", "Sending it again, shrunk to fit", "Attaching the brief's files" |
| New order, a brief's file that failed | toast "Sent to {BEAT} for a quote. {logo.png} couldn't be attached. Add it from the order." ("Add them" for more than one) |
| API: `too_big` | "Use a file of {100 GB} or less." (a caption file: "1 MB", a relay background: "100 MB") |
| API: `wrong_file_type`, a caption file | "Use a WebVTT (.vtt) or SRT (.srt) caption file." |
| API: `parts_missing` | "Part {12} of {128} isn't in yet. Resume the upload." |
| API: `not_uploading` | "That upload isn't taking parts any more."; completing a cancelled one: "That upload was cancelled or couldn't be finished. Upload the file again." |
| API: `abandoned` (not finished in a day) | "Not finished within a day, so it was cancelled. Upload the file again." |
| API: `wrong_size`, `not_found`, `couldnt_read` | "The file that arrived isn't the size it said it was. Upload it again.", "The file didn't arrive. Upload it again.", "That file couldn't be read from storage. Upload it again." |
| API: `signature` (a part URL changed or run out) | "That part URL has expired or isn't signed. Ask for a new one." (the uploader asks by itself) |
| API: `uploads_need_bucket`, `uploads_unavailable` (a server set up wrong) | "Uploads need object storage (R2) on this server.", "Direct uploads aren't available on this server." |

### Changing channel (follow-up Phase 5, 2026-09-30)

The reference's words, final (not new): "Tuning in" under the program's name over the static (after 800 ms), and Stand by's "Please stand by" with the colour bars (the Slate's). The corner number is the channel and call sign ("18.1", "SAZN"), no words. The radio band shows "Tuning in" under the station's name the same way. The words below are new: no frame draws the line under Stand by after a channel change, or what a screen reader hears.

| Where | Words |
|---|---|
| Stand by after a channel change (8 s with no picture), web, phone, TV mode and Cast, under "Please stand by" | "The signal from {BEAT 12.1} isn't coming through. Trying again." |
| The same on the TV app (tv 05.2's layout, with its buttons "Tune to {REEL 24.1}" and "Open the guide") | "The signal from {BEAT 12.1} isn't coming through. Trying again. {REEL 24.1} is on now." (the dial's own Stand by keeps "{CIVC 7.1} is waiting for its signal.") |
| The corner number (spoken, polite) | "Tuning to {BEAT 12.1}" |
| "Tuning in" with no program on the dial | the station's name in place of the program's |

### External stations (follow-up Phase 6, 2026-09-30)

The External sources page follows network-desk 05.1 ("External sources", "Stations on the {Inland Empire} dial that play the source's own stream. No playout, no spots.", "List a source", the columns Source, Channel, How it plays, What's on, Right now, and its rows' words: "Official embed", "Stream link", "Their agenda calendar", "Guide data" / "Checked, from their published schedule", "No schedule found" / "Banner shows name and Live", "Down {14} min" / "Hidden from the dial", "Waiting", "Not on the dial", "Up"). What the reference doesn't draw is below. Internal names stay `listed`.

**Viewer (web, phone), TV mode and the TV app**

| Where | Words |
|---|---|
| The banner, an external station (every size) | the dashed "External" tag, then "**Live** from {City of Colton}" in the source line; with nothing scheduled the title is the station's name ("City of Colton") and there's no progress bar |
| Dial row, an external station with nothing scheduled | "{City of Colton}", "Live", "External", line "From {City of Colton}'s own stream" |
| Tuned-in page (web, phone), nothing scheduled | title the station's name; "**Live** from {City of Colton}" and the External tag |
| Tuned-in page, the stream down | "{City of Colton}'s stream is down. Stand by." |
| Guide (web), the station column | the dashed "External" tag under an external station's channel |
| Guide (web and TV), time an external station's source lists nothing | a cell titled with the station's name, "**Live**, nothing listed" (web: gaps of 15 minutes or more; the TV fills every gap, since its focus follows the time) |
| Station page, On now, nothing scheduled | the station's name, "External **Live** from {City of Colton}." |
| Station page, On now, the stream down | "External {City of Colton}'s stream is down. It's off the dial until it's back." |
| Station page, About | "External {City of Colton}'s own stream. No Opencast playout, spots or breaks." (was "External, the city's own stream") |
| TV guide header, an external cell | "{City of Colton}'s own stream." |
| TV About | "External" by the ident; "{source}'s own stream. No Opencast playout, spots or breaks."; On now "Live from {source}" (nothing scheduled) or "Stand by" with "{source}'s stream is down. It's off the dial until it's back."; the main button "Open the guide" while it's down and you're not on it |
| TV, Stand by over the picture (the stream down) | "{City of Colton}'s stream is down. Stand by." then " {PREP 31.1} is on now." when there's a station to offer |
| TV presets strip, nothing scheduled | "**Live** from {source}" |
| TV guide options, under "Tune to {COLT} now" | "Live from {source}" (nothing scheduled), "Stand by" (down) |

**Network desk: notices** (push and email, on by default)

| Where | Words |
|---|---|
| A station off the dial | "{COLT 9.2} is off the dial" / "{City of Colton}'s stream has been down since {8:43 pm}. It's off the dial, the guide and the swipe order until it's back. Anyone watching sees Stand by." |
| Back on the dial | "{COLT 9.2} is back on the dial" / "{City of Colton}'s stream is back after {19} minutes down. It's on the dial again." |

**Network desk: External sources (table)**

| Where | Words |
|---|---|
| How it plays, small lines | "Their own player, embedding allowed (checked {Sept 21})", "Their written permission, {Sept 24}", the public basis ("US government, public"), "Terms unclear, {asked Sept 22}", "Terms page not recorded", "Needs their permission. In the creator pipeline", "DASH stream, not played yet", "Outside this market" |
| What's on | "Their schedule feed" (a feed that isn't a calendar), "Calendar not found", "Guide data not found" |
| Right now | "Not checked yet", "Down {1} hr {12} min", "Still on the dial" |
| Source line, from a lead | "From an IPTV list. {description}" |
| The rail's count | "{2} not on the dial" (was "… not on the dial yet") |

**Network desk: a listing's details** (a click on a row)

| Where | Words |
|---|---|
| Subtitle | "{9.1 RDLS}. {description}", or "Not on the dial. {description}" |
| Sections | "How it plays", "What's on", "Right now", "History" |
| Rows | "Their terms" ("Allow embedding" / "Unclear"), "Terms page" ("{link}, checked {Sept 21}", "…, not checked yet", "Not recorded yet"), "Their written permission", "Where it's kept", "The stream it covers", "Recorded" ("By {Dee A.}, {September 26 at 8:42 pm}. Recorded once, never edited"), "Clearly public", "Their permission" ("Not recorded yet"), "Their player's address", "Stream address", "Checked against", "Guide data address", "Feed address" |
| Right now | "Last checked {September 26 at 8:42 pm}. {HTTP 503}", "Checked every minute once it's on the dial", "Not checked while it's off the dial" |
| Held by a rule | "It waits until Settings allows DASH stream links." / "… allows other markets' streams." with "Open the rules" |
| History | "Down {8:43 pm} to {9:02 pm}, {19 minutes}, hidden from the dial at {8:48 pm}. {HTTP 503}", "Down {2 minutes}, back before it left the dial. {detail}", "Down since {8:28 pm}, hidden from the dial at {8:33 pm}" / "…, still on the dial", "No outages in the last 90 days." |
| Buttons | "Close", "Record evidence" |

**Network desk: Record evidence, and List a source**

| Where | Words |
|---|---|
| Record evidence | title "Record evidence", subtitle "{name}. It goes on the dial once the evidence is complete.", "Both are needed before it goes on the dial.", "Nothing new to record yet.", "Save" |
| Toasts | "{name} is on the dial at {9.2}." / "{name} is on the dial." / "Saved. It goes on the dial once {…}." / "{name} is saved. It goes on the dial once {…}.", where {…} is "their terms allow embedding", "the terms page and the day it was checked are recorded", "they say yes in writing, or it's confirmed public", "Settings allows DASH stream links", "Settings allows other markets' streams", "its stream is back", "its evidence is recorded" |
| Evidence fields | "Terms page", "Checked on", "Why it can play" ("Their written permission" / "Clearly public" / "Not yet"), "It's saved but not on the dial until they say yes in writing, or it's confirmed public.", "Who said yes" (help "“Maria Lopez, City Clerk, City of Colton”."), "Said yes on", "Where it's kept" (help "“Email to network@opencast.tv, Sept 18”."), "Document" (Optional), "Recorded once and never edited. It covers {stream} only.", "The basis" (help "“US government, public”, “Public body, stream published for the public”."), "Note" (Optional, help "What's being waited on: “Asked Sept 22”.") |
| Evidence errors | "Paste the link to their terms page.", "The day you read them.", "Say who said yes, and for whom.", "The day they said yes.", "Say where the written yes is kept.", "That doesn't look like a link.", "Say why it's clearly public.", "Keep it under 120 characters." |
| List a source | "How it plays" ("Official embed" / "Stream link"), "Their player's address", "Without the terms page and the day it was checked, it's saved but not on the dial.", "Stream address" (help "An HLS address (.m3u8). Viewers' players fetch it from the source directly." or "A DASH address (.mpd). It's saved, but waits until Settings allows DASH stream links."), "What's on" ("Their calendar or schedule feed" / "Guide data" / "None"), "The banner shows the station's name, External, Live and the source. Nothing is made up.", "Calendar or feed" (help "iCal, RSS, JSON or XMLTV. Their real titles and times become the listings."), "Guide data address", "Checked against" (help "Their published schedule."), "Date checked", "The source is outside the {Inland Empire}" (helper "It waits unless Settings allows other markets' streams.") |
| List a source errors | "Paste the address of their player.", "Paste the stream's address.", "Paste the link to their calendar or feed.", "Paste the guide data's address.", "Paste the link to their published schedule.", "The day you checked it." |
| API errors | `external_station`: "{COLT} is an external station: its video is the source's own stream, with no playout, spots, sponsor credits, partner ads or earnings, and it can't be carried or offered in the market."; `permission_recorded`: "Their written permission is already recorded. It's never edited."; `already_external`: "{name} is already an external station."; a subchannel alone: "Start at {14}.1. Subchannels go beside other external stations."; an embed without its terms: "Say whether their terms allow embedding."; permission for an embed: "Written permission is for stream links. An embed needs its terms page."; `list_unavailable`: "The list answered HTTP {404}." / "The list couldn't be read. Try again, or paste it."; `no_channels`: "No channels with a stream address were found in that list."; a list from elsewhere: "Use a list from iptv-org (iptv-org.github.io), or paste the list itself." |

**Network desk: the pipeline and IPTV lists**

| Where | Words |
|---|---|
| Pipeline | the button "Import from an IPTV list"; a lead's source cell "From an IPTV list, {group}" with its stream address; its Next "Ask for permission, or confirm it's public", then "External station {9.3 ICTV}" or "External station, not on the dial yet"; buttons "List as external station", "Open" |
| Import from an IPTV list | title "Import from an IPTV list"; subtitle "Channels on public IPTV lists are leads, not listings. They go in the pipeline with their stream noted, and never on the dial until they say yes or are confirmed public."; "The list" ("Paste or upload" / "An iptv-org address"), "M3U or JSON", "Or upload the file", "List address" (help "iptv-org's published lists only. Only the list is read, never a stream."), "Read the list", "Back", "Cancel", "{3} channels. {1} entries skipped: no stream address.", "Filter" (placeholder "Name, group or country"), "Select all", "Select none", "Already a lead", "Already an external station", "No channels match.", "Import {2} as leads" / "Import 1 as a lead", "Up to 100 at a time."; errors "Paste the list, or upload it.", "Give the list's iptv-org address."; toast "{2} leads added to the pipeline. {1} already on the desk." |
| Settings, Rules | the group "External stations"; "Other markets' streams" ("Whether a source from outside a market can be an external station on its dial, for example a county meeting that covers two markets. Off: such a listing is saved but waits"; "Allowed" / "Not allowed"); "DASH stream links" ("Opencast's player plays HLS everywhere. DASH needs a player library on the web and some TVs. Off: a DASH-only stream link is saved but waits, and the source's official embed or HLS address is listed instead"; "Played" / "Not played yet"); the edit form's fields "Allowed", "Played" |

**Network desk: changing a listing, and taking it off the dial for good** (A215, added 2026-09-30)

| Where | Words |
|---|---|
| A listing's details, footer | "Change" (beside "Close" and, while it waits, "Record evidence"); taken off the dial: "Put back on the list" |
| A listing's details, subtitle when taken off | "Taken off the dial {Sept 30} by {Dee A.}. {9.1} held for it until {December 29}" / "{9.1} freed {December 29}" / "Its channel was freed" |
| A listing's details, How it plays | "Earlier permission": "{Maria Lopez, City Clerk, City of Colton}, {Sept 24}, for {address}. Kept, never edited"; "Their permission": "Not recorded yet for this address" |
| A listing's details, Right now, taken off | "Not checked, and its schedule isn't read" / "It's off the dial, the guide, search and the swipe order. Its records are kept" |
| A listing's details, Changes | the section "Changes" (after "History"); "No changes since it was listed."; entries "{Dee A.} changed {Address} from {old} to {new}, {8:42 pm}. It waits for new evidence. Checked afresh", "… {How it plays} from {Official embed} to {Stream link}; {What's on} from {None} to {Their calendar or schedule feed} …", "Its schedule read again", "{Dee A.} took it off the dial for good, {8:42 pm}", "{Dee A.} put it back on the list{ at 9.3}, {8:42 pm}"; the fields "Whose stream", "What it shows", "Address", "How it plays", "Their terms", "Feed address", "Feed format", "What's on", "Checked against", "Date checked", "Channel", "Call sign"; an empty value "nothing"; no name: "Opencast" |
| A listing's details, the last section | "Off the dial for good": "It leaves the dial, the guide and search at once, and its checks stop. Its records are kept, and it can be put back on the list." and the button "Take off the dial for good" |
| History (outages), ended by a change | "Down {8:43 pm} to {8:55 pm}, when the address was changed{, hidden from the dial at 8:48 pm}. {HTTP 503}", "…, when it was taken off the dial…" |
| Change the listing (List a source, filled in) | title "Change the listing"; subtitle "{City of Colton}, {9.2 COLT}. Its evidence is recorded on its own, and every change is kept in its history."; the band, the evidence fields and "The source is outside the {market}" aren't shown; for an embed, "Their terms" ("Allow embedding" / "Unclear"); buttons "Cancel", "Save changes", or "Save, and wait for evidence" when saving takes it off the dial; "Nothing to change yet." |
| Change the listing, said before saving | "Their written permission covers {old address} only. Saving takes {COLT} off the dial until new evidence is recorded for the new address. The permission is kept as it was."; "The written permission recorded before for this address covers it again ({Maria Lopez, City Clerk}). It's checked from the next minute."; "The public basis stays: it's about the source. The new address is checked from the next minute."; "Their terms were checked for {redlands.example.gov}. Saving takes {RDLS} off the dial until the terms for {video.example-host.com} are checked."; "Same host, so their terms stay as checked. The new address is checked from the next minute."; "Saving takes {RDLS} off the dial until their terms allow embedding."; "An official embed needs its terms page and the day it was checked. Saving takes {COLT} off the dial until they're recorded."; "A stream link needs their written permission, or a clearly public basis. Saving takes {RDLS} off the dial until one is recorded."; "The new address is checked once its evidence is recorded." |
| Change the listing, toasts | "{City of Colton} is saved. It's on the dial at {9.2}." / "{NASA} is saved." / "Saved. {City of Colton} goes on the dial once {they say yes in writing, or it's confirmed public}." (then Record evidence opens) |
| Take off the dial for good (confirmation) | title "Take {9.2 COLT} off the dial for good?"; subtitle "{City of Colton} leaves the dial, the guide, search and the swipe order now."; "Anyone watching sees Stand by, then that it's no longer on the dial. Its station page goes.", "Its checks and schedule reads stop.", "{9.2} stays held for it until {December 29}, then it's freed. {COLT} stays its own." (or "Its channel is freed."), "Its permission records, outages and history are kept.", "Its pipeline lead goes back to the stage it had before it went on air.", "You can put it back on the list from Taken off the dial."; buttons "Cancel", "Take it off the dial"; toast "{City of Colton} is off the dial for good. It's under Taken off the dial." |
| External sources, the filter | "Show": "On the list" / "Taken off the dial ({1})" (shown once something has been taken off) |
| Taken off the dial (table) | label "Taken off the dial"; columns "Source", "Was on" ("{9.1 RDLS}", "None"), "How it played", "Taken off" ("Taken off the dial {Sept 30} by {Dee A.}" / "{9.1} held for it until {December 29}"); the row's button "Put back on the list"; empty "Nothing in the {Inland Empire} has been taken off the dial." |
| Put back on the list | title "Put {City of Redlands} back on the list?"; subtitle "It comes back on {9.1}, held for it until {December 29}, with its evidence as recorded, and waits for its checks." / "Its channel was freed {December 29}. It comes back on it if it's still free, or on another you choose, and waits for its checks."; the field "Channel" (help "{9.1} is its own until {December 29}." / "If it's taken, choose another in the same band."; error "A channel like 9.4." / "A frequency like 89.2."); buttons "Cancel", "Put it back"; toasts "{City of Redlands} is back on the list at {9.1}. It's checked from the next minute." / "{name} is back on the list. It goes on the dial once {…}." |
| The board, a slot held for one taken off | status "Taken off the dial" |
| The pipeline, a lead whose listing was taken off | Next "Was external station {9.2 COLT}. Taken off the dial" |
| Viewer, its station page (web, TV) | "{COLT}, {City of Colton} is no longer on the dial." (the page's 404) |
| API errors | `removed`: "{City of Colton} was taken off the dial. Put it back on the list first." / "{City of Colton} is already off the dial."; `not_removed`: "{name} is on the list."; `already_external` on putting back: "Its lead is already another external station."; `call_sign_taken` on putting back: "{COLT} has gone to someone else." |

**DASH stream links** (A201, added 2026-09-30)

| Where | Words |
|---|---|
| The player (web, phone, TV), a DASH stream link on a device that can't play DASH (A226) | title "Not on this device"; "{LOMA 9.7}'s stream is in a format this device can't play. Watch it on a computer or a TV." |
| Network desk, List a source, "Stream address" help for a `.mpd` address | "A DASH address (.mpd). Viewers' players fetch it from the source directly, while Settings allows DASH stream links." (was "A DASH address (.mpd). It's saved, but waits until Settings allows DASH stream links.") |
| Settings, Rules, "DASH stream links" | detail "Played: a DASH stream link plays in Opencast's player, which loads its DASH library only when one is tuned; a device that can't play DASH skips it. Not played: a DASH-only stream link is saved but waits, and the source's official embed or HLS address is listed instead" (was "Opencast's player plays HLS everywhere. DASH needs a player library on the web and some TVs. Off: …"); "Played" / "Not played yet" as before |
| Settings, Change log (the desk's mocks) | "DASH stream links: Not played yet to Played" |
| The mock DASH stream's frames (development only) | "Mock stream for development · the source's own DASH stream", "MPEG-DASH · fMP4" |

### Shared call signs (A229 to A235, 2026-09-30)

One brand's streams on one channel's subchannels share a call sign (15.1 RIVC, 15.2 RIVC, 15.3 RIVC); the channel tells them apart. For review. Words in braces are filled in.

| Where | Words |
|---|---|
| Network desk, List a source (and Change), on X.n beside an external X.1 | checkbox "Same brand as {15.1 RIVC} (share its call sign)", on by default; helper on: "{Riverside County, Board of Supervisors} and this stream keep their own evidence and checks. Only the call sign is shared."; off: "It takes a call sign of its own."; the Call sign field, locked: "The channel tells them apart: {15.2 RIVC}." |
| Change the listing, leaving a family without a call sign | "Give it a call sign of its own, or keep sharing." |
| Change the listing, on X.1 with a family | the Channel field, locked: "Its call sign is shared on its subchannels, so it stays here."; before saving a new call sign: "This changes the call sign of {both / all 3} streams: {15.1 RIVC, 15.2 RIVC and 15.3 RIVC} become {RVCO}. {RIVC} is held a year for them, so their old addresses still work and nobody else takes it."; the button "Change {both / all 3} to {RVCO}" |
| External sources table, Source column | a member: "Same brand as {15.1 RIVC}"; X.1: "Its call sign is shared by {15.2 and 15.3}" (also in a listing's details' subtitle) |
| Take off the dial for good, X.1 with a family | title "Take {15.1 RIVC} and its family off the dial for good?"; subtitle "{15.2 RIVC and 15.3 RIVC} share its call sign and go off the dial with it. Put back on the list, they come back together."; a list of each ("{15.2 RIVC}, {Riverside County, Public Works}"); the button "Take {both / all 3} off the dial"; toast "{Riverside County, Board of Supervisors} and the {2 streams} sharing its call sign are off the dial for good." |
| Put back on the list, X.1 | subtitle adds "{15.2 RIVC and 15.3 RIVC}, taken off with it, come back too." |
| API errors (external) | `cannot_share`: "Only a subchannel ({15.2} and up) shares the call sign of the station on its .1." / "Nothing is on {16.1} to share a call sign with." / "{12.1 BEAT} is a full station. External stations share only an external station's call sign." / "{15.1 RIVC} was taken off the dial. Put it back first."; `family_channel`: "{15.2 RIVC, 15.3 RIVC} share its call sign. Move them first, or give them their own call signs."; `family`: "{15.2 RIVC, 15.3 RIVC} share its call sign and would go with it. Take them off too, or give them their own call signs first."; `family_removed`: "Put {15.1 RIVC} back first. It shares its call sign, and brings back the streams taken off with it."; "Give it a call sign, or share the call sign of the station on its .1."; "Give it its own call sign to stop sharing the call sign of the station on its .1."; "It shares {15.1 RIVC}'s call sign." |
| Master control, Your station (A230) | title line "Where you sit on the dial and how viewers will know you. You can change the name and colour later. The call sign and channel are fixed once you sign on."; channel help "…You'll be {12.2}, beside {12.1 BEAT}." and "…subchannels {12.2} and up are for stations you carry around the clock, or your own."; group "Beside your own station", buttons "{12.3} next to {12.1 BEAT}"; checkbox "Share {12.1 BEAT}'s call sign"; helper on: "Viewers see {BEAT 12.2}: the channel tells your stations apart. Once it signs on, it keeps this call sign." (plus " {TAPE} is let go." when it had its own); off: "It picks a call sign of its own." |
| Master control, the call sign field and Identity | sharing, before saving: "Shared with {12.1 BEAT}. The channel tells them apart."; a member: "Shares {12.1 BEAT}'s call sign. The channel tells them apart." / once on air "Shares {12.1 BEAT}'s call sign. Fixed since the first sign-on."; X.1: "{12.2 Beat Tapes} shares this call sign. A change here changes theirs too, until one of them signs on." / once on air "{12.2 Beat Tapes} shares this call sign. Fixed since the first sign-on."; X.1's channel: "{12.2 Beat Tapes} shares this call sign, so {12.1} stays while it does." |
| Master control, Sign on | appended: "It keeps {12.1 BEAT}'s call sign once it's on air." (member) / "Once it's on air, the call sign it shares with {12.2 Beat Tapes} is fixed." (X.1) |
| Master control, anywhere a station is named by call sign alone | "{BEAT 12.2}" (the call sign and channel) when its call sign is shared: statements, usage and billing, earnings, relays, team, invites, claims, the market pages |
| API errors (full stations) | `not_your_subchannel`: "{12.1 BEAT} isn't yours. A subchannel goes beside a station you own." / "{12.1 BEAT} has signed off for good."; "Start at {12}.1. A subchannel goes beside your own station on its .1."; `fixed_after_sign_on`: "{BEAT 12.2} has signed on with this call sign, so it stays."; `family_channel`: "{12.2 BEAT} shares this station's call sign. Move it first."; "{12.1} needs its call sign first." |
| Notices (relays) | "{BEAT 12.2}'s relays stopped" / "{BEAT 12.2}'s relays are back" when its call sign is shared |
| Viewer (web, phone), TV | the guide's station column: the stream's own name under call sign and channel for a shared call sign; the phone remote: the stream's own name under "{15.2} {RIVC}"; the TV: "Tune to {BEAT 12.2} now", "From {BEAT 12.2}", "{BEAT 12.2}'s pledge" |
| Settings, Rules (A230) | "Owners' own subchannels": "An owner can put another of their stations on a subchannel beside their own X.1 (12.2 beside 12.1), and it can share X.1's call sign. Off: a station gets X.1 only, and subchannels are for 24/7 carriage and external stations. Stations already on one keep it"; "Allowed" / "Not allowed" |
| Mocks (development only) | "Riverside County, Board of Supervisors", "Riverside County, Public Works", "Riverside County Library Live" (RIVC 15.1 to 15.3); "Beat Tapes" (BEAT 12.2) and its airings "Tape 31: Redlands summer", "Tape 32: Night drive", "Tapes all night" (web), "Beat Tapes: side A", "Beat Tapes: side B", "Beat Tapes overnight" (TV) |

**A shared call sign whose stations no longer share an owner** (A234, added 2026-09-30)

Nothing changes on air; the Network desk is told and decides with the owners. For review. Words in braces are filled in.

| Where | Words |
|---|---|
| Notice to the Network desk (in the app, push, email) | title "{12.2 BEAT} {Beat Tapes} no longer shares an owner with {12.1 BEAT} {Inland Beat}"; body: what changed, "Ownership of {12.2 BEAT} moved from {Kai} to {Jen}." / "{Kai} no longer owns {12.2 BEAT}." / "{Jen} now owns {12.2 BEAT}."; who owns each now, "{Jen} owns {12.2 BEAT}. {Kai} owns {12.1 BEAT}." (or "Nobody owns {12.2 BEAT}.", "{Kai and Jen} own …"); then, signed on: "{BEAT} is fixed on air, so nothing changes by itself. Whether {12.2} keeps it is for you and the owners to decide." / not yet: "Nothing changes by itself. Before {12.2} signs on, its owner can give it a call sign of its own."; the email's button "Open master control" as for every station notice, opening the market board on the channel |
| Network desk, the market board, under the figures (one per station) | a standby notice: "{12.2 BEAT} {Beat Tapes} no longer shares an owner with {12.1 BEAT} {Inland Beat}"; detail "Since {September 25}. {Jen Park} owns {12.2}, {Kai M.} owns {12.1}. {BEAT} is fixed on air, so nothing changes by itself" / "… Nothing changes by itself. Before {12.2} signs on, its owner can give it a call sign of its own" ("nobody owns {12.1}" when nobody does); the button "Select {12}"; for screen readers the list is "Shared call signs whose owners differ" |
| Network desk, the selected slot with subchannels (full stations) | the slot's line "Independent stations. {Inland Beat}, {Redlands}"; a line per station, "{12.1 BEAT}" with its name, the button "Open {12.1}" (master control); the member's: "{Beat Tapes}. No longer shares an owner with {12.1 BEAT}. Since {September 25}. …" as on the board |
| Network desk, the rail's Market board | the count, read as "{1} shared call {sign / signs} to look at" |
| Mocks (development only) | "Beat Tapes" (BEAT 12.2) on the desk's Inland Empire board, handed from Kai M. to Jen Park on September 25 |

## Phone remote: the TV's menu (2026-10-01)

- Remote button row: **Menu** (beside Guide; opens the TV's menu, where Settings and Captions are; pressed again, it closes there).
- While the TV's menu is open, the arrows-and-OK pad is labelled "Menu on the TV" (the guide's stays "Guide on the TV").

## Phone remote: arrows and OK, like a TV's remote (2026-09-30)

- Under the rockers, always there: the arrows (accessible names "Up", "Down", "Left", "Right") around **OK**, a group named "Arrows".
- At the pad's corners: **Menu** (top left), **Guide** (top right), **Back** (bottom left, new: sends Back to the TV), **Info** (bottom right).
- While the phone has the TV's guide or menu open, a small line over the pad says "Guide on the TV" or "Menu on the TV", and the group takes that name.
- Under the pad: **Keypad** (one wide key), then "Guide on this phone". **Last** is now only the play rocker's lower key ("Last channel"); the button row's Last is gone.

## External stations' http:// stream links (A237, 2026-10-01)

For review. Viewers see nothing new: a relayed station plays like any other.

| Where | Words |
|---|---|
| Network desk, External sources table, How it plays (a third small line) | "Plays through Opencast's secure relay (its address is http)"; "Plays over https (its listed address is http)" when the same address answered over https |
| Network desk, External sources table, How it plays, waiting | "Needs an https address" (an http link that doesn't answer over https, with the relay not set up) |
| Network desk, a listing's details, How it plays | a row "Plays through Opencast's secure relay (its address is http)" or "Plays over https (its listed address is http)"; waiting, the line "Needs an https address" and the note "Apps on https can't play an http address. It waits until its source answers over https, or Opencast's secure relay is set up." |
| Network desk, List a source (and Change, Put back), saved but waiting | "Saved. {City of Colton} goes on the dial once its source answers over https, or Opencast's secure relay is set up." (the toast's usual start, then these words) |
| The relay's own answers (developers only, plain text) | "Not signed", "Bad signature", "Not a relay address", "Only http and https streams are relayed", "Addresses with a user name or password aren't relayed", "Not a public address", "The relay isn't configured", "The source answered {404}", "Couldn't reach the source", "The source didn't answer in 10 seconds", "Not a playlist", "The playlist is too large", "Too many redirects at the source", "Opencast stream relay" (/health) |

## Stream links browsers can't load, and platform feeds (A238, 2026-10-01)

For review. Viewers see nothing new: a relayed station plays like any other.

| Where | Words |
|---|---|
| Network desk, External sources table, How it plays (a third small line) | "Browsers block this stream's server, so it plays through Opencast's secure relay" (its server sends no CORS header for Opencast's apps) |
| Network desk, External sources table, How it plays, waiting | "Browsers can't play this stream yet" (CORS-blocked, with the relay not set up); "Uses another app's access ({Pluto via Samsung TV Plus})" (a platform feed) |
| Network desk, a listing's details, How it plays | a row "Browsers block this stream's server, so it plays through Opencast's secure relay", with what the check found under it: "Its playlist has no CORS header for Opencast's apps", "Its variant playlists have no CORS header for Opencast's apps" or "Its segments have no CORS header for Opencast's apps" |
| Network desk, a listing's details, How it plays, waiting | "Browsers can't play this stream yet", and the note "Browsers can't play this stream yet. Its server doesn't let other sites load it. {Its segments have no CORS header for Opencast's apps.} It plays once its server allows it, or Opencast's secure relay is set up." A platform feed: "Uses another app's access ({Pluto via Samsung TV Plus})", and the note "Uses another app's access ({Pluto via Samsung TV Plus}). Ask the channel's licensor for its own feed." |
| The platform feeds' names, in the brackets | "jmp2.uk, which forwards to other apps' feeds"; "Pluto via Samsung TV Plus", "Pluto via The Roku Channel", "Pluto via {partner}", "Pluto via a partner app"; "Samsung TV Plus"; a partner named in a token ("The Roku Channel", "Vizio WatchFree+", "Xumo", "LG Channels", "Amazon Fire TV", or the name as the token gives it) |
| The CORS check's other findings (`ListedSource.cors.detail`; kept by the API, not shown by the desk yet) | "Its playlist didn't answer the check"; "Its playlist allows Opencast's apps; its variant playlists couldn't be checked"; "Its variant playlists couldn't be checked"; "Its playlists allow Opencast's apps; its segments couldn't be checked"; "Its MPD allows Opencast's apps; its segments couldn't be checked"; "Checked its MPD only (its segments' addresses aren't simple to work out)"; "Not a stream playlist" |
| Network desk, List a source (and Change, Put back), saved but waiting | "Saved. {News} goes on the dial once its server lets browsers load it, or Opencast's secure relay is set up."; "Saved. {Channel} goes on the dial once it has a feed of its own from the channel's licensor." (the toast's usual start, then these words) |

## Direct mode in the native apps (A239, 2026-10-01)

For review. Viewers see nothing new: a station played in direct mode plays like any other.

| Where | Words |
|---|---|
| Network desk, External sources table, How it plays (a third small line) | "Plays in the TV app only" (its server refuses web pages' requests but answers apps) |
| Network desk, a listing's details, How it plays | a row "Plays in the TV app only", with under it: "Its server refuses web pages' requests but answers apps. The Android TV and Fire TV app, and the Opencast app on Android, play it straight from the source; browsers, Chromecast and iPhone show Stand by on it." |
| The CORS check's finding (`ListedSource.cors.detail`, state `unknown`) | "Its server refuses web pages' requests (it answers only without an Origin header), so it plays in the TV app only" |
| The apps' native fetch (developers only: the user agent sources see) | "Opencast TV (Android)"; "Opencast (Android)" |

## A webpage's event data, and a schedule entered by hand (A241, 2026-10-01)

For review. Viewers see nothing new: a schedule entered by hand, or read from a page's event data, shows its titles and times like a feed's.

| Where | Words |
|---|---|
| Network desk, List a source and Change, What's on (three choices) | "Its feed", "Enter it by hand", "None" (was "Their calendar or schedule feed", "Guide data", "None") |
| Its feed | the field "Calendar, feed or schedule page", help "iCal, RSS, JSON, XMLTV, or a webpage with event data. Their real titles and times become the listings."; "Format": "Work it out from the address", "iCal", "RSS", "JSON", "XMLTV", "Webpage (its event data)"; the tick "It's guide data, checked against their published schedule", helper "Someone else's listings for this source, not its own feed." (then "Guide data address", "Checked against", "Date checked" as before); the error "Paste the link to their calendar, feed or schedule page." |
| Its feed, a page with no event data (Change) | a notice "This page has no schedule data a computer can read." with the link "Enter the schedule by hand instead." |
| Enter it by hand | "Their weekly schedule, as they publish it. Times are {Pacific Time}; an end before the start runs past midnight. Titles are theirs: nothing is made up."; each slot: "Days" (chips "Mon" to "Sun"), "Starts", "Ends" (help "{6:00–9:00 pm}, {3 hr}", ", past midnight" when it is), "Title" (help "As they publish it."), "Description" (Optional), a season set through the API as "In season {Mon, Nov 2} to {Fri, Dec 18}." / "From {date}." / "Until {date}."; "Remove slot {2}, {Planning Commission}" (the x); "Add a slot"; "Where you checked it": "Their published schedule", "Date checked"; "Dates it doesn't air": "Date" (help "Holidays and other days off."), "Add date", each date "{Thu, Nov 26}" with "Remove {Thu, Nov 26}" |
| Enter it by hand, errors (the API's too) | "Pick at least one day."; "A time like 6:00 pm."; "Use 5-minute steps (6:00, 6:05, 6:10)." (start) / "(9:00, 9:05, 9:10)" (end); "It ends when it starts. An end before the start runs past midnight."; "Give it the title they publish."; "Keep it to 120 characters." (title) / "Keep it to 300 characters." (description); "The season ends before it starts."; "“{Planning Commission}” overlaps “{City Council}” on {Wednesdays} at {8:00 pm}. Two slots can't be on at once."; "Add at least one slot."; "Paste the link to their published schedule."; "The day you checked it."; the API's "Say where you checked it: the address of their published schedule." and "Say when you checked it against their published schedule." |
| Network desk, External sources table, What's on | "Entered by hand" / "Checked against their published schedule"; "Their webpage's event data"; "No schedule data on the page" / "Enter it by hand instead" |
| Network desk, a listing's details, What's on | "Every week": one line a slot, "{Mon–Fri} {6:00–9:00 pm}: {City Council}" (". {description}" after it, quieter; " (until {2026-12-18})" for a season); "Doesn't air on": "{November 26, December 24}"; "Checked against" (the link, ", {Sept 25}"); for a page: "Schedule page" (the link) and "Format": "Webpage (its event data)"; a page with none: "This page has no schedule data a computer can read. Enter the schedule by hand instead." (the last sentence opens Change on "Enter it by hand", where it was checked filled in with the page) |
| Network desk, the change history | "Weekly schedule from {Mon–Fri 6:00–9:00 pm: City Council and commissions, “Whichever meets that night, live from City Hall”; …} to {…}"; "Doesn't air on from {nothing} to {2026-11-26}"; "What's on from … to Entered by hand"; "Feed format from {Webpage (its event data)} to {nothing}" |

## Openers, closers and a station's own off-air card (A242, 2026-10-02)

For review. No frame draws them: the rows and words follow the library's own (A.2, 04.1) and Settings, Breaks (02.1). Viewers see the closer, the card and the opener on the channel; the guide and dial read as before ("Off air, back at 6:00 am").

| Where | Words |
|---|---|
| The log's codes (everywhere a code is named) | "OPN" (Opener), "CLS" (Closer), "OFF" (Off-air card) |
| Library, the folder rail | the group "Sign-off and sign-on", with "Closers", "Off-air cards", "Openers" and their counts |
| Library, each of the three lists | the titles "Closers", "Off-air cards", "Openers"; empty: "No {closer} of your own yet. Until you add one, Opencast makes one in your look." |
| Library, the three lists: the sequence (the region "When you sign off and back on") | "Closer → Off-air card → off air → Opener → (Station ID) → first program"; rows: "Closer": "Your closer" / "Your {2} closers, a day each in turn" / "Made for you: “{12.1 BEAT} · Signing off · Back at 6:00 am”, in your look"; "Off-air card": "Your off-air card" / … / "Made for you: {12.1 BEAT}, off air, and when you're back", then ". For a minute, then the channel ends"; "Opener": "Your opener" / … / "Made for you: “{12.1 BEAT} · Signing on”, in your look", then ". It ends as the first program starts"; "Station ID": "After the opener" / "Only if you turn it on in Settings, Breaks. The opener replaces it"; under them, TV: "Openers and closers are short clips. An off-air card is a picture or a short clip." / radio: "On the radio band, openers and closers are audio, and the off-air card is a short clip or a picture your relays show.", then "Off air time too short to go dark keeps the channel on: closer, the card, opener." |
| Library, the drop zone | "Upload as": "Guess from its length", "Program", "Spot", "Underwriting", "Bumper", "Station ID", "Opener", "Closer", "Off-air card" (preset on each list); as an off-air card: "Drop an off-air card here", "A picture (PNG, JPEG or WebP) or a short clip. It airs for a minute when you sign off."; refused (the mocks): "That file isn't a picture, video or audio." |
| Library, the table | "Runs": "Still" for a picture; "Ready for air" with "A picture, {1920×1080}" |
| Library item page | "Off-air card, a picture." (or "Opener, 0:06." …); the button "Sign-off and sign-on" (to Settings, Breaks) in place of Schedule |
| The API's refusals | "That file can't be read as a picture, video or audio." (an off-air card); "It's a picture, so it can only be an off-air card. Upload a clip to use it as something else."; "It's on the log. Take it off the log first: openers, closers and off-air cards air at sign-off and sign-on, not from the log."; "Openers, closers and off-air cards air at sign-off and sign-on, not from the log." |
| Settings, Breaks, under How often | the heading "Signing off and on", the link "Openers and closers"; "Closer → Off-air card → off air → Opener → (Station ID) → first program" ("Station ID" without brackets when it's on); "Air the station ID after the opener": "Off: the opener takes the station ID's place as you sign back on" / "Both air as you sign back on, ending as the first program starts"; "Open each broadcast day with the opener": "For a channel that never signs off. Off: the opener airs only when you sign back on" / "For a channel that never signs off: at the first program after 6:00 am, where the station ID would air. {BEAT} never cuts into a program for it" |
| Monitor | beside "Program", and before "On air since …": "Signing off" while the closer airs, "Signing on" while the opener airs (the phone: a line above the picture) |
| The channel (made for the station) | the automatic closer: "{12.1 BEAT}", "Signing off", "Back at {6:00 am}"; the automatic opener: "{12.1 BEAT}", "Signing on" |
| As-run log (the API) | an automatic one's title: "Automatic opener", "Automatic closer" |

## Bumper roles in chained sequences (A243, 2026-10-02)

For review. No frame draws them: the rows and words follow the library's own (A.2, 04.1), Settings, Breaks (02.1) and the player's lower third. Programming blocks' words (Build B) come with that build.

| Where | Words |
|---|---|
| Library, the folder rail | the group "Bumpers", with "All bumpers" and its count |
| Library, the Bumpers list | the title "Bumpers"; the chips "All bumpers", "Into a break", "Out of a break", "Up next", "Any"; empty: "No bumpers yet. Drop short clips here."; up next: "No up next bumpers yet. Upload one, then set its role to Up next."; another role: "No {into a break} bumpers yet." |
| Library, the table | under a bumper's type, its role: "Any", "Into a break", "Out of a break", "Up next" |
| Library item page, a bumper | the section "Role": "Any" ("A brand sting. Airs wherever a bumper is wanted."), "Into a break" ("We'll be right back."), "Out of a break" ("Now back to…"), "Up next" ("We draw the next program's title over it, from your log. Leave room in the lower third."); on the radio band, with up next: "On the radio band, choose up next sounds that make sense without a title." |
| Library item page, a bumper, station ID, opener or closer | the section "When it airs": the summary "Any time" / "Dec 1 to Dec 31, 6:00 pm to 2:00 am" / "From Dec 1" / "Until Dec 31" / "6:00 pm to 2:00 am", under it "Wherever it's wanted", "Airing now" or "Not airing now: from Dec 1" ("from 6:00 pm", "ended Dec 31"); the choices "Any time", "Between dates" ("From", "To", "No end"), "At times of day" ("From", "To", "Past midnight is fine."); "Save" |
| The API's refusals | "Only a bumper has a role."; "Only bumpers, station IDs, openers and closers have times they air."; "The last day is before the first."; "Say both times of day, or neither."; "The times of day can't be the same."; "Each bumper role can be in a position once, four at most. Say after how many programs." |
| Settings, Breaks, the ladder | the rows "Opening the break" ("Before the spots") and "Closing the break" ("After the credit, before the station ID. Time left over holds on the station ID slate"), each with its roles: "Into the break", "Up next", "Out of the break", "Any"; under each, "{2} in your library", "None yet, so an Any bumper airs", "None yet, so nothing airs", "{1}, not airing now (from Dec 1)"; "Remove {Up next}"; "Add" (the menu lists the roles not already there); "Nothing airs here."; for screen readers: "Move it with the arrow keys.", "{Up next}, now {1} of {2}", "{Up next} removed", "{Up next} added, {2} of {2}" |
| Settings, Breaks, How often | each sequence's own select: "Every break", "After every program", "After every {2} programs", "Once an hour", "Never"; the "Bumpers" row is gone |
| Settings, Breaks, under the ladder | the heading "Between programs", "After your station ID, just before the next program starts."; its select: "Between every program", "Every {2} programs", "At the top of the hour", "Never"; the notes "Up next names the next program on your log, as the guide shows it." and "Up next airs once a break. Here it only airs if it isn't earlier in the break."; "Example, a {2:00} break: Into the break :05, Up next :08, your spots, the credit, Out of the break :05, then your station ID." (with between programs: "…; between programs, Any :03.") |
| The log's break rows and the Monitor's rundown | a bumper's note: "Into the break", "Out of the break", "Between programs", "Up next: {Saturday Reel}, {9:00 pm}"; one that doesn't fit, listed quieter with no length: "Didn't fit: {Up next} ({:08})" |
| The player, over an up-next bumper (TV band) | "Up next" when the program follows the break, else "Next at {9:00 pm}" (the market's time); then the title; then the episode title. Its accessible name: "{Up next}, {Saturday Reel}, {Reel 14}" |

## Programming blocks (A244, 2026-10-02)

For review. No frame draws them: the rows and words follow the library's own (A.2, 04.1), Settings' sections and the program log (A.4); the viewer's follow the guide (05.1), the station page (01.1) and the banner (06.1).

| Where | Words |
|---|---|
| The rail, Programming | "Blocks" (between Library and Listings) |
| Blocks | the title "Blocks"; "Named stretches of your schedule with their own look: a logo, an ID, bumpers, an intro and an outro. The programs inside belong to the block while it's on."; the button "New block"; each card: "{Late Crate Nights}", "{Every Saturday, 9:00 pm to 1:00 am}" (or "Not on the log yet"), "Next {Sat Oct 10}"; empty: "No blocks yet. Make one, then put it on the log." |
| New block | the title "New block", "Give it a name and a colour. Its logo, ID, bumpers, intro and outro come next."; "Name", "Colour" ("Text on it must stay readable"); the button "Make the block" |
| The block editor | the sections "Name and look", "Intro and outro", "ID", "Bumpers", "Bumper order", "On the log"; "Name"; "Description" ("Shown on your station page"); "Colour" ("Text on it must stay readable"); "Logo" ("A PNG, JPEG or WebP, at least 128 pixels." / "Its bug and its cards show it."), "Upload", "Replace", "Remove"; "During the block, the bug shows": "Your station's bug", "The block's logo", "Nothing" ("Until it has a logo, your station's bug shows."); "Intro" ("Plays just before the block's first program."), "Outro" ("Plays just after the block's last program."); under each "Uses: {Late Crate Nights intro} ({:06})" or "No {intro} of its own yet, so a :05 card with the block's name and logo" or "No {intro}."; ID: "Airs where your station ID would during the block. Mention {BEAT}." and "Uses: {…}" or "No ID of its own, so your station ID airs."; Bumpers: "Into a break", "Out of a break", "Up next", "Any", each "{2} in this block" / "None yet, so its Any bumper airs" / "None yet, so {BEAT}'s up next airs" / "None yet, so {BEAT}'s airs", with "Add from your library" and "Upload"; "Bumper order": "Same as {BEAT}", "Its own" (then the Breaks page's rows); "On the log": "{Every Saturday, 9:00 pm to 1:00 am} (from the template {After dark})", one-off dates, or "Not on the log yet. Add it from the Program log's edit mode, or in a day template."; "Archive {Late Crate Nights}"; refused: "{Late Crate Nights} is on the log {3} more times. Take it off the log first.", "Dates you edited by hand keep theirs.", the button "Take it off the log and archive"; done: "{Late Crate Nights} is archived." (", {2} edited dates keep theirs.") |
| Add from your library | "Add {into a break} bumpers" / "Add an ID" / "Add an intro" / "Add an outro"; "From your library. It airs only during the block."; empty: "Nothing in your library fits here yet. Upload one into the block from its library list." |
| Library | the rail's group "Blocks", a list per block; a block's list: its name, empty "Nothing in {Late Crate Nights} yet. Drop its bumpers, ID, intro or outro here."; the item page's "Part of a block": "Block", "None, it's {BEAT}'s", or a block, with "Airs only during {Late Crate Nights}." / "Airs as {Late Crate Nights}' ID." / "Its intro" / "Its outro" |
| Program log | a rail beside the timeline in the block's colour with its name; its accessible name "{Late Crate Nights}, {9:00 pm} to {1:00 am}" (", {1} thing to look at"); its pane: "{Late Crate Nights}", "{3} programs, {9:00 pm} to {1:10 am}" or "Nothing in it yet", "Change times", "Take the block off this day", "Edit {Late Crate Nights}"; what to look at: "{Saturday Reel} runs {10} minutes past the block's end, {1:00 am}. It stays in the block.", "Nothing in this block yet. Put programs between {9:00 pm} and {1:00 am}.", "No room for the intro before {9:00 pm}. Leave {:05} at the end of {Crate Session 02}'s slot." |
| Program log, edit mode | the edit bar's "Add a block"; its dialog "Add a block", "Programs that start between these times are the block's.", "Block", "New block…", "Starts", "Ends", "Add it", "You don't have a block yet."; a span picked: "Starts", "Ends" ("Programs that start between these times are the block's."), "Take the block off this day"; while dragging a program into it: "In {Late Crate Nights}"; the changes' lines: "{Late Crate Nights} added, {Sat} {9:00 pm} to {1:00 am}", "{Late Crate Nights} now ends at {1:30 am}", "… now starts at {8:30 pm}", "… now runs {8:30 pm} to {1:30 am}", "{Late Crate Nights} comes off the log"; problems: "Blocks can't overlap: {Late Crate Nights} is on until {1:00 am}.", "{Late Crate Nights} is on air. Change it after {1:00 am}.", "{Late Crate Nights} is archived.", "A block runs 24 hours at most.", "That block isn't on the log any more." |
| Repeat this day | under a template: "Blocks in this template: {Late Crate Nights}, {9:00 pm} to {1:00 am}"; refused: "A block in a day template ends by 6:00 am, when the next broadcast day starts. Make it two blocks, or place it on the date." |
| The log's break rows and the Monitor's rundown | "{Late Crate Nights} ID", note "Block ID"; "{LCN intro}", note "Intro"; "{Late Crate Nights} outro", note "Outro"; one that doesn't fit, quieter: "Didn't fit: {Intro} ({:05})" |
| Monitor | beside "Program": the chip "{Late Crate Nights} · until {1:00 am}"; the preview card: "{Late Crate Nights} starts at {9:00 pm}" |
| The channel (made for the station) | the automatic intro: "{Late Crate Nights}", "on {12.1 BEAT}"; the automatic outro: "That was {Late Crate Nights}", "{12.1 BEAT}" |
| As-run log (the API) | an automatic card's title: "{Late Crate Nights} intro", "{Late Crate Nights} outro" |
| The API's refusals | "You already have a block called {Late Crate Nights}."; "Name it, in 60 characters at most."; "That colour doesn't hold 4.5:1 against white. Choose a darker one."; "Choose a PNG, JPEG or WebP image."; "The logo has to be at least 128 pixels on its short side."; "Only bumpers, station IDs, openers and closers can be part of a block."; "That block isn't this station's." |
| The banner (web, TV) | "{Late Crate Nights} · {Saturday Reel}" (the block lighter); its Next line "Next at {9:00} {Late Crate} · {After Hours}" when the next program is in another block |
| The guide (web, TV) | a band above the station's row in the block's colour with its name; its accessible name "{Late Crate Nights}, {9:00 pm} to {1:00 am}"; TV details: "Part of {Late Crate Nights}" |
| Station page (web) | the section "Blocks": per block its logo, name, description, "{Saturdays}, {9:00 pm} to {1:00 am}", "Next: {Sat Oct 10}, {Saturday Reel and Late Crate}"; in the schedule, a member's block name above its title |
| TV station info | "Block", "{Late Crate Nights}", "{Saturdays, 9:00 pm to 1:00 am}" |

## The swipe home (A245, 2026-10-02)

For review. The reference (`viewer/opencast-swipe-home.html`) draws most of the words: the tabs (Watch, Guide, Search, You), the buttons (Preset, Remind, Pledge, Share, Guide), "Preset 2 of 3", "Dial, 4 of 5", "End of your presets" / "The dial, in channel order", "Back to your presets", "End of the dial" / "Back to preset 1", "Start of your presets" / "To the end of the dial", "Paused at 8:42 pm", "Back to live" with "0:48 behind", the Tune pad's "Channel", "TV 2 to 69, radio 88.1 to 107.9", "Type a channel or frequency. It tunes 2 seconds after you stop, or press Tune.", "{SAZN 18.1}" over "Now: {Tamales for forty}, {18 min} left", "Radio band. Now: …", "No station on {45}" / "Nearest is {LUPE 33.1}.", Cancel and Tune, the guide's "Your presets" and "The dial", and "Watch full screen". These are new:

| Where | Words |
|---|---|
| The position line, radio band | "Band, {3} of {4}" |
| The detent, the radio band | "End of your presets" / "The band, by frequency"; "End of the band", "Start of the band", "To the end of the band" |
| The detent, no presets | "End of the dial" / "Back to the start"; "Start of the dial" / "To the end of the dial" |
| The detent, every station a preset | "End of your presets" / "Back to preset 1"; "Start of your presets" / "To your last preset" |
| The detent from the dial back | "Back to your presets" / "Preset {3}" |
| The right-hand buttons, accessible names | "Add to presets", "Preset {1}. Open presets", "Remind me: {Beat Tape Live}, {9:00 pm}", "Remind me (nothing scheduled next)", "Pledge", "Share", "Guide"; the group "This station"; a long press shows the name |
| The top bar, accessible names | the bands' group "Band" ("TV", "Radio"); "Cast" / "Watching on {Living room TV}"; "AirPlay"; "Search" |
| Screen readers and the keyboard | "Next channel: {SAZN 18.1}", "Previous channel: {PREP 31.1}" (or "Next channel", "Previous channel" with nowhere to go), "{Inland Beat}'s page"; Back to live's name "Back to live, {0:48} behind" |
| The floating bar | the tabs' navigation "Tabs"; the Tune button's name "Tune by number" |
| The Tune pad | out of range: "No channel {75}" / "TV runs 2 to 69, radio 88.1 to 107.9."; no station on a band with none: "Nothing on that band here yet."; a station off air: "Off air now."; the keys' names "Point", "Delete", the group "Keys"; the dialog "Tune by number" |
| The mini player | its line "{BEAT 12.1}, {18 min} left"; a swipe down stops it |
| Guide, the radio band | "The band" (the dial's heading on radio); a station's column: "Tune in to {BEAT 12.1}"; the watched row, for screen readers: ", watching" |
| Guide and Search, a tablet on its side | the column's name "Watching"; nothing on: "Nothing on. Tap a station in the guide to tune in."; "Remind" |
| The home, waiting | "No stations on the dial here yet."; `/radio`: "No stations on the radio band here yet." |
| Settings, Watching (phones and tablets) | "Muted previews", help "Watch opens with no sound until you tap" (the web keeps "Muted previews on the dial", "The live hero plays with no sound") |


## The Schedule workspace, Phase 1 (A246, 2026-10-02)

For review. The reference (`docs/reference/control/opencast-schedule.html`) draws the rail item "Schedule", the head "Schedule" and the tabs "Log", "Templates", "Blocks" and "Break rules", and the Templates tab's "Every day" card; those words are final. Phase 1 hosts the pages that already existed under that head, so these are the words around the move.

| Where | Words |
|---|---|
| The phone's top bar on every Schedule tab, and on Place it in the log | "Schedule" (was "Program log" on Place it in the log) |
| Templates, the "Every day" card (the off air hours, above the templates) | "Every day" (the reference's title, in place of "Off air hours"); under the hours: "Off air hours apply to every template and date." (the reference's card line is "Off air every night, 2:00 to 6:00 am. Applies to every template and date"; the hours keep their existing rows until Phase 4 draws the card) |
| Templates, with no templates | "No templates yet. On the Log, Repeat this day makes one from a day." |
| Station settings, Breaks (the link left behind) | "Break rules moved to the Schedule." "When breaks come, what fills them and how often each part airs are set beside the log now." The button "Open Break rules" |
| Spot market, Your rotation | the button "See tonight's breaks" (to the Schedule); C.3's toast and the paused-spot notices keep their words from Breaks |
| Spot market, the blocked categories line | "Never on {BEAT 12.1}: {Alcohol, Gambling}. Change in Break rules" (was "Change in Settings") |
| A block with no dates (the block editor's "On the log") | "Not on the log yet. Add it from the Log's edit mode, or in a day template." (was "the Program log's edit mode") |

## The Schedule workspace, Phase 2: the Log tab (A246, 2026-10-03)

For review. The reference (`docs/reference/control/opencast-schedule.html`, sections 01 to 04) draws the rundown, the chips, the pane, the week, edit mode, the tray and the Add drawer, and their words are final ("Tonight at a glance", "Spots placed at 10:09 pm", "Follows the programs", "4 changes, checked: nothing blocks publishing", "Runs 9 min over", "Repeat from your library" and the rest). These are the words beyond its examples. `{}` marks what's filled in.

| Where | Words |
|---|---|
| The day nav, arrows (accessible names) | "The day before", "The day after"; on the Week "The week before", "The week after" |
| The rundown, nothing on the day | "Nothing on the log this day." |
| The rundown's codes, for screen readers | PGM "Program", LIVE "Live", BRK "Break", GAP "Dead air", OFF "Off air, planned" |
| A break's line (beyond the reference's) | "{1 spot}, credit, up next, ID"; "{0:30} open" (open time of 15 seconds or more); "Holds on the station ID slate" (nothing else in it) |
| A program kept at its time (view) | the tag "KEPT" |
| Planned off air (the hours) | after "Planned, back at {6:00 am}": the link "Change the hours" (the Templates tab's "Every day") |
| A block's label | "Its own bumpers, {BEAT}'s ID", "Its own ID, {BEAT}'s bumpers", "{BEAT}'s bumpers and ID" (the reference has "Its own bumpers and ID") |
| Health chips | "Dead air now, {20 min}"; "{2 items} couldn't be prepared"; "{2} spots paused; backup fills {10:29 pm}"; "A spot paused; your station ID and bumpers fill its time" (no break ahead has the backup rotation in it) |
| Week, a day's header | "No template" (a day no template made); for screen readers ". Open the day"; the regions "The week", "The week's hours" |
| Week, dead air now | "Dead air now, {1 hr}" |
| Tonight at a glance, another day | "{Sunday} night at a glance" |
| Tonight at a glance, rows | "None" (no breaks); "Still open, on the station ID slate" (when open time doesn't go to the spot market) |
| Under the glance (the reference's "Changes to this day") | the heading "Recent changes"; rows "{Kai M.}, {6:12 pm}" / "{2 changes}"; "{Saturdays} template" / "Made" |
| A break's pane, its list | bumpers: "Into the break", "Out of the break", "Between programs", "Where the block starts or ends", ". {Late Crate Nights}'s own"; up next: "Up next: {Saturday Reel}, {9:00 pm}"; spots: "From the backup rotation"; the credit: "{Made possible by members}. {Once an hour}"; the ID: "Last in the break"; open: "Open", "Open to the spot market", "Holds on the station ID slate"; before spots are placed, when open time stays the station's: "From the main rotation. {0:30} holds on the station ID slate until then" |
| A break's why line (beyond the reference's) | "Cued from the booth during {Beat Tape Live}."; "Breaks come every {30} minutes."; "Breaks are cued from the booth."; "no bumpers open the break"; "spots air {once an hour}"; "the station ID airs {once an hour}" |
| A program picked (view) | rows "From", "Episode", "Note", "Block", "Length", "Keep at this time" / "On"; the button "Change it" |
| A block picked | its line starts "Block, {8:00 to 9:00 pm}. " before the existing "{2 programs}, {8:00 pm to 8:59 pm}" |
| Edit mode, the pane with nothing picked | "Editing {Saturday, Sep 26}"; "Drag a row by its handle to move it, or use the arrow keys. Pick a row to type its time, change what airs or keep it at its time. Nothing changes on air until you publish." |
| Edit mode, a picked program | "Keep at this time" with "Moving the rows around it stops here"; the start's help when kept "Kept at this time. Turn it off to move it."; for a fixed row "{Live, so it keeps its start}. Moving the rows around it stops here." |
| Edit mode, rows' lines (beyond the reference's) | "Carried, so it keeps its time", "Kept at this time", "Off air, so it keeps its time", "Replaces {Slow Hours}", "locked" |
| Edit mode, dragging | "Drop here: {10:40 pm}. Joins {Late Crate Nights}" / "In {…}" / "Leaves {…}"; the end of a live block or sign-off while dragged "Ends {10:10 pm}" |
| Edit mode, rows' buttons (accessible names) | "Move {Late Crate, ep. 15}, {10:00 pm}"; "Keep {…}, {10:00 pm}, at this time" (title "Keep at this time"); "Remove {…}, {10:00 pm}" (title "Remove"); "Change when {Beat Tape Live}, {9:01 pm} ends, now {9:58 pm}"; on a removed row "Undo" ("Undo: {…} stays on"); "Add here, {10:40 pm}" |
| The tray | "{1 change}, checked: {1 problem blocks} publishing" / "{2 problems block}"; "{2 changes}, checking…"; a date from a template: "Publishing makes {Saturday, Oct 3} an exception to "{Saturdays}"." |
| The tray, 409 `log_changed` | "The log changed since you started editing." (as before); "Reload to see it as it is now. Your {2 changes are} kept and checked again; any that no longer fit say so here."; the buttons "Discard" and "Reload and keep my changes" |
| After Publish, the change record | "Published: {4 changes}, by {Kai M.} at {8:43 pm}" with each line; "Close" |
| Done editing with changes | "Leave without publishing?"; "{2 changes} haven't gone out. Leaving drops them."; "Keep editing", "Discard changes" |
| The Add drawer | "Nothing after it on this day"; "No time free: it starts where {Late Crate, ep. 13} at {12:00 am}"; over with nothing pushed "{29:10}, runs {9} min over, into {Late Crate, ep. 13}"; "Show all {31}"; "Nothing in your library by that name."; Live: "Program", "No program", "No live sources yet. Add one under Live sources."; quick fill with no end: "Sign off for an hour"; a choice's name ends ". Add it"; the toast "Filled {11:40 pm} to {2:00 am} from your library." |
| Setup step 3 and the Log without the Schedule's head | "What airs, in order. Build one day and make a template of it, then adjust." (was "…and repeat it, then adjust.") |
| Templates, with no templates | "No templates yet. On the Log, "Make a template from this day" starts one." (was "…Repeat this day makes one from a day.") |
| The API's lines (G18) | "{Saturday Reel} keeps its time", "{Saturday Reel} no longer keeps its time"; the problem `kept`: "{Saturday Reel} is kept at its time. Turn off Keep at this time to move it." |

## The Schedule workspace, Phase 3: Break rules, with a preview (A246, 2026-10-03)

For review. The reference (`docs/reference/control/opencast-schedule.html`, section 05) draws the tab and its words are final: "Every break, in air order", "Drawn to scale for a 2:00 break", "Then between programs", "Outside the break, so partner ads never replace it", the parts' names and lines ("Your rotation, then backups, then the spot market", "Members and sponsors", "Into and out of the break", "Always last. Can't be never", "Between programs"), the chips ("Every break", "After each program", "Every 2 programs", "Once an hour", "Never"), "What can air in your breaks", "Never on {BEAT}", "Backup rotation", "When a spot pauses", "Ads from partners", "Only time still open. Paid later", the tiles ("Breaks come", "Length", "Spot time per hour", "Same spot per hour"), "Preview: {7:00 to 8:00 pm}", "Rebuilt with the rules as set. Nothing is saved yet", "Everything on this page saves together. Applies to breaks not yet filled. Breaks in the next 20 minutes keep what they have. {Late Crate Nights} uses its own bumper order during the block.", "Reset", "Save break rules". These are the words beyond it. `{}` marks what's filled in.

| Where | Words |
|---|---|
| The recipe's line, after every program (the length doesn't shape these breaks) | "Drawn to scale for a {2:00} break. After every program, a break is the time its program leaves, so most run shorter or longer"; with no rule (breaks cued from the booth): "Drawn to scale for a {2:00} break, cued from the booth" |
| The recipe on the phone (its parts listed under the strip) | "Bumper {0:10} · Spots up to {1:20} · Credit {0:15} · Bumper {0:10} · ID {0:05}" |
| The recipe, between programs | each part "{Up next} {0:05}" or "Bumper {0:03}" |
| The chips | "Every {3} programs" once N is chosen; beside it the select "How many programs: {Spots}" with "{2} programs" to "{6} programs"; accessible names "How often: {Spots}" (and "How often each part airs" for the group) |
| Up next's line, by where its role sits | "Between programs" (the reference's), "In the break, as it opens", "In the break, as it closes" |
| Bumpers, opening and closing differ | "Opening and closing differ. Set each in the bumper order below" |
| What can air | "Spots in these categories don't reach your market" (the reference's line); the backup rotation's link "Open the rotation" and "No backups yet"; the row "Fill order", "Your spots and the credit, inside each break", chips "Spots, then the credit" and "The credit, then spots"; Ads from partners' chips "On", "Off" |
| The length tile, by mode | after every program: "Breaks cued live, and between repeats. The rest are the time a program leaves"; every N minutes: "Every break. Live programs cue their own"; no rule: "Breaks cued from the booth" |
| The timing tiles (accessible names) | "Timing and limits" (the group); the selects "Breaks come", "Break length", "Spot time per hour", "The same spot, at most" |
| The bumper order (the sequences, below) | the heading "The bumper order"; "Which bumpers air, in order, and how often each place airs them"; with Up next's own cadence: "Which bumpers air, in order. Up next goes by its own choice above; here it only sets its place" |
| The preview | saved and unchanged: "Rebuilt with the rules as saved"; "Building the preview…"; "Nothing on the log this hour."; "The preview can't be built. {The API's words}"; a program's "live" or "carried"; a kept break "Keeps what it has"; the arrows "An hour earlier", "An hour later"; the list's name "The hour, rebuilt"; the column's "Preview and save" |
| Two or more blocks with their own order | "{Late Crate Nights} and {Sunday Matinee} use their own bumper order during their blocks." |
| Saving | "Unsaved changes" beside Save; "Saving…"; the toast "Break rules saved." |
| Leaving with unsaved changes (a link, a Schedule tab) | "Leave without saving?"; "Your changes to the break rules haven't been saved. Leaving drops them."; "Keep editing", "Leave without saving" (closing or reloading the tab gets the browser's own prompt) |
| The Log's why line, with Up next's own cadence (S20) | "up next airs {once an hour}"; "up next is off" |
| The API's refusals (`previewBreakRule`) | "The preview ends after it starts."; "Preview three hours at most." (the rest are `setBreakRule`'s own) |

## The Schedule workspace, Phase 4: templates, blocks and the phone (A246, 2026-10-03)

For review. The reference (`docs/reference/control/opencast-schedule.html`, sections 06 to 08) draws the tabs and its words are final: "Every day", "Off air every night, 2:00 to 6:00 am. Applies to every template and date", "Change", "{15} dates ahead", "Once, {Sat Oct 31}. Overrides {Saturdays} that day", "New template", "{Oct 3} edited", "Reset {Oct 3} to template", "Edit template", "Saving changes here rebuilds {3} upcoming {Saturdays}. {Oct 3}, edited by hand, is kept as an exception.", the blocks' cards ("{Fridays and Saturdays}, {9:00 pm to 1:00 am}. Its own look, bumpers and ID", "Next: tonight at {9:00 pm}", "Not on the log yet", "Place on the log", "New block"), the block page ("Edit", "Made by {BEAT 12.1}", "Place on the log", "Save", "What it airs", "Anything it doesn't have falls back to {BEAT}'s", "Intro", "Just before its first program. {2} in rotation", "Outro", "Just after its last program. {1}", "Block ID", "Airs where the station ID would. {3} in rotation", "Bumpers into the break", "{4} of its own", "Bumpers out of the break", "Up next", "None of its own", "Uses {BEAT}'s", "Add from the library", "Upload", "Added clips and uploads save straight away; everything else saves with Save.", "Bumper order", "Its own, instead of {BEAT}'s", "Opening a break", "Closing a break", "Between programs", "How it looks", "Colour", "Logo", "Replace", "The bug shows", "{BEAT}'s", "Block logo", "Nothing", "Where it airs", "{Fridays and Saturdays} templates", "{9:00 pm to 1:00 am}. {6} dates ahead", "Once, {8:00 pm to 2:00 am}", "Open", "Made by {BEAT}. Offering blocks to other stations, with your look or theirs, comes later with the syndication market.", "Archive block"), the handles ("{Late Crate Nights} starts {9:00 pm}", "Drag to change. Programs that start inside it become its members", "Ends {12:30 am}, was {1:00 am}", "Its outro airs at {12:29:10 am}", "Member. Its intro airs just before", "Member", "Member, runs to {12:29 am}", "Not a member: starts after the block ends", "{Crate Session 01} is no longer part of it") and the phone ("Today, {Sat Oct 3}"). These are the words beyond it. `{}` marks what's filled in.

| Where | Words |
|---|---|
| Templates, the "Every day" card | "Off air {every night, 2:00 am to 6:00 am}. Applies to every template and date" (the rule's own words); with none: "No off air hours: {BEAT} stays on around the clock. Hours set here apply to every template and date"; Change's accessible name "Change the off air hours" |
| Templates, a card's line | "{Monday to Friday} from {Sep 21}{, until Nov 20}. {15 dates ahead, 1 edited}"; a template with no name: "From {Sep 26}. {3 dates ahead}"; "No dates ahead"; for screen readers ". Edited by hand: {Wed Sep 30}"; a square's title "{Sep 30}, edited"; the list's name "Your templates" |
| Templates, the precedence note (beyond the reference's "Overrides {x} that day") | "Overrides {Every day} on {Saturdays}"; "Overrides {Every day} on weekdays"; "Overrides {Every day}" (a newer every-day template); more than one: "{Every Saturday} and {Every day}" |
| Templates, none yet | "No templates yet. Start one from a day: "New template" here, or "Make a template from this day" on the Log." |
| New template | "New template"; "A template starts as one day's log. Pick the day, then how it repeats; change its rundown after."; "Start from the day"; "Cancel", "Continue" (then the Repeat this day dialog, as before) |
| A template, its head | more than three edited dates: "{2} more edited"; edit mode: "Editing the template", "Add a block", "Add", "Done editing"; two or more edited dates, a list "Dates edited by hand": "{Wed Sep 30}, edited by hand" with "Reset {Sep 30} to template" |
| What saving does (beyond the reference's) | "{Oct 3 and Oct 10}, edited by hand, are kept as exceptions."; "{4} dates edited by hand are kept as exceptions."; "Saving changes here rebuilds {1} upcoming {Saturday}" / "{weekday}" / "{day}"; a template once: "Saving changes here rebuilds {Sat Oct 31}."; "Saving changes here rebuilds no dates." (once, past) / "…no dates yet." |
| A template's rundown | "Nothing in this template yet."; edit mode, nothing picked: "Editing {Every Saturday}", "The same rows as the day: drag a row by its handle, or use the arrow keys; drag a block's start or end. Nothing changes on the dates it makes until you save."; a picked row "Take off the template"; a picked block "Take the block off the template", its end's help "Programs that start between these times are the block's. In a template it ends by 6:00 am." |
| A template's tray | "{1 change}, checked: nothing blocks saving" / "{1 problem blocks} saving" / "{2 problems block} saving"; lines "{Night Owl} comes off the template", "{Late Crate Nights} comes off the template", "{Crate Session 03} replaces {Slow Hours}" (the others as the API's: "moves to", "now ends at", "goes on at", "keeps its time", "{x} added, {9:00 pm} to {11:00 pm}", "{x} now ends at {10:00 pm}, was {9:00 pm}. {Beat Tape Live} joins it"); the problems in the API's words ("{Night Owl} would overlap {Beat Tape Live} at {9:30 pm}.", "Blocks can't overlap: …", "A block in a day template ends by 6:00 am, …"); "Discard", "Save template" |
| After saving a template | the notice "Template saved. {3 dates} rebuilt; {1} edited {date} kept as {an exception}." (or "…exceptions"); the toast "Template saved." |
| Leaving a template with changes | "Leave without saving?"; "{1 change} to {Every Saturday} haven't been saved. Leaving drops them." (Done editing) / "Your changes to {Every Saturday} haven't been saved. Leaving drops them." (a link, a tab); "Keep editing", "Discard changes" / "Leave without saving" |
| A template's foot | "Change how it repeats", "Stop repeating" (the Repeat this day and Stop dialogs, as before) |
| Reset to template | "Reset {Sep 30} to {After work}?"; "{Wed Sep 30} goes back to the template: what was changed by hand comes off, and the template's programs and blocks go back on. It's no longer an exception."; "Comes off", each "{Crate Talk}, {7:00 pm}"; "Keep it", "Reset to template"; the toast "{Sep 30} is back to {After work}: {2 programs} back on, {1} taken off." (either part left out at zero) |
| The API's `resetTemplateDate` | 409 `date_started`: "{Oct 26} has started. Only dates from tomorrow on can be reset to their template."; 404: "That date of the template wasn't found." |
| A block's start and end (the Log's edit mode, a template) | a start moved: "{Late Crate Nights} starts {9:30 pm}, was {9:00 pm}"; on air: "{Late Crate Nights} started {8:00 pm}", "On air, so only its end can change"; an end unchanged: "Ends {1:00 am}"; with no outro "It airs until {12:29 am}"; with no members "Nothing in it yet"; accessible names "Move the start of {Late Crate Nights}, now {9:00 pm}", "Move the end of …", "Take {Late Crate Nights} off this day" (title "Take it off") |
| Dragging an edge | the line where it lands: "{Late Crate Nights} starts {9:30 pm}. {…}" / "Ends {10:00 pm}. {…}" with "{Beat Tape Live} joins it", "{x and y} join it", "{Crate Session 01} leaves it", "{x and y} leave it", or "Its programs stay the same"; on the rows "Joins {Late Crate Nights}", "Leaves {Late Crate Nights}" |
| A row near a block (beyond the reference's) | "Not a member: starts before the block" |
| The dry run's line for a block (API and mock; the reference's second line) | "{Late Crate Nights} now ends at {12:30 am}, was {1:00 am}" and "… now starts at {9:00 pm}, was {9:30 pm}", then ". {Crate Session 01} is no longer part of it", ". {x and y} are no longer part of it", ". {Late Crate} joins it", ". {x and y} join it" (the reference's ": BEAT's bug and ID air from {12:30 am}" isn't said) |
| Blocks, a card | "{Its own look}. {BEAT}'s {bumpers and ID}"; "{BEAT}'s bumpers and ID"; "Next: today at {2:00 pm}", "Next: tomorrow at {6:00 am}", "Next: {Sat Oct 31} at {8:00 pm}", "On now"; the list "Your blocks"; none: "No blocks yet: named stretches of your schedule with their own look, ID, bumpers, intro and outro. Make one, then place it on the log."; "That block wasn't found." |
| A block's head | Edit's accessible name "Edit the name and description"; in place: "Name", "Description" ("Shown on your station page"), "Done"; "Unsaved changes. Save keeps them; leaving drops them."; the toast "{Late Crate Nights} saved."; "Place on the log" (accessible name "Place {Late Crate Nights} on the log") with "On a date" ("The Log, in edit mode") and "In {After work}" ("The template editor") |
| Place on a date | "Place {Late Crate Nights} on a date"; "The Log opens in edit mode with Add a block set to it. Publish when it's where you want it."; "Date"; "Cancel", "Open the Log" |
| What it airs (beyond the reference's) | "{Just before its first program}. None of its own"; "Off. Nothing airs before it" / "…after it"; "None of its own for this" with "Uses its Any bumpers"; "An automatic card airs" (intro, outro); "An automatic ID airs"; "Nothing airs here yet"; "Any bumper", "{2} of its own. Airs wherever a bumper is wanted" |
| Add from the library | "Add from the library"; "It airs only during the block, and it's the block's as soon as you pick it."; "It's for": "Intro", "Outro", "Block ID", "Into the break", "Out of the break", "Up next", "Any bumper"; "From your library"; "Nothing in your library fits here yet. Upload one into the block."; "Cancel"; the toast "{Late Crate Nights ID} is part of {Late Crate Nights} now. Added at once." |
| Bumper order, the station's | the heading's line "{BEAT}'s"; "Same as {BEAT}", "Its own"; the station's order read-only, its list "{BEAT}'s bumper order", "None" |
| How it looks | a block not on the log: "A sample program: {Sunday Matinee} isn't on the log yet." and the sample's title "Your program"; the figure's name "How {Late Crate Nights} looks on air" (", with a sample program"); "No bug during the block." (screen readers); the guide's name "{Late Crate Nights} in the guide" |
| The logo | "Upload" (no logo yet; "Upload the logo", "Replace the logo"), "Remove", "Saves straight away"; toasts "Logo saved.", "Logo removed."; with "Block logo" and no logo: "Until it has a logo, {BEAT}'s bug shows." |
| Where it airs (beyond the reference's) | one template: "{After work} template"; "No dates ahead yet"; more than the API lists: "{20}+ dates ahead"; a one-off date's title "{Sat Oct 31}"; Open's accessible name "Open {Saturdays template}"; none: "Not on the log yet. Place it on a date, or in a template." |
| The syndication line, a carried copy (later) | "Made by {REEL}, carried here in its look. The syndication market's screens come later." / "…in your look where it allows." |
| The phone, the desk-only tabs | "Open {Templates} on a computer" ("Blocks", "Break rules"); "Templates, blocks and break rules are desk work. On the phone, check tonight, fill dead air, sign off and move a program on the Log."; "Back to the Log" |


## Break timing (A247, 2026-10-04)

For review. Words for the Break rules tab's new choices of when breaks come, and the Log's why line. The reference (`docs/reference/control/opencast-schedule.html`, section 05) draws only "After every program" in the tile; these follow its voice.

| Where | Words |
|---|---|
| "Breaks come" (the select) | "After every program", "After every {2} programs", "Every {30} minutes", "At set times each hour", "Never" |
| Under it, the second select | after every N programs: "Every {2nd} program" to "Every {6th} program" (accessible name "After how many programs"); every N minutes: "{5} minutes" to "{60} minutes" ("How many minutes") |
| Under it, the line | after every N programs: "Between the others, a program's spare time airs your station ID and bumpers"; every N minutes: "Inside every program, or at its maker's break points"; set times: "Programs pause at the times below"; after every program and never: nothing (as the reference) |
| The recipe's line | after every N programs: "Drawn to scale for a {2:00} break. After every {2nd} program, a break is the time its program leaves, so most run shorter or longer"; never with inside long programs: "Drawn to scale for a {2:00} break, cued from the booth and inside long programs" |
| The length tile | after every program (or N) with inside long programs: "Breaks inside long programs, cued live, and between repeats. The rest are the time a program leaves"; set times: "Breaks at your times, and cued live. After a program, a break is the time it leaves"; never with inside long programs: "Breaks cued from the booth, and inside long programs" |
| The clock's row | "Breaks at"; "Minutes past the hour, in your station's time. A long program gets several"; chips ":00" to ":55" (the group "Minutes past the hour"); too close: "Leave at least {10} minutes between break times." (Save waits) |
| Inside long programs | "Inside long programs too" (the switch's name); on: "Counted from the last break inside it, or its start", "Longer than {45 min} every {30 min}" (accessible names "Programs longer than", "A break every"); off: "Off: long programs break only as above"; with every N minutes (the switch off and disabled): "Every N minutes already breaks inside every program" |
| The rules line (under the rows) | with set times or inside long programs: "A break inside a program comes out of the time it leaves in its slot, so a program is never cut for one. A break less than 5 minutes from another, or from the end of its program, is skipped. Programs carried live only never pause."; with every N programs: "The count starts again each day at 6:00 am, after off air time and where a block starts or ends. Live programs cue their own and aren't counted." |
| The group (accessible name) | "When breaks come" |
| The Log's why line | "Breaks come after every {2} programs.", "Breaks come every {45} minutes.", "Breaks come at {:15 and :45} each hour."; with inside long programs: "Programs over {45} minutes also break every {30} minutes inside." |
| The API's refusals (and the mock's) | "Breaks after every N programs go with breaks after every program."; "Breaks at set times each hour go with mode every_n_minutes."; "Choose the minutes past the hour: 0 to 59."; "Choose 6 times an hour at most."; "Leave at least {10} minutes between break times."; "Every N minutes already breaks inside every program."; "Breaks inside long programs come every 10 to 60 minutes."; "A long program is longer than how often it breaks, and 24 hours at most."; "Say after how many programs: 2 to 12." |

## Schedules from spreadsheets (A248, 2026-10-06)

For review. Viewers see nothing new: a spreadsheet's shows appear in the guide, on the dial and on the station page like a feed's. The API's refusals are its own words, shown as they come.

| Where | Words |
|---|---|
| Network desk, List a source and Change, What's on (four choices) | "Its feed", "A spreadsheet", "Enter it by hand", "None"; "Its feed"'s Format gains "Spreadsheet" |
| A spreadsheet | "Where it is": "A link", "Upload a spreadsheet"; the field "Spreadsheet link" (placeholder "https://docs.google.com/spreadsheets/…"), help "A Google Sheet, published to the web or shared with anyone with the link, or a link to a .csv, .tsv, .xlsx or .ods file. Read again every hour. A tab in the link is the one read."; "Spreadsheet file" with the button "Upload a spreadsheet" ("Upload another" once one is chosen or kept), "No file chosen", "{attic-week.xlsx}", "Now: {attic-week.xlsx}, {Excel workbook}, {18 KB}, uploaded {Oct 6} by {Dee A.}", and the line "An .xlsx, .ods, .csv or .tsv file, 2 MB at most. What's read from it is kept, not the file: upload it again when their schedule changes. Formulas and macros are never run."; "Times in": "Work it out", "{Eastern} ({America/New_York})" and the rest, help "Worked out: the zone the sheet names, else the market's ({Pacific})."; with a workbook of several tabs, "Tab": "The first ({Sheet1})", then each tab's name |
| A spreadsheet, checking it | the button "Check it" ("Reading…" while it reads) and "Reads it now and shows what it gives. Nothing is saved."; what was read: "Read {152} shows from {a week grid / a grid with a column of times / a list}, {Monday 10/05} to {Sunday 10/11}, times in {Eastern}." (", every week" for a sheet of weekdays without dates); "Tab: {The tab in the link (gid 7)} / {The first tab} / “{Week}”, of {2} tabs"; "Times in {Eastern}: {the sheet says so / this listing's setting / the market's, as the sheet doesn't say}"; several zones: "It names {Eastern} and {Pacific}, so {the market's / this listing's setting} is used."; "{2} cells skipped: nothing was guessed for them" ("rows" for a list), each "“{Test Card 2:55 PM}”, {Friday 10/09, row 10}: {no time it can read / a time but no title / out of order in its day (a typo?) / no am or pm / no day or date}", "And {5} more"; "{31} airings to come{ in the next 14 days}. The first {8}, in {Eastern} time:" and each "{Fri Oct 9}, {6:00 to 6:25 am}" with its title; a dated sheet whose days have passed: "Its days have passed: the last is {Sunday 10/11}. {Upload the new week. / It's read again every hour, so the new week shows once they add it.}" |
| A spreadsheet, problems | a sheet that isn't public: a notice "This sheet isn't public" with "Publish it to the web (in Google Sheets: File, Share, Publish to web), or share it with anyone with the link (Share, General access), then check it again."; before checking, a link for editing: "A link for editing works only when the sheet is shared with anyone with the link. Publishing it to the web works too."; "Paste the link to their spreadsheet: a Google Sheet, or a .csv, .tsv, .xlsx or .ods file."; "Choose their spreadsheet file."; "Use a file of 2 MB or less."; "Choose a file to check."; listed but the file wasn't read (a toast): "{Attic Channel} is listed, but its spreadsheet wasn't read: {the API's words} Upload it again from its details." |
| The API's refusals (and the mock's) | "This Google Sheet isn't public. Publish it to the web (File, Share, Publish to web), or share it with anyone with the link, then try again."; "That address didn't answer with a schedule. Check the link and try again."; "No shows with times were found in it. Each needs a title and a time (“Trigun 6:00 AM”) under a row of days, or columns like Date, Start and Title."; "That isn't a spreadsheet Opencast can read: use .xlsx, .ods, .csv or .tsv."; "Older Excel files (.xls) aren't read. Save it as .xlsx or .csv and upload that."; "Use a file of 2 MB or less."; "It has no tab called “{Week 2}”."; "That address answered with a web page, not a spreadsheet."; "That workbook is too big to read."; "Give their schedule's address, or upload a spreadsheet."; "Choose a spreadsheet file."; "Upload a spreadsheet first."; "Upload the spreadsheet once it's listed." |
| Network desk, External sources table, What's on | "Their spreadsheet" / "Read every hour" (a link) or "Uploaded" (a file); "Sheet isn't public" / "Publish it, or share it with anyone with the link"; "No times found in the sheet" / "Banner shows name and Live until it has some" |
| Network desk, a listing's details, What's on | "What was read": "{the summary}. Last read {September 26 at 8:00 pm}" (a file: "Read when it was uploaded"); "Tab"; "Times in": "{Eastern}: {the sheet says so}"; "Nothing to come" (a dated sheet whose days have passed); "{1} cell skipped" with its lines; "Spreadsheet link" (the link) or "Spreadsheet file" ("{attic-week.csv}, {CSV file}, {26 bytes}, uploaded {Sept 26} by {Dee A.}"); not public: "This Google Sheet isn't public, so it can't be read: what it listed before stays. Publish it to the web (in Google Sheets: File, Share, Publish to web), or share it with anyone with the link (Share, General access), then it's read again within the hour." |
| Network desk, the change history | "Spreadsheet from {nothing} to {attic-week.csv, 14 shows}"; "Its time zone from {nothing} to {America/Chicago}"; "What's on from … to An uploaded spreadsheet"; "Feed format from … to Spreadsheet" |

## Large guides and "Find this channel's guide" (A249, 2026-10-06)

For review. Viewers see nothing new: a guide's shows appear in the guide, on the dial and on the station page like any feed's. The API's refusals are its own words, shown as they come.

| Where | Words |
|---|---|
| Network desk, List a source and Change, Its feed | the button "Find this channel's guide" ("Looking…" while it looks) and "Looks up its name in iptv-org's public lists of guides, for a guide file Opencast can read."; without a name: "Fill in whose stream first: its name is what's looked up." |
| Guides found | "{3} guides for “{Anime x HIDIVE}” ({Anime x HIDIVE} in iptv-org's list):" ("A guide for …"); none: "No guide file Opencast can read was found for “{name}”. Check the name, or enter the schedule another way."; each guide "{Pluto TV (US)}, via {i.mjh.nz}" with "Their name for it: {ANIME x HIDIVE}", and when the file no longer has it ". Not in the guide right now" (its buttons off), or ". Couldn't check the guide just now"; buttons "Check it" ("Reading…") and "Use this" ("In use" once it's the address); "{3} more guides need a site's pages read, so they aren't offered." ("1 more guide needs …, so it isn't offered."); once one is used: "It's someone else's listings for this channel, so it's saved as guide data: say where you checked it against their published schedule, and when." |
| A guide checked | "Read {32} airings to come for {ANIME x HIDIVE}, one of {427} channels in the guide."; "{965 KB} as it downloads (gzipped), {7.4 MB} unzipped" (not gzipped: "{212 KB}"); "{32} airings to come. The first {8}, in {Pacific} time:" and each "{Sat Sept 26}, {8:30 to 9:00 pm}" with its title; nothing to come: "Nothing to come in it right now." |
| The API's refusals (and the mock's) | "This guide has {427} channels. Pick one: add #channel= and its id to the address (Find this channel's guide does it), so no other channel's shows are listed."; "Channel {USBC1500009LD} isn't in this guide right now (it lists {427} channels). Find this channel's guide again, or check the address."; "This guide is over 40 MB as it downloads, Opencast's limit, so it wasn't read. What it listed before stays."; "This guide is over 300 MB unzipped, …"; "This guide lists over 5,000 airings to come for the channel, …"; "This guide took over 90 seconds to read, …"; "iptv-org's lists couldn't be read just now. Try again in a minute."; "Give the channel's name." (the mock's) |
| Network desk, External sources table, What's on | "Guide needs a channel" / "Pick one: Find this channel's guide"; "Channel not in the guide" / "What it listed before stays"; "Guide too big to read" / "What it listed before stays" |
| Network desk, a listing's details, What's on | "Channel in the guide": "{ANIME x HIDIVE} ({6793eaa4bc03978b9bc63db1}), one of {427} channels"; "What was read": "{Read 32 airings to come for ANIME x HIDIVE, one of 427 channels in the guide}. {965 KB as it downloads (gzipped), 7.4 MB unzipped}. Last read {September 26 at 8:42 pm}" with "; not changed since, at {September 26 at 9:42 pm}"; "How often": "Read every hour (every 30 minutes at most while it runs out), asking first whether it changed." (a small guide: "Read every hour, asking first whether it changed."); notes: "This guide has {427 channels}, and none is picked, so nothing from it is listed. Change, then Find this channel's guide (or add #channel= and its id to the address)."; "The channel in its address isn't in the guide right now: what it listed before stays. Change, then Find this channel's guide for another file."; "{It's over 300 MB unzipped / It's over 40 MB as it downloads / It lists over 5,000 airings to come for the channel / It took over 90 seconds to read}, so it wasn't read: what it listed before stays." |
| Viewer settings, Privacy | "Counting devices" / "Opencast counts devices with a random number kept on this device. It isn't tied to your account, and only totals are kept after 30 days." (A251, 2026-10-06) |

## Cleaner pictures (programming Phase 1, 2026-10-09)

For review. A library item says what preparing did to its picture, after its size, in the item's "Prepared for air".

| Where | Words |
|---|---|
| Control room, a library item, Prepared for air, Picture | "{1920 by 1080}. Converted from HDR" (an HDR file, phone video mostly, tonemapped); "{1920 by 1080}. Deinterlaced"; both: "{1920 by 1080}. Converted from HDR, deinterlaced". Nothing more for a file that needed neither |

## Seasons and playback orders (programming Phase 2, 2026-10-09)

For review. No frame draws these; they follow the item page's and the Add drawer's voice.

| Where | Words |
|---|---|
| A library item's page, a program: the section "Episode" | the row "{Season 2, episode 5}" ("Episode {5}" without a season; ". Part {2} of {The Long Night}" for a multi-part episode, "A part of …" without a number; "Not numbered" when it has none) with "Repeats and next-episode slots air in season, then episode order. A multi-part episode's parts air together."; fields "Season", "Episode", "Part of" (placeholder "The Long Night", help "For a multi-part episode: the same words on each part."), "Part" (off until Part of has words); "A whole number, or leave it empty." under a field that isn't one; "Save" |
| The item's picture placeholder | the same words as the row ("Season 2, episode 5", "Episode 5") |
| The Add drawer's fit badges | "Never aired", and its line's lead "Never aired. " (as "Next episode. ") |
| "Repeat from your library" (the Fill pane and the Add drawer) | with a season: "{Late Crate} season {2}, episodes {3} to {6}, in order, with your break rule" (the short line stays "{Late Crate} {3} to {6}, until {2:00 am}") |
| Playback orders (contracts' `PLAYBACK_ORDER_WORDS`, for Phase 3's select) | "In order": "Season, then episode, then date added"; "Newest first": "The newest episode not yet aired from this slot, then back through the rest"; "Shuffle": "Every episode once, in a random order, before any repeats; then a new random order"; "Shuffle shows, keep each in order": "Which program is random, and each program's episodes stay in order"; "Marathon": "A whole season in a row, then the next season" (the prompt's words) |

## Suggested break points (programming Phase 4, 2026-10-10)

For review. No frame draws these; they follow the item page's voice (the "Episode" section's rows and buttons).

| Where | Words |
|---|---|
| A library item's page, a program: the section "Break points" | its own: "{3} break points" ("1 break point") / "At {8:00, 22:10 and 33:40}." Suggested: "Suggested break points: {3}, from chapter marks" (or "from fades to black") / "Found in the file. Nothing changes until you choose: listen to each first.", with "Use these" and "Dismiss"; then a row per point, "{22:10}", with "Preview" ("Stop" while it plays; read aloud as "Preview the break at {22:10}") and, while it plays, "Playing from {22:08}" |
| Under the points | "The preview is still being made." (not prepared yet); "The preview couldn't be played." |
| Toasts | "{3} break points set." ("1 break point set."); "Suggestions dismissed." |
| The API's refusal (and the mock's) | "There are no suggested break points to answer." (409 `no_suggestions`) |
