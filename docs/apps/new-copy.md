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

