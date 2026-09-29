# Open questions (apps)

Every note marked "Open" in the reference files, and how the apps build around it so the answer is easy to change. Where the platform prompt has already chosen a default, it's recorded in [docs/open-decisions.md](../open-decisions.md) and the apps follow it. Questions the apps raise themselves are added below the reference list as the phases find them.

| # | Question | Where | Default the apps build | Easy to change by |
|---|---|---|---|---|
| 1 | **Watch from the start**: can a program already under way be watched from its beginning? | viewer/home 03 | No. Tuning in joins live, and there's no scrub bar | One `watchFromStart` feature flag in `packages/player`, off. The program page (#3) is where it would attach |
| 2 | **Opencast's share of pledges** | viewer/home 07 | 0: the copy says pledges go to the station less card fees (`revenue_config.opencast_pledge_share_bps` = 0) | The pledge sheet reads the share from the API. If it's ever above 0, the copy needs a new line, listed in new-copy.md. Confirm before the copy is public |
| 3 | **On demand** | viewer/station-pages 02 | None. Episodes lead to airings | Same flag as #1. The program page keeps a slot for it under Episodes |
| 4 | **Wallets for viewers** | viewer/you 01 | No wallet button for viewers (open-decisions: "no"). Email first, then Apple and Google. Master control and claims keep wallets | Sign-in methods are one list in `packages/ui`'s sign-in config, per app |
| 5 | **Casting to Roku and Apple TV** | tv/tv 06 | Chromecast by Cast. Apple TV by AirPlay mirroring (tv-update). Roku isn't a target | "Watch on" lists targets from the input adapter. Roku would be a separate FAST packaging job, not an app change |
| 6 | **Takedowns** | control/master-control A2 | Drawn in control/rights (claims pull everywhere, fill the gap). Built as drawn there | n/a: answered by the rights file |
| 7 | **Who approves a carrier** | control/master-control B | The maker chooses per offer: "Any station" or "I approve" (`catalog` `Terms.approval`, drawn in offering 02) | n/a: answered by the offering file and the contract |
| 8 | **Opencast's share of spot revenue** | control/master-control C | The pane says a share is taken and where to see it, with no number. Earnings shows "Not set yet" at $0.00 | The number comes from the API's earnings lines; nothing hard-coded |
| 9 | **Political spots** | control/station-settings 02 | No platform rule. Each station can block the category | Categories come from the API, so a platform-wide block or extra disclosure fields need no app release |
| 10 | **Your share when your rotation is empty** | control/offering 04 | A station ID airs (playout default, open-decisions) | Shown as text from the offer's terms, not hard-coded |
| 11 | **Repeat policy** (3 upheld a year pauses carriage offers) | control/rights 01 | The placeholder threshold, read from `trust.policy` via listClaims | The standing panel renders whatever threshold the API returns |
| 12 | **Legal wording** for claims and answers | control/rights 03 | The frames' wording, marked for legal review | All claim copy in one strings module, so a lawyer's edit is one file |
| 13 | **Licensed catalogs** and their revenue split | control/market 05 | Not shown: the "Licensed" tag exists but no licensed offers are mocked | The maker-kind filter already has catalog. "Licensed" is a rights-basis value |
| 14 | **Other markets' streams** | desk 05 | Not supported (open-decisions): a listed source belongs to one market | The desk's market picker is per source |
| 15 | **Permission page wording** | desk 06 | The frame's wording, marked for legal review, and not shown to a real creator until reviewed | One strings module, like #12 |
| 16 | **Where the escrow contract lives**, the chain, the unclaimed period | desk 07 | Opencast's own CreatorEscrow on Base (Base Sepolia on staging), 3 years unclaimed (open-decisions) | Contract address, chain and period are read from the API (heldEarnings), not built in |
| 17 | **Tax treatment** of spots and sponsorships | business/results 04 | The statement says nothing about deductibility | n/a: layout only |
| 18 | **Who owns the finished spot**; does Opencast's share apply to production? | business/production-orders 02 | The business owns it and the maker may show it in samples. Production share 0 (open-decisions) | Terms text comes from one strings module; the share from the API |

## Raised by the apps

