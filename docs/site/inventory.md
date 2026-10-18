# Dial site: Phase 0 inventory

What the reference in `docs/reference/site/` is made of, page by page, and what the repo has today. Written for the port to Astro in `apps/site` (the site prompt, Phase 0). Paths in the page sections are relative to `docs/reference/site/source/` unless they start with `pages/`.

- The built pages are their source parts byte for byte: `head.html`, the shared CSS, the page CSS, `body.html` and the page JS. Each `body.html` regenerates byte-identical from its `body.py`, so the `body.py` line numbers are reliable. The `build/*.py` scripts point at old sandbox paths and can't run as they are. That doesn't matter, since the port reads the parts.
- No cell on any page, header or footer has `--t` above 6.
- No visible copy says "Opencast". The one trace is the call sign **OCAT** ("Classic Matinee", 60.1) in every station list. It's demo data; see Q11 below.

## Summary

### Interactive pieces, per page

| Page | Piece | Driven by |
|---|---|---|
| All | Grain texture, now-playing tuner LCD in the nav (pinned to BEAT, refreshed every 30 s), Lenis, in-page anchors (offset −70, 1.2 s), custom cursor (`data-cur`, fine pointers only), phone menu, footer reveal | `shared/common_head.js`, `shared/common_tail.js`; header inline script `chrome/header.html:15-23` |
| All but Network | Canvas scenes: crate, reel, kitchen, civic, field, matinee, radio, radio2, dunes, all `(x,w,h,t,s)` | `shared/scenes.js` `draw()` / `SC` (byte-identical copies in `home.js:30-92` and `run.js:25-87`) |
| Home | Power-on intro, hero tuner (wheel, keys, needle, `fill()` tints `--st`), the station wall, the guide (filters All/TV/Radio, now-line), the stations grid, the sign-off off-air canvas, the break timeline, the crawl, the doors | `home/home.js` (see Home below for each function) |
| Run | Signal chain (an auto-advancing tab set), master control demo, the "Already running a 24/7 stream?" switch, usage estimator `calc()`, competitor comparison `vs()`, "Does it cover your costs?" `pay()`, FAQ, footer number picker and Claim | `run/run.js` |
| Syndication | Network map canvas, offer side A/B, the market (`#fits`) with search, filters and a phone filter sheet, earnings calculator `#earn` with station squares, deals ticker, schedule week, FAQ | `syndication/synd.js` |
| Spots | Hero tuner scan (3.2 s), spot planner, live break control room (26 s loop), receipt tabs, steps highlight, ticker, FAQ | `spots/spots.js` |
| Network | Hero tuner seg, call-sign checker, "follow the dollar" seg, FAQ | `network/net.js` |

The per-page sections below list every piece with file:line, states, timers and data.

### Calculators: the spec's reference values hold

- **Run usage estimator** `calc()` (`run.js:164-174`). The defaults are 500 GB library, 40 GB on air, relays on Everything and 10 live hours, giving $1.20 + $25.00 + $3.75 = **$29.95**.
- **Run pay calculator** `pay()` (`run.js:152-160`). The defaults are 10 tuned in, 0.5 min and $50 pledges, giving $103.68 + $47.50 − $29.95 = **$121.23 left**, "Covers your month 5× over".
- **Syndication earnings** (`synd.js:133-147`). At the defaults, revenue share gives $576.00 a month ("About $6,912 a year"). Cash gives $370.50.
- **Spots planner** (`spots.js:125-145`). The defaults are shop, 12 miles, $8, $300 budget and $15 cap. That gives 3 stations, 9.5 airings a day, 1,875 tuned in a day and 20 days.

### Spec §5 against the repo

`packages/domain` has no pricing or share constants. They live in the rules registry (`packages/contracts/src/rules.ts`, values in `packages/db/migrations/0033_pay_as_you_go.sql`) and are explained in `docs/pricing.md`.

| Figure | SITE-SPEC §5 / reference JS | Repo | |
|---|---|---|---|
| Storage | $0.04 a GB-month, first 10 GB free | `prices.storage` 40000 micros; `prices.free_allowance` 10 GB | Same |
| Live hours, TV | $0.75 an hour, first 5 free | `prices.live_hours` 750000; free allowance 5 h | Same |
| Live hours, radio | Free | `prices.radio_live` 0 | Same |
| Relays, live shows only | Free | Free (`docs/pricing.md`) | Same |
| **Relays, everything aired** | **$0.05 an hour, never over $25 a month** | **$0.20 an hour** (`0033`, line 90), **with no monthly cap**. `docs/pricing.md` lists $0.05 as recommendation 2 and $25 flat as an alternative, neither adopted | **Mismatch** |
| Month length | 720 hours | Billing is measured daily; cost notes use 730 | Only matters for the relay cap; harmless at $0.05 (720 h = $36, so the $25 cap applies) |
| **Dial's share** | Self-booked spots 10%, Dial-sourced spots 20%, pledges 5%, syndication cash 5%, backfill 20% | `shares.opencast` has `spotBps`, `pledgeBps` and `productionBps`, **all 0 ("not set yet")**. Nothing splits self-booked from Dial-sourced spots, and nothing covers syndication cash or partner ads (backfill) | **Mismatch**: none of the five is set, and three have no rule at all |
| **Syndication revenue share** | The maker's share of a station's ad revenue × watch-time share, **capped at 80%**; the calculator's default mode | Carriage `Terms` (`catalog.ts:16-38`) offers **barter, cash, cash plus barter, free**. There is **no revenue-share term** and no maker-share cap | **Mismatch**: the calculator's main mode isn't a term the platform offers |
| Spot market | About $8 per 1,000 | Spots carry their own `rate` (`per_thousand` or `per_airing`); no default | No constant to compare |
| Waitlist hold | 120 days, with a reminder | `call_signs.hold` 120 days, reminder before the end | Same |
| Numbers | TV 2.1–69.9, radio 88.2–107.8 | `packages/domain/src/station.ts` uses the same ranges, radio on even tenths | Same |
| After signing off | Call sign yours a year, number back after 90 days | Same (`station.ts:69-79`, contracts) | Same |
| **Call-sign rules** | `net.js:63`: brands ABC CBS NBC NPR PBS FCC FOX CNN HBO ESPN MTV BBC AMC TBS TNT CSPAN **UPN ION HGTV WGN KTLA KCAL TCM QVC** BET; alert words ALERT EAS SOS; **exact match** | `CALL_SIGN_RULES_DEFAULT` (`callSigns.ts:30`): the same core plus **CBC FEMA HULU MSNBC NOAA NWS ROKU TUBI**, without UPN ION HGTV WGN KTLA KCAL TCM QVC. Names of 4+ letters match **anywhere** (ESPNX is refused) | **Mismatch** in the list and in how names match |

The pay calculator prices each 15-second spot at $8 per 1,000 (`mn*4` spots an hour). That's what gives $121.23. The copy says "about $8 per 1,000 tuned in" without saying "per spot". The number and the copy agree only if a spot is 15 seconds.

### Contracts the site will need (for `docs/contract-requests.md`)

- **The waitlist number.** `waitlist.join` takes `callSign` but no **channel number**. Claim a number and the checker's Reserve both hold a number.
- **The waitlist details.** `waitlist.join` has no field for the producer's program, a market row's program id, the spot planner's prefill or "order a spot". Only `about` (140 characters) could carry them.
- **ZIP is required.** `waitlist.join` needs a 5-digit `zip`, so the sheet has to ask for one.
- **API copy says "Opencast".** The API's waitlist `message` and the `CallSignRefusal.reason` strings say "Opencast" ("Opencast doesn't allow that name."). The site should show its own words from `rule`, not the API's text.
- **No `POST /contact`.** Contact needs a request, a mock and a `mailto:` fallback (spec §7).

### What `apps/site` holds today

- `@opencast/site` is the earlier one-page Opencast site, in **React 19 and Vite**, using `@opencast/ui`, TanStack Query and MSW. Mock mode runs on :5183. It's **deployed on Vercel** (`opencast-site`, `vercel.json`).
- **What's worth keeping:**
  - `src/api/client.ts`: calls built from contracts, with the response parsed by the endpoint's schema.
  - `src/lib/waitlist.ts`: cleaning, validation and the body for `waitlist.join`, with tests.
  - `src/mocks/handlers.ts`: the waitlist and `checkCallSign` answered by MSW, validated against contracts.
- Everything else is replaced: the React components, `@opencast/ui`, `site.css`, `Tuner` and the Vercel config.

### Repo facts that differ from the prompt

- **Branch.** There's no `monorepo` branch. `main`, `dev` and `staging` are all at f46eb5f, so `site` was cut from `main`.
- **Package manager.** The repo uses **npm workspaces** (`packageManager: npm@11.3.0`), not pnpm, and the package is `@opencast/site`. `pnpm --filter site dev` becomes `npm run dev -w @opencast/site`. The package name stays, since the rename is out of scope.
- **Hosting.** The web apps, the site included, are hosted on **Vercel**. Railway runs only the API, worker, relay, Postgres and Redis (`.railway/railway.ts:46-51`, `docs/deploy.md`). Phase 5 puts the site back on Railway.
  - Staging's API allows the site's origin in `WEB_ORIGIN` (`railway.ts:116`). The new Railway origin will need adding there before the waitlist works from the preview. That means touching the api service.

### Rendered check of the references

All five pages were rendered in Chrome at 1440, 820, 390, 360 and 320, scrolled top to bottom.

- **No console errors.** Fonts and Lenis load from Google and the CDN.
- **Network has horizontal scroll at 390, 360 and 320** (page 410px wide). The call-sign checker's box and the hero's `seg2` (`#tnMk`, and `#fdSeg` in Follow the dollar) are wider than the cell.
- **Spots has 12px of horizontal scroll at 320**, from a long `span > em` line.
- Home has a section the spec's table doesn't list: `signs`, between `stations` and `breaks`.

### Things to decide before or while porting

1. **Night.** The spec says Night is `#140F24`. The page ground token `--night` is **`#0E0A1C`** (`head.html:11`, `run.css`). `#140F24` appears in nav, polish, synd and spots CSS, and in the brand SVGs. Parity keeps both as drawn: `--night` for the ground, `#140F24` for the surfaces that use it.
2. **Station colours on night.** BEAT `#C04A9E` (4.20:1) and PREP `#3478C6` (4.14:1) fall short of 4.5:1 where they carry text. NITE is 4.77, SAZN 5.01, CIVC 5.33 and REEL 6.78.
   - Meeting Phase 4 means a lighter text tint for those two wherever they colour text, which changes how they look.
   - The data also has 9 stations, but the spec lists colours for 6.
3. **Buttons the spec routes but the reference doesn't draw:**
   - a Start a spot button on the planner;
   - a Reserve button on the checker's free result (it's plain text);
   - Order one made and the agency card's Talk to us only link to `#ways` and `#plan`;
   - the Network footer's Claim a number goes to `/run`;
   - the Run footer's Claim a number scrolls to itself.
   §6 needs these as waitlist triggers, so they'll be added in the reference's button style.
4. **One station list.** There are four lists that disagree: `shared_data.js` (9), the spots planner, `net.js` (19 across markets) and `synd.js` (48 carriers).
   - The checker calls the syndication call signs, VOZE, VALE and DIAL "free".
   - High Desert is marked "Opening first", which contradicts the FAQ and §7 ("Inland Empire first").
   - The syndication station squares make up their numbers (BEAT shows 2.1, FM stations get TV numbers), and their colours don't match the stations.
   The plan is to keep one `stations.ts` with the 9 dial stations plus the markets and carriers as demo data, and to derive "taken" from all of it.
5. **Call-sign rules.** One shared function should use `callSignRefusal()` and `CALL_SIGN_RULES_DEFAULT` from `@opencast/contracts`, so the site refuses exactly what the API refuses, plus the length rule and the demo "on the dial" set. That makes the site follow the contracts' list and substring matching, not `net.js`'s. The alternative is the net.js list as drawn.
6. **Copy against the numbers:**
   - The Syndication partner-ads line says "after our 10%", but backfill is 20%.
   - "Every airing pays the maker" contradicts the Free terms.
   - Run's "1:45 a break" caption, but the items sum to 1:25.
   - Cash-mode rows add up to $30.87, but the total shows $30.88.
   Copy is final, so these are listed, not changed.
7. **Placeholder numbers in the markup are stale.** Run shows $2.00 / $14.60 / $18.60, Syndication "10 programs fit" (11 render), and the checker's number "12.4" (63.4 after JS). The Astro build will prerender the computed defaults, so the HTML and the first frame agree.

The per-page sections below have the full problem lists: CSS collisions, `[hidden]` overrides, reduced-motion gaps, canvas sizing, no-JS behaviour and accessibility.

---

## Inventory: shared layers + Home (docs/reference/site)

