# Dial marketing site: spec

The public website for Dial (formerly Opencast, product working name). Domain: **usedial.com**.

The reference pages in `pages/` are the source of truth for layout, copy, states, motion and behaviour. This file covers what they can't show: routes, how the references are assembled, the rules behind the design, where every number comes from, where every button goes, and the Contact page, which has no reference yet.

---

## 1. Pages and routes

| Route | Reference | `<title>` | Sections, in order (section id: headline) |
|---|---|---|---|
| `/` | `pages/home.html` | Dial: Anyone can run a channel | `hero` Anyone can run a channel · `guide` No feed. Just what's on. · `stations` Every number is somebody. · `breaks` The breaks are part of the show. · `doors` Make it. Carry it. Sponsor it. · `public` (public institutions) · footer |
| `/run` | `pages/run.html` | Run a Station \| Dial | `hero` Run it like a station. Not a loop. · `who` · `control` Master control · `switch` Already running a 24/7 stream? · `pricing` On air is free. You pay for what it costs. · `earn` A station can pay for itself. · `faq` · footer with Claim a number |
| `/syndication` | `pages/syndication.html` | Syndication Market \| Dial | `hero` Make it once. Air it everywhere. · `offer` · `fits` (the filterable market) · `terms` · `rights` · `escrow` · `outlets` · `faq` · footer |
| `/spots` | `pages/spots.html` | Spot Market \| Dial | `hero` Be in the break. Pay for who watched. · `who` · `plan` · `paid` · `customers` · `ways` · `rules` · `faq` · footer |
| `/network` | `pages/network.html` | The Network \| Dial | `hero` A network, not a feed. · `what` · `dial` (call-sign checker) · `kinds` · `money` · `locks` · `standards` · `faq` · footer |
| `/contact` | none yet, see §7 | Contact \| Dial | see §7 |
| 404 | none | Off the air \| Dial | see §7 |

Redirects (301): `/spot-market` → `/spots`, `/about` → `/network`, `/stations` → `/run`.

Every page shares the same header (the tuner nav) and the same footer structure. The footer's first row changes per page (the Run page's is "Claim a number" with the number picker).

---

## 2. How the references are built

Each reference page is one HTML file assembled by a Python script from shared and per-page parts. The parts are in `source/`, the scripts in `source/build/`. Read them to see exactly what each page loads and in what order. **Cascade order matters**, because later pages reuse components defined in earlier pages' CSS:

| Page | CSS, in this order | JS, in this order |
|---|---|---|
| Home | `shared/head.html` inline style, polish, grid, flat, nav, shape, lt | `home/home.js` (self-contained: its own station data and scenes) |
| Run | head, polish, grid, flat, nav, shape, lt, **run.css** | `run/run.js` with `shared/shared_data.js` pasted at `/*DATA*/` |
| Syndication | head, shared CSS, run.css, **synd.css** | `shared/common_head.js` (with shared_data at `/*DATA*/`), `syndication/synd.js` (with `shared/scenes.js` at `/*SCENES*/`), `shared/common_tail.js` |
| Spots | head, shared CSS, run.css, synd.css, **spots.css** | common_head (+ data), scenes.js, spots.js, common_tail |
| Network | head, shared CSS, run.css, synd.css, spots.css, **net.css** | common_head (+ data), net.js, common_tail |

- `source/*/body.py` generates `body.html` for that page. The generated `body.html` is included, so you don't need to run Python. Read `body.py` for the data behind repeated blocks (FAQ lists, share tables, cards).
- `source/chrome/header.html` is the shared header. The build scripts rewrite its in-page anchors to routes and mark the current page with `class="is-cur" aria-current="page"`.
- `common_head.js` opens a `'use strict'` IIFE and `common_tail.js` closes it. It provides `$`, `RM` (reduced motion), `FINE` (fine pointer), the grain texture, the now-playing tuner in the nav, Lenis smooth scrolling, in-page anchor scrolling and the custom cursor.
- Lenis comes from a CDN in the references (`lenis@1.1.13`). Use the npm package.
- Fonts come from Google Fonts in the references. Self-host them (see §4).

---