Added at each STOP as the build finds them. The detail and frame references are in [inventory.md](inventory.md), under "Decisions needed".

| # | Question | Found in | Default until decided |
|---|---|---|---|
| A1 | Default ground when the system has no preference: the prompt says dark, but the references fall back to light | style guide; site | Dark |
| A2 | A lit tally in the radio band list, and on the site's waitlist confirmation | station-pages 04.1; site S.11 | The tally edge in the list; the site's sign unlit |
| A3 | Digits on the web: preset keys, or channel entry | home 01; rules | Outside a text field digits 1 to 6 are preset keys; channels go through search |
| A4 | What `waiting_for_you` means next to `paused_budget`, and the frames' state words that differ from `states.ts` | biz-spots 01, 04, 06; orders 04, 05; sponsorships 06 | The frames' words, requested in contract-requests T3 and listed in new-copy |
| A5 | Roles the contracts leave open: offering terms, deciding carriage, quoting orders, answering claims, approving sponsorships, signing off, statement CSVs | control; offering; rights; sponsorships | Owners and operators act, except: answering a claim and signing off are owner-only, and CSV follows the API (owner) |
| A6 | A host's rail | control rules | Items shown disabled, with a one-line reason |
| A7 | Where the creator's claim page lives | rights 05.1 | Master control, public `/claim/:token` |
| A8 | Station ID mid-break on the Monitor rundown vs "always last" | master-control A.7; station-settings 02.1 | Always last: settings win |
| A9 | "Watch on" labels (Chromecast / AirPlay vs Cast / Mirror / Open the app) | tv 06.2; tv-update 02 | The note's labels |
| A10 | Listed city streams on a TV and on Cast | tv 02 | Skipped when changing channel; a plain state if tuned by number |
| A11 | The number-entry wait: 1.5 s (tv note), 2 s (settings default), 1 s (phone keypad) | tv 02.2; tv-update 04.1; tv 06.4 | 2 s, the settings default |
| A12 | The bug position vs title safe | style guide ch. 06, 11 | Inside title safe (5%) |
| A13 | Menu on a basic remote: Home can't reach an app on Android TV or Fire TV | tv 01 | Long-press Back |
| A14 | TV type under 21px in the reference CSS (tally 18px, now-line 20px, sleep times 20px) | tv 03.1; tv-update 05.1 | 21px minimum |
| A15 | The rules say times are right-aligned in tables; every frame puts the time column first, left-aligned (amounts are right-aligned) | control, business tables | The frames: times first and left, amounts right |
| A16 | Short durations: the rundown and order review frames write `0:30`, `0:05`; the rules say `:30` | master-control A.7; orders 05.1 | The rules: `:30` |
| A17 | Pause beyond what the stream keeps | player | Decided (2026-09-28): pause is always allowed; on resume, if the paused moment has scrolled out of the stream, it moves forward to the oldest moment still there; after 30 minutes it offers Back to live. A 30-minute playlist window (contract-requests X1) makes the full hold work |
| A18 | The level meter moves with the sound | tv 05.1 | Decided (2026-09-28): real levels, measured with Web Audio on whichever device plays the sound (the TV app, the Cast receiver, the phone). It falls back to a rhythm only where the browser gives no samples (native HLS on iPhone) |
| A19 | "No station on 13" names the nearest two: nearest by number, or the channels either side | tv 02 | Nearest by number (12.1 and 9.1 for 13) |