Paths below are relative to `docs/reference/site/source/` unless they start with `pages/` or `SITE-SPEC`.
Verified: `pages/home.html` is exactly `head.html` + the 6 shared CSS files + `home/body.html` (with the build's href rewrites) + `home/home.js`. No duplicate ids in the built page.

---

### Shared layers

Cascade order (all pages): `head.html` inline `<style>` → polish → grid → flat → nav → shape → lt. Later files override earlier ones heavily, and much of head.html/polish.css is dead legacy (listed under Problems).

#### head.html (`shared/head.html`)
- Lines 1-4: `<title>Dial</title>` + Google Fonts preconnect/stylesheet (Big Shoulders Display 500/700/800/900, Instrument Sans 400-700, VT323).
- `:root` (5-18):
  - `color-scheme: dark`
  - `--night: #0E0A1C`
  - `--night-2: #171030`
  - `--glow: #F3EAD9`
  - `--muted: #A79FBF`
  - `--line: rgb(243 234 217 / .13)`
  - `--tally: #FF4A3D`
  - `--st: #C04A9E` (the current station's colour, set at runtime)
  - `--display: "Big Shoulders Display","Arial Narrow",Impact,sans-serif`
  - `--text: "Instrument Sans","Helvetica Neue",Arial,sans-serif`
  - `--osd: "VT323","Courier New",monospace`
  - `--gut: clamp(16px,4vw,64px)`
  - `--ease: cubic-bezier(.2,.7,.1,1)`
- Base: `body` (night bg, 17px/1.55 text, `overflow-x:clip`), `::selection`, `:focus-visible` (2px glow outline, radius 6px), `h1-h3` (display 900, line-height .88), `.sr` (visually hidden), `.wrap` (gut padding, max 1560px).
- Class families:
  - `.room` (fixed radial wash in `--st`)
  - `.grain` + `@keyframes grain`
  - `.cur` (custom cursor: `.r` ring with label span, `.d` dot, `.big`)
  - `.nav` / `.brand` / `.nav ul` / `.btn` (+`.ghost`, `.dot`) / `.menu-btn` / `.mob` (+`.mob[hidden]{display:none}` :63)
  - hero: `.hero` (195svh), `.pin` (sticky, 100svh), `.halo`, `.screen` (`#pic`, `#noise`, `.roll`), `.scan`, `.vig`, `.osd` (+`.tun`), `.kbuf`, `.fade`, `.hero-copy` (`h1 .ln span` reveal under `.on`), `.lower` (old `.top/.num/.cs/.prog/.who/.bar/.next`), `.air`
  - dial band: `.dial`, `.arrow`, `.band`, `.seg` (`.tv-s` flex 68 / `.fm-s` flex 32, `.lab`), `.tick` (`.big`, `.tl`), `.st-mark`, `.needle`, `.hint`, `.snd` (eq bars), `.after`, `.power` (`.go`)
  - `.crawl` (`.tag`, `.track` 60s, `.it`)
  - `.sec`, `.head`, `.ch-tag`
  - guide: `.guide`, `.g-in`, `.g-time`, `.g-row`, `.g-st`, `.g-progs`, `.g-p`, `.g-now`
  - `.peek` (floating preview)
  - `.signs` / `.sg` (old call-sign list)
  - break: `.brkw` (380svh), `.brk-pin`, `.cap`, `.brk-tv`, `.tl`, `.tl-lab`
  - `.doors` / `.door`, `.mani` (`.w`, `.lit`, `.hot`), `.facts` / `.fact`
  - `.signoff`, `.off`, `.offtv` (`.img`, `.dot`, shut animation), `.word`, `.foot`
- Keyframes: grain, pulse (1.8s), roll, line, open, crawl, capin, shut, dot, stay, eq.
- Breakpoints: `max-width:1060px` (:273), `600px` (:297), `prefers-reduced-motion` (:312), `(hover:hover) and (pointer:fine)` (:43).

#### polish.css
- `:root` (:2):
  - `--r-key: 14px` (shape.css later sets 999px)
  - `--s-1: 8px`
  - `--s-2: 16px`
  - `--s-3: 24px`
  - `--s-4: 40px`
  - `--s-5: 64px`
  - `--s-6: clamp(112px,11vw,168px)`
- `.btn` restyled as a cream key: gradient #FFF7E8→#EADFCA, text #140F24, 52px tall. `.btn .live` is the dark VT323 chip with a pulsing `i`. `.btn.ghost`, `.nav .btn`.
- Lower third v1: `.lt-tag`, `.lt-num`, `.lt-cs`, `.lt-air`, `.lt-body`, `.lt-prog`, `.lt-who`, `.lt-row`, `.lt-bar`, `.lt-next`.
- Restyles: `.hint kbd`, `.arrow`, `.st-mark.on span`, `.after .dots`, `.crawl .tag` (tally bg).
- `.sh` / `.sh-r` (section head).
- `.g-bar`, `.seg2` (segmented control), `.g-help`, `.g-corner`.
- Guide v2: `.g-row[hidden]{display:none}` (:80), `.g-st .badge`, `.g-p strong/small/.past/.now/.pb`, `.g-now span`.
- `.onn` (now/next block with `.pb`), `.sg .go` / `.door .go`, `.tl-names`, `.dt em`.
- `.fact` (border-top `--c`), `.cols`, `.badge` (:172).
- The wall: `.wall`, `.tile` (`.tb`, `.tp`, `.me`, `.tw` "Watching" with blink), `.wall.up`, `.wall.narrow`.
- `.after` v2 caption: `.af-l`, `.af-k`, `.af-r`.
- Z-stacking (:249-257): `.screen` z1, `.tile` z0, `.tile.me` z3, the hero UI z4.
- Breakpoints: 1060 (:150), 600 (:162), 720 (:190, :243), reduced motion (:248).

#### grid.css (the site grid)
- `:root` (:7):
  - `--cols: 12`; 6 at `max-width:1099px` (:8); 2 at `max-width:699px` (:9)
  - `--rule: #2A2342`
  - `--panel: color-mix(in srgb,var(--st) 5%,#110C21)`
  - `--panel-hi: color-mix(in srgb,var(--st) 9%,#161029)`
  - `--pad: clamp(20px,2.2vw,34px)`
  - `--mh: 46px` (42px at ≤699)
- Grid layout:
  - `.blk` (section padding); `#guide.blk` gets extra top padding.
  - `.sheet`: grid of `repeat(var(--cols))`.
  - `.cell`: `grid-column: span var(--d,12)`; ≤1099 `span var(--t,6)` (:15); ≤699 `span var(--m,2)` (:16). Defaults are --d 12, --t 6, --m 2.
- Strips and bodies: `.mh` (header strip, uppercase 11px), `.ix` (VT323 index), `.mh .lv` / `.mh .air` pulsing dot, `.tab` (tabular-nums), `.mf` (+`.col`), `.cb` (+`.end`).
- `.hd h2`, `.lede`, `.key` (arrow key), `a.cell:hover`.
- Guide in a cell: `#guide .g-bar` / `.guide` / `.g-in`. Legend `.lgd` (`.k-now` hardcodes #C04A9E, `.k-up`, `.k-past`).
- Stations: `.stn` (`.mh .ch`, `.mh .air`, `.cv` aspect 2.15/1, `.nm`, `.onn`, `.key` revealed on hover), `.stn-cta` (:179-184).
- Break: `.brk-pin` flex, `.bcap`, `.btv` (`.brk-tv` max-height calc(100svh - 330px)).
- Doors: `.dr` (`.big` spans 2 rows ≥1100 :94), `.claim` (`.cn` blink `cnb` 1.1s, `.cc` outlined), `.rul` ruler (`.mk`, `.mk.you` dashed blinking, `.lo`, `.hi`).
- Public: `#public .mani`, `.pf` (`.sq` swatch).
- Sign-off: `.signoff`, `.offc`, `.lk` (link column), `.wd` (big wordmark), `.wd-tag`, `.foot.mf`.
- Breakpoints: 1099, 699, `min-width:1100px` (:94), reduced motion (:175).

#### flat.css
- Hero overlay as a grid:
  - `.hui` (flex column, padding-top `calc(var(--mh) + 96px)`)
  - `.hrow` (hardcoded `repeat(12,…)`)
  - `.hui .hero-copy` spans columns 1/span 7; `.hui .lower` 9/span 4 (lt.css changes this to 8/span 5)
  - `.hui .hint`, `.hui .dial`
- Tablet: the lower third becomes a strip. ≤1099 hides `.hint`.
- `@media (max-height:620px) and (max-width:1099px)` hides the hero paragraph (:39).
- Flat sheet (:46-63): no bg, no radius, top rule only, negative `margin-inline: calc(var(--pad)*-1)`, `clip-path: inset(-1px 1px -1px 0)`. Each `.cell` has a right and bottom rule.
- Phone `--pad: var(--gut)` (:66).
- `#guide .g-now{z-index:6}` (:81) puts the now-line over the programmes.
- Breakpoints: 1099, 699, max-height 620.

#### nav.css
- v1 (:5-74):
  - `.nav` is 68px (60px ≤699) and goes `.solid` with blur and a bottom rule.
  - `.nl` ruled link list (dead); `.np` live chip v1 (`.np-tv`, `.np-t`, `.np-k`, dead)
  - `.menu-btn` + `.hb` hamburger (`.on` turns it into an X)
  - Phone menu: `.mob`, `.mob-h`, `.mob-l` (staggered `mobin` animation), `.mob-f`
- v2 (:80-135):
  - `.nl.nl2` centred pill rail; `.nl-ind` sliding indicator (`.on`)
  - `a.is-cur` (glow text + 4px dot `::before` in `--np`); `.nl2 a:focus-visible{outline:none}` (:88)
  - Tuner button: `.tnb`, `.tnb-lcd` (154px), `.tnb-dot`, `.tnb-roll`, `.tnb-a` (channel + call sign), `.tnb-p` (Now + programme), `.tnb.flip`, `.tnb-go` (Watch + round play key)
- Logo (:137-142): `.brand .bi` (32px icon), `.brand .bw` (50×25 wordmark).
- Breakpoints: 1240 (:39, :115), 1099 (:40, :116, :126), 699 (:45, :117, :129, :141), 420 (:142), 374 (:135), 360 (:124), reduced motion (:72, :125).

#### shape.css
- `:root{--r-key:999px}` (:6).
- Pills and circles: `.btn`, `.btn .live`, `.key` (50%), `.menu-btn`, `.seg2` (+buttons), `.after .af-r` (+`i` circle), `.snd`.
- Square at 2px or less: lower third, kbd 3px, `.st-mark span`, guide, `.g-p`, `.badge`, `.lgd i`, `.pb`, `.tl div`, `.peek .scr`, `.brk-tv`, `.offtv`, `.tile` (`!important`), `.air`, `.crawl .it i`.
- `.brand .mk` 6px (dead).
- :43-69: a second `.np` "one pill" variant (`.np-b`, `.np-ch`, `.np-go`) not used by the markup (dead).
- Breakpoints: 1240, 699, 360.

#### lt.css (lower third v2)
- `.hui .lower` spans 8/span 5, max 640px.
- Pieces: `.lt-tag` (54px station bar, `.lt-air` "On air" on the right), `.lt-body`, `.lt-r` (52px label column), `.lt-k`, `.lt-prog`, `.lt-who`, `.lt-left`, `.lt-t`, `.lt-row` (start / bar / end), `.lt-nx` (Next).
- `.hui .lt-next{display:none}` (the old one).
- Breakpoints: `(max-width:1240px) and (min-width:1100px)` spans 7/span 6 (:28); ≤1099 compact strip (hides Now label, who, Next); ≤699.

#### Breakpoint inventory, all shared CSS
- **System:** 1099/1100 and 699/700 (grid, flat, nav, lt, and `layoutWall` in JS uses `vw<700`).
- **Legacy:** 1060 and 600 (head.html, polish.css), 720 (polish.css guide and after caption).
- **Nav-only:** 1240, 420, 374, 360.
- **Other:** max-height 620; hover/pointer fine; prefers-reduced-motion.

#### Runtime-set custom properties
- `--st`: current station colour, set on `<html>` by home.js `fill()`. Not set on other pages.
- `--np`: nav tuner colour, set by `fill()` in both home.js and common_head.js.
- `--c`: per element (station or door colour).
- `--pc`: break part colour on `#brkPin`; peek colour.
- `--px`, `--py`: parallax on `#pic`.
- `--h`: `.sg`, dead.
- `--pct`: head.html:179, dead.
- `--d`, `--t`, `--m`: cell spans.

---

### Shared JS

#### shared_data.js
- `var S=[…]` (:2-12), 9 stations. Fields:
  - `n` (channel string)
  - `b` (`'tv'|'fm'`)
  - `cs` (call sign)
  - `name`
  - `who`
  - `c` (hex)
  - `sc` (scene key)
  - `len` (programme length in minutes)
  - `p` (programme titles, cycled)

| n | b | cs | name | who | c | sc | len | p |
|---|---|---|---|---|---|---|---|---|
| 7.1 | tv | CIVC | Civic Channel | Run by a residents’ group in Riverside | #2F9A72 | civic | 120 | Council Watch · Neighborhood Hour · Library Talks · Council Watch, replay |
| 12.1 | tv | BEAT | Beat Tape TV | Run by a crate digger in Pomona | #C04A9E | crate | 60 | Late Crate · Crate Session · Beat Tape Live · Overnight Crates |
| 18.1 | tv | SAZN | Sazón | Run by a family kitchen in Fontana | #E0583A | kitchen | 30 | Tamales for forty · Sunday Pozole · Abuela’s Pantry · Salsa School |
| 24.1 | tv | REEL | Saturday Reel | Run by a film club in Redlands | #D98A2B | reel | 120 | Saturday Reel · Short Stack · The Late Show · Projector Room |
| 31.1 | tv | PREP | Prep Sports | Run by high-school students in Upland | #3478C6 | field | 180 | Prep Football Live · Game Film · Locker Room |
| 60.1 | tv | OCAT | Classic Matinee | Public-domain films from the network’s catalog | #9A9CAB | matinee | 90 | Classic Matinee · Silent Hour · Serial Saturday |
| 88.4 | fm | NITE | Night Shift Radio | Run by two DJs in San Bernardino | #5B7BE0 | radio | 180 | Night Shift · Request Line · Dawn Patrol |
| 92.0 | fm | FLDR | Mojave Field Recordings | Desert sound, recorded and shared under CC BY | #C9709A | dunes | 60 | Wind at Amboy · Joshua Tree, 4 am · Kelso Dunes |
| 104.2 | fm | VOZE | La Voz del Valle | Run by a radio collective in Coachella | #EBA03A | radio2 | 60 | Mañanitas · La Hora Norteña · Voces del Valle |

- `slot(s)` (:13): uses minutes since local midnight. Returns:
  - `i`, `start`, `end` (minutes)
  - `prog` = `p[i%n]`, `next`
  - `pct` (0-1)
  - `left` (ceil minutes)
- `clock(min)` (:14): 12-hour clock, `"3 pm"` / `"3:05 pm"`, wraps at 1440.

#### scenes.js
- `hexA(hex,a)` (:1): turns a hex colour into an rgba string.
- `SC` (:2-61): scene functions with signature `(x,w,h,t,s)`.
  - `x` is a 2D context, `w`/`h` are pixel sizes, `t` is seconds, `s` is a station (uses `s.c`, and `s.n` in the radio scenes).
  - `radio` takes a 6th arg `alt` (warm palette).

| Scene | Line | Draws | Notes |
|---|---|---|---|
| `crate` | :3 | Spinning vinyl in `s.c` + EQ bars ("vinyl" in SITE-SPEC) | |
| `reel` | :11 | Sunset, sun, hills, film grain/flicker | Uses `Math.random` |
| `kitchen` | :19 | Pot in `s.c`, steam | |
| `civic` | :26 | Council dais, 7 members (speaker changes every 4s), "LIVE" | Fixed `bold 14px` text |
| `field` | :34 | Football field, scrolling yard lines, players, scorebug "UPL 14 – CHA 10 Q3" | Fixed 15px text |
| `matinee` | :41 | B&W projector, curtain, two figures | Uses `Math.random` |
| `radio` | :48 | Stars, spectrum, FM scale 88-108 with a needle at `s.n` | |
| `radio2` | :55 | `SC.radio(...,1)` | |
| `dunes` | :56 | Desert dunes, sun, waveform | |

- `draw(x,w,h,t,s)` (:63): `SC[s.sc](…)`.
- `run/run.js:25-87` holds a third, identical copy of `hexA`/`SC`/`draw` (byte-identical to scenes.js).

#### common_head.js (opens the IIFE; used by Syndication, Spots, Network)
- :3-4: `BRAND='dial'`, written into every `[data-brand]`.
- :5-8: `RM` (reduced motion), `FINE` (hover + fine pointer), `$` (getElementById), `clamp(v,a=0,b=1)`.
- :9: grain IIFE. A 180×180 random-noise canvas becomes a dataURL background on `#grain`.
- :10: `/*DATA*/` (shared_data.js is pasted here).
- :11: `var cur=1` (always BEAT).
- :12: `nowMin()`, unused in the shared code.
- :13: `fill()` updates `.js-ch`, `#npCs`, `#npProg` and `--np`.
- :14: `fill()` runs now and every 30000 ms. It does **not** set `--st` and does **not** update `#mobClock`, which stays the literal "3:22 pm" on non-home pages.

#### common_tail.js (closes the IIFE)
- :1-4: `onScroll()` toggles `nav.solid` when scrollY > 40. Lenis is built when `window.Lenis && !RM` (`{lerp:.1, smoothWheel:true}`) with its own rAF loop; there is also a native scroll listener.
- :5: in-page anchors. Every `a[href^="#"]` scrolls with Lenis `scrollTo(t,{offset:-70,duration:1.2})`; `#top` goes to 0. Without Lenis it uses `scrollIntoView` (smooth unless RM).
- :6: an IntersectionObserver on `#contact` (threshold .2) adds `.go` (sign-off animation).
- :9-12: cursor (FINE only).
  - Adds `body.cursor-on`.
  - The dot follows the mouse exactly; the ring lerps .2 (1 under RM).
  - `[data-cur]` under the pointer sets the `#curL` label and `.big`.
  - Hides on document mouseleave.
- :15-17: menu. `#menuBtn` sets `#mob.hidden=false` and `aria-expanded=true`. `closeM()` runs on `#menuX` and on any `#mob a`.

#### Header inline script (`chrome/header.html:15-23`, identical in `home/body.html:16-24`)
- `to(a)` moves `.nl-ind` to the link's offsetLeft/offsetWidth and adds `.on`.
- `rest()` returns it to `.is-cur`, or hides it if there is none.
- Bindings: mouseenter/focus on each link; `rest` on rail mouseleave, window load, resize and `document.fonts.ready`.
- Tuner flip: `setInterval(() => toggle .tnb.flip, 3400)`. Skipped when the document is hidden; not started under RM.

---

### Header and footers

#### Header (`chrome/header.html`)
- Order: `.room`, `#grain`, `#cur` (label `#curL`, default "Tune"), then `header.nav#nav`.
  1. `a.brand` (href `#top`, aria-label "Dial, home"): inline SVG icon (120 grid, red i + 4 ticks) and inline SVG wordmark (red full stop).
  2. `nav.nl.nl2[aria-label=Main]`: `.nl-ind`, then 5 links with VT323 index `<i>`: 01 Run a station `#run`, 02 Syndication `#syndication`, 03 Spot market `#spots`, 04 The network `#network`, 05 Contact `#contact`.
  3. `a.np` (href `#top`, aria-label "Watch what's on now"), the tuner button:
     - `.tnb` > `.tnb-lcd` (aria-hidden): `.tnb-dot`, then `.tnb-roll`
     - `.tnb-roll` holds `.tnb-a` (`.js-ch` "12.1" + `#npCs` "BEAT") and `.tnb-p` (`small` "Now" + `em#npProg` "Overnight Crates")
     - then `.tnb-go` ("Watch" + round play key)
  4. `button.menu-btn#menuBtn`: aria-expanded=false, aria-controls=mob, aria-label "Menu", `.hb` burger, `.ml` "Menu".
- `#mob[hidden]` (phone menu):
  - `.mob-h`: brand + `#menuX` (aria-label "Close menu", `.hb.on`, "Close").
  - `nav.mob-l[aria-label=Menu]`, 6 links:
    - 00 Watch / Open the dial `#top` (`.w`, coloured `--np`)
    - 01 Run a station / For creators and groups `#run`
    - 02 Syndication / Carry shows, or offer yours `#syndication`
    - 03 Spot market / For advertisers, near and far `#spots`
    - 04 The network / How it's run `#network`
    - 05 Contact / A person answers `#contact`
  - `.mob-f`: "9 stations on now" (literal) and `#mobClock` ("3:22 pm" literal).
- Current-page marking: the non-home build scripts (e.g. `build/build_run.py:7-12`) rewrite rail anchors to routes and add `class="is-cur" aria-current="page"` **only in the desktop rail**. The mob menu links get routes without any current marking (`y.split(' class')[0]`). Brand, `.np` and mob Watch become `/`. Home has no `is-cur` (Home isn't in the rail).
- Rail and menu by width:
  - >1240: full rail with indexes; LCD 154px.
  - ≤1240: rail indexes hidden (nav.css:39 `.nl a i`); link padding 12px; LCD 136px.
  - ≤1099: rail hidden (:41, :126); `.menu-btn` shown with the "Menu" label (:42); `.np` pushed right.
  - ≤699: nav 60px; menu key icon-only, 42px; LCD 126px; "Now" small hidden; call sign shown at 14px.
  - ≤420 / ≤374: call sign hidden, LCD 100px.
  - ≤360: "Watch" text hidden (font-size 0). The LCD 96px rule there is overridden by the later 374/420 rules.
- Menu trigger: click on `#menuBtn` (there is no hover). Closes on `#menuX` or a link click. No Esc, no focus move or trap, no scroll lock, not a dialog.
- JS: the inline header script (indicator + flip). Contents are filled by home.js `fill()` on Home and by common_head `fill()` elsewhere; the menu is wired by common_tail (or the home.js copy at :400-402).

#### Footers
- All `footer.signoff#contact > .wrap > .sheet`. Rows 2-4 are identical in all 5 footers (home + 4):
  - 4× `nav.cell.lk` (`--d:3;--t:3;--m:1`):
    - Watch: Open the dial `#top`, What's on `#guide`, Stations `#stations`
    - Make: Run a station `#run`, Syndication `#syndication`
    - Advertise: Spot market `#spots`, How breaks work `#breaks`
    - The network: About `#network`, How it's run `#public`, Contact `#contact`
  - `.cell.wd` (`--d:12`): outlined "dial" wordmark (`data-brand`, aria-hidden) + `.wd-tag` "Free to watch. / Flip it on."
  - `.cell` (`--d:12`): `.mf.foot`, "© 2026 Dial." + "Stations, programs and people on this page are examples."
- Non-home builds rewrite: `#top`→`/`, `#guide`→`/#guide`, `#stations`→`/#stations`, `#breaks`→`/#breaks`, `#public`→`/#public`, `#run`→`/run`, etc., `#contact">Contact`→`/contact`.

First row (cell spans; the `ix` number; headline; buttons; second cell):

| Footer | Cell 1 | Cell 2 |
|---|---|---|
| Home (`home/body.html:215-226`) | `--d:8` (t 6). "06 Sign-off / A person answers". h2 "Turn it off whenever. We'll keep it on." Lede. Btn "Open the dial" `#top` (live chip `.js-ch`), ghost "Contact us" `#contact`→`/contact` | `.offc` `--d:4` (t 6). "Off air / Good night". `.offtv` with `canvas#offC` 320×240 + `.dot` (CRT shut-off) |
| network (`chrome/footer-network.html:4-15`) | `.claimc` `--d:7;--t:6`. "08 Find your number / Free to hold". h2 "There's room / on the dial." Btn "Claim a number" `/run` (chip "NEW", data-cur Claim), ghost "Open the dial" `/` | `--d:5;--t:6`. "Three ways in / Pick yours". `ol.stps` (`--c:#5B7BE0`): 01 Watch, 02 Run a station, 03 Advertise or make shows |
| run (`footer-run.html:4-15`) | `.claimc#claim`. "07 Claim a number / TV 2 to 69, FM 88 to 108". h2 "Pick a number. / Go on air tonight." Lede says "four-letter call sign". Btn "Claim a number" `#claim` (chip "__.1"), ghost "Talk to a person" `/contact` | `.pickc`. "Open numbers near you / Inland Empire". `#pick` (JS-filled), call-sign `input#csIn maxlength=4` (aria-label "Call sign, four letters"), `#csN` "44.1", `#csMsg` "Four letters. Pick a number above." |
| spots (`footer-spots.html:4-15`) | "08 Start a spot / No minimum". h2 "Get in / the break." Btn "Start a spot" `#plan` (chip ":15"), ghost "Order one made" `#ways` | "What you'll need / About 10 minutes". `ol.stps` (`--c:#E0583A`): A spot, or a brief / An offer / A budget |
| syndication (`footer-syndication.html:4-15`) | "08 Offer a show / Free to list". h2 "Put your show / on more dials." Btn "Offer a show" `#offer` (chip "NEW"), ghost "Browse the market" `#fits` | Same header as spots. `ol.stps` (`--c:#EBA03A`): The episodes / Who owns what / Your terms |

- Footer component CSS is **not** in shared CSS: `.claimc`/`.pick*`/`.cs-*` are in `run/run.css:202-248`; `.stps` is in `syndication/synd.css`.

#### Every href, header + footers (source, before rewrite)
- Header: `#top` (brand ×2, `.np`, mob Watch), `#run`, `#syndication`, `#spots`, `#network`, `#contact` (rail + mob).
- Footers, shared rows: `#top`, `#guide`, `#stations`, `#run`, `#syndication`, `#spots`, `#breaks`, `#network`, `#public`, `#contact`.
- First rows: Home `#top`, `#contact`; network `/run`, `/`; run `#claim`, `/contact`; spots `#plan`, `#ways`; syndication `#offer`, `#fits`.
- Built home (`pages/home.html`), all hrefs: `#top`×8, `#guide`×2, `#stations`, `#breaks`, `#public`, `/run`×5, `/syndication`×4, `/spots`×4, `/network`×4, `/contact`×4, plus Google Fonts.

---

### Home page

`build/build_home.py`:
- Reads `a.html` (= head.html), the 6 CSS files, `b.html` (= home/body.html) and `c.js` (= home/home.js). These are hardcoded `/tmp/...` and `/mnt/...` paths.
- Replaces `href="#run|syndication|spots|network|contact"` with `/route` across the whole body.
- No `is-cur`, title stays `Dial`, Lenis comes from the CDN script tag at `home/body.html:236`.
- Home does **not** include chrome/header.html or any chrome footer. It inlines an identical header (`body.html:8-36`, diff-verified) and its own footer.

#### Sections in order
- **Overlays** (`body.html:2-6`): `.room`, `#grain`, `#cur`, `#power` (power-on line), `#peek` (canvas 260×195, `.ch`, `.lb`).
- **`main#top`**

1. **`section.hero#hero`** (195svh; `.pin#pin` sticky)
   - Headline: "Anyone / can run / a channel." (3 `.ln` lines; `body.html:54`).
   - Paragraph: "A dial of 24/7 stations made by people near you: crate diggers, film clubs, family kitchens, city hall. Flip through what's on right now."
   - `.halo#halo`
   - `.screen#screen`: `canvas#pic`, `canvas#noise`, `.scan`, `.vig`, `.osd` (`#osdNum` 12.1, `#osdCs` BEAT, `.tun` "TUNING IN"), `#kbuf`. `aria-label`, `data-cur="Flip"`.
   - `.hui > .hrow`:
     - `.hero-copy#copy`: h1, p, `.acts` (Open the dial `#top` with a live chip `.js-ch`; ghost Run a station `#run`→`/run`)
     - `.lower#lower` (aria-live=polite): `.lt-tag` (`#lNum`, `#lCs`, "On air"); Now row (`#lProg`, `#lWho`, `#lLeft` "24 min left"); `.lt-row` (`#lStart`, `#lBar`, `#lEnd`); Next row (`#lNext`, `#lNextT`)
   - `.hint#hint`: "← → flip", "0–9 type a number", `button#snd` (aria-pressed, "Sound off").
   - `.dial#dial`: `#prev`, `.band#band` (`#segTv` "TV 2–69", `#segFm` "FM 88–108", `#needle`), `#next`.
   - `.wall#wall` ("Every station, live").
   - `.after#after`: `.dots#afterDots`, "The wall, live", `#afterB` "Nine stations on tonight", `a.af-r#afterGo` "See the full guide" `#guide`.
   - Not a sheet; no cells.
2. **`.crawl`** ("On now" tag, `.track#crawl`). Outside any section.
3. **`section.blk#guide`**, sheet:
   - `.cell.hd` `--d:7` (t 6, m 2): mh "01 The guide" / "● Live"; h2 **"No feed. Just what's on."**
   - `.cell.hd` `--d:5` (t 6): mh "How it works" / `#gClock`; lede "Every station keeps a schedule, so there's always something playing and you can see what's next. Nothing is picked for you."
   - `.cell` `--d:12`:
     - `.g-bar`: `.seg2` role=group "Show stations", buttons All 9 / TV 6 / Radio 3 (`data-f` all|tv|fm, literal counts); `.g-help` "Hover a station to peek. Select it to tune in."
     - `.guide > .g-in#gIn` (JS)
     - `.mf`: legend (On now / Coming up / Ended) + "Times in your time zone"
4. **`section.blk#stations`**, `.sheet#signs`:
   - `.cell.hd` `--d:7`: "02 Stations" / "9 on the dial" (literal); h2 **"Every number is somebody."**
   - `.cell.hd` `--d:5`: "Who's on" / "6 TV · 3 radio" (literal); lede "A station is a person or a group with a call sign, a number in their market and a schedule they built. Some are one person and a crate of records. One is a whole city council."
   - JS appends 9 `a.cell.stn` (`--d:4;--t:3;--m:1`): mh `.ch` (FM prefix for fm) + "On now"; `.cv` canvas + `.sr` call sign; `.mf.col` name/who, `.onn` programme + "until X" + `.pb`; `.key`.
   - Then `a.cell.stn-cta` (`--d:12;--t:3;--m:1`): "__.1" / "Open", h3 "Room on the dial.", p "Pick a number and a call sign. Free to start.", mf "Run a station", href `#run`.
5. **`section.brkw#breaks`** (380svh, aria-label "How a break works, played as you scroll"), `.brk-pin#brkPin` sticky, `--pc`. Sheet:
   - `.cell.bcap` `--d:5` (t 6):
     - mh "03 The break" / `#capPre` "A break on 12.1 BEAT"
     - h2#capH initial **"The breaks are part of the show."**
     - `#capP` "Scroll to play one. Every station builds its own: short, local, and paying the people who make the channel."
     - mf "Scroll to play" / `#tlT` "0:00 of 1:45"
   - `.cell.btv` `--d:7` (t 6): mh `#tlNow` "Late Crate" / "12.1 BEAT" (literal); `.brk-tv > canvas#brkC` (800×500 attrs, reset to 1280×800 in JS); `.mf.col` `#tl` + `#tlNames` (aria-hidden).
6. **`section.blk#doors`**, sheet:
   - `.cell.hd` `--d:7`: "04 Get on the dial" / "Four ways in"; h2 **"Make it. Carry it. Sponsor it."**
   - `.cell.hd` `--d:5`: "Who it's for"; lede "Everything on the dial is made, carried or paid for by someone nearby. Here's where each of them starts."
   - `a.cell.dr.big#run` `--d:6` (t 6), `--c:#F3EAD9`, data-peek 1:
     - "A For creators and groups" / "Free to start"
     - `.claim` "__.1 YOURS", `.rul#rul`
     - h3 "Run a station"; p "Get a call sign and a number, build a schedule, and air it around the clock."
     - mf "Claim a number"; href `/run`
   - `a.cell.dr#syndication` `--d:6`, `--c:#EBA03A`, peek 3: "B For stations and makers" / "Paid when it airs"; h3 "Syndication"; mf "Browse the market"; `/syndication`.
   - `a.cell.dr#spots` `--d:3;--t:3;--m:2`, `--c:#E0583A`, peek 2: "C For advertisers"; h3 "Spot market"; mf "Buy a spot"; `/spots`.
   - `a.cell.dr#network` `--d:3;--t:3;--m:2`, `--c:#5B7BE0`, peek 0: "D For everyone"; h3 "The network"; mf "How it's run"; `/network`.
7. **`section.blk#public`**, sheet:
   - `.cell` `--d:12`: "05 Public by design" / "Five promises"; `p.mani#mani` from data-text "Free to watch, every station *earns*, creators get *paid*, *rights* come first and the software stays *open*." There is no h2.
   - 5× `.cell.pf`:
     - Free to watch (`--c:#5B7BE0`, `--d:4;--t:2;--m:1`)
     - Earned by the station (#E0583A, 4/2/1)
     - Paid before joining (#C04A9E, 4/2/1)
     - Rights first (#2F9A72, `--d:6;--t:3;--m:1`)
     - Open source (#EBA03A, `--d:6;--t:3;--m:2`)
8. **`footer.signoff#contact`**: see Footers. Home h2 **"Turn it off whenever. We'll keep it on."**

No cell anywhere in home, header or footers has `--t > 6`. Max is 6 (the default); explicit values are 2 and 3.

#### Interactive pieces (home.js)

| Piece | Functions (home.js line) | States / timers / data |
|---|---|---|
| Grain | IIFE :12 | 180² noise dataURL; CSS anim .9s steps(6) |
| Power-on | IIFE :146 | rAF adds `.go`; `body.on` at 650 ms (reveals h1 lines); `#power` removed at 1500 ms; RM removes it immediately |
| Hero picture | `size` :97, `paintNoise` :99, `heroLoop` :101, IO on `#screen` :103 | Canvas fixed W=480, H by aspect; noise 200 wide. 33 ms throttle (~30 fps). Paused when the screen is off view (`heroVis`) or the tab is hidden. `t=0` under RM |
| Tuning | `tune(i)` :113-118 | Wraps index; `hiss()`; `mapWall()`. Adds `.changing` to screen + hero, noise opacity 1, `.roll` restart. OSD updated immediately. 380 ms later `fill()` and noise 0; +200 ms clears `.changing`. RM calls `fill()` directly |
| Now-playing fill | `fill()` :105 | Updates `#npCs`, `#npProg`, `--np`, lower third (`#lNum…#lNextT`), OSD, all `.js-ch`, the screen aria-label, `--st`; calls `place()`. `setInterval(fill,30000)` :106 |
| Clocks | `gClk` :107 | `#gClock` + `#mobClock` every 30000 ms |
| Sound | click :110, `hiss()` :111 | Toggles `aria-pressed` and "Sound on/off"; lazy AudioContext; 0.3 s highpass (900 Hz) noise burst at gain .12 on tune |
| Band | `pos(s)` :121 (TV `(n-2)/67`, FM `(n-88)/20`); build IIFE :122-126; `place()` :127 | Ticks: TV 2-69 (big every 10, labels at 2 and every 10); FM 88-108 (big and label every 4). `button.st-mark` per station (aria-label "Tune to n cs") calls `tune(i)`. **Writes `s.mark` onto the S objects.** `place()` moves `#needle` and toggles `.on` |
| Band drag | IIFE :129-134, `nearest(cx)` :130 | pointerdown (not on a mark) captures and tunes to the nearest mark; pointermove keeps tuning while down |
| Keyboard | listener :135-140 | Window-wide while `heroP <= .3` and hero bottom ≥ 200. ArrowRight/Up = next, ArrowLeft/Down = prev (`preventDefault`). Digits and `.` buffer into `#kbuf`; after 900 ms tunes to the nearest channel number. Ignored in inputs |
| Swipe | :141 (screen), :143 (pin, not on a/button/.band) | Horizontal swipe > 50 px and \|dx\| > 1.4\|dy\| → next/prev |
| Parallax | :148 | FINE and !RM: `--px = -x*18px`, `--py = -y*12px` |
| After caption | :145, `#afterGo` :350 | "Nine" only when S.length is 9; dots per station. Click scrolls with Lenis to `#guide`, offset -20, 1.2 s |
| Crawl | IIFE :151 | Built once from `slot()`: "n CS prog, until clock(end)", duplicated h+h; CSS 60 s loop (240 s under RM), pauses on hover. Never refreshed |
| Peek | `showPeek(s,label)` :155, `hidePeek` :156; drawn in `loop` :383-390 | FINE only. Follows the cursor (lerp .18) at +26/-90 px. Canvas 260×195 redrawn every 50 ms with `draw()`, not gated by RM |
| Guide | IIFE :159-169, `nowL` :166 | Window start `st = floor(m/30)*30 - 30`, span 210 min (7×30). Rows `div.g-row role=button tabindex=0` (data-i, data-b, aria-label, data-cur Tune) with badge, call sign, name. Programmes `.g-p` (`.now` with `.pb` %, `.past`). `#gNow` line + label moved every 20000 ms and on resize. Row click/Enter/Space → `tune(i)` + `scrollToTop()`; hover → `showPeek`. `.seg2` filter sets `row.hidden`. The grid is rendered once at load |
| Station cells | build :172-179, CTA :180-182, `sizeSigns` :185, `paintSign` :186, `paintAll` :187-188, IO :189-190 | The call sign is drawn as a mask (900 weight Big Shoulders, fit to width); the scene is drawn into a 240-wide offscreen canvas and composited `source-atop` at .62. Initial still at `t = k*5+2` after `fonts.ready`; resize repaints. Animated (50 ms) only when `o.hot`: mouseenter on FINE, or on touch an IO with rootMargin -42% that also toggles `.lit`. Click → `tune(i)` + `scrollToTop()`. DPR capped at 2 |
| Ruler (Run door) | IIFE :183-184 | TV stations as `.mk` at `(n-2)/67`, "You?" at 44, labels 2/69 |
| Break | PARTS :193-200, TOT :201, tl build :202, setup :203-218, `brkFrame` :305, loop `bl` :308, `brkAt(p)` :310-314, `mmss` :309 | Scrubbed by scroll progress through `#breaks` (in `onScroll`). Canvas 1280×800 with `setTransform(1.6)` onto an 800×500 logical size. Loop redraws the current part every 40 ms when visible, not hidden and not RM. `brkAt` updates the `#tl` segment fills, `#tlNames .on`, `#tlT`, and on part change `--pc`, `#capPre`, `#capH`, `#capP`, `#tlNow` |
| Break part renderers | `fProgram` :221, `fBumper` :229, `fJuniper` :240 (`pole` :236, `chair` :237, `qr` :238), `fRedlands` :264 (BOX :263), `fMembers` :286 (MEM :285, 30 names), `fStationID` :297 | Helpers: `bf`, `tx`, `rc`, `rr`, `ez`, `sg`, `lg`, `flash`, `hsh`, `bug`, `sup`, `shade`, `push` (:206-218). Hardcoded to `B=S[1]` (BEAT) plus literals "12.1", "BEAT", "LATE CRATE", "Marisol", "Pomona" |
| Manifesto | IIFE :317, `mWords` :318, lit in `onScroll` :373 | Splits words; `*word*` gets `.hot`. Lit count = `round(clamp((vh*.85-top)/(height+vh*.3)) * n)`; RM lights all |
| Doors peek | :321 | `[data-peek]` mouseenter → `showPeek(S[idx], h3 text)` |
| Sign-off | :324-325 | IO threshold .3 draws `#offC` once (`draw(...,3,S[cur])`) and adds `#contact.go` (CSS shut animation 1.2 s, dot pulse, wordmark clip reveal 1.8 s) |
| Wall | tiles IIFE :330-333, `mapWall` :334, `layoutWall` :337, `wallAt(e)` :344, `paintWall` :347, loop `wl` :348 | 9 tiles in a 3×3 grid. Tile 4 is `div.me` ("Watching", current station, no canvas); the other 8 are buttons (other stations in S order) that call `tune(o.s)`. Layout: `narrow = vw<700`, gap 8/14, top 84/100, caption 150/156, tile aspect .625 (desktop) or 1.3 (phone), canvas width 120/180. Fade-in staggered by Manhattan distance; `.up` and pointer-events when e > .85. Repaint every 110 ms when `wallE ≥ .3`, hero visible, !RM. `mapWall` every 30000 ms :376 |
| Scroll choreography | `onScroll` :356-374, Lenis :375, init :376-379 | `nav.solid` > 40. Hero: `heroP` = progress, `e = ease(clamp(heroP*1.15))` (0 under RM). Clip-path inset shrinks the screen onto the centre tile; `#pic`/`#noise` translate and scale; `wallAt(e)`. Copy/lower/hint/dial fade (`1-heroP*2.8`) and translateY(`-heroP*80`). Halo inset + opacity; after caption opacity `(e-.82)*6`; vignette `1-e*.85`. Break scrub; manifesto |
| `#top` links | `scrollToTop` :354, :355 | All `a[href="#top"]` except `.stn` → Lenis `scrollTo(0, 1.4 s)`. There is **no** generic in-page anchor handler on Home |
| Cursor / menu | :393-397, :400-402 | Same as common_tail |
| Nav indicator / tuner flip | inline header script | 3400 ms flip (see Shared JS) |

#### Duplication with shared_data.js / scenes.js
- `home.js:15-27` (S, `slot`, `clock`) is **byte-identical** to `shared_data.js:2-14` (diff-verified). No field or value differences.
- `home.js:30-92` (`hexA`, SC, `draw`) is **byte-identical** to `scenes.js` (diff-verified). `run/run.js:25-87` is a third identical copy.
- Also duplicated in home.js (logic, not data):
  - `:3-12` (BRAND, RM, FINE, `$`, clamp, grain) = `common_head.js:3-9`
  - `:393-402` (cursor, menu) = `common_tail.js:9-17`
- Behaviour that differs from common_head/tail:
  - home `fill()` also sets `--st`, the lower third, OSD, aria-label and `place()`, and follows the tuned `cur`. common_head pins `cur=1` and sets only `--np` and the nav.
  - home updates `#mobClock`; common does not.
  - home sign-off IO threshold is .3 and draws `#offC`; common_tail uses .2.
  - home has no anchor handler with the -70 nav offset (only `#top` and `#afterGo`, offset -20).
  - home builds Lenis inside `onScroll` wiring; common_tail builds it separately.
- Home-only code that belongs in the shared module: `ease()` :9 and the mutation `s.mark = b` :125.

#### CTAs and links (built hrefs)
- Brand → `#top` (scrollToTop). Rail → `/run`, `/syndication`, `/spots`, `/network`, `/contact`. Tuner `.np` "Watch" → `#top`.
- Mob: Watch `#top`, `/run`, `/syndication`, `/spots`, `/network`, `/contact`.
- Hero: "Open the dial" `#top`; "Run a station" `/run`. After caption: "See the full guide" `#guide`.
- Guide rows (role=button): tune + scroll to top. Station cells: `href="#top"`, JS tune + scroll to top. Wall tiles: buttons, tune.
- Stations CTA "Run a station": `#run` (JS-generated, `home.js:180`, **not rewritten** by the build, so it jumps to the door cell `#run` on the same page).
- Doors: "Claim a number" `/run`, "Browse the market" `/syndication`, "Buy a spot" `/spots`, "How it's run" `/network`.
- Footer: "Open the dial" `#top`, "Contact us" `/contact`; Watch: `#top`, `#guide`, `#stations`; Make: `/run`, `/syndication`; Advertise: `/spots`, `#breaks`; The network: About `/network`, How it's run `#public`, Contact `/contact`.

---

### Problems

#### Build / structure
- `build/build_home.py:1-8`: hardcoded `/tmp/claude-0/...` and `/mnt/user-data/...` paths; inputs are named `a.html`/`b.html`/`c.js`. Not runnable as-is.
- The Home `<title>` is "Dial" (`shared/head.html:1`, never replaced by build_home); SITE-SPEC §1 says "Dial: Anyone can run a channel". No meta description, favicons, manifest or OG tags on any page.
- Home inlines its own copy of the header (`home/body.html:2-36`) and footer instead of the chrome parts. Its footer's first row (`--d:8` + `--d:4`) is a different shape from the other four (`--d:7;--t:6` + `--d:5;--t:6`).
- Footer component CSS lives in page CSS (`.claimc`/`.pick` in run.css:202-248, `.stps` in synd.css), so the shared footer can't be built from shared CSS alone.
- The mob menu never marks the current page (build_run.py:16 strips the class); only the desktop rail gets `is-cur`/`aria-current`.
- The JS-generated stations CTA `a.href='#run'` (`home.js:180`) misses the build rewrite: on Home it jumps to the door cell `#run`, not `/run`.
- The door cells reuse route names as ids (`#run`, `#syndication`, `#spots`, `#network`; `body.html:166-185`). Harmless after the rewrite but confusing; `/#run` resolves to the door.
- Home has no generic anchor handler (common_tail.js:5 has one, with offset -70). The footer `#guide`/`#stations`/`#breaks`/`#public` links use a native jump, so the 68px fixed nav covers the target.
- `common_head.js:14`: other pages never update `#mobClock` (stays "3:22 pm") and always show BEAT (`cur=1`).
- The guide is rendered once (`home.js:159-165`); only the now-line moves (`:166`). After about 30 minutes the past/now classes and window are stale; there is no re-render or interval.
- The crawl (`home.js:151`) is built once and never refreshed.
- Midnight: the guide indexes programmes by `floor(x/len)` across the 1440 boundary (`home.js:162`) while `slot()` resets at midnight (`shared_data.js:13`). Titles disagree around midnight (e.g. len 90: guide `p[16%3]=p[1]`, slot `p[0]`).
- `#lLeft` shows "95 min left" style values up to 180 (`home.js:105`). Fine, but never in hours.

#### Data / literals (spec §5 wants no literals)
- Hardcoded counts: `body.html:105` (All 9 / TV 6 / Radio 3), `:123` "9 on the dial", `:127` "6 TV · 3 radio", `header.html:34` "9 stations on now", `home.js:145` "Nine" only for 9, `body.html:159` "Four ways in".
- The break is hardwired to `B=S[1]` plus literals "12.1"/"BEAT" (`home.js:193`, `:215`, `:233`, `:291`, `:294`, `:300` target `12.1`, `:302`, `:313`; `body.html:140`, `:145`).
- The guide legend swatch hardcodes BEAT pink (`grid.css:49`).
- `home.js:125` mutates the station objects (`s.mark = <button>`). A shared module must not carry DOM refs.
- `OCAT` call sign (`shared_data.js:8`, `home.js:21`) looks like an "Opencast" leftover ("Opencast catalog"). No literal "Opencast" appears in any copy (only `SITE-SPEC.md:3`).
- Spec vs CSS:
  - SITE-SPEC §3 Night is `#140F24`, but the token `--night` is `#0E0A1C` (`head.html:11`). `#140F24` appears only as literals (`polish.css:5,9,70`; `nav.css:95,109`).
  - The spec lists 6 station colours; the data has 9 (OCAT #9A9CAB, FLDR #C9709A, VOZE #EBA03A also used as the door/pf orange).
- SITE-SPEC §1 describes `public` as "(public institutions)". The reference section is "Public by design / Five promises", a manifesto with no h2.
- `--r-key` is set twice (`polish.css:2` 14px, `shape.css:6` 999px). `--pct` (`head.html:179`) and `--h` (`.sg`) are dead.

#### CSS collisions / dead code
- `.tl` is used for both the hero tick labels (`.tick.tl`, `home.js:123-124`) and the break timeline (`head.html:222`, `polish.css:123`). The tick labels inherit `display:flex; margin-top:24px`, so they are pushed down by 24px. Accidental.
- `.big` (`.tick.big`, `.cur.big`, `.dr.big`), `.on` (`body.on` drives `.on .hero-copy h1`, also `.st-mark.on`, `.seg2 .on`, `.nl-ind.on`, `.hb.on`, `.tl-names .on`), `.go` (`.signoff.go`, `.power.go`, `.sg .go`, `.door .go`), `.lit`, `.air` (`head.html:100` vs `.mh .air` vs `.stn .mh .air` reset at `grid.css:177`), `.dot`, `.num`, `.cv`, `.ch`, `.mk` (`.brand .mk` vs `.rul .mk`), `.seg` vs `.seg2`, `.off`, `.who`, `.band`, `.tick`: all generic names reused across components (spec §8).
- `.mob a{font:900 56px}` (`head.html:64`) also hits the brand link in `.mob-h`; it is patched by `nav.css:73`.
- `.np` is defined three times (`nav.css:16`, `shape.css:47`, `nav.css:93` with `!important`).
- Dead CSS families (markup no longer uses them):
  - `.nav ul`, `.brand .mk`, `.nav > .btn`, `.btn .dot`, `.btn::before`
  - `.lower .top/.num/.cs/.prog/.who/.bar/.next`, `.lt-next`
  - `.head`, `.sec`, `.sh`, `.ch-tag`
  - `.signs`/`.sg*` (home.js:173 sets `className='sg'` then overwrites it on :174)
  - `.cap*`, `.door*`/`.doors`/`.dt`, `.facts`/`.fact`, `.cols`, `.off`
  - `.np-tv/-t/-k` (`nav.css:17-31`), `.np-b/-ch/-go` (`shape.css:50-68`)
  - `.nl` v1 underline
  - The legacy hero absolute positions under `.hero-copy`/`.lower`/`.hint`/`.dial` (all overridden by `.hui`)
- `nav.css:124`: the `.tnb-lcd{width:96px}` rule at ≤360 is dead (overridden by the later 374/420 rules). `.nl2 a:focus-visible{outline:none}` (`nav.css:88`) leaves focus visible only through the JS indicator.
- Mixed breakpoint systems: 1060/600/720 (head, polish) vs 1099/699 (grid, flat, nav, lt). Between 1061 and 1099 the old 1060 rules (e.g. `.sh`, `.g-help`, `.cols`) don't apply but the tablet grid does.
- `[hidden]`: OK in practice. `.mob[hidden]` (`head.html:63`) beats `.mob{display:flex}` (`nav.css:56`); `.g-row[hidden]` (`polish.css:80`) beats `.g-row{display:grid}`. There is no global `[hidden]{display:none!important}`.
- `.sheet{clip-path:inset(-1px 1px -1px 0)}` (`flat.css:46`) clips focus outlines (offset 3px) on edge cells.

#### External dependencies
- Google Fonts: `head.html:2-4`.
- Lenis CDN `lenis@1.1.13`: `body.html:236` (and in every built page).
- Canvas text relies on the webfonts being loaded (`home.js:185`, `:205`); it waits for `document.fonts.ready` (`:188`, `:378`).

#### Reduced motion gaps (spec: scenes draw one still frame, tickers don't rotate)
- `heroLoop` (`home.js:101`) keeps redrawing under RM at t=0, and the `reel`/`matinee` scenes use `Math.random` per frame (`scenes.js:15-17`, `:41`, `:45-46`), so they still flicker.
- The peek redraws at 50 ms under RM (`home.js:388`).
- The crawl still moves under RM (240 s; `head.html:315`).

#### Canvas sizing (spec §8: DPR-sized, capped at 2)
- Only the station cells comply (`home.js:185`). The rest are fixed:
  - hero 480 wide (:97), noise 200
  - wall tiles 180/120 (:341)
  - peek 260×195 (`body.html:6`)
  - `#offC` 320×240 (`body.html:225`)
  - `#brkC` 1280×800 (`home.js:204`)
- The rAF loops keep running and only early-return (`home.js:101`, `:308`, `:348`, `:383`). The cursor rAF (`:395`) never checks visibility.

#### No-JS / robustness
- `#power` (`head.html:136`) is a fixed black z-90 overlay removed only by JS. With JS off the page is black (except under RM, which hides it through CSS at :313).
- The hero h1 lines stay at `translateY(105%)` until JS adds `body.on` (`head.html:89-90`).

#### Accessibility
- **Keyboard:**
  - `home.js:136-138`: ArrowUp/ArrowDown are `preventDefault`ed window-wide while the hero is in view, so keyboard users can't scroll at the top of the page. Digit keys anywhere also tune.
  - `#screen` (`body.html:43`) is a `div` with an `aria-label` but no role and no tabindex (the label is ignored). Its `data-cur="Flip"` promises a click action that doesn't exist; only swipe and keys work.
  - The wall tiles (`home.js:330`), `#afterGo`, and the faded `.hint`/`.dial` controls stay in the tab order while invisible (opacity 0; only pointer-events are disabled; `home.js:344-345`, `:366-368`).
  - The guide rows are `div role="button" tabindex="0"` (`home.js:161`): the controls are divs. The guide has no table or grid semantics.
  - `.seg2` filter buttons have no `aria-pressed` (`body.html:105`, `home.js:168`).
  - The phone menu (`header.html:24`) isn't a dialog: no focus move, trap or return, no Esc, the page still scrolls underneath. The nav indicator has no blur handler (it stays on the last focused link).
  - No skip-to-content link.
- **Screen readers:**
  - `#lower aria-live="polite"` (`body.html:59`) is rewritten every 30 s by `fill()` (`#lLeft` "N min left"), so it announces on every refresh.
  - `.crawl` (`body.html:89`) and `#wall` (`:84`) put `aria-label` on role-less divs, which is ignored. The crawl content is duplicated (h+h, `home.js:151`) and read twice.
  - `#mani` gets `aria-label` on a `<p>` (`home.js:317`); that is prohibited on a generic/paragraph role.
  - Canvases are all `aria-hidden`. Text equivalents: the hero has the lower third; station cells have `.sr` call signs; the break has its caption. The break timeline `#tl`/`#tlNames` is aria-hidden, so the part names are lost to screen readers except through `#capH`.
  - Station cells (`home.js:175`) and guide rows use `aria-label`, which hides the programme/"until" text inside them.
- **Motion:** auto-moving content with no pause control (the crawl, the 3.4 s tuner flip, the grain, blinking `.claim .cn`, `.mk.you`, `.tile.me .tw`). Only the crawl pauses, and only on hover (WCAG 2.2.2).
- **Pointer:** the custom cursor sets `cursor:none` on the body and on links/buttons (`head.html:43`).
- **Copy:** `afterB` always says "tonight" (`home.js:145`).

#### Design rules (SITE-SPEC §3) not enforced by the reference CSS
- "Buttons in a row are equal width": hero `.acts` and sign-off `.acts` are not equal width on desktop (`head.html:94`, `grid.css:113`).
- Labels square at 2px or less: `.hint kbd` is 3px (`shape.css:23`); the dead `.sg .go`/`.door .go` are 14px (`polish.css:115`).
- The header uses inline SVGs (`header.html:8`, `:25`) instead of the `brand/` files. Spec §4 says to use `dial-wordmark.svg` and the 48 drawing at 32px.
- `--t > 6`: **none found** in home, header, or any footer.

---

## Inventory: Run + Syndication references

Root: `docs/reference/site/`. Paths below are relative to `source/` unless prefixed `pages/`.
Line refs: `run/body.py`, `syndication/body.py` (I regenerated both `body.html` in scratch with `python3 -I`; **both byte-identical to the committed `body.html`**, so body.py lines are authoritative), `run/run.js`, `syndication/synd.js`, `chrome/footer-*.html`, CSS files.

Build notes (`build/build_run.py`, `build_synd.py`):
- Paths are stale sandbox paths (`/tmp/claude-0/...`, `chrome_head.html`, `foot.html`, `a.html`): the scripts can't run as-is. `chrome_head.html` = `chrome/header.html`, `foot.html` = `chrome/footer-run.html` / `footer-syndication.html`, `a.html` = `shared/head.html`.
- Run: CSS = head + polish, grid, flat, nav, shape, lt + run.css. JS = `run/run.js` alone, with `shared_data.js` at `/*DATA*/` (build_run.py:22). run.js **duplicates** common_head (run.js:1-15), common_tail (run.js:206-224) and scenes.js (run.js:25-87, identical to shared/scenes.js:1-63).
- Synd: CSS = same + run.css + synd.css. JS = common_head (+data) + synd.js (scenes.js at `/*SCENES*/`) + common_tail (build_synd.py:22).
- Both rewrite nav/footer anchors to routes (build_*.py:7-21). Footer `#contact`→`/contact` only for the link text "Contact" (the footer element keeps `id="contact"`).
- Grid defaults (shared/grid.css:14-16): a cell with no `--t` spans 6 on tablet, no `--m` spans 2 on phone.

---

### Run (`/run`)

`body{--st:#C04A9E}` (run.css:4). Header mh helper `mh(label, meta, ix)` (body.py:3).

#### Sections, in order

**`hero`** (body.py:11-73), class `blk rhero`. mh "Run a station" / "For operators".
- H1 "Run it like a station." + dim "Not a loop." (body.py:16)
- cells: `.cell.hd.rh` --d:7 (no --t/--m); `.cell.chainc` --d:5 (mh "Signal chain" / live "12.1 BEAT, live"; mf "Five destinations. One signal." + `#chClock`); 4 × `.cell.st4` --d:3 --t:3 --m:1: "Free" / "0 GPUs" / "Every platform" / "Paid breaks" (body.py:68-71).
- hero mf: "Being on air is free. You pay for storage, relays and live hours." (body.py:20)

**`who`** (body.py:76-93). H2 "Built for the people / already doing it."
- `.cell.hd` --d:7 (mh 01 "Who it's for" / "Three kinds of operator"); `.cell.hd` --d:5 (mh "Why they switch").
- 3 × `a.cell.aud` --d:4 --t:6 (no --m) from `aud`.

**`control`** (body.py:96-142). H2 "Master control. / The whole station, one screen."
- hd --d:7 (mh 02 "Master control" / "Eight parts"), hd --d:5 (mh "What you run").
- `.cell.ft.big` --d:8 --t:6 (A Schedule, "This week on 12.1"; row-span 2 at ≥1100, run.css:57)
- `.cell.ft` --d:4 --t:3: B Breaks, C Library at home, D Prepare, E Relays, F Live
- `.cell.ft` --d:6 --t:3: G Series slots
- `.cell.ft` --d:6 --t:6: H Feeds
- Desktop rows: 8(big)+4 / big+4 / 4+4+4 / 6+6. Tablet: 6 / 3+3 / 3+3 / 3+3 / 6. OK.

**`switch`** (body.py:145-170). H2 "Already running / a 24/7 stream?"
- hd --d:7 (03 "Switching" / "From loop tools"), hd --d:5 ("The short version"), `.cell` --d:12 comparison table (mh "One channel, side by side" + `.swp` "Swipe to compare →" (phone) / `.mo` "Monthly"), mf competitor-source note.
- 5 × `.cell.stp`: --d 4,4,4,6,6 · --t 3,3,3,3,6 · --m 2 (body.py:169).

**`pricing`** (body.py:173-210). H2 "On air is free." + dim "You pay for what it costs."
- hd --d:7 (04 "Pricing" / "Pay as you go"), hd --d:5 ("How it works").
- `.cell` rate card --d:5 --t:6 (mh "Rate card" / "USD"; `.cb.rc`; mf "Launch prices…").
- `.cell.calc` --d:7 --t:6 (mh "Estimate your month" / "Drag to try").
- 4 × `.cell.bl` --d:3 --t:3 --m:1 (bill).

**`earn`** (body.py:213-259). H2 "A station can / pay for itself."
- hd --d:7 (05 "Earnings and ownership" / "Where the money goes"), hd --d:5 ("The short version").
- 4 × `a.cell.ern` --d:3 --t:3 --m:2.
- `.cell.pay#pay` --d:12 (mh "Does it cover your costs?" / "Drag to try").
- `.cell` --d:12 share table (mh "Who gets what" / "Per dollar earned, by source").
- 4 × `.cell.own` --d:3 --t:3 --m:2.

**`faq`** (body.py:269-272). H2 "Questions / operators ask."
- `.cell.hd` --d:5 --t:6 (06 "Questions"), `.cell.faq` --d:7 --t:6 (mh "Before you switch" / "7 answers").

**Footer `#contact`** (chrome/footer-run.html). `.cell.claimc#claim` --d:7 --t:6 (07 "Claim a number" / "TV 2 to 69, FM 88 to 108"; H2 "Pick a number. / Go on air tonight."), `.cell.pickc` --d:5 --t:6 (mh "Open numbers near you" / "Inland Empire"), 4 × `nav.cell.lk` --d:3 --t:3 --m:1, `.cell.wd` --d:12, `.cell` --d:12 foot ("© 2026 Dial." / "Stations, programs and people on this page are examples.").

**No `--t` > 6 anywhere on Run.**

#### Interactive pieces

| Piece | Driver | Inputs / states / timers / data |
|---|---|---|
| Nav tuner fill | `fill()` run.js:13-15 | `S[cur=1]` (BEAT). Sets `.js-ch`, `#npCs`, `#npProg` (slot().prog), `--np`, **and `#chClock`** (hero mf). `setInterval(fill,30000)`. |
| Relay uptime counters | `tick()` run.js:18-22 | `[data-up]` → `hms(up+elapsed)`; `[data-restart]` → countdown `R-(el%R)`, prefixed "↻ ", leading "0:" stripped, adds `.warn`. 1000 ms. Data: body.py:59-61 (`171230`, `2892`, `91210`). |
| Signal chain / control-room monitor | IIFE run.js:89-128 | 5 stages `STG` run.js:92-97 `{c,t,p,s,d}` with durations 2.6/2.6/2.4/3/4.2 s. `setStage(i)` 104-107 sets `pgm[data-s]`, `--s`, `.is-air` (i===4), step `.on/.done/aria-selected`, caption `#mcT/#mcP/#mcS`; stage 0 rotates `FILES` (98, 6 items) into `#olL` via `lib()` (103: 5 rows, first "Sending", next "Sent", rest "At home"); stage 1 rotates `PREP` (99) into `#opT`. Click a step → `hold=now+6000` (108). `frame()` 116-124: rAF throttled to ≥40 ms; paused when `!vis` (IntersectionObserver 115) or `document.hidden`; progress bar `u` width; stage 0 upload bar `--p=min(100,p*130)%`; stage 1 wipe `--w=12+76*(.5-.5cos(pπ))%`; stage 2 `#osN.left=30+25p %`; stage 3 picks `BRK` (100) segment `floor(p*5)` → `#obN/#obT`; draws `SC.crate` for `S[1]` onto fixed 480×270 canvas; timecode `#pgmTc` HH:MM:SS:FF (30 fps, 114). Auto-advance when p≥1 and past hold. Fan SVG `layout()` 110-113 (bezier from monitor to each `.so`, on resize + fonts.ready). RM: `setStage(4)`, one still frame, no rAF (127). |
| Schedule viz (`#sch`) | IIFE run.js:131-145 | Window `W0=18`,`W1=26` (6 pm–2 am). `P` programmes (132, 7 keys `[name,color]`), `G` per-day blocks (133-134, `[start,end,key,'lv'?]` or `'off'`). Today = `(getDay()+6)%7`. Red `.now` line in today's row; `pos()` every 30000 ms; outside the window it is parked at 46% (144). |
| Copy buttons `.cp` | run.js:148 | `data-copy` → clipboard; text "Copied" + `.ok` for 1600 ms. |
| Usage estimator | `calc()` run.js:169-174 | see Calculators. Listeners 190-192; relay seg `.rm button` (`data-r` 0/1/2) sets global `rm`. Calls `vs(lib,tot)`, sets `BILL=tot`, calls `pay()`. |
| Competitor compare (`#vs`) | `vs()` run.js:180-189 | `COMP` 176-179. Per competitor: cheapest tier with `lib<=GB`; else "Won't fit". rm===0 → note "Dial only. Loop tools only push to platforms…" and empty `#vsR` (`.vs-r:empty{display:none}` run.css:166). |
| Pay calculator | `pay()` run.js:152-160 | see Calculators. Listeners 161. |
| Number picker + call sign (footer) | IIFE run.js:196-204 | `nums` (12), `taken` {16.1,31.1,41.1} → disabled + `aria-label "N is taken"`, default `sel='44.1'`. Click → `.on`, rewrites every `.btn .live` chip to `<i></i>`+sel. `upd()`: uppercase, strip non-A–Z, `slice(0,4)`; <4 → "Four letters. N to go."; in `used` (all `S[].cs`) → "XXXX is taken on the network. Try another."; else "XXXX on 44.1 is free. Claim it." + `.ok`. |
| FAQ | native `<details>` body.py:272; CSS run.css:189-199 | 7 items. |
| Nav/menu, Lenis, anchors, cursor, footer reveal | run.js:207-223 (copy of common_tail) | Lenis `lerp .1`; anchor offset −70, 1.2 s; `.solid` nav at scrollY>40; footer `.go` at 20% visible. |

#### Calculators (exact)

**Constants** run.js:164: `PRICE={gb:.04, freeGb:10, relayHr:.05, relayCap:25, liveHr:.75, freeLive:5, hours:720}`; `rm=2` (165); `LIB=[25,50,75,100,150,200,300,500,750,1000,1500,2000,3000,5000]` (167).

**`calc()`** (run.js:169-174):
```
lib = LIB[+cLib.value]; gb = +cGb.value; lv = +cLive.value
if (gb > lib) gb = lib                      // display only; slider not moved
st  = max(0, gb - 10) * 0.04
rl  = rm===2 ? min(25, 720 * 0.05) : 0      // always 25 when Everything (36 > 25)
li  = max(0, lv - 5) * 0.75
tot = st + rl + li
oRl text: rm===2 → money(rl); rm===1 → 'Free'; rm===0 → '$0.00'
money(v) = '$' + v.toFixed(2)
size(g) = g>=1000 ? (g/1000).toFixed(g%1000?1:0)+' TB' : g+' GB'
slider fill --p = (value-min)/(max-min)*100 %
```
Inputs (body.py:190-193): `cLib` range 0–13 step 1 **value 7** (=500 GB); `cGb` 0–300 step 5 **value 40**; relays seg default **Everything** (`data-r=2`); `cLive` 0–200 step 1 **value 10**.

Default by hand: st = 30×0.04 = **$1.20**; rl = **$25.00**; li = 5×0.75 = **$3.75**; tot = **$29.95** → confirms spec §5. (Markup placeholders say $2.00 / $14.60 / $2.00 / $18.60, body.py:195-198: stale.)
Default `vs(500, 29.95)`: note "Their plans have to hold your whole 500 GB library, at 1080p." Livepush "Won't fit · Largest published plan holds 100 GB · 400 GB over"; Upstream same (100 GB, 400 GB over; its `note` is dropped in this branch); Gyre "Won't fit · …150 GB · 350 GB over". When it fits: `$price`, plan "Tier, N GB" (+ " · note"), and `price>tot` → `<em class="dn">$X more than here</em>` (green) else `<em class="up">$X less than here</em>` (orange).
Range of output: max = (300−10)×0.04 + 25 + 195×0.75 = $182.85.

**`pay()`** (run.js:152-160):
```
tun=+pTun, mn=+pMin, pl=+pPl
sp   = mn * 4 * 720 * tun * 8 / 1000 * 0.9     // 4 = 15-s units per minute, $8 CPM per unit, ×0.9
po   = pl * 0.95
earn = sp + po;  cost = BILL (= calc tot);  left = max(0, earn - cost)
vMin: mn===0 → 'None'; mn<1 → round(mn*60)+' sec'; else (mn%1 ? mn.toFixed(2).replace(/0$/,'') : mn)+' min'
vTun: tun.toLocaleString('en-US'); vPl: '$'+pl.toLocaleString('en-US')
pSp=money(sp); pPlO=money(po); pCost='−'+money(min(cost,earn)); pCostN=money(cost); pLeft=money(left)
verdict: cost<=0 → 'Your month costs nothing to run'
         earn>=cost: x=earn/cost; x>=2 → 'Covers your month '+(x>=10 ? round(x) : x.toFixed(1) minus trailing '.0')+'× over'
                                 else 'Covers your month, with some left'
         else 'Covers '+round(earn/cost*100)+'% of your month'
bar: tot=max(earn,cost)||1; #pbC flexGrow=min(cost,earn)/tot; #pbL flexGrow=left/tot; parent --gap=max(0,cost-earn)/tot
```
Inputs (body.py:226-228): `pTun` 1–500 step 1 **value 10**; `pMin` 0–3 step .25 **value .5**; `pPl` 0–1000 step 10 **value 50**.
Default by hand: sp = 0.5×4×720×10×8/1000×0.9 = **$103.68**; po = **$47.50**; earn = 151.18; cost = 29.95; left = **$121.23**; x = 5.0477 → "5.0" → **"Covers your month 5× over"** → confirms spec. Labels: "10", "30 sec", "$50"; pCost "−$29.95"; pCostN "$29.95". (Markup placeholders "$0" / "$18.60" / "Covers your month", body.py:229-235: stale.)

#### CTAs / links → §6

| CTA | href / handler | §6 row |
|---|---|---|
| Nav tuner "Watch" pill | `a.np href="/"` (build_run.py:17) | Open the dial / Watch |
| Hero "Claim a number" (chip `__.1`) | `#claim` (body.py:18) | Claim a number (Run hero) |
| Hero "See pricing" | `#pricing` | in-page anchor |
| Who cards A/B/C "See the switch" / "See master control" / "See how it pays" | `#switch` / `#control` / `#earn` (body.py:81-85) | in-page anchor |
| Earn cards Spots / Syndication / Members / Backfill | `/spots`, `/syndication`, `/network`, `/spots` (body.py:221) | cross-page (not in §6; treat as plain links) |
| Feed "Copy" ×2 | `.cp` clipboard handler (run.js:148) | none (in-page action) |
| Footer "Claim a number" | `#claim` (footer-run.html:9) = scrolls to itself; no action | Claim a number (Run footer, prefilled number + call sign) |
| Footer "Talk to a person" | `/contact` | Talk to a person |
| Footer nav | `/`, `/#guide`, `/#stations`, `/run`, `/syndication`, `/spots`, `/#breaks`, `/network`, `/#public`, `/contact` | Open the dial; others plain links (§8 home anchors) |

#### Data arrays (run/body.py unless noted)

- `aud` body.py:79-86, 3 × `(letter, color, title, sub, tag, points[3], href, cta)`
- comparison `rows` body.py:145-154, 8 × `(feature, dial, livepush, upstream, gyre)` (HTML strings)
- switch `steps` body.py:163-167, 5 × `(h, p)`
- `rate` body.py:176-182, 7 × `(name, desc, price, freeNote)`
- `bill` body.py:204-207, 4 × `(h, p)`
- `earn` body.py:216-219, 4 × `(color, h, p, linkLabel)` (linkLabel → route map body.py:221)
- `shr` body.py:242-246, 5 × `(source, weKeep, stationKeeps, [(platform, theyKeep)])`
- `own` body.py:253-256, 4 × `(color, kicker, h, p)`
- `faq` body.py:262-268, 7 × `(q, a)`
- JS: `STG` run.js:92-97 (5), `FILES` 98 (6 `[name,size]`), `PREP` 99 (3), `BRK` 100 (5 `[label,dur]`), schedule `P` 132 (7) + `G` 133-134 (7 days), `COMP` 176-179 (3 `{n,tiers[[GB,$,name]],note?}`), `LIB` 167 (14), picker `nums` 196 (12) + `taken` (3)
- Static markup lists: hero outputs (body.py:58-62, 5), breaks bar (108-109), prep list (119, 4), relay list (124, 4), episodes (134, 5), feeds (139, 2)

---

### Syndication (`/syndication`)

`body{--st:#EBA03A}` (synd.css:5).

#### Sections, in order

**`hero`** (body.py:11-36), class `blk rhero sx-hero` (gets run.css `.rhero` padding).
- `.cell.hd.sx-top` --d:12: mh "Syndication market" / "For makers and stations"; H1 `.sy-h` "Make it once." + dim "Air it everywhere." (body.py:16); lede; acts.
- `.cell.sx-map#wire` --d:12: mh with deals ticker ("On the wire" + `#dlV`, `aria-live="off"`) + live "Live"; `#sxViz` network map (canvas `#sxLines`, hub screen `#wPic` 320×180 "18.1" "Source", hub text "From 18.1 SAZN, a family kitchen in Fontana" / "Tamales for forty" / "26 episodes of 30 min"); `.w-foot.sx-foot`: Paid to SAZN `#wPaid` $412.50 · Airings `#wAir` 121 · Stations 8 · Markets 5; mf "An example week…".

**`offer`** (body.py:39-51). H2 "Two sides. / One handshake."
- hd --d:7 (01 "How it works" / "Makers and carriers"), hd --d:5 ("The short version").
- 2 × `.cell.side` --d:6 (no --t/--m): A "You make shows" / "Offer it"; B "You run a station" / "Carry it". Each `a.mf.go`.

**`fits`** (body.py:54-81). H2 "Got an open hour? / Here's what fits it."
- hd --d:7 (02 "The market" / "Built for the gap"), hd --d:5 ("Why it starts from the schedule").
- `.cell.fit` --d:12 (mh "Browse" / "Search, filter, sort"): `.f-bar2` (search `#fQ`, 4 dropdowns `.f-dd[data-k=slot|len|terms|sort]`, mobile `#fMob` "Filters" + count `#fN`), `#fList` (`aria-live="polite"`), mf `#fCount` + "Examples. The real market shows your market's offers first.", phone sheet `#fSheet` (dialog `aria-modal`, 4 `.seg2` groups, `#fClear`, `#fDone` with `#fShowN`).

**`terms`** (body.py:84-124). H2 "Three ways / to make a deal."
- hd --d:7 (03 "Terms" / "Set by the maker"), hd --d:5 ("How carriage is paid").
- 3 × `.cell.trm` --d:4 --t:2 --m:2 (Revenue share / Cash / Free).
- `.cell.rsc#earn` --d:12 earnings calculator (mh "What a show earns across the network" / `.rs-k` "Monthly, every carrier added up"; `#rMode` seg; mf "No channel to grow…").

**`rights`** (body.py:132-135). H2 "Rights first. / Always."
- `.cell.hd` --d:5 --t:6 (04 "Rights" / "Five rules"; includes `.rrec` rights record, aria-hidden); `.cell.rgl` --d:7 --t:6 (mh "How carriage stays clean" / "For everyone"; `ol.rg` 5).

**`escrow`** (body.py:138-155). H2 "Paid before / they even join."
- hd --d:7 (05 "Escrow" / "On-chain"), hd --d:5 ("Why makers can trust it"), `.cell.esc` --d:12 (mh "Where the money goes" / "Weekly"; `.flow` aria-hidden; `#escAmt`).

**`outlets`** (body.py:158-163). H2 "Beyond the dial."
- hd --d:7 (06 "Where it can air" / "Five outlets"), hd --d:5 ("Outlets").
- 4 × `.cell.otl.is-on` --d:3 --t:3 --m:1; 1 × `.cell.otl.is-later` (FAST) --d:12 --t:6 --m:2.

**`faq`** (body.py:174-177). (No H2 headline; left cell is the share table.)
- `.cell` --d:5 --t:6 (07 "Who gets what" / "On carriage"; `.shr2`; mf "Shares come from the carrier's earnings after the network's 10% on spots…"), `.cell.faq` --d:7 --t:6 (mh "Questions makers ask" / "6 answers").

**Footer `#contact`** (chrome/footer-syndication.html): `.cell.claimc` --d:7 --t:6 (08 "Offer a show" / "Free to list"; H2 "Put your show / on more dials."), `.cell` --d:5 --t:6 (mh "What you'll need" / "About 10 minutes"; `ol.stps` 3, inline `--c:#EBA03A`), 4 × `nav.cell.lk`, `.cell.wd`, foot cell. Same structure as Run.

**No `--t` > 6 anywhere on Syndication.**

#### Interactive pieces

| Piece | Driver | Inputs / states / timers / data |
|---|---|---|
| Nav tuner | `fill()` common_head.js:13-14 | `S[1]`, 30000 ms |
| Network map ("the wire") | IIFE synd.js:4-60 | `CAR` 7-15 (8 carriers `{n,cs,mk,c,t,tv,a}`), source `S[2]` SAZN. Tiles `.sx-t` built 16-18 (canvas 160×90, badge, `.st` status, `.tm`, `.tt` terms, `.pp` payout "+$x" / "+ watch time" / "+ reach"). `place()` 20-22: desktop polar `left=50+40cos(a)%`, `top=50+39sin(a)%`; phone (≤699) 4×2 grid at `12.5+25*(i%4)%`, top 62%/85%; on resize. Status 24: live "On air" / aired "Aired" / "In N min" (`next=15+i*17`, decremented every 60000 ms, 59). Lines canvas DPR-scaled (cap 2) 26-28; dashed when idle, solid tinted when live. `fire()` every 2300 ms (first at 700 ms) when visible+not hidden, round-robin; pulse travels 1100 ms (ease-in-out, 10-dot trail + glow) then `arrive()` 32-36: tile live for 9000 ms, `.pay` anim, `air++`, cash adds parsed price to `paid`, `.bump` on `#wPaid/#wAir`. Frame: lines every rAF; canvases throttled to 66 ms; live tiles draw SAZN kitchen scene, idle tiles draw random `noise()`. Paused via IntersectionObserver + `document.hidden`. RM: `T=0`, no `fire`. |
| Deals ticker (`#dlV`) | IIFE synd.js:112-122 | `D` 113-117 (5 `[color,n,cs,verb,program,terms,ago]`). Old item gets `.out` (removed after 400 ms), new appended after 380 ms. 3400 ms; RM → shows first only. |
| Market filter (desktop dropdowns) | IIFE synd.js:63-104 | Data `P` 65-76 (11 programmes `{t,by,c,len,eps,slot[],terms,tv,g}`), state `F={slot,len,terms,sort,q}`, `asked{}`. `fits()` 79: slot ∈ p.slot; len '120' = ≥120 else exact; terms equal; q substring of `t+by+g`. `sorted()` 80: short/long by len, az by `localeCompare`; "fit" = source order. `render()` 84-87 rows `.fp` + button "Request"/"Add it" (free) ↔ "Sent"/"In your log"; empty "Nothing fits that yet…"; `#fCount` "N program(s) fit"; `#fShowN` "Show N programs"/"Nothing fits". `sync()` 81-83 updates dropdown labels (`LBL` 78), `.set` (non-default, not sort), `aria-selected`, sheet seg `.on`, badge `#fN` count of non-any filters (hidden if 0). Dropdown 89-93: button toggles popup (`hidden`, `aria-expanded`, `.open`), focuses selected option; option click sets F, closes, refocuses button; ArrowUp/Down/Escape; document click closes. Search input 94. |
| Market filter sheet (phone/tablet ≤1099) | synd.js:95-101 | `#fSheet` moved to `<body>`. `openSheet()`: unhide, `html.sheet-open` (overflow hidden), `.on` after 10 ms, focus `.f-x`. `closeSheet()`: remove `.on`, after 260 ms hide + focus `#fMob`. Any `[data-close]` closes (backdrop, ×, `#fDone`). Seg buttons set F and re-render live. Escape closes. `#fClear` resets slot/len/terms/sort (not q). `.f-mob` shown ≤1099 (synd.css:385-388). |
| Request / Add it | synd.js:102 | toggles `asked[i]`, re-render. |
| Escrow counter | IIFE synd.js:107-109 | start 1284.6; +[2.5,3,1.5,0.85] random every 2600 ms when visible; RM → no tick. Format `$1,284.60 waiting`. |
| Earnings calculator + station squares | IIFE synd.js:125-152 | see Calculators. Mode seg `#rMode` 149-151 toggles `#earn [data-m]` hidden. |
| Outlet toggles | markup only body.py:163 | disabled checkboxes "Allowed" (decorative). |
| FAQ | native `<details>` body.py:177 | 6 items. |
| Lenis / anchors / cursor / menu / footer reveal | common_tail.js | same as Run. |

#### Calculator: `#earn` (synd.js:125-152, exact)

```
mode='share' (default)
m(v) = '$' + v.toFixed(2) with thousands commas (regex)      // 127
w(v) = '$' + Math.round(v).toLocaleString('en-US')            // 128
n = +rSt.value
share:  rev=+rRev; wt=+rWatch/100; sh=+rShare/100; one = rev * wt * sh
        o1=m(rev); o2=round(wt*100)+'%'; o3=round(sh*100)+'%'
        labels l1 'One station’s ad revenue', l2 '× your share of what’s watched', l3 '× your revenue share'
cash:   a=+rAir; p=+rPrice; mo = a*52/12; one = mo * p * 0.95
        o1=(round(mo*10)/10).toString(); o2=m(p); o3='−'+m(mo*p*0.05)
        labels 'Airings a month, one station', '× your price per airing', 'Less our 5%'
tot = one * n; oOne=m(one); oPay=m(tot); oYr='About '+w(tot*12)+' a year'; oSt=n; vSt=n
squares: cells[k].on = k < n; for k>=NET(32): label 'New' if on else 'Open'
slider fill --p as Run
```
Inputs (body.py:104-109): `rSt` 1–48 step 1 **12**; `rRev` 100–5000 step 50 **600**; `rWatch` 1–80 step 1 **20**; `rShare` 5–80 step 5 **40** (cap 80% = §5); `rAir` 1–21 step 1 **3** (hidden); `rPrice` 0.5–15 step 0.25 **2.5** (hidden).
Default (share) by hand: one = 600×0.20×0.40 = **$48.00**; tot = **$576.00**; "About **$6,912** a year"; o1 $600.00, o2 20%, o3 40%. Matches markup (body.py:112-117).
Cash mode at defaults: mo = 13 → o1 "13"; o2 "$2.50"; o3 "−$1.63"; one = 30.875 → **$30.88**; tot **$370.50**; "About $4,446 a year".
Station squares (synd.js:129-132): 48 cells (`CS` 48 call signs). `NET=32`: cells 0–31 show `ch` + call sign (grey unless on), 32–47 dashed `.open` "Open". Channel per cell `(2+((i*13)%66))+'.'+(1+i%3)`; colour `COLS[(i*5)%8]`; transition delay `(i%8)*14` ms. Default: 12 coloured, 20 grey, 16 dashed. Grid 8 cols (synd.css:398), 6 on phone (410).
§5 formula check: share = revenue (input already "after our 10%") × watch share × maker share × stations: matches. Cash 95% to maker: matches.

#### CTAs / links → §6

| CTA | href / handler | §6 row |
|---|---|---|
| Nav tuner | `/` | Open the dial |
| Hero "Offer a show" (chip `+1`) | `#offer` (body.py:19) = scrolls to "Two sides" | Offer a show |
| Hero "Browse the market" | `#fits` | in-page anchor |
| Side A mf "Offer a show" | `#contact` (body.py:50) = scrolls to footer | Offer a show |
| Side B mf "Browse the market" | `#fits` | in-page anchor |
| Market row "Request" / "Add it" | `.fp-b` toggle (synd.js:102) | Request / Add it (role station, program named) |
| Footer "Offer a show" (chip `NEW`) | `#offer` (footer-syndication.html:9) | Offer a show |
| Footer "Browse the market" | `#fits` | in-page anchor |
| Footer nav | as Run | as Run |
- No "Talk to a person" on this page.

#### Data arrays (syndication/body.py unless noted)

- `sides` body.py:42-43, 2 × `(letter, color, title, ctaLabel, steps[3](h,p), cta)`; CTA href computed at body.py:50
- `TERMS` body.py:87-89, 3 × `(name, color, title, para, example, bar[(flex,color,legendKey)])`; `LG` body.py:90 (3)
- `RG` body.py:127-131, 5 × `(h, p)`
- `OUT` body.py:158, 5 × `(name, desc, status, on|off)`
- `shr` body.py:166, 3 × `(source, makerKeeps, weKeep)`
- `FAQ` body.py:168-173, 6 × `(q, a)`
- JS: `CAR` synd.js:7-15 (8), `P` 65-76 (11), `LBL` 78, `D` 113-117 (5), `CS` 129 (48), `COLS` 126 (8), escrow increments 109 (4)
- Static markup: rights record (body.py:133, 5 rows), escrow flow (144-151, 4 nodes), footer steps (footer-syndication.html:14, 3)

---

### Shared components synd.css (and spots/net) take from run.css

Synd/spots/net load run.css, so these live there today and must be extracted:
- Nav current-page indicator `.nl a.is-cur` (run.css:6-8): every page relies on it.
- `.dim` (run.css:5), `.rhero` padding (11, 223, 254), `.btn .live` font (16), `.rh` hero (12-15, 220-225; spots + net use `.rh`).
- Range slider `input[type=range]` + `--p` fill (run.css:150-155) and `.cr` / `.cr label` / `.cr .lb` / `.cr .seg2` / `.crh` rows (146-149, 256): used by Run, Synd, Spots.
- Output list `.out` / `.ol` / `.ot` (run.css:156-160): Run; spots uses `.out`. Synd has its own `.ro` (synd.css:241-246) that is the same pattern; worth one component.
- FAQ `.faq` (run.css:189-199): all four pages.
- Claim/sign-off `.claimc` (run.css:202-203): Run + Synd footers.
- Share table `.shr/.sh-h/.sh-r` (run.css:384-409): Run only; synd/spots use `.shr2/.s2` (synd.css:114-120,157-162). Two variants of one table.
- Legend `.t-lg2` (run.css:425-427) vs `.t-lg` (synd.css:153-156, 187, 409; also Spots): two variants.
- Synd → spots: `.deals/.dl-v/.dl-k` ticker (synd.css:171-180, 411-419), `.trm`, `.side`, `.mf.go`, `.tg`, `.t-lg`, `.rg`, `.rrec`, `.shr2/.s2`, `.otl` (Spots uses these per class counts).
- `.seg2` lives in shared polish.css:67-71 + shape.css:13-14 (used by all).
- Square marker `.sq` repeated per component: run.css:184, 429; synd.css:72; grid.css:106.

---

### Constants (price / share / cap / free tier / hours / comparison)

#### Run
- body.py:20 "Being on air is free" · :68 "Free" · :69 "0 GPUs"
- body.py:36, :55, :114-115; run.js:93 — library 2.4 TB, 38 GB sent, "Next 7 days"
- body.py:59-61, :124 — uptimes 47:33:50 (171230 s), Twitch restart 2892 s ("0:48"), 25:20:10 (91210 s)
- body.py:103 sign-off 2 am / back at 6; :129 "Live, 9 to 11 pm"; run.js:131 W0 18, W1 26
- body.py:146 compare: Dial "From $0", "About $26 for 40 GB on air, relayed all month"; Livepush "$39 to $119/mo", Editors 20 GB, Creators 50 GB, Business 100 GB; Upstream "$30/mo" per 1080p 30 fps; Gyre "$99 to $169/mo", Start+ 75 GB, PRO+ 150 GB
- body.py:147 "No limit", 7 days; 100 GB, 100 GB, 150 GB
- body.py:149 Livepush "20 a month free. 24/7 looping from $39"; Upstream "24 a month free. Unlimited from $30"; Gyre "7-day trial. 24/7 from $49; playlists from $99"
- body.py:161 "cap it at 100 or 150 GB"; :162 and :202 "October 2026"
- body.py:177-182 rate card: on air Free; storage $0.04 / "10 GB free"; relays live-only Free; relays everything $0.05 / "never over $25 a month"; live TV $0.75 / "5 hours free"; live radio Free; number + call sign "Included" / "licences come later"
- body.py:190-193 sliders (see Calculators); :195-198 stale $2.00/$14.60/$2.00/$18.60
- body.py:202 "30-day month"
- body.py:205-206 "14-day grace"; :267 "14-day grace period"
- body.py:226-228 pay sliders; :227 "up to 3 minutes an hour", "about $8 per 1,000 tuned in"; :229 stale $18.60
- body.py:232-233 "after our 10%", "after our 5%"
- body.py:242-246 shares: booked 10/90 (YouTube 45%, Twitch 45%); sourced 20/80 (YouTube 45%); pledges 5/95 (Patreon 10%, YouTube 30%, Twitch 50%); syndication cash 5/95; backfill 20/80 (YouTube 45%)
- body.py:252 YouTube ads 45%, memberships 30%
- body.py:255 "95 cents of every dollar"
- body.py:263 Twitch caps at 48 hours
- footer-run.html:5 "TV 2 to 69, FM 88 to 108"; :8 "four-letter"; :14 `maxlength="4"`, default 44.1
- run.js:96 "1:45 a break"; :97 "5 outputs · 0 drops"; :100 BRK 0:05, 0:30, 0:30, 0:15, 0:05
- run.js:154 `4`, `PRICE.hours`, `8` ($ CPM), `/1000`, `.9`, `.95`; :157 thresholds 2 and 10
- run.js:164 PRICE `gb .04, freeGb 10, relayHr .05, relayCap 25, liveHr .75, freeLive 5, hours 720`; :165 `rm=2`
- run.js:167 LIB list
- run.js:176-179 COMP: Livepush [20,$39,Editors] [50,$69,Creators] [100,$119,Business]; Upstream [100,$30,'1 stream'] note "100 GB is its free plan; paid storage not published"; Gyre [75,$99,Start+] [150,$169,PRO+]
- run.js:196 picker nums (12), taken 16.1/31.1/41.1, sel 44.1; :199-200 length 4

#### Syndication
- body.py:29 "26 episodes of 30 min"; :32 $412.50, 121 airings, 8 stations, 5 markets; synd.js:30 `paid=412.5, air=121`
- body.py:65 "10 programs fit" (stale); :76 "Show 11 programs"
- body.py:87 "Like 40% of the show's revenue", bar 40/60
- body.py:88 "Like $2.50 an airing, or $1 + 15%"
- body.py:104-109 sliders (see Calculators); :105 "after our 10%"; :107 "up to 80%", "at least a fifth"; :108 weekly 1 / nightly 7; :109 "You get 95%"
- body.py:112-117 $600.00, 20%, 40%, $48.00, 12, $576.00, "$6,912 a year"
- body.py:133 "3 releases on file"
- body.py:146 $1,284.60; :149 "72 hours in public"; :153 "7 days in public"
- body.py:166 cash 95% / 5%; revenue share "Their share" / 0%; free — / 0%
- body.py:175 "network's 10% on spots"
- footer-syndication.html:5 "Free to list"; :13 "About 10 minutes"
- synd.js:8-15 CAR: BEAT $2.50, REEL 30%, MESA $2.50, ORNG $1.00 + 15%, LBCH 40%, VALE Free, PREP $2.00, CIVC Free
- synd.js:66-76 P: $2.50, 25%, 40%, Free, Free, Free, $3.00, Free, 30%, Free, $2.00
- synd.js:109 escrow +2.5/3/1.5/0.85
- synd.js:113-117 deals: 30% share, $3.00, free, 25% share, $2.00
- synd.js:130 NET 32; :140 `52/12`, `.95`; :144 `.05`
- synd.css:29 hard-coded `content:"+$2.50"` (dead rule)

---

### Problems

#### Can't build as drawn / broken behaviour
- **Pay formula vs copy.** run.js:154 `sp = mn*4*720*tun*8/1000*.9` charges $8 CPM per 15-second unit (×4 per minute), so effectively $32 per 1,000 per spot-minute. Copy (body.py:227) and SITE-SPEC §5 say "about $8 per 1,000 tuned in". Port exactly (the spec's $121.23 / 5× needs the ×4), but the copy/§5 wording and the formula disagree; needs a decision.
- **Stale SSR numbers.** Run markup placeholders disagree with the JS defaults: body.py:195-198 ($2.00/$14.60/$2.00/$18.60 vs $1.20/$25.00/$3.75/$29.95), :229 `pCostN` $18.60 vs $29.95, :232-235 "$0"/"Covers your month" vs $103.68/$47.50/−$29.95/$121.23/"…5× over". `#vsNote` initial text (body.py:200) is replaced too. Synd `#fCount` "10 programs fit" (body.py:65) vs 11 rendered and "Show 11 programs" (76). In Astro, render computed defaults server-side.
- **Cash-mode rows don't add up on screen.** At defaults o1×o2 = 13 × $2.50 = $32.50, minus o3 "−$1.63" = $30.87, but `oOne` shows $30.88 (synd.js:142-145, rounding each line separately).
- **gb clamp doesn't move the slider.** run.js:170 `if(gb>lib) gb=lib` changes only the label and the maths; `cGb` thumb and `--p` stay at the larger value (e.g. library 25 GB with 300 GB on air).
- **Wire's initial live tiles never show.** synd.js:18 sets `live:i%3===0, until:0`; the first frame (47) sees `now>until` and flips them to "Aired". So the page opens with no tile on air until the first pulse lands at ~1.8 s; with RM no tile is ever live.
- **Reduced motion not honoured in the wire.** synd.js:42-56 keeps redrawing at 66 ms with `T=0`; idle tiles use `noise()` (Math.random, 41) so they flicker as animated static. Violates §3 "scenes draw one still frame". Run handles RM correctly (run.js:127).
- **Canvases not sized to box/DPR** (§8): run `#pgmC` fixed 480×270 (body.py:34, run.js:123); synd `#wPic` 320×180 (body.py:28) and tile canvases 160×90 (synd.js:17). Only `#sxLines` is DPR-scaled (synd.js:26-27).
- **Schedule "now" line is faked outside 6 pm–2 am.** run.js:144 parks it at 46% of the row, so in daytime the red line claims a time that isn't now.
- **Claim chip shows `__.1` on load.** The hero/footer chips (body.py:18, footer-run.html:9) only get the number after a pick click (run.js:203); the default selection 44.1 is never written to them.
- **Footer "Claim a number" is a no-op** (`href="#claim"` inside `#claim`, footer-run.html:4,9). Synd side A "Offer a show" → `#contact` (footer, body.py:50) whose "Offer a show" → `#offer` (back up): a loop with no offer flow. Both become waitlist-sheet CTAs per §6.
- **`#fClear` doesn't clear the search** (synd.js:101): `F.q` and `#fQ` text survive "Clear".
- **Sheet scroll lock vs Lenis.** synd.js:96 sets `html.sheet-open{overflow:hidden}` (synd.css:384) but never calls `lenis.stop()`, so the wheel can still scroll the page under the sheet on touch-pad/desktop widths ≤1099.
- **Break total disagrees.** run.js:96 caption "1:45 a break" but `BRK` (100) sums to 1:25 (5+30+30+15+5 s).
- **Station-square identities are synthetic.** synd.js:131: channels `(2+((i*13)%66)).(1+i%3)` give BEAT 2.1 (really 12.1), REEL 15.2 (24.1), MESA 28.3 (33.1 in CAR), PREP 14.1 (31.1), CIVC 27.2 (7.1), OCAT 13.3 (60.1), and FM stations NITE/FLDR/VOZE as TV numbers 40.3/53.1/66.2 (really 88.4/92.0/104.2). Colours `COLS[(i*5)%8]` don't match station colours, and the legend swatch is a single orange (body.py:119). Use the shared stations for the first squares.
- **Carrier colours off-palette.** synd.js:15 CIVC `#9A9CAB` (shared is `#2F9A72`, and the ticker uses `#2F9A72` at synd.js:115); synd.js:14 PREP `#5B7BE0` (shared `#3478C6`; `#5B7BE0` is NITE).
- **Picker numbers vs synd carriers.** Run's "open" list (run.js:196) offers 19.1, 27.1, 33.1, which synd uses for LBCH, VALE, MESA, and marks 41.1 taken (ORNG is Orange County, not the IE). Fine only if numbers are per-market; decide.

#### Copy and number inconsistencies (vs each other and SITE-SPEC §5)
- Synd body.py:105 "Spots, sponsorships and partner ads, after our 10%": partner ads (backfill) are 20% to Dial per §5 and Run body.py:246. body.py:175 "after the network's 10% on spots" ignores the 20% on Dial-sourced spots.
- Synd hero lede "every airing pays the maker" (body.py:18) and footer "You get paid every time it airs" (footer-syndication.html:8) contradict Free terms (body.py:89 "No charge and no split").
- Run compare "About $26 for 40 GB … relayed all month" (body.py:146) = $26.20 with 0 live hours; fine, but the default estimator (40 GB + 10 live h) is $29.95; both are correct for their inputs.
- Run `vs()` shows Upstream "$30 · 1 stream, 100 GB · 100 GB is its free plan" (run.js:178,187): the $30 price sits next to "free plan".
- Everything else in rate card / share table / pay labels / synd cap 80% / cash 95% matches §5.

#### Run footer call sign ("Four letters", §8)
- footer-run.html:8 lede "a four-letter call sign"; :14 `maxlength="4"`, `placeholder="YOUR"`, `aria-label="Call sign, four letters"`, initial msg "Four letters. Pick a number above."
- run.js:199 `.slice(0,4)`; :200 `v.length<4` → "Four letters. N to go."; :201 only checks `used` (network call signs). No 3–5 length rule, no K/W four-letter ban, no brand/alert blocklist. Use the one shared validator (net.js rules); change hint to "Three to five letters." and log in `docs/site/new-copy.md` (the lede at :8 and the aria-label also need new copy, which §8 doesn't mention).
- `.cs-box input` is sized for 4 glyphs (run.css:213 56px / 246 44px on phone); check 5 letters fit at 375px.

#### "Opencast" leftovers
- No literal "Opencast" in run/synd sources or built pages.
- Call sign **`OCAT`** (Classic Matinee, 60.1, "the network's catalog") in shared/shared_data.js:8 and synd.js:129 (squares) reads as an Opencast remnant; it also feeds Run's `used` set (run.js:198). Decide whether to rename.

#### Class / id collisions and cascade leaks
- `.out` (run.css:156 `display:grid;border-top:1px solid var(--rule)`) hits synd's ticker exit class `div.out` (synd.js:119): display is overridden by `.dl-v div`, but the 1px top rule shows during the 400 ms exit. Real leak.
- `.sh` (polish.css:62 `display:grid;grid-template-columns:7fr 5fr;gap…`, :151) hits synd legend `<i class="sh">` (body.py:119; synd.css:156). `.sh-r` (polish.css:64, section-head right column) vs run.css `.sh-r` share-table row (385-408).
- `.off` (head.html:252-254 footer layout `display:grid…`; polish.css:142-143) vs run's schedule `b.off` (run.js:139) and relay `i.off` (body.py:124); masked by specificity on the `b`, applies `display:grid` to the `i`.
- `.pay`: Run's pay-calculator cell (run.css:411) vs synd tile animation state `.sx-t.pay` (synd.js:33, synd.css:303).
- `.big`: `.ft.big` (run), `.cr.big` (synd.css:259-260), `.fl-n.big` (synd.css:92-93), `.dr.big` (grid.css), `.cur.big` cursor (head.html:40-42).
- `.dt`: synd legend `i.dt` (synd.css:409) vs polish.css:132 `.dt em`.
- `.d` / `.r` / `.l`: run `.eps li.d`, `.lv-t .r/.l` vs cursor `.cur .d/.r` (head.html:37-42); scoped, safe today.
- `.rh .cb` redefined in synd.css:169 (`justify-content:center;padding-top…`) and `.rh h1.sy-h` (167, 215, 223): synd has no `.rh`, but spots and network do and load synd.css, so their hero alignment is set by synd.css.
- synd.css:231 `@media (max-width:379px){ .mh>span:last-child:not(.lv){display:none} }` is global: it hides every cell-header meta on synd/spots/net under 380px.
- Slider thumb halo hard-coded to BEAT magenta `rgb(192 74 158 / .25)` (run.css:154-155) on every page, including orange synd.
- Ids: `oSt` = Run storage output (body.py:195) and synd "× stations" output (body.py:116); `#earn` = Run section vs synd calculator cell inside `#terms`; `#contact` = footer element on every page while `/contact` is a route; `#offer` (synd "Two sides") is what "Offer a show" scrolls to. Rename when these become components.
- Dead CSS: run.css `.chain`, `.cn-i`, `.onair`, `.outs` (18-38: pre-v3 signal chain); synd.css `.wire`, `.w-prog/.w-pic/.w-meta/.w-rows/.w-r` (7-30, 130-136, 161-162, 182-185), `.f-bar` (50, 140), `.rs-bar/#rbM/#rbC/#rbO` (247-249), `.sx-top .cb`/`.sx-top .deals` (273, 278), `.t-bar i.sh` (76). Spec's listed collisions `.oa`, `.onair`, `.tl`, `.rc`, `.cmp`, `.fd`, `.tick`, `.band`, `.who` don't conflict on these two pages (`.rc`, `.cmp`, `.fd` are only defined in run.css; `.who`, `.band`, `.tick`, `.tl` shared rules are scoped to home markup).

#### `[hidden]` overrides
- synd.css:255 `#earn [hidden]{display:none!important}` (needed because `.cr` is `display:grid`, run.css:146); synd.css:364 `.f-mob .n[hidden]`, :369 `.f-sheet[hidden]`, :396 `.f-pop[hidden]`; shared head.html:63 `.mob[hidden]`, polish.css:80 `.g-row[hidden]`. Run uses `.vs-r:empty{display:none}` (run.css:166). One global `[hidden]{display:none!important}` replaces all of these.

#### Shape / button rules (§3)
- Surfaces with big radii: `.f-pop` 14px, options 9px (synd.css:354,357); `.f-sh` sheet 20px top corners (371); `.f-sh-b .seg2` 18px (380). Rule: surfaces ≤2px.
- Equal-width rule not met: Run `.rm` seg (Off / Live only / Everything, body.py:192), synd `#rMode` (body.py:101), hero/footer `.acts` pairs. `.fp-b` uses `min-width:112px` (synd.css:366): equal only up to that width.

#### Accessibility
- Signal chain (body.py:26-32, run.js:104-108): `role="tablist"`/`role="tab"` with no tabpanels or `aria-controls`, no arrow-key/roving tabindex, no `aria-selected` until JS runs; auto-advances forever (no pause control; WCAG 2.2.2); caption `.mc-cap` `aria-live="polite"` (body.py:55) announces every 2.4–4.2 s.
- Seg controls are bare `<button>`s with only a `.on` class, no `aria-pressed`: Run `.rm` (body.py:192, also no `type="button"`), synd `#rMode` (101, no type), sheet groups (71-74, `role="group"` with no accessible name; `.lb` span not linked).
- Number picker (run.js:197): no group label, selection not exposed (`aria-pressed`/`aria-checked`). `#csMsg` result isn't a live region (footer-run.html:14).
- Sliders: `cLib` value is an index 0–13 (body.py:190), so a screen reader announces "7", not "500 GB"; no `aria-valuetext` anywhere (`pMin` "0.5", `rPrice` "2.5", money sliders without $). Labels include the changing `<b>` value in their text.
- Market dropdowns (body.py:61, synd.js:89-93): options are `<button role="option">` (each a Tab stop) inside `role="listbox"`; no Home/End/type-ahead; Tab out leaves the popup open until a document click.
- Filter sheet: `aria-modal="true"` but no focus trap (synd.js:96-100); background still scrollable via Lenis.
- `#fList` `aria-live="polite"` (body.py:64): the whole list is re-announced on every keystroke in search.
- Comparison table scroller `.cmpw` (body.py:162, run.css:121) has no `tabindex`/`role="region"`/label, so keyboard users can't scroll it.
- Canvases/visuals with no text alternative: `#pgmC`, schedule `#sch` (a full week schedule, `aria-hidden`, body.py:102), break bar, prep list, relays list, episodes (all `aria-hidden`), `#sGrid` station squares (body.py:118), escrow `.flow` (143), rights record `.rrec` (133). Wire tiles are readable text but update silently.
- Whole-cell links (`a.cell.aud`, `a.cell.ern`, body.py:88, 221) wrap headings and lists, giving very long link names.
- Feed URLs lack a scheme (`usedial.com/12.1/channel.m3u`, body.py:139): copied text isn't a usable URL.

---

## Inventory: /spots and /network

Root for paths: `docs/reference/site/source/`.
Verified: `pages/spots.html` and `pages/network.html` contain `body.html` + the JS byte for byte (after the build's ascii escaping), so the source parts are the truth.

Build (both `build/build_spots.py`, `build/build_net.py`):
- CSS order: head inline style, polish, grid, flat, nav, shape, lt, run.css, synd.css, spots.css (+ net.css for network). Network loads **all of spots.css**.
- JS: `common_head.js` (with `shared_data.js` at `/*DATA*/`) + [spots: `scenes.js` + `spots.js`] / [network: `net.js`] + `common_tail.js`. Network does NOT load scenes.js.
- Footer: `chrome/footer-spots.html` / `chrome/footer-network.html`; anchors rewritten to routes (build_*.py:20). Hard-coded paths `/tmp/claude-0/...` and `/mnt/user-data/outputs` (build_*.py:1,25,27): can't run as is (not needed).
- What the page JS relies on from shared: `$`, `RM`, `FINE`, `clamp` (common_head.js:5-8); `S` (station array, shared_data.js:2-12; spots uses `S[1]` = BEAT for the program scene); `draw()`/`SC.crate` (scenes.js:63); `fill()` sets every `.js-ch` to `S[1].n` "12.1", `#npCs`, `#npProg`, `--np` every 30000 ms (common_head.js:13-14); common_tail needs `#nav`, `#contact` (footer, IO threshold .2 adds `.go`), `#cur`/`#curL`, `#menuBtn`/`#mob`/`#menuX` (common_tail.js:1-17). In-page `a[href^="#"]` get Lenis scroll, offset -70, 1.2 s (common_tail.js:5).

---

### Spots (`/spots`)

#### Sections in order (spots/body.py line refs)
No cell on this page has `--t > 6` (all `--t` are 6; footer link cells 3). Cells without `--t`/`--m` fall back to 6/2 (sh/grid.css:14-16).

1. `#hero` `.blk.rhero.sp-hero` (body.py:11-34). H1: "Be in the break." / dim "Pay for who watched." (`<br class="lg">` inside each span).
   - `.cell.hd.rh.cr-l` `--d:5`: mh "Spot market" / "For advertisers"; lede "Your :15 or :30 in the breaks of stations people actually sit with: near your shop, or anywhere you ship. Stations choose your spot. You pay only for the people who tuned in."; buttons; mf "No minimum spend. No contract. Pause any time."
   - `.cell.cr#spair` `--d:7`: control room (mh-dl "Just booked" ticker + `.lv` "Live"; canvas monitor `#spTv` + bug `#spBug` "12.1" + chip `#crChip`; timeline `#crSegs` + playhead `#crPh`/`#crClock`; 3 meters; mf "An example break on one station. Your spot is the cream one.").
2. `#who` (body.py:37-56). H2 "Down the street, / or ships anywhere."
   - `.cell.hd` `--d:7` mh "01 Who it's for" / "Three kinds of advertiser"; `.cell.hd` `--d:5` mh "Why it works", lede "Local stations used to be where a barber or a hardware store could afford to be on TV. That's the idea here, for anyone with something to sell to the people watching."
   - 3 × `.cell.side.wh` `--d:4;--t:6;--m:2` from `WHO` (A shop / B online / C agency), each with `a.mf.go`.
3. `#plan` (body.py:59-88). H2 "Say who it's for. / See what it buys."
   - `.cell.hd` 7 (mh "02 Plan it" / "Before you spend"); `.cell.hd` 5 (mh "How it's priced", lede "You set the rate and the budget. Stations decide whether your spot fits their breaks, so a fair rate gets picked up by more of them. The planner shows what you'd get before you spend a cent.").
   - `.cell.pl-in` `--d:5;--t:6;--m:2` (mh "Who it's for" / "Change anything"): planner inputs.
   - `.cell.pl-out` `--d:7;--t:6;--m:2` (mh "What it buys" / "Estimated"): 4 stats, pick bar, list, mf `#pNote`.
4. `#paid` (body.py:91-107). H2 "Every airing, / settled honestly."
   - hd 7 (mh "03 Paying" / "Per airing"); hd 5 (mh "Held, counted, settled", lede "Before an airing, the most it could cost is held from your balance. After, it's settled at what it really cost, and the rest comes back. Pick an airing to see how.").
   - `.cell.rct` `--d:12`: mh "Three airings of Pumpkin latte" / `.rs-k` "From the statement"; tabs `#rcTabs`; receipt `#rcL`; steps `#rcSteps`; viewer bar `#vwBar`/`#vwLg`; `#rcNote`; mf "On the dial we count viewers with our own player. Relay viewers come from YouTube's and Twitch's own numbers."
5. `#customers` (body.py:110-135). H2 "Count customers, / not impressions."
   - hd 7 (mh "04 Results" / "Codes and QR"); hd 5 (mh "What counts", lede "Every spot ends with your offer, a short code and a QR. When someone uses it, at your counter or at checkout online, it's counted against the spot that sent them.").
   - `.cell.endc` `--d:5;--t:6;--m:2` (mh "The end card" / "Added to every spot"): static end card `.ec` (aria-hidden) "Orange Street Coffee" / "0:12" / "Show this code" "PUMPKIN" "A free pastry with a latte" / canvas `#qr` 116x116 / "Good for 7 days" "1840 Orange St"; caption.
   - `.cell.fun#fun` `--d:7;--t:6;--m:2` (mh "One month, one spot" / "Bars on a log scale"): funnel `#fnRows`, totals "Spent this month $147.36" / "Each customer cost $3.59", 3 count rows 17 / 19 / 5; mf "Not everyone who comes in because of a spot uses the code. These are the customers we can count."
6. `#ways` (body.py:138-163). H2 "Three ways / into the break."
   - hd 7 (mh "05 Buying" / "Spots, sponsors, made for you"); hd 5 (mh "Pick one or all three", lede "Bring a finished spot, put your name on a show you love, or have one made by people who make TV every day.").
   - 3 × `.cell.trm.wy` `--d:4;--t:6;--m:2`: Spots (Self-serve, `--c:#E0583A`, length bar :15/:30/:60, mf "Any budget. Paid as it airs"); Sponsorships (Monthly, `--c:#EBA03A`, credit-read sample, mf "Renews monthly until you end it"); Made for you (Order a spot, `--c:#2F9A72`, 4-step `ol.mtl` Brief/Quote on, Made/Yours off, mf "The maker is paid for the work, even if it never airs").
   - `.cell.otl.is-later` `--d:12`: "Ad exchanges and VAST partners" / "Later", disabled toggle "Not yet open".
7. `#rules` (body.py:166-174). H2 "Their breaks. / Your spot."
   - `.cell.hd` `--d:5;--t:6` (mh "06 Rules" / "Five of them", lede, `.rrec` sample: Length "0:15, exactly", Loudness "Levelled to broadcast", Picture "1080p, safe margins", End card "PUMPKIN and QR added", Category "Food and drink").
   - `.cell.rgl` `--d:7;--t:6` (mh "How the breaks stay good" / "For everyone"): `ol.rg` from `RG`.
8. `#faq` (body.py:177-189). **No H2.**
   - `.cell` `--d:5;--t:6` (mh "07 Who gets what" / "Per dollar you spend"): share table `shr`; mf "Shares never change what you pay. Card fees are added when you put money in. Part of what we keep goes back to stations through the co-op pool."
   - `.cell.faq` `--d:7;--t:6` (mh "Questions advertisers ask" / "7 answers"): `<details>` × 7.
9. Footer `footer.signoff#contact` (ch/footer-spots.html): `.claimc` `--d:7;--t:6` "08 Start a spot" / "No minimum", H2 "Get in / the break.", lede, buttons; `--d:5;--t:6` "What you'll need" / "About 10 minutes" 3 steps; 4 × nav `.lk` `--d:3;--t:3;--m:1`; `.wd` 12; `.mf.foot` "© 2026 Dial." / "Stations, programs and people on this page are examples."

#### Interactive pieces

**Control room (live break)**: IIFE spots/spots.js:7-84.
- Canvas `#spTv` 640x360, `x.scale(2,2)`, drawing space W=320, H=180 (spots.js:9-10). Fixed 2x; never resized to its box or to devicePixelRatio.
- Segments `SEG` (spots.js:53-60), seconds: Program "Late Crate" 4 (`#C04A9E`) · Bumper 2 (`#7a3b8f`) · Juniper 4 (`#2F9A72`, chip "Spot, :15") · **Your spot 7** (`#F3EAD9`, chip "Your spot, :15") · Redlands 4 (`#3478C6`, chip "Spot, :30") · ID 2 (`#E0583A`, "Station ID") · Program 3. `TOT` = 26 s. Segment starts 0,4,6,10,17,21,23.
- Loop: rAF, skip if not intersecting (IO on canvas), `document.hidden`, or <45 ms since last frame; `T=(now-t0)/1000`; with RM `frame(13.5)` every 45 ms (spots.js:82-83), i.e. the loop keeps running and redrawing the same frame.
- `frame(T)` (spots.js:65-81): `t=T%26`; finds segment i; `u=(t-start)/d`.
  - Drawing: prog → `draw(x,W,H,T,S[1])` (scenes `crate`); bump/jun/red/id → `card(bg,fg,big,small,u,acc)` (spots.js:48-51) with texts "12.1 BEAT"/"We'll be right back"; "Juniper"/"Fades. Beard trims. Orange St."; "REDLANDS HARDWARE"/"Since 1962. Everything for the house."; "BEAT 12.1"/"Beat Tape TV · Pomona"; you → `spot(u*15,T)` (spots.js:17-47): k<9 product shot (text fades: "Orange Street Coffee" k .4–1.2, "PUMPKIN"/"LATTE" k 1.1–1.9, "Back for fall. Roasted on Orange St." k 4–4.7), k≥9 end card wipe over .6 ("SHOW THIS CODE", "PUMPKIN", "A free pastry with a latte", "ORANGE STREET COFFEE  ·  1840 ORANGE ST", fake QR 21x21).
  - `ease(v)=1-(1-clamp(v))^3` (spots.js:13).
  - On segment change: toggles `.on` on the timeline segment, chip text and `.you`, `#spair.is-you`; entering `you`: `settled=false`, `#crTunS`="Counting the room"; entering `red` and not settled: `settled=true; tot+=2.5; if(Math.random()<.4) cu++;` `#crTot`=money(tot), `#crCu`=`cu+' customers from the code'`, `#crTunS`="Settled. $1.50 back to your balance", bump animation on `#crCost` (spots.js:74-77). The `i===SEG.length-1` branch does nothing (dead).
  - While in `you`: `n=Math.round(312*ease(u*1.15))` → `#crTun`=num(n), `#crCost`=money(n*8/1000) (spots.js:78). Peaks 312 / **$2.50** (312*8/1000=2.496) at u≥0.8696.
  - i<3 (prog/bump/jun): `#crTun`="0", `#crCost`="$0.00"; i===0: `#crTunS`="Waiting for the break" (spots.js:79). After the spot, values stay at 312/$2.50 through Redlands/ID/Program.
  - Playhead `left=t/26*100%`; clock `clockAt(t)`: base today 20:14:02 + `t*2.1` s, format `h:mm:ss` 12-hour, no am/pm (spots.js:63-64,80).
- Defaults (markup + first frame): `#crTun` 0, `#crCost` $0.00, `#crTot` **$33.02** (`tot=33.02`), `#crCu` "9 customers from the code" (`cu=9`), meter captions "Tuned in for your spot", "This airing costs" / "$8 per 1,000 tuned in", "Tonight, of $300". First frame at T=0 → "Waiting for the break", clock "8:14:02".
- RM still frame T=13.5: Your spot, u=.5, n=round(312*ease(.575))=**288**, cost **$2.30**, product shot with all text.
- `tot` grows $2.50 every 26 s with no cap (passes "of $300" after ~107 loops ≈ 46 min); `cu` random.

**Just booked ticker**: spots.js:87-97. 5 rows `D` [colour, badge number, business, verb, target, price, ago]: Juniper Barber Co. / is sponsoring / Late Crate / $120 a month / 3 min ago; Redlands Hardware / ordered a :30 from / SAZN / quoted $180 / 8 min ago; Cuevas Bakery / booked a :15 on / CIVC and 4 more / $6 per 1,000 / 12 min ago; Sole Shop, online / booked a :30 in / Inland Empire / $9 per 1,000 / 19 min ago; Magnolia Books / is sponsoring / Saturday Reel / $200 a month / 26 min ago. Swap every **3600 ms** (skipped if hidden); old gets `.out`, removed after 400 ms; new inserted after 380 ms. RM: shows the first row, no rotation. Container `aria-live="off"`. Styles from synd.css (`.deals`, `.dl-v`, `.mh-dl` synd.css:171-176,413-418).

**Planner**: IIFE spots.js:100-159.
- Data: `KINDS` (7) Music, Film, Food, Sports, Civic, Talk, Radio; `TIMES` (4) m Morning, d Daytime, p Prime, l Late night; `MKTS` (5) Inland Empire, High Desert, Orange County, Long Beach, Coachella Valley; `P` (13 stations, fields n, cs, c, k kind, city, mk market, mi miles, aud viewers a spot, t{m,d,p,l} breaks a day) (spots.js:103-116):
  CIVC 7.1 Civic Riverside IE mi2 aud140 t2/4/3/1 · NITE 88.4 Radio San Bernardino IE 9 180 2/2/3/5 · SAZN 18.1 Food Fontana IE 11 260 3/4/4/1 · REEL 24.1 Film Redlands IE 13 300 0/2/4/4 · OCAT 60.1 Film "Network catalog" IE 15 210 2/3/3/3 · PREP 31.1 Sports Upland IE 22 520 0/2/5/1 · BEAT 12.1 Music Pomona IE 24 380 0/2/4/5 · ORNG 41.1 Talk Anaheim OC 31 340 3/3/3/1 · MESA 33.1 Music Victorville HD 46 220 1/2/4/3 · LBCH 19.1 Music Long Beach "Long Beach" 52 300 1/2/4/4 · FLDR 92.0 Radio Mojave HD 58 60 1/1/1/3 · VALE 27.1 Film Palm Desert CV 66 190 1/2/3/2 · VOZE 104.2 Radio Coachella CV 72 240 4/3/2/1.
- State `F` default (spots.js:117-118): where 'shop', mi 12, mk {Inland Empire, Long Beach}, all kinds on, all times on, rk 'k', rate 8, bud 300, cap 15.
- Inputs (body.py:65-73):
  - `#pWhere` seg2 shop/online ("In a shop" / "Online"). Shop shows `#pDistW`, online shows `#pMktW` (spots.js:123).
  - `#pDist` range min 2 max 60 step 1 value 12 → label `F.mi+' miles'`; hint "Of 1840 Orange St, Riverside. Change the address when you sign up."
  - `#pMkt` chips (MKTS), `#pKind` chips (KINDS), `#pTime` chips (TIMES): `button[aria-pressed]` toggles (spots.js:119-121).
  - `#pKindR` seg2 k/a ("Per 1,000 tuned in" / "Per airing"). On switch (spots.js:124): k → min 2, max 20, step .5, value 8, label "Rate per 1,000 tuned in"; a → min .5, max 8, step .25, value 2.5, label "Rate per airing".
  - `#pRate` range 2–20 step .5 value 8 → `money(rate)` "$8.00".
  - `#pBud` range 50–2000 step 25 value 300 → `'$'+bud.toLocaleString('en-US')`.
  - `#pCap` range 5–150 step 5 value 15 → `'$'+cap`. `if(F.cap>F.bud) F.cap=F.bud` (label clamps, slider thumb does not move).
  - Each range gets `--p` = fill %.
- Formulas, exactly as coded (spots.js:125-145):
  - `chance(s)`: rk 'k' → `v=(rate-2)/9`; rk 'a' → `v=(rate/(s.aud*8/1000)-.3)/1.1`; return `clamp(.12+v*.85, .08, .97)`.
  - `costOf(s)`: rk 'k' → `s.aud*rate/1000`; rk 'a' → `rate`.
  - Exclusion reason, in order: shop and `s.mi>F.mi` → "Farther than N mi"; online and market not picked → "Not in your markets"; kind not picked → "Not a kind you picked"; then `slots = Σ s.t[time]` over picked times, if 0 → "No breaks at those times".
  - Per station: `p=chance(s)`, `ad=slots*p`, `cost=costOf(s)`.
  - Totals over fitting stations: `ad=Σad`, `tun=Σ ad*aud`, `spend=Σ ad*cost`, `pk=Σp`.
  - `scale = spend>cap ? cap/spend : 1`; ad, tun, spend all ×scale.
  - `days = spend>0 ? bud/spend : 0`.
- Output formatting (spots.js:146-155):
  - `#oSt` = count. `#oAd` = ad≥10 ? Math.round : toFixed(1). `#oTd` = `Math.round(tun).toLocaleString('en-US')`. `#oDays` = spend>0 ? (days≥90 ? "90+ days" : max(1,round(days)) + (" day" if round(days)===1 else " days")) : "—".
  - Pick bar width `round(avg p*100)%`; label: none fit "No one yet", >.75 "Most will", >.5 "Many will", >.3 "Some will", else "Few will".
  - List: fitting stations sorted by `ad` desc, top 6: badge, call sign, `kind · city`, `mi+' mi'` (shop) or market (online) + "about N a spot", `money(cost)` + `(ad*scale).toFixed(1)+' a day'`. If >6: "and N more that fit". Then excluded stations fill to 6 rows: reason, "Won't air". Empty: "Nothing fits yet. Widen the distance or pick more kinds of station."
  - `#pNote`: scale<1 → "Held to your most per day of $<cap>. Raise it to air more often."; else "Estimates from last month's viewing. Stations, viewers and costs here are examples."
  - Stats changing value get `.flash` (spots.js:128).
- **Default outputs (by hand, confirmed in node):** fitting CIVC, NITE, SAZN; p = .12+(6/9)*.85 = .686667 each; slots 10/12/12; ad 6.8667/8.24/8.24 (Σ 23.3467); cost $1.12/$1.44/$2.08; tun 4586.93; spend 36.6955 → scale 15/36.6955 = .40877 → **Stations 3, Airings a day "9.5", Tuned in a day "1,875", Budget lasts "20 days"**, bar 69%, **"Many will"** (markup says "Most will" until JS runs). Rows: NITE $1.44 3.4 a day; SAZN $2.08 3.4 a day; CIVC $1.12 2.8 a day; then REEL, OCAT, PREP "Farther than 12 mi". Note: "Held to your most per day of $15. Raise it to air more often."
  - Online default: 8 fit (7 IE + LBCH), Airings 6.7, Tuned 1,875, 20 days, "and 2 more that fit".
  - Per airing at $2.50: Stations 3, Airings 6.0, Tuned 1,156, 20 days, 92% "Most will".
  - When capped in per-1,000 mode, Tuned a day is always cap*1000/rate and Budget lasts is always bud/cap.

**Receipt (Held/Counted/Settled)**: spots.js:162-192.
- `A` (3 airings; fields b[colour,num,cs], w, held, lines[[label,value,struck?]], billed, cost, bar[[n,colour,label]], s[3 step texts], note):
  - BEAT 12.1 "Late Crate · Tue, 8:14 pm", held 4, lines dial 268 + YouTube relay 44, billed 312, cost 2.5; steps "$4.00 held at 8:13 pm" / "312 people tuned in" / "$2.50 paid, $1.50 back".
  - REEL 24.1 "Saturday Reel · Sat, 9:02 pm", held 4, dial 301 + YouTube with location 37 + "On YouTube, no location given" 21 (struck), billed 338, cost 2.7; "338 counted, 21 not" / "$2.70 paid, $1.30 back".
  - NITE 88.4 "Night Shift · Fri, 11:40 pm", held 2, "Listening when it started" 190 (struck), "Cut off at 0:09 of :15" / "Live hand-off", billed 0, cost 0; "$2.00 held at 11:39 pm" / "Cut short at 0:09" / "$0.00 paid, $2.00 back".
- Rows: "Held before it aired" money(held); lines (animation-delay k*60+60 ms); "Billed: N × $8 per 1,000" money(cost); "Back to your balance" money(held-cost); "This airing cost" money(cost). Viewer bar flex by count, uncoloured = "Not billed".
- `cost` and `held` are literals, not computed (2.5 = 312*8/1000 rounded; 2.7 = 338*8/1000 rounded).
- Step highlight cycles every **1600 ms** (skipped if hidden; RM: static on step 1); tab click resets to step 1.
- Tabs `#rcTabs` click → `show(i)`, sets `.on` + `aria-selected`.

**End card QR + funnel**: spots.js:195-206. Fake 25x25 QR on `#qr` (not scannable). Funnel `F` (4: label, count, colour): Tuned in 18420 `#9A9CAB`; Scanned the QR 212 `#EBA03A`; Saved it for later 96 `#C04A9E`; Used the code 41 `#E0583A`. Width `log10(n)/log10(18420)*100` → 100 / 54.5 / 46.5 / 37.8 %. `#fun.go` added on IO threshold .12 (RM: at once). Static totals agree: 18420×$8/1000 = $147.36; $147.36/41 = $3.59; 17+19+5 = 41.

**FAQ**: native `<details>` × 7 (body.py:179-185), no JS.

**Off-the-shelf toggle**: disabled checkbox "Open for partners" (body.py:161).

#### CTAs and links
| Element | href/handler | file:line | SITE-SPEC §6 row |
|---|---|---|---|
| Hero "Start a spot" (`:15` chip) | `#plan` | body.py:18 | Start a spot (waitlist role business, prefilled from planner / `PUBLIC_BUSINESS_URL/spots/new?…`) |
| Hero "Order one made" ghost | `#ways` | body.py:18 | Order one made (waitlist business "order a spot" / `/orders/new`) |
| Who A/B "Plan a spot" (`a.mf.go`) | `#plan` | body.py:54-55 | in-page anchor |
| Who C "Talk to us" | `#plan` (!) | body.py:54-55 | Talk to a person / Contact us → `/contact` |
| Footer "Start a spot" | `#plan` | ch/footer-spots.html:9 | Start a spot |
| Footer "Order one made" | `#ways` | ch/footer-spots.html:9 | Order one made |
| Footer nav Open the dial / What's on / Stations | `/`, `/#guide`, `/#stations` | footer:16 + build_spots.py:20 | Open the dial (row 1); home anchors |
| Footer nav Run a station / Syndication / Spot market / How breaks work / About / How it's run / Contact | `/run`, `/syndication`, `/spots`, `/#breaks`, `/network`, `/#public`, `/contact` | footer:17-19 | routes; Contact → `/contact` |
| Planner | no submit button anywhere | — | Start a spot needs one (see Problems) |

#### Data arrays in spots/body.py
- `WHO` (3) body.py:40-48: (letter, colour, title, tag, h3, paragraph, rows[(label,value)×2]). A `#E0583A` "You have a shop"/"Set a distance"/"Down the street"/rows Within "8 miles of Orange St", Counted by "Clear Pay at the counter"; B `#5B7BE0` "You sell online"/"Pick markets"/"Ships anywhere"/Markets "Inland Empire, Long Beach", Counted by "Shopify, Stripe or Square"; C `#2F9A72` "You run an agency"/"One login"/"For your clients"/Businesses "As many as you manage", Statements "One per business, monthly". Footer link text: A,B "Plan a spot", C "Talk to us".
- `RG` (5) body.py:166-170: (heading, paragraph): Checked before it airs; Stations choose; Counted, never guessed; Pay only for what aired; Stop any time.
- `shr` (4) body.py:177: (label, to station, we keep): A spot you book 90%/10%; A sponsorship 90%/10%; A spot made for you 80%/20%; A deal our team brought you 80%/20%.
- `FAQ` (7) body.py:179-185: (question, answer).

---

### Network (`/network`)

#### Sections in order (network/body.py line refs)
No `--t > 6`. Kinds cells: `--d` = 4 for k<3 else 6; `--t` = 6 for k==2 else 3 (body.py:82) → desktop 4+4+4 / 6+6, tablet 3+3 / 6 / 3+3.

1. `#hero` `.blk.rhero.nt-hero` (body.py:12-37). H1 "A network," / dim "not a feed."
   - `.cell.hd.rh` `--d:6`: mh "The network" / "About"; lede "Local TV used to work like this: a few stations in every town, each with a number on the dial, paid by the businesses down the street, carrying the best shows from everywhere else. We're rebuilding that for anyone with something worth airing."; buttons; mf "Free to watch. No account to tune in." + `.nt-st` "Before launch".
   - `.cell.tuner#tuner` `--d:6`: mh "The dial" / "Example stations"; market seg `#tnMk`; readout `#tnNum` / `#tnBand` / `#tnCs` / `#tnName` / `#tnWho` (`aria-live="polite"`); "Now" `#tnNow` + kind `#tnKind`; TV band (2–69) and FM band (88–108) with ticks, station markers, needles; controls prev / Scan / next; mf "Every number is unique in its market. Radio sits on even tenths, so no number matches a real FM station."
2. `#what` (body.py:40-53). H2 "Old TV's best idea. / Open to everyone."
   - hd 7 (mh "01 What it is" / "Then and now"); hd 5 (mh "Why a network", lede "Broadcast TV had a schedule, a dial, local ads and shows that travelled. Then the internet gave everyone a channel and took all of that away. We kept what worked and dropped the licence.").
   - `.cell.nw-cmp` `--d:12`: header row "Broadcast TV / Streaming platforms / The network" + 5 `CMP` rows.
3. `#dial` (body.py:56-70). H2 "Every station / gets a number."
   - `.cell.hd` `--d:5;--t:6` (mh "02 The dial" / "Numbers and call signs", lede "A number you can remember and a call sign you can say out loud. It's how people find you again tomorrow.", call-sign checker `.nw-cs#cs`).
   - `.cell.rgl` `--d:7;--t:6` (mh "How numbers work" / "Five rules"): `ol.rg` from `RULES`.
4. `#kinds` (body.py:73-82). H2 "Five kinds / of station."
   - hd 7 (mh "03 On the dial" / "Who's who"); hd 5 (mh "Kinds", lede "They share the dial, the guide and the remote. What differs is who runs them and where the money goes.").
   - 5 × `.cell.knd` (see spans above) from `KINDS`.
5. `#money` (body.py:85-113). H2 "Follow / the dollar."
   - hd 7 (mh "04 Money" / "How it moves"); hd 5 (mh "What we keep", lede "We earn two ways: a small share of what stations earn, and what stations pay for the storage and relays they use. Being on the air is free. Here's where a hundred dollars goes.").
   - `.cell.nw-fd` `--d:8;--t:6;--m:2` (mh "Per $100" / "Pick a kind of money"): seg `#fdSeg`, bar `#fdBar`, 3 rows, `#fdNote`.
   - `.cell.use` `--d:4;--t:6;--m:2` (mh "What stations pay" / "Pay as you go"): "Being on the air" Free; "Storage, after 10 GB" $0.04 a GB a month; "Relays to YouTube and the rest" $0.05 an hour, $25 most; "Live hours, after 5" $0.75 an hour; note "Paid from earnings first. Run short and the channel stays on the air; relays pause after a 14-day grace."
   - `.cell.pool` `--d:12` (mh "The pool" / "On the 1st, for last month"): 3 columns 01 An equal share / 02 A watch-time share / 03 The creator fund.
6. `#locks` (body.py:116-141). H2 "Money we / can't touch."
   - hd 7 (mh "05 Escrow and the fund" / "On-chain"); hd 5 (mh "Why it's built this way", lede).
   - 2 × `.cell.lk2` `--d:6;--t:6;--m:2`: "Paying a creator or a grant" / "2 of 3 keys" (Approve → "72 hours in public" → Paid); "Changing the contracts" / "7-day lock" (Proposed → "7 days in public" → Live).
   - `.cell` `--d:12` `.nw-facts`: Unclaimed after "3 years"; Can pay the network "Never"; Paid into escrow "Weekly"; Anyone can read it "Always".
7. `#standards` (body.py:144-155). H2 "Rules every / station keeps."
   - `.cell.hd` `--d:5;--t:6` (mh "06 Standards" / "Seven of them", lede, `.rrec` "A rule change"/"Dated").
   - `.cell.rgl` `--d:7;--t:6` (mh "On every station" / "For everyone"): `ol.rg` from `STD`.
8. `#faq` (body.py:158-168). **No H2.**
   - `.cell.where` `--d:5;--t:6` (mh "07 Where" / "Markets we're filling first"): `#mkList`; mf "Markets are sets of ZIP codes. Your market decides which stations come first on your dial."
   - `.cell.faq` `--d:7;--t:6` (mh "Questions people ask" / "7 answers"): `<details>` × 7.
9. Footer (ch/footer-network.html): `.claimc` `--d:7;--t:6` "08 Find your number" / "Free to hold", H2 "There's room / on the dial.", lede "Hold a call sign and a number in your market while you get ready. Or just tune in: it's free, and there's no account."; buttons; "Three ways in" `--d:5;--t:6`; same 4 nav cells, wordmark, copyright.

#### Interactive pieces

**Tuner**: network/net.js:29-57.
- Data `MK` (net.js:3-26), 4 markets (id, n, d, st status, on, c, s stations [num, cs, name, who, colour, kind, programs[3]]):
  - ie Inland Empire "Riverside and San Bernardino counties" "Opening first" on `#5B7BE0`, 8: 7.1 CIVC Listed; 12.1 BEAT Station; 18.1 SAZN Claimable; 24.1 REEL; 31.1 PREP; 60.1 OCAT Catalog; 88.4 NITE; 99.2 LOFI Catalog.
  - la Los Angeles "Los Angeles County" "Next" off `#C04A9E`, 5: 19.1 LBCH; 22.1 ECHO; 36.1 CORT; 45.1 PASA Listed; 96.6 SURF.
  - oc Orange County "Next" off `#E0583A`, 3: 14.1 SKAT; 41.1 ORNG; 101.4 TIDE.
  - hd High Desert "Victorville to the Mojave" "Opening first" on `#C9709A`, 3: 33.1 MESA; 66.1 ROUT; 92.0 FLDR.
- `pos(n)`: FM (≥88) `(v-88)/20`, TV `(v-2)/68`. Ticks: TV 2..69 step 1, major every 10; FM 88..108 step .4, major every 2 (net.js:33-35).
- `list()` = market stations sorted by number. `tune()`: wraps k, flick animation, fills readout, `#tnNow` = `programs[new Date().getHours() % 3]`, `#tnKind` = kind, `--c` = colour, moves the band needle (other band's needle `.idle`), `.on` on marker (net.js:41-47).
- Initial: market 0, `k=1` → **12.1 BEAT, TV, "Beat Tape TV", "Run by a crate digger in Pomona", kind "Station"** (net.js:56); needles init TV .15, FM .2.
- Auto-scan: every **3200 ms** `k++` if scan && in view (IO) && tab visible (net.js:49-50). `scan=!RM`; RM → `setScan(false)` (label "Scan").
- Market click: `k=0`, rebuild markers, tune. Marker click / prev / next: set k, stop scan. Scan button toggles; text "Scanning"/"Scan", `aria-pressed`.

**Call-sign checker** (shared validation source): network/net.js:60-75; markup body.py:63-68.
- Markup: `<label for="csIn">Try a call sign</label>`; `<input id="csIn" type="text" maxlength="5" autocomplete="off" spellcheck="false" value="TACO" aria-describedby="csOut">`; suggested number `span.nw-csch` (static "12.4"); checklist `ul#csCk`; result `p#csOut aria-live="polite"`.
- Normalise: `v = inp.value.toUpperCase().replace(/\s/g,'')`; writes back into the input if changed (net.js:66). Other characters (digits, hyphens, accents) are kept and fail the letters test.
- Rules, as coded (net.js:67):
  - `letters = /^[A-Z]{3,5}$/.test(v)` (ASCII A–Z only, 3–5).
  - `kw = v.length===4 && /^[KW]/.test(v)` (checked on raw length, even with non-letters).
  - `brand = BRANDS.indexOf(v)>=0 || DENY.indexOf(v)>=0` (exact match only).
  - `taken = TAKEN[v]`.
- Lists, verbatim (net.js:62):
  - `BRANDS` (25): `ABC, CBS, NBC, NPR, PBS, FCC, FOX, CNN, HBO, ESPN, MTV, BBC, AMC, TBS, TNT, CSPAN, UPN, ION, HGTV, WGN, KTLA, KCAL, TCM, BET, QVC`.
  - `DENY` (alert words, 3): `ALERT, EAS, SOS`.
- "Already on the dial" source: `TAKEN[cs] = num+' in '+market` over all 4 `MK` markets (net.js:63), 19 signs: CIVC, BEAT, SAZN, REEL, PREP, OCAT, NITE, LOFI, LBCH, ECHO, CORT, PASA, SURF, SKAT, ORNG, TIDE, MESA, ROUT, FLDR.
- Checklist (always 4 rows, `li.no` when failing, icon "✓" pass / "×" fail) (net.js:68-69):
  1. "Three to five letters, A to Z"
  2. "Not four letters starting with K or W"
  3. "Not a network, a brand or an alert word"
  4. taken ? `"Already "+taken` (e.g. "Already 12.1 in Inland Empire") : "Not on the dial yet"
- `ok = v.length && all four pass`. Result class `nw-csout ok|no` (empty input gets `no`, red).
- Result message priority, verbatim (net.js:72):
  1. empty → "Type a call sign to check it."
  2. ok → `V+" is free. Reserve it and we hold it for 120 days."`
  3. kw → "Too close to a real FCC call sign. Try three or five letters."
  4. !letters → "Letters only, three to five of them."
  5. brand → "That one belongs to someone else."
  6. else (taken) → `V+" is taken. Try another."`
- Suggested number (net.js:64-65,73): shown only when ok, else "--.-". `used` = numbers in `MK[0]` (Inland Empire only): 7.1, 12.1, 18.1, 24.1, 31.1, 60.1, 88.4, 99.2.
  ```
  h=0; for each char: h=(h*31+charCode)%997
  for t=0..69: n=2+((h+t*7)%66); c=n+'.'+(1+(h%4)); if(!used[c]) return c
  return '50.1'
  ```
  So it is always TV, major 2–67, minor .1–.4, deterministic per call sign. Default "TACO" → h=787 → **"63.4"**; the checker loads showing "TACO is free. Reserve it and we hold it for 120 days.", all four ✓. (Others: DIAL 16.1, VOZE 38.1, KAT 2.1.)
- Runs on `input` and once on load.
- Related hold copy (RULES, body.py:56-60): rule 1 "A number in your market": "TV from 2.1 to 69.9, radio from 88.2 to 107.8. Each number belongs to one station in each market."; rule 2 "A call sign that's yours": "Three to five letters, unique across the whole network. Pick it once: it can't change after you sign on."; rule 3 "Nothing that looks official": "No four-letter signs starting with K or W, which look like real FCC stations, and no network or brand names."; rule 4 "Hold one before you're ready": "Reserve a call sign and a number on the waitlist. It's held for 120 days, with a reminder before it lapses."; rule 5 "Sign off for good, and it's kept": "Your call sign stays yours for a year. The number goes back to the market after 90 days."

**Follow the dollar**: net.js:78-93. `D` (4: a station, b network, p pool flag, l label, n note): A spot it booked 90/10 p1 "To the station"; A spot we brought 80/20 p1; A pledge 95/5 p0; Cash carriage 95/5 p0 "To the maker". `pool = p ? b*.25 : 0` → bar flex A=a, B=b-pool, C=pool (hidden if 0); bar labels "$a", "$b" only if b≥10; rows `$a.toFixed(2)` / `$b.toFixed(2)`; last row "Shared monthly" / "Not from this kind". Default: $90.00 / $10.00, bar 90 / 7.5 / 2.5. Notes verbatim in net.js:80-83.

**Locks animation**: net.js:96-101. Per `.lk2`: IO threshold .3 → add `.go`, then every **7000 ms** remove `.go` and re-add after **700 ms**; cleared when out of view. RM: `.go` permanently. CSS timing: time bar 2.6 s linear after .5 s, done dot after 3.2 s (net.css:123-131).

**Markets list**: net.js:104-105 → `#mkList` rows: dot (filled if on, outline `.soon`), name, `d+' · '+count+' example stations'`, status em. IE 8, LA 5, OC 3, HD 3.

**FAQ**: `<details>` × 7, no JS.

#### CTAs and links
| Element | href/handler | file:line | SITE-SPEC §6 row |
|---|---|---|---|
| Hero "Open the dial" (live chip `.js-ch` = 12.1) | `/`, `data-cur="Watch"` | body.py:19 | Open the dial / Watch (`PUBLIC_WATCH_URL`, live `/?ch=<number>`) |
| Hero "How the money moves" | `#money` | body.py:19 | in-page anchor |
| Checker free result | **no element**: text only in `#csOut` | net.js:72 | "Reserve it and we hold it for 120 days" → waitlist station, prefilled call sign + suggested number |
| Footer "Claim a number" (chip "NEW") | `/run`, `data-cur="Claim"` | ch/footer-network.html:9 | Claim a number (Network) → waitlist station / `PUBLIC_APP_URL/control/claim?number=&callsign=` |
| Footer "Open the dial" ghost | `/` | ch/footer-network.html:9 | Open the dial |
| Footer nav | same as Spots | footer:16-19 | routes / `/contact` |
| Tuner prev/next/scan/markers/market seg | JS buttons | net.js:51-55 | n/a |

#### Data arrays in network/body.py
- `CMP` (5) body.py:40-44: (row label, broadcast, streaming, network). Who can start a channel; How you find it; What's on at 9 pm; Who pays for it; How shows travel.
- `RULES` (5) body.py:56-60: (heading, paragraph), quoted above.
- `KINDS` (5) body.py:73-77: (colour, name, tagline, paragraph, example): Stations `#C04A9E` "12.1 BEAT, 24.1 REEL"; Studios `#EBA03A` "Pomona Vinyl Club"; Claimable `#5B7BE0` "18.1 SAZN"; The catalog `#9A9CAB` "60.1 OCAT"; Listed `#2F9A72` "7.1 CIVC".
- `STD` (7) body.py:144-150: (heading, paragraph).
- `FAQ` (7) body.py:158-164.
- Hard-coded in markup (not arrays): use rows (4), pool columns (3), `nw-facts` (4), two `tl3` timelines.

---

### Constants (file:line)

Spots
- Rate default **$8 per 1,000** tuned in: body.py:28 (caption), body.py:71 (`value="8"`), spots.js:78 (`n*8/1000`), :117 (`rate:8`), :124 (reset 8), :125/:178 (receipt "× $8 per 1,000"), :167 (note). Matches §5 "About $8 per 1,000".
- Planner ranges: distance 2–60 step 1 default 12 (body.py:66); rate per 1,000 2–20 step .5 default 8 (body.py:71, spots.js:124); rate per airing .5–8 step .25 default 2.5 (spots.js:124); budget 50–2000 step 25 default 300 (body.py:72); most per day 5–150 step 5 default 15 (body.py:73).
- Chance: `(rate-2)/9`, `aud*8/1000`, `-.3`, `/1.1`, `.12+v*.85`, clamp `.08`–`.97` (spots.js:125). Days cap "90+" (spots.js:146). List limit 6 (spots.js:150). Pick thresholds .75/.5/.3 (spots.js:148).
- Control room: SEG durations 4,2,4,7,4,2,3 (TOT 26 s) (spots.js:54-60); peak 312 viewers, `ease(u*1.15)` (spots.js:78); start total $33.02, +$2.50 per loop, start 9 customers, +1 with p=.4, "$1.50 back" literal (spots.js:63,77); "Tonight, of $300" (body.py:29); clock 20:14:02, ×2.1 (spots.js:63-64); frame throttle 45 ms, RM T=13.5 (spots.js:82-83); canvas 640×360 at scale 2 (body.py:24, spots.js:10).
- Ticker prices: $120 a month, quoted $180, $6 per 1,000, $9 per 1,000, $200 a month; 3600 ms / 400 / 380 ms (spots.js:88-96).
- Receipts: held $4/$4/$2; billed 312/338/0; cost $2.50/$2.70/$0 (spots.js:165-173). Steps 1600 ms (spots.js:188).
- Funnel: 18420 / 212 / 96 / 41 (spots.js:201); "$147.36", "$3.59" (body.py:126); 17 / 19 / 5 (body.py:128-130).
- Shares (`shr`): book 90/10, sponsorship 90/10, made for you 80/20, team-brought 80/20 (body.py:177).
- Copy figures: "Good for 7 days" (body.py:118); end card "0:12" (body.py:116); lengths :15/:30/:60 (body.py:143-144); "Roasted on Orange Street since 2011" (body.py:149); "within 8 miles of Orange St" (body.py:41); address "1840 Orange St, Riverside" (body.py:66); footer "About 10 minutes", "10% off. Good for 7 or 30 days" (footer-spots.html:13-14); "a few minutes after it ends" (FAQ body.py:182).

Network
- Number ranges: TV 2.1–69.9, radio 88.2–107.8 (body.py:56); bands "2–69" / "88–108" (body.py:31-32); tick math `(v-2)/68`, `(v-88)/20`, steps 1 and .4, majors 10 and 2 (net.js:33-35).
- Call sign: 3–5 letters, 4-letter K/W banned (net.js:67); `maxlength="5"` (body.py:65); hold **120 days** (body.py:59, net.js:72); call sign kept 1 year, number back after 90 days (body.py:60); hash `*31 %997`, `t<70`, `t*7 %66`, `2+`, `.1+(h%4)`, fallback "50.1" (net.js:65); static placeholder "12.4" (body.py:65).
- Scan 3200 ms (net.js:50); locks 7000 / 700 ms, IO .3 (net.js:100); CSS .5 s, 2.6 s, 3.2 s (net.css:126-131).
- Shares (`D`): 90/10, 80/20, 95/5, 95/5; pool = 25% of the network share for spot kinds (`d.b*.25`) (net.js:80-85).
- Usage: storage after 10 GB $0.04 a GB a month; relays $0.05 an hour, $25 most; live hours after 5, $0.75 an hour (body.py:103); 14-day grace (body.py:103, :150).
- Governance: 2 of 3 keys, 72 hours, 7-day lock (body.py:120-131); 3 years, Weekly (body.py:136-138); "Three upheld claims in a year" (body.py:147); "three minutes of spots an hour" (body.py:149); TV-Y to TV-MA (body.py:148).
- Markets: 4, with 8/5/3/3 example stations (net.js:3-26).

Spots page vs SITE-SPEC §5: $8/1,000 ✓; 90/10 booked ✓; 80/20 Dial-sourced / agency-made ✓; "A sponsorship 90/10" is not in the §5 table. Network vs §5: 90/10, 80/20, 95/5 pledges, 95/5 cash syndication ✓; usage figures ✓ but drops "relays for live shows only: free" and "live radio hours: free"; backfill 80/20 not shown; pool 25% and 14-day grace are not in §5.

---

### Problems

Can't build as drawn / missing CTAs
- Spots planner has no "Start a spot" button. §6 needs the waitlist prefilled "from the planner" (where, kind, time, budget, cap); the hero and footer "Start a spot" only link to `#plan` (body.py:18, footer-spots.html:9). A planner submit is needed.
- "Order one made" links to `#ways` (body.py:18, footer-spots.html:9), and the "Made for you" cell has no button (body.py:153-158). §6 wants waitlist business "order a spot".
- Who C "Talk to us" goes to `#plan` (body.py:55); §6 says `/contact`.
- Network checker has no Reserve button: the free result is plain text in `#csOut` (net.js:72). §6 needs a button prefilled with call sign + `.nw-csch` number.
- Network footer "Claim a number" is `/run` (footer-network.html:9); §6 says waitlist station.
- Suggested number avoids only Inland Empire numbers (`used` from `MK[0]`, net.js:64). It ignores the market the user picks and never suggests radio. A shared validator needs a market input.
- "Already on the dial" draws on 19 signs from `MK` only (net.js:63). Other pages show signs it doesn't know: VOZE (shared_data.js:11, spots.js:116), VALE (spots.js:115), and 48 signs in syndication (synd.js:129: DUNE, PALM, MOJO …). Those report "is free". There are 4 station rosters with conflicting data (shared_data.js, spots.js `P`, net.js `MK`, synd.js `CS`), e.g. SAZN's "who" text, BEAT/REEL/PREP program lists, LBCH market "Long Beach" (spots.js:113) vs Los Angeles (net.js:14), and Coachella Valley in the planner but not in the network's markets.
- The block list doesn't include the product's own name: "DIAL" passes as free (16.1). Matching is exact only ("FOXY", "ESPNX" pass). No profanity list.
- `pl-none` "Nothing fits yet…" (spots.js:154) can't appear: excluded stations always fill the list.
- Spots `cost`/`held` receipt values are literals, not formula outputs (spots.js:165-173). The hold rule (e.g. $4 for a :15) is undefined anywhere.

Broken / inconsistent behaviour
- Control-room "Tonight" total grows forever (+$2.50 per 26 s loop, spots.js:77). It passes "of $300" (body.py:29) after ~46 min and conflicts with the planner's default $15 most-per-day ($33.02 "tonight" > $15/day).
- `if(i===SEG.length-1||sg.k==='red')` outer branch is partly dead (spots.js:77). "$1.50 back" is hard-coded, not hold − cost.
- Segment durations don't match their labels: "Your spot, :15" lasts 7 s; Juniper ":15" and Redlands ":30" both 4 s (spots.js:56-58).
- RM: the control room keeps a rAF loop redrawing the same frame every 45 ms (spots.js:82). Canvas fixed at 2x (spots.js:10); §8 wants box-sized, DPR capped at 2. No pause beyond IO/hidden. The ticker and steps intervals keep running while off screen (only `document.hidden` checked, spots.js:96,188).
- Cap clamp: `F.cap=F.bud` changes the label but not the `#pCap` slider (spots.js:131).
- Pick label in markup "Most will" (body.py:84) becomes "Many will" on load; `#oSt`/`#oAd`/`#oTd`/`#oDays` markup "0" (body.py:79-82) flash before JS. Network `.nw-csch` static "12.4" vs computed "63.4" (body.py:65). Render on the server.
- Case-normalising rewrites `inp.value` on every input (net.js:66), so typing lowercase mid-string jumps the caret to the end.
- Empty checker input shows the "no" (red) style (net.js:71). With "K1A2" the K/W message wins over "letters only" (net.js:72).
- Markets list marks High Desert "Opening first" (net.js:23). FAQ (body.py:159) and SITE-SPEC §7 say Inland Empire first, then LA and Orange County.
- Network `use` cell says relays "$0.05 an hour, $25 most" with no "live shows only: free" option (body.py:103); §5 has it.
- Pool = 25% of the network's cut (net.js:85) is a visual constant with no copy or spec backing.
- Spots FAQ footer calls it the "co-op pool" (body.py:187); network calls it "The pool" (body.py:106).
- Who card A "8 miles" (body.py:41) vs planner default 12 miles (body.py:66). Hero lede ":15 or :30" vs ":15, :30 or :60" elsewhere.
- Ticker badge "88.4" for an online market buy (spots.js:91).
- Global selectors: `document.querySelector('.fd-r:last-child b')` (net.js:89), `document.querySelector('.nw-csch')` (net.js:73).
- Dead CSS from hero v1: `.spair`, `.sa-*`, `#spair .w-foot b.bump`, `@keyframes oain/settle` (spots.css:8-35, 175-184, 214). Hero h1 size declared 8 times (spots.css:209-216, 223, 252, 254); only `.sp-hero .cr-l h1.sy-h` matters.
- Fake QR (spots.js:14-16, 196-199) isn't scannable; fine as decoration, but copy says "Viewers can scan it from a TV".

Class/id collisions (shared/run/synd CSS loaded under these pages)
- `.cr` (big one): the hero control-room cell is `.cell.cr#spair` (body.py:22). run.css:146 `.cr{display:grid;gap:10px}` (calculator row) loads after grid.css `.cell{display:flex;flex-direction:column}` and wins, so the hero cell renders as a grid with 10px gaps. spots.css:224-229 `.cr …` rules are meant for the hero but `.cr` also names every planner row (body.py:65-73). Also synd.css:259-260 `.cr.big`. Rename (e.g. `.ctl-room`) and decide which layout is intended.
- `.out`: run.css:156 `.out{display:grid;border-top:1px solid var(--rule)}` hits `.pr.out` planner rows (spots.js:153; adds a top border) and the ticker's exiting `div.out` (spots.js:94; switches flex→grid and adds a border for 400 ms).
- `[hidden]`: `#pMktW` is `.cr[hidden]` (body.py:67); run.css `.cr{display:grid}` beats the UA rule, hence the global `[hidden]{display:none!important}` in spots.css:212 (also loaded on network). synd.css:255 `#earn [hidden]` does the same. Keep one global `!important` rule (§8).
- `.side` (spots who cells) styled by synd.css:39-41; `.dim` global in run.css:5; `.rh` in run.css:12-15 + synd.css:167-169; `.claimc` in run.css:202-203; `.faq/.qs` in run.css:189-194; `.rg`, `.trm`, `.otl`, `.is-later`, `.tg`, `.stps`, `.shr2/.s2/.sk/.nk/.hd2`, `.rrec/.rr-l/.rr-h/.rr-ok`, `.deals/.dl-k/.dl-v/.mh-dl`, `.sy-h`, `.lede`, `.rs-k`, `.w-foot` all come from synd.css; `.crh`, `.sk/.nk` also in run.css:390-406. These pages can't render correctly without run.css + synd.css; a port must lift these into shared components.
- `.lb` defined 5+ times: global in spots.css:6 and net.css:6, `.cr .lb` run.css:147, `.f-grp .lb` synd.css:52, `.peek .lb` head.html:189.
- `.badge` re-sized per context: polish.css:172, shape.css:29, synd.css:19,176,295, spots.css:26,66,80,226.
- `.go`: spots `a.mf.go` (body.py:54), `.fun.go` (spots.js:204), net `.lk2.go`; polish/head `.sg .go`, `.door .go`, `.power.go`; footer `.signoff.go`. All the same token with different meanings.
- `.on`, `.you`, `.x`, `.no`, `.d`, `.tot`, `.hot`, `.bump`, `.dot` are scoped by parent today (e.g. `.pr .d` vs head `.cur .d`; `.rl.tot` vs synd `.ro.tot`; `.nw-csck li.no` vs run `.vc b.no`; `.rl.x` vs nav `.mob .x`). They are fragile, not broken.
- §8 list: these pages already dodge `.tl` (`.cr-tl`, `.tl3`; head.html:223 `.tl div` would hit a bare `.tl`), `.band` (`.nw-band`), `.cmp` (`.nw-cmp`), `.fd` (`.nw-fd`, `.fd-*`; run.css:115 `.fd code`), `.big` (`.us-big`; head `.cur.big`, synd `.cr.big`). Not used here: `.oa`, `.onair`, `.rc`, `.who` (only as an id), `.off`, `.tick`.
- Ids repeat across pages (`#hero`, `#who`, `#faq`, `#plan`, `#money`), but no base CSS targets them (checked).
- Unstyled hooks: `.rgl`, `.rct`, `.where`, `.pool`, `.more` exist in markup with no rules.

Accessibility
- Network tuner station markers are focusable `<button>`s inside `aria-hidden="true"` bands (body.py:31-32, net.js:39).
- `.tn-read` `aria-live="polite"` plus auto-scan every 3.2 s (body.py:26, net.js:50) means constant announcements.
- The "Just booked" ticker (3.6 s) and the steps highlight (1.6 s) rotate with no pause control (WCAG 2.2.2) (spots.js:96, 188).
- Receipt tabs: `role="tablist"`/`role="tab"` with no initial `aria-selected`, no `aria-controls`/`tabpanel`, no arrow keys (body.py:96, spots.js:190).
- seg2 groups (`#pWhere`, `#pKindR`, `#tnMk`, `#fdSeg`) show state only through `.on`, with no `aria-pressed`/`aria-checked` (body.py:65,70,90; net.js:36).
- Range labels wrap the value `<b>` ("Within12 miles") and have no `aria-valuetext` for money (body.py:66-73).
- The `#faq` sections on both pages have no heading, so FAQ/share/markets content sits under the previous H2 in the outline (body.py:186-188 both files).
- The control-room meter numbers update every 45 ms in the accessibility tree.
- seg2 buttons aren't equal width (polish.css:67-68), against §3 "equal width"; only `.rc-tabs` on phones uses `repeat(3,1fr)` (spots.css:189).

"Opencast" in copy
- No literal "Opencast" in spots/network copy. Vestige: catalog call sign **OCAT** ("Opencast catalog") on 60.1: shared_data.js:8, spots.js:108, net.js:10, network body.py:76 ("60.1 OCAT"), synd.js:129, home.js:21. It's also reserved as "taken" by the checker. Decide whether to rename.

---