## 3. Design rules

These are the decisions behind the look. Check every page, and the new Contact page, against them.

**Grid.** One site grid: 12 columns from 1100px up, 6 from 700 to 1099px, 2 below 700px. A section is a `.sheet` of `.cell`s split by 1px hairline rules. Each cell sets its span per breakpoint with `--d`, `--t` and `--m`. **`--t` is never more than 6**, because the tablet grid has 6 columns. Cells carry a header strip (`.mh`, small caps label left, meta right) and an optional footer strip (`.mf`).

**Flat, not cards.** Cells sit flat on the page as a faux bento: columns and rows of the same grid, separated by rules. No floating cards, no drop shadows on cells, no gaps between them.

**Shape rule.** Only things you press are round: buttons and chips are full pills, single-icon keys are circles. Surfaces, media, labels, badges and data are square (2px radius at most).

**Buttons.** Primary is a cream pill with a dark inset "live" chip on the left (channel number, `:15`, `+1`), ghost is an outlined pill. Buttons in a list or a row of options are **equal width** (the width of the widest one).

**Colour.**
- Night (ground) `#140F24`, cream text `#F3EAD9`, muted `#A79FBF`, rule `#2A2342`.
- Tally red `#FF4A3D` means "on air / live / now". The red now-line in the guide sits on top of everything in it.
- Phosphor `#E9FFE8` for screen glow.
- Station colours: BEAT `#C04A9E`, REEL `#D98A2B`, SAZN `#E0583A`, CIVC `#2F9A72`, PREP `#3478C6`, NITE `#5B7BE0`. The current station's colour tints the page through `--st` / `--np`.
- Money in the Earnings section: orange `#E0583A` pays the bill, green `#3ddc84` stays with you.

**Type.**
- Big Shoulders Display (500, 700, 800, 900) for headlines, uppercase.
- Instrument Sans (400, 500, 600, 700) for text and buttons.
- VT323 for on-screen display: channel numbers on screens, clocks, the tuner LCD.
- Tabular figures (`.tab`) for every amount and count.

**Station states.** Wherever stations are shown as a grid of squares (the syndication earnings calculator), each square shows the channel number and call sign. Coloured means carrying, grey means on the network, dashed means open.

**Motion.**
- Canvas scenes (`scenes.js`) draw the TV pictures: vinyl, kitchen, reel, field, radio and so on.
- Tickers swap with a short slide.
- Lenis provides smooth scroll.
- A custom cursor with labels from `data-cur` shows only on fine pointers.
- With `prefers-reduced-motion`: no smooth scroll, tickers don't rotate, and scenes draw one still frame.

**Voice.** Broadcast vocabulary (station, channel, call sign, tune in, carry, spot, break, underwriting). A 12-hour clock ("8:14 pm"). No exclamation marks, no emoji. Copy in the references is final.

**The name.**
- The wordmark is lowercase "dial" with a red full stop.
- The icon is a red "i" standing on a rising band of ticks.
- Use the files in `brand/`; never redraw them.
- The footer reads "© 2026 Dial."

---

## 4. Brand files (`brand/`)

