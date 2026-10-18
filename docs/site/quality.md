# Dial site: quality (Phase 4)

Measured 2026-10-18 on the production build (`npm run build -w @opencast/site`) served by `apps/site/scripts/serve.mjs`, the server Railway will run. Chrome stable, headless.

## Lighthouse (mobile)

Lighthouse 12.8.2, default mobile settings (Moto G Power, simulated slow 4G, 4× CPU).

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| Home | 97 | 96 | 100 | 100 | 2.3 s | 0.003 | 0 ms |
| Run | 97 | 100 | 100 | 100 | 2.3 s | 0 | 10 ms |
| Syndication | 98 | 100 | 100 | 100 | 2.3 s | 0 | 0 ms |
| Spots | 97 | 100 | 100 | 100 | 2.3 s | 0 | 0 ms |
| Network | 98 | 100 | 100 | 100 | 2.3 s | 0.001 | 40 ms |
| Contact | 96 | 100 | 100 | 100 | 2.6 s | 0 | 0 ms |

- **404:** Lighthouse won't score a page that answers 404, so it isn't in the table. axe covers its accessibility, and it's `noindex`.
- **Home accessibility (96):** the remaining audit is target size on the phone dial. The nine station marks sit 16px apart on two side-by-side rulers. They were 7px wide and are now 24px, but they can't be 24px apart without redrawing the dial. The guide rows and the station cards below tune the same stations at full size, which is WCAG 2.5.8's "equivalent" exception.
- **Lighthouse's label-content-name-mismatch:** it flags the guide rows, whose names are "Tune to 7.1 CIVC, Civic Channel" while the rows also show program names. It's weighted 0 and not part of axe's standard rules.

Before the fixes below, Syndication scored 80 on performance (CLS 0.36), Home 90 (TBT 240 ms), and Contact 96 on best practices.

## Tests

`npm run test:e2e -w @opencast/site` runs 64 Playwright tests against `serve.mjs` (system Chrome, Los Angeles time zone). `npm test -w @opencast/site` runs 59 unit tests. All pass.

| Spec | What it checks |
|---|---|
| `e2e/a11y.spec.ts` (25) | axe on all 8 routes (with `/no-such-page` and `/_kit`) at 1440, 820 and 390, plus the open menu and waitlist sheet. No serious or critical violations |
| `e2e/keyboard.spec.ts` (14) | Focus kept in the menu, the waitlist sheet and the filter sheet, all closing on Escape; visible focus; the skip link; the switchboard, receipt tabs and tuner from the keyboard; reduced motion (no smooth scroll, still tickers and scenes, no cursor); no console errors or CSP violations on 7 routes (it now listens for violations directly, so a caught one like Zod's counts) |
| `e2e/flows.spec.ts` (12) | Tune the nav; Claim a number from Run through the waitlist sheet; filter the syndication market on desktop and on a phone; plan a spot and start it; check a call sign and reserve it; a contact message to each of the six desks |
| `e2e/budget.spec.ts` (8) | Per page, at DPR 3: under 60KB of gzipped JS, every canvas at most 2× its CSS size, layout shift under 0.02 through fonts and scripts. Plus an animated canvas that stops drawing off screen and starts again on screen |
| `e2e/server.spec.ts` (5) | 301s for `/spot-market`, `/about`, `/stations`; clean URLs; the 404 status and page; robots and sitemap; security and cache headers |

## Budgets

| Page | JS, gzipped (with Lenis, 8.1KB) |
|---|---|
| Home | 26.1 KB |
| Run | 21.8 KB |
| Syndication | 22.9 KB |
| Spots | 24.0 KB |
| Network | 16.3 KB |
| Contact | 39.4 KB (Zod and the contracts' schemas are 24.6 KB of it) |
| 404 | 10.9 KB |

The waitlist sheet and the call-sign check load when first used.

## What changed in Phase 4

**Contrast.** axe found 345 text nodes under 4.5:1, all from the reference. They're fixed in one block at the end of `src/styles/global.css` and listed in `open-questions.md` Q15:
- black text on station-colour fills;
- 13% cream mixed into station-colour text;
- dim text raised to about 50% cream;
- spots that won't air greyed out instead of faded.

The BEAT and PREP inks moved to `#C75FA6` and `#4D87C8` (Q5).

**Layout shift.**
- Syndication's carriers are placed by CSS from positions in the markup. A script used to place them after load, so they jumped.
- Home's power-on line no longer moves its box as it grows.
- The body face (Instrument Sans 400) is preloaded. It had been arriving late and rewrapping the heroes' ledes.

**Best practices.** Zod runs jitless (`src/lib/zod.ts`). Its `new Function` probe was a CSP violation on every page that parses.

**Canvases.** `fit()` sizes to the layout box rather than the drawn box. Syndication's live tiles, scaled to 1.04, had gone just past DPR 2.

**Smaller fixes.**
- The nav's tuner link takes its name from what it shows ("12.1 BEAT Now Late Crate Watch") instead of a label that didn't match.
- The dial's station marks are 24px targets.
- The axe spec waits for the menu's and sheet's entrance animations before scanning, and prints colours for contrast failures.

## Still on mocks

With `PUBLIC_API_URL` blank, the site answers from `src/mocks`. With it set, these calls go to the API, and the ones marked (proposed) need contract changes first (`docs/contract-requests.md`):

| Call | Contract | State |
|---|---|---|
| Waitlist (every CTA) | `waitlist.join` | Live contract. The held channel number (D1) and signup details (D2) are proposed; the site sends what the contract takes today |
| Call-sign check | `callSignRefusal()` in the contracts, run in the page | Local by design: the same function the API runs |
| Contact form | `POST /contact` (D3, proposed) | Mocked. Against a live API that doesn't have it yet, the form hands the message to the visitor's email app, addressed to the desk |
| Visitor-facing API copy | D4 | The site shows its own words until the API says Dial |

The platform values the site states (DX1–DX3: relay price and cap, Dial's shares, revenue-share carriage) are in `open-questions.md` Q1–Q3.

## Parity after Phase 4

Regenerated with `npm run parity -w @opencast/site -- <page>` (`docs/site/parity/*.md`; each report's Notes now say what Phase 4 changed).

| Page | Worst section, Phase 3 | Worst section, Phase 4 | What moved |
|---|---|---|---|
| Home | 0.43% (crawl, 1440) | 0.43% (crawl, 1440) | Nothing measurable |
| Run | 3.01% (hero, 390) | 3.01% (hero, 390) | Nothing (the hero's differences are Phase 2's, documented) |
| Syndication | 2.12% (terms, 820) | 2.34% (terms, 820) | Black labels on the term bars; escrow's creator-fund node no longer faded |
| Spots | 4.63% (plan, 390) | 5.22% (plan, 390) | Won't-air rows are solid with grey badges; black badge text |
| Network | 14.46% (dial, 390) | 14.46% (dial, 390) | Nothing (Reserve it button and the 390 overflow fix, Phase 2) |

Spots' planner at 390 is the one section past 5%, and it's all the contrast fix.
