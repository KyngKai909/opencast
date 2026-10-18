# Dial site: new copy for review

Every visitor-facing string the references don't have, and every change to reference copy. Written in the voice of SITE-SPEC §3: broadcast words, a 12-hour clock, no exclamation marks, no emoji.

## Changed from the references

| Where | Reference | Now | Why |
|---|---|---|---|
| Run footer, call-sign hint | "Four letters. Pick a number above." | "Three to five letters." | SITE-SPEC §8: the shared call-sign rules |
| Run footer, lede | "Choose a free number and a four-letter call sign, …" | "Choose a free number and a call sign of three to five letters, …" | Same rule; the lede said four letters too |
| Run footer, call-sign input | `maxlength="4"`, label "Call sign, four letters" | `maxlength="5"`, labelled by "Call sign", hint read with it | Same rule |
| Demo station 60.1 | OCAT (Classic Matinee) | **MATN** (Classic Matinee) | OCAT read as "Opencast" (open-questions Q11) |
| Network footer, Claim a number | went to `/run` | opens the waitlist sheet (station) | SITE-SPEC §6 (Q7) |
| Spots footer, Start a spot / Order one made | scrolled to `#plan` / `#ways` | open the waitlist sheet (business) | SITE-SPEC §6 (Q7) |
| Run footer, Talk to a person | `/contact` | `/contact?desk=stations` | Opens Contact on the Stations desk |

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
