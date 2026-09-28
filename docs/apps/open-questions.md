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