| File | Use |
|---|---|
| `dial-lockup-cream.svg`, `dial-lockup-night.svg` | Icon + wordmark, for the header and OG images |
| `dial-wordmark.svg` | Wordmark in `currentColor` with the red full stop (the header uses this) |
| `dial-wordmark-cream.svg`, `dial-wordmark-night.svg` | Fixed-colour wordmarks |
| `dial-icon.svg` | Full-detail icon, 120 grid, for 128px and up |
| `dial-icon-64.svg`, `-48.svg`, `-32.svg`, `-16.svg` | Redrawn for small sizes: fewer, thicker ticks. The header uses the 48 drawing at 32px |
| `dial-icon-cream.svg`, `dial-icon-red.svg` | Alternate grounds |
| `favicon.svg`, `favicon-32.png`, `favicon-16.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Favicons and web manifest |

Fonts: self-host with `@fontsource/big-shoulders-display`, `@fontsource/instrument-sans` and `@fontsource/vt323`, latin subset, `font-display: swap`. Preload the two headline weights used above the fold.

---

## 5. Numbers on the site

These figures appear in copy, tables and calculators. Keep them in **one module** (`src/data/pricing.ts`) and import them everywhere; don't leave literals in markup. If `packages/domain` already exports pricing or share constants, import those instead and note any mismatch.

**Station usage (pay as you go, one channel per station)**
- Being on air: free. Number and call sign: included.
- Storage: $0.04 per GB a month, first 10 GB free (only what's scheduled in the next 7 days is stored).
- Relays, live shows only: free. Relays, everything you air: $0.05 an hour, never over $25 a month.
- Live hours, TV: $0.75 an hour, first 5 free. Live hours, radio: free.
- The month is 30 days (720 hours).

**What Dial keeps, per dollar earned**

| Source | Station keeps | Dial keeps |
|---|---|---|
| Spots the advertiser books (self-serve or station-booked) | 90% | 10% |
| Spots Dial sourced, or ads its agency made | 80% | 20% |
| Pledges and members | 95% | 5% |
| Syndication paid in cash, to the maker | 95% | 5% |
| Backfill (ads from partners) | 80% | 20% |

Comparison figures (others keep): YouTube ads 45%, YouTube memberships 30%, Twitch ads 45%, Twitch subs 50%, Patreon 10%.

**Syndication revenue share.** A maker on revenue share earns:

> station ad revenue (after Dial's 10%) × the program's share of the station's watch time × the maker's share

The maker's share is set by the maker and is **capped at 80%**, so the station always keeps at least 20%. The calculator multiplies by the number of stations carrying the show.

**Spot market.** About $8 per 1,000 tuned in. Local businesses pay only for viewers Dial can place in their area. Online businesses pay for all viewers.

**Calculators.** Port the formulas exactly from the reference JS:
- Run page, usage estimator: `calc()` in `run/run.js`.
- Run page, "Does it cover your costs?": `pay()` in `run/run.js`. The bill there follows the usage estimator.
- Syndication, earnings: the `#earn` code in `syndication/synd.js`.
- Spots, planner and the live break control room: `spots/spots.js`.

Unit-test every calculator against values read from the references (for example: default Run estimator = $29.95; default pay calculator = $121.23 left, "Covers your month 5× over").

---

## 6. Where the buttons go

The site runs before the apps are public. A single flag, `PUBLIC_LAUNCH_MODE`, controls it:
- `waitlist` (the default): CTAs open the waitlist sheet.
- `live`: CTAs link into the apps.

Every link target comes from one `src/data/links.ts`.

| CTA | Where | `waitlist` mode | `live` mode |
|---|---|---|---|
| Open the dial / Watch (nav tuner) | everywhere | `PUBLIC_WATCH_URL` (default `/`, the home guide) | `PUBLIC_WATCH_URL` + `/?ch=<number>` |
| Claim a number | Run hero, Run footer, Network | Waitlist sheet, role **station**, prefilled with the picked number and call sign | `PUBLIC_APP_URL/control/claim?number=&callsign=` |
| A free result in the call-sign checker ("Reserve it and we hold it for 120 days") | Network `#dial` | Waitlist sheet, role station, prefilled with the call sign and the suggested number | same as Claim |
| Offer a show | Syndication | Waitlist sheet, role **producer** | `PUBLIC_APP_URL/control/offer` |
| Request / Add it (market rows) | Syndication `#fits` | Waitlist sheet, role station, with the program named | `PUBLIC_APP_URL/control/market?program=<id>` |
| Start a spot | Spots | Waitlist sheet, role **business**, prefilled from the planner (where, kind of business, time of day, budget, cap) | `PUBLIC_BUSINESS_URL/spots/new?…` |
| Order one made | Spots | Waitlist sheet, role business, "order a spot" | `PUBLIC_BUSINESS_URL/orders/new` |
| Talk to a person / Contact us | everywhere | `/contact` | `/contact` |
| See pricing, Browse the market, How the money moves, and other in-page links | — | in-page anchor | in-page anchor |

