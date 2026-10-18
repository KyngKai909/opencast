# Dial site: new copy for review

Every visitor-facing string the references don't have, and every change to reference copy. Written in the voice of SITE-SPEC §3: broadcast words, a 12-hour clock, no exclamation marks, no emoji.

## Changed from the references

| Where | Reference | Now | Why |
|---|---|---|---|
| Run footer, call-sign hint | "Four letters. Pick a number above." / "Four letters. N to go." | "Three to five letters." until three are typed | SITE-SPEC §8: the shared call-sign rules |
| Run footer, call-sign result | "XXXX is taken on the network. Try another." / "XXXX on 44.1 is free. Claim it." | Kept; a refused name shows the Network checker's line ("Too close to a real FCC call sign. Try three or five letters." or "That one belongs to someone else.") | The shared rules |
| Run hero and footer, Claim a number | scrolled to the footer / to itself | opens the waitlist sheet with the picked number and the call sign when it's free | SITE-SPEC §6 (Q7) |
| Run, signal chain steps | a tablist that auto-advanced | the same buttons, as pressed toggles (no tab semantics) | Accessibility (the reference's tabs had no panels) |
| Run footer, lede | "Choose a free number and a four-letter call sign, …" | "Choose a free number and a call sign, …" | Same rule; the lede said four letters too. Shortened rather than lengthened, so it keeps the reference's two lines |
| Run footer, call-sign input | `maxlength="4"`, label "Call sign, four letters" | `maxlength="5"`, labelled by "Call sign", hint read with it | Same rule |
| Demo station 60.1 | OCAT (Classic Matinee) | **MATN** (Classic Matinee) | OCAT read as "Opencast" (open-questions Q11) |
| Network footer, Claim a number | went to `/run` | opens the waitlist sheet (station) | SITE-SPEC §6 (Q7) |
| Spots footer, Start a spot / Order one made | scrolled to `#plan` / `#ways` | open the waitlist sheet (business) | SITE-SPEC §6 (Q7) |
| Run footer, Talk to a person | `/contact` | `/contact?desk=stations` | Opens Contact on the Stations desk |

| Demo station lists | OCAT in Syndication's squares, the Spots planner, the Network tuner and "The catalog" example | MATN | One station list (open-questions Q11) |
| Syndication, Offer a show (hero, side A, footer) | scrolled to "Two sides" / the footer | opens the waitlist sheet (producer) | SITE-SPEC §6 (Q7) |
| Syndication, Request / Add it on a market row | toggled to "Sent" / "In your log" | opens the waitlist sheet (station) with the program named; the label stays "Request" / "Add it" | SITE-SPEC §6 |
| Syndication, station squares | made-up numbers and colours (BEAT 2.1, FM stations on TV numbers) | the stations' real numbers and colours first | SITE-SPEC §3 station squares |
| Syndication, the wire | CIVC grey and PREP in NITE's blue | the stations' own colours | One station list |
| Spots, Start a spot (hero, footer) and Order one made | scrolled to `#plan` / `#ways` | open the waitlist sheet (business), Start a spot prefilled from the planner | SITE-SPEC §6 (Q7) |
| Spots, the planner | no way to start the spot | a "Start a spot" button under the station list, carrying the plan | SITE-SPEC §6 (Q7) |
| Spots, agency card "Talk to us" | went to `#plan` | `/contact?desk=advertisers` | SITE-SPEC §6 |
| Spots, receipt | tabs with no panel | tabs with a panel, arrow keys between them | Accessibility |
| Network, call-sign checker | free result as text only | adds a "Reserve it" button (chip shows the suggested number) that opens the waitlist with the call sign and number | SITE-SPEC §6 (Q7) |
| Network, call-sign rules | its own brand list, exact matches | the contracts' rules (open-questions Q6): e.g. ESPNX, MSNBC, HULU are refused; UPN, ION, HGTV, QVC no longer are | One shared check |
| Network, Where | High Desert "Opening first" | "Later" | Matches the FAQ: the Inland Empire first, then Los Angeles and Orange County |

## New strings

### Page descriptions (`<meta name="description">`, Open Graph)

| Page | Description |
|---|---|
| Home | Dial is free TV and radio from local stations, run by the people who make it. Flip it on. Or claim a number and run a channel of your own. |
| Run | A number, a call sign and master control. Build a real schedule with breaks and station IDs, go live inside it, and pay only for what it costs. |
| Syndication | List a show once and let stations across the network carry it, for a revenue share, cash or free. Every agreement is on the record. |
| Spots | Put your business in the breaks of local stations. Set a rate and a budget, and pay for the people who were tuned in. |
| The Network | How Dial works: every station gets a number and a call sign, the money is split in the open, and the rules are the same for everyone. |
| Contact | Talk to a person at Dial: the stations, makers, advertisers, public channels, press and rights desks. |
| 404 | There's nothing on this channel. (SITE-SPEC §7) |

### Open Graph images

- Each page's headline from its reference (Contact's from SITE-SPEC §7), the dim second line in muted.
- Footer line: "usedial.com" on the left, "● Free to watch" on the right (the footer's "Free to watch." without the full stop).
- Image alt: "Dial. " followed by the headline.

### Web manifest

- Name "Dial", description "Anyone can run a channel."

### The waitlist sheet (every page)

| Where | Copy |
|---|---|
| Header strip | "00 The waitlist"; close button "Close the waitlist" (screen readers) |
| Headline | "Get on the dial / before it opens." (second line dim) |
| Lede, viewer | Dial opens one market at a time. Say who you are and where, and we'll write when yours is on. |
| Lede, station | Hold a call sign and a number in your market while you get ready. We keep them for 120 days and remind you before they lapse. |
| Lede, producer | List your show when the syndication market opens to makers. Tell us what it is and we'll write first. |
| Lede, business | Be in the breaks when the spot market opens near you. We'll write with your first stations. |
| Role chooser | "I'm joining as": A viewer · A station · A producer · A business (from the earlier site) |
| Call sign | "Call sign you'd like" (earlier site); hint "Three to five letters. We'll hold it for 120 days."; while checking "XXXX looks free. Checking…"; free "XXXX is free. We'll hold it for 120 days."; asked for by someone else: earlier site's line with Dial for Opencast; refused or taken: the Network checker's lines |
| What it's for | Label "Your show" (producer) or "Your business" (business); the planner's picks listed as Where you sell, Kinds of station, Time of day, Budget, Most a day, Program |
| Fields | "Email", "ZIP code"; errors from the earlier site ("Enter an email address", "Enter your ZIP code.", "A ZIP code is five digits.") |
| Button | "Join the waitlist" (viewer), "Hold my number" (station, chip shows the number), "Join as a producer", "Join as a business" |
| Offline | "We couldn't reach Dial. Check your connection and try again." (earlier site, Opencast → Dial) |
| Done | The API's message as the headline ("TACO is on hold for you."), the earlier site's paragraph for the role; held chip "Held for 120 days"; button "Back to the page" |
| Footer strip | "Your ZIP decides your market. We don't share your email." (earlier site) |
| No JavaScript | "The waitlist needs JavaScript. Or tell us on the contact page." |

### Home

| Where | Copy |
|---|---|
| Hero screen (screen readers) | role "group", described as a "tuner"; after each tune a polite announcement "12.1 BEAT: Late Crate" (the lower third is no longer a live region) |
| Station cells (screen readers) | "Tune to 12.1 BEAT." in place of the bare call sign |
| Guide rows (screen readers) | "Tune to 12.1 BEAT, Beat Tape TV" (adds the station name) |
| Crawl | the loop's second copy is hidden from screen readers |

### Syndication, Spots and Network (screen readers)

| Where | Copy |
|---|---|
| Syndication, market rows | "Request Tamales for forty" / "Add Silent Hour" as each button's name |
| Syndication, station squares | "12 of 32 stations on the network carrying it, with 16 numbers still open" (follows the slider) |
| Syndication, escrow flow | "Airings pay into an escrow contract, about $1,284.60 waiting this week. The maker claims it once verified, after 72 hours in public; if it's never claimed it goes to the creator fund as grants." |
| Spots, control room | "An example break on 12.1 BEAT: a program, a bumper, a spot for Juniper Barber Co., your 15-second spot for Orange Street Coffee, a spot for Redlands Hardware and the station ID. About 312 people tuned in for your spot, which cost $2.50." |
| Network, tuner | after a change: "66.1 ROUT, Route 66 Reel. Now: Midnight Reel." |
| Network, checker rows | each row read with "Yes: " or "No: " before it |
| Network, the two lock timelines | "Two of three people, held separately, approve it. It waits 72 hours in public, where any one key can stop it. Then it's paid, only to the creator or as a grant." / "The network proposes it. It waits 7 days in public, where every key holder can cancel it. Then it's live; one honest key is enough to stop it." |