| A20 | The replace dialog ("All six keys are taken") draws two keys to replace (3 and 6), with no rule for picking two, and the API suggests only one | you 03.1; inventory worth raising 7 | All six keys and No key, with the suggested key preselected |
| A21 | Home 01.1 draws key 6 Empty; the You frames draw all six taken | home 01.1; you 02.1, 03.1 | The mock follows You (all six taken, so the replace dialog is reachable). Home's Empty state appears after a Remove |
| A22 | Saving while signed out: the notes say it's "kept on the device and offered to the account afterwards", but no frame draws a "keep on this device" button | you 01.1 | Closing sign-in for a save or a reminder keeps it on the device, with a toast that can undo it. The first sign-in offers what the device holds |
| A23 | Preset tiles draw short titles ("Radio dramas", "Cartoons, 1928 to 1934") that no field holds | home 01.1; you 02.1, 03.1 | The airing's full title, clipped with an ellipsis |
| A24 | The phone guide has no Earlier and Later | home 05.2 | Six hours from the hour before now, scrolled sideways, at the drawn width per hour |
| A25 | The station page's "This week" day tabs: the calendar week, or the next seven days | station-pages 01.1 | The next seven days (a schedule, not the calendar week) |
| A26 | A monthly pledge switched to Once, and pausing a pledge | you 04.1; inventory worth raising 8 | Switching to Once ends it after this month. No pause control (none is drawn) |
| A27 | A host's rail: disabled items, or a host-only rail | inventory worth raising 9; station-settings 03.1 | The fixed rail, every item but Live sources disabled with "Hosts see their own live blocks". Live sources opens the host's next live block; any other page sends them there |
| A28 | "Breaks tonight" says "3:30 open across 4 breaks", but its rows add up to 4:15 (1:00, 1:30, 1:45) | master-control C.1 | The rows as drawn; the total and the rail's Breaks badge are computed from them (4:15) |
| A29 | Cue a break when nothing live is on | master-control A.7; inventory worth raising 1 | Disabled outside live blocks, with the tooltip "For live programs" |
| A30 | "Log runs until": the Monitor frame says "Sun 8:42 pm" on a night with dead air at 11:40 pm | master-control A.7, P.2 | Until the first gap (Sat 11:40 pm), in amber when a gap is coming |
| A31 | Sign off: which button, and who | master-control header; station-settings 03.1 | Ink (it changes what goes out), owners only, after a confirmation. Signing on is owners' too |
| A32 | An off-air log entry has no log code | log contract | Code OPEN |
| A33 | The backup rotation fills leftover open time too, not only a paused spot's time | master-control C.3; biz-spots 05.1 | Yes, when the backup rotation has spots; otherwise the ID and bumpers |
| A34 | How long "It's back" stays | biz-spots 05.1 | Until the station adds the spot back or takes the notice down; no expiry |
| A35 | Who acts on money and carriage (contracts leave it open; inventory worth raising 9) | sponsorships, orders, offering, rights, earnings | Operators approve or decline sponsors, quote orders, carry, offer and decide requests, remove a claimed item. Owners also stop renewals, change minimums, answer claims, move money and download statements |
| A36 | Sponsor money: a monthly charge on the earnings page, weekly accrual on statements | earnings 02.1, 03.1 | Monthly on earnings ($200), accrued weekly on statements ($46.15); the ledger's model needs a decision |
| A37 | Audience for a week or a month has no chart drawn | earnings 01.1 | The numbers, programs and platforms without a chart |
| A38 | Radio stations' audience words ("Watching on", "Casting to a TV") | earnings 01.1 | As drawn for TV; radio wording to decide |
| A39 | BEAT's first sign-on is September 12 (Identity 01.1), but its earnings history starts August 31 with 214 members | station-settings 01.1; earnings | The Identity frame's date; the mock's history is illustration |
| A40 | Listings schedule Crate Session 03 on Monday, but A.3 says an item with rights to confirm can't go on the log | live-listings 03.1; master-control A.3 | Kept as drawn; the sign-on checks flag it |
| A41 | The browser source's line says "Owners and operators", but hosts go live from it too | live-listings 01.1; inventory worth raising 6 | Copy as drawn |
| A42 | Lower thirds on an encoder's live block | live-listings 02.1; inventory worth raising 15 | Stored per block (S15); nothing composites them onto an encoder's picture yet |
| A43 | When a listing needs a description | live-listings 03.1; inventory worth raising 8 | An episode without its own description needs one; a live program uses the series description |
| A44 | "Fits your schedule" (until C1) | market 01.1, 06.1 | Fits when the episode is up to 30 minutes shorter than the gap or at most 2 over; "exact" within 2 minutes |
| A45 | Undo on carrying, approving and sponsor decisions | market 06.1; offering 05.2; sponsorships 03.1 | A delayed send: it goes when the toast does. If the tab closes first, nothing is sent |
| A46 | HALL in the switcher: "Operator. On air" with a tag (04.1) or "Operator. Dead air in 40 min" (05.2) | station-settings 04.1, 05.2 | Each as drawn |
| A47 | Screens no frame draws: the maker's order after a quote, a studio's spot rotation and carriers, the statements list, Station account, Ownership, the Carried tab | master control | Built plain from the contracts, their copy in new-copy.md; they need designs |
| A48 | A card top-up's fee: out of the balance, or charged on top | biz-funding 02.1 | Decided (2026-09-28): out of the balance, shown in dollars before paying, as its own "Card fee" movement |
| A49 | A withdrawal that leaves less than a day of airings | biz-funding 04.1 | Decided (2026-09-28): the business's spots pause (Paused, balance) and stations are told; held airings still air; topping up resumes them automatically and stations get "It's back" |
| A50 | Auto top-up from a Clear wallet with full access | biz-funding 02.1, 03.1 | Each Clear transfer needs the person's confirmation on Clear's page, so auto top-up draws only from a bank or card. With Clear as the only source, the low-balance warning asks them to add money instead |
| A51 | A Clear link belongs to a person, not a business | biz-settings 04.1; station account | The owner who links it; a business or station uses it as a funding source or payout destination. If ownership changes, the new owner links their own and the old source stops working |
| A52 | Who edits a business profile; closing a business | biz-settings 01.1; close account (undrawn) | Owners and managers edit the profile; auto top-up and funding are the owner's. Closing is the owner's: spots leave rotations today, held airings air and pay, what's left returns to the default source, orders in the making are cancelled with their hold returned, sponsorships end with their paid month. A closed business can't be reopened (start a new one) |
| A53 | Withdrawals: where they arrive and when | biz-funding 04.1 | To a linked bank (1 to 2 business days, no fee) or a linked Clear account (minutes, no fee); the copy says which |
| A54 | Amounts in the business lists: the frames draw them left-aligned; rules.md says right | sponsorships 01.1; orders 01.1 | Right-aligned, as the rules say |
| A55 | How a typed code identifies "this customer" for "First use for this customer" | biz-results 05.1 | The customer who saved the offer most recently and hasn't used it |
| A56 | The results frames' tuned-in figures don't match the spots' rates (Pumpkin latte priced at $8 per 1,000; it's $5) | biz-results 01.1, 02.1 | Money as drawn; tuned in recomputed so every airing's cost is tuned in × its rate (33,505 in September, not 31,101) |
| A57 | September's statement has no Council Watch line, but Money and receipts says "1 sponsorship, $298.90" | biz-results 04.1; biz-settings 03.1 | The statement as drawn, so it reconciles to the balance |
| A58 | Fall menu: $176.40 of its budget used (spots 01.1) vs $219.92 spent on it in September (statement) | biz-spots 01.1; biz-results 04.1 | Each as drawn; the budget counts from its current run |
| A59 | Customers from BEAT for Fall menu: 12 in master control's mock, 18 in the business frame | biz-results 01.1; master control | Each app's mock as drawn |
| A60 | The street address on a saved offer, though the contract says it's private | biz-results 03.1 | Shown on the offer (customers need it to come in); stations still see only the city |
| A61 | A whole-station sponsorship credit with co-sponsors | sponsorships 02.1, 05.1 | Each sponsor's own credit; co-sponsors listed on the station's slate (P17) |
| A62 | "Open" on a sponsorship in the list | sponsorships 01.1 | A detail view (credit, amount, dates, End it) as a Modal on the web and a Sheet on the phone |
| A63 | The paused tag: "Paused, budget spent" (biz-spots 04.1) or "Paused (budget spent)" (states.ts) | biz-spots 04.1 | states.ts's label, so both apps say the same |
| A64 | A spot the business pauses itself | biz-spots (undrawn) | "Pause it" on the spot page: state `waiting_for_you`; stations are told and fill its time. Bringing it back lists it again; stations add it back themselves |
| A65 | After a balance top-up, does an in-rotation spot go straight back into rotations? | biz-spots 05 (station side) | No: it's back in the market, stations get "It's back" and add it themselves (never re-added automatically) |
| A66 | Leaving out named stations, choosing which location a spot targets, editing captions, the code's placement | biz-spots 03.1, 02.1 | Not drawn and no endpoints: the first location is used; P3 and P4 stay open |
| A67 | The number-entry wait: 1.5 s (tv 02 note), 2 s (the settings frame's default) or 1 s (the phone keypad) | tv 02.2; tv-update 04.1; tv 06.4 | 2 seconds by default; the setting offers 1, 1.5, 2 and 3. The keypad's "Tuning in 1 second" is its countdown |
| A68 | Where the sleep timer and pledge live: the menu rail has exactly seven items in 04.1 | tv 04.1, 05.4; tv-update 05 | Sleep timer is a rail item after Presets (the later file wins); pledge opens from About (a station's info) |
| A69 | Type under 21px at 1080p in the reference CSS (the tally 18px, the guide's now-line time and the sleep list's clock times 20px) | tv intro; tv 03.1; tv-update 05.1 | 21px minimum, as the intro rule says |
| A70 | Menu on a basic remote: "Home" can't be caught by an app on Android TV or Fire TV | tv 01 | The Menu key, and a long press on Back |
| A71 | Which station off air suggests | tv 05.2 | The nearest on-air station in dial order that isn't a listed city stream, looking up the dial first |
| A72 | Stand by: the TV's colour-bars layout or the stand-by slate the worker already airs | tv 05.2 | The TV's layout only when the dial says the block is waiting for its signal (S13); otherwise the stream's own slate, nothing drawn over it |
| A73 | Listed city streams (RDLS) on a TV and a Chromecast: the city's own player can't be driven by a D-pad and a receiver can't play it through CAF | tv 02, 06.1 | Kept on the dial, playing the city's player as the player draws it, for now |
| A74 | The hint row hiding after a week of use | tv 02 | Device-local; the "Playing from…" and "Mirrored from…" chips never hide |
| A75 | The name in the casting chip: iOS no longer gives apps the phone's name | tv 06.1; tv-update 01.1 | Built from the account's first name ("Kai's phone"); signed out, "Playing from a phone" |
| A76 | Settings while casting | tv-update 04 | They come from the phone; the receiver has no Settings |
| A77 | Watch on's labels: "Chromecast"/"AirPlay" with one "Play on" button (06.2) or "Cast", "Mirror", "Open the app" (update 02 note) | tv 06.2; tv-update 02 | The note's actions on the button ("Cast to Living room TV", "Mirror to Bedroom TV"), the kinds as each row's second line, from a table of target kinds so a Roku or Apple TV app row is one entry |
| A78 | Should the TV guide list the radio band after the TV band? | tv 03.1 | Yes: CH pages through both, and typing 88.3 jumps to it |
| A79 | Pledge by QR: the frame shifts the picture left full-bleed (cropping it); the build squeezes it into the space beside the panel | tv 05.4 | Squeezed, so nothing is cropped |
| A80 | Captions set on the TV change the account's captions for the phone and web too | tv-update 04.1 | Shared (`settings.watching.captions`), as the settings line says; a TV-only caption setting if people ask |
| A81 | While casting, does the phone play too? It follows the TV muted, so choosing in the phone's guide tunes the TV, but its heartbeat also counts as "phone" | tv 06.3 | Follows muted; the double count is noted for the audience figures (Phase 9) |
| A82 | Presets on a Cast receiver: it has no account | tv 06.3 | The phone sends a preset key as `{type:"tune", channel}` |
| A83 | A sleep timer on the phone remote (06 note; not drawn) | tv 06 | The command exists; no phone UI until drawn |
| A84 | Captions over the banner and the presets strip | tv 02.1 | Lifted above them while they're up (counted in caption lines, so every size clears) |
| A85 | Picture quality and evening out the sound are stored and synced, but the player has no option for either yet | tv-update 04.1 | Kept as settings; wired in Phase 9 with the real streams |
| A86 | Pairing a phone with the TV app ("who on the Wi-Fi can change the channel" on a TV that isn't a Chromecast) needs Cast Connect or a relay | tv-update 04 | The setting is saved; it works on Cast (the phone sends it); the TV app waits for the relay decision |