- **The waitlist sheet** is one component used on every page. It is a bottom sheet on phones and a right-side panel on desktop, built from the site's own parts: square surface, pill buttons, `.seg2` for the role.
- It posts to the API's existing waitlist endpoint with the four roles: viewer, station (with a held number and call sign), producer and business.
- Validate call signs with **one** shared function, using the Network page checker's rules (`network/net.js`):
  - three to five letters, A to Z;
  - not four letters starting with K or W (too close to a real FCC call sign);
  - not a network, a brand or an alert word;
  - not already on the dial.
- A waitlist hold lasts 120 days, with a reminder before it lapses.

---

## 7. Pages without a reference

### Contact (`/contact`)

Same chrome, grid and rules as the other pages. It must **not** be a plain form on a blank page: the user rejected basic list layouts and wants every hero to be distinct.

**Hero: the switchboard.**
- Headline: "Talk to a person." Dim second line: "We pick up."
- The right-hand cell is an old patch bay: a row of jacks labelled **Stations, Makers, Advertisers, Public channels, Press, Rights**.
- Choosing one (click, tap or keyboard) draws a patch cable on a canvas or SVG from the jack to a desk lamp that lights. The cell header shows that desk's response time ("Stations desk · usually within a day") and "● Open" in tally red during 9 am–6 pm Pacific, otherwise "Closed till 9 am".
- With reduced motion, the cable appears without animating.

**The form** sits in the cell beside the switchboard and follows the choice:

| Field | When it shows |
|---|---|
| Name, email, message | always |
| Number and call sign (prefilled from the URL if they came from Claim a number) | Stations |
| Link to a show or channel | Makers |
| Business name, website, area served | Advertisers |
| City, county, district or library, and the channel today | Public channels |
| Outlet | Press |
| Program or station, link to the work, "I hold the rights" or "I'm reporting a problem" | Rights |

- **Rights** messages also show a note: "For a formal takedown, use the takedown form." Link to `/rights/takedown` and leave a TODO; that route is for later, with a lawyer.
- On submit, post to `POST /contact` in `packages/contracts`. If that endpoint doesn't exist, add it to `docs/contract-requests.md`, build against a mock, and fall back to opening a `mailto:` to the desk's address.
- After sending, the lamp stays lit and the cell reads "Patched through. We'll write back to <email>."

**Below the hero:**
- **Desks:** one row, six cells. Each has the desk name, its address (`stations@`, `makers@`, `spots@`, `public@`, `press@`, `rights@usedial.com`) and one line on what it handles. Make the addresses configurable.
- **Where we are:** Southern California, Inland Empire first, then LA and Orange County. Use a small square map cell drawn in the style of the syndication network map, not an embedded Google map.
- **FAQ:** four questions, in the existing FAQ component. Write new copy in the site's voice and list it in `docs/site/new-copy.md`.
- **Footer.**

### 404

- "Off the air." The headline sits over a TV-static canvas (the grain texture, animated) with the station bug "--.-".
- One line: "There's nothing on this channel."
- Buttons: "Open the dial" and "Back to the start".

---

## 8. Known issues in the references to fix while porting

- The Run page footer's call-sign box says "Four letters" and caps the input at 4 characters. That contradicts the Network checker (three to five letters, and four-letter K/W signs are refused). Use the shared rules there too. Change its hint to "Three to five letters." and list the change in `docs/site/new-copy.md`.

- The Home reference has its own copy of the station data and scenes inside `home.js`. Use the one shared `stations` and `scenes` module for every page.
- Several class names collide between base and page CSS (`.oa`, `.onair`, `.tl`, `.rc`, `.who`, `.band`, `.cmp`, `.fd`, `.big`, `.off`, `.tick`). The references work around this with prefixes and load order. Scope page styles so it can't happen again.
- `[hidden]` is overridden by `display` rules in places. The references add explicit `[hidden]{display:none}` rules. Keep a global `[hidden]{display:none !important}`.
- Footers link to in-page anchors on the home page (`/#guide`, `/#stations`, `/#breaks`, `/#public`). Keep them, and make sure those ids exist.
- Canvas scenes must pause when off screen (IntersectionObserver) and when the tab is hidden. Each canvas must size to its box at `devicePixelRatio`, capped at 2.
