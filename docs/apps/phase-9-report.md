# Phase 9: real data, tests and cleanup (report)

2026-09-28, branch `apps`. How to run everything is in [testing.md](testing.md).

## Test results

Every run below passed with one Playwright worker, no retries.

### Playwright on the mocks (`npm run e2e`)

| Product | Specs | Tests | What they cover |
|---|---|---|---|
| Viewer | viewer.a11y, viewer.flow | 194 | axe on every route and overlay, both grounds, 1280 and 390 (192); first visit, tune in, save a preset through sign-in, a reminder, on web and phone (2) |
| Master control | control.a11y, control.flows, control.contrast | 315 | axe on every route, both grounds, 1280 and phone, as each mock person (308); first sign-on, carry a program, fill a break from the market, approve a sponsorship (4); station colours and both pickers (3) |
| Business | spots.a11y, spots.flow | 11 | axe on every route, modal and sheet, both grounds, 1280 and 406, as owner, manager and viewer (9); fund, list a spot, pause and resume it, sponsor a program, order and approve a spot, on web and phone (2) |
| TV mode | tv.a11y, tv.flow | 26 | axe on 24 screens and states, including the Cast receiver and the iPhone's second screen; channel by arrows and number, the guide, the sleep timer to its end; a phone over the relay |
| Desk | desk.a11y, desk.flow | 43 | axe on every route, both grounds (40); found to on air across the desk and the viewer's permission page, Add a creator, signing in through the page (3) |
| Site | site.a11y, site.tuner, site.waitlist | 14 | the page at 1280 and 390, both grounds, the ground toggle; the tuner; the waitlist (free and taken call signs, a ZIP outside every market) |

About 600 tests. No axe rule is skipped anywhere. Four regions are excluded, each with its reason in the spec (A111, A114).

### Playwright against the real API (`npm run e2e:real`)

The real v1 API on a throwaway database, seeded; each app in e2e mode with the dev-only test-token sign-in. No outside service is called.

| Product | Tests | What they cover |
|---|---|---|
| Viewer | 36 | every route and overlay as a seeded viewer and signed out; first visit, tune in, a preset through sign-in, a reminder, a pledge change, each checked through the API |
| Master control | 44 | every station route; carry, fill breaks, approve a sponsorship, start a new station |
| Business | 32 | every route; start a business, upload a real clip through the checks, list, review, rotation, pause and resume, a sponsorship credited on air, an order quoted and accepted |
| TV mode | 24 | every screen signed out and in; sign-in by code, the dial, a guide reminder, settings saved to the account and picked up by a second TV, presets; a phone driving the TV through the relay, another account refused |
| Desk | 26 | every route as an admin, a non-admin kept out; a creator set up from a recipe; asking with a work left out; held earnings |
| Site | 7 | the page; the waitlist posting to the real API |

169 tests.

### Unit tests (Vitest)

Viewer 326, master control 312, business 178, TV mode 185, desk 48, site 45, `packages/ui` 162, `packages/player` 47. Every app type-checks. The API's own suite passed on `monorepo` (171 plus 20 for the TV devices, relay and markets).

### Contrast on station colours

Every station colour in every app's fixtures holds 4.5:1 against white; the lowest is REEL #9A5412 at 5.75:1. Master control's and the desk's colour pickers refuse a colour under 4.5:1 and print the ratio. The viewer's fallback colour is #33507A (8.17:1).

## Fixed in this phase

- **Accessibility, shared:** the Opencast lockup's role; a focusable scrolling `main` in every shell; the progress bar's name; the log timeline's selectable blocks; past schedule rows at `ink-50` instead of faded; the banner always on the dark tokens (its times read on the light ground).
- **Accessibility, per app:** presets' live region outside the list, the keypad's digits, no button inside the Studio picture's image, the log's week view as a focusable region, the desk board's slot numbers at full white.
- **Behaviour:** signing in through the page no longer leaves a blank page (control, business, desk); TV mode's first tune waits for both bands; `/radio` keeps its own tune; the new channel's banner after tuning from the guide; a hand-paused spot reads as waiting for you.
- **Real API:** a route the API hasn't mounted reads "This isn't available yet." instead of "Something went wrong"; screens whose proposed fields are missing hide what depends on them (listings, a library item's history, sponsor targets, receipts, the place lookup, the desk's setup read-back).
- **Cleanup of the old web app:** its lock-file entry, control's `/api` proxy and a stale README line are gone. What's left is the API's own legacy `/api` routes and `SERVE_WEB_APP` hosting, which belong to the platform (listed below).

## Still on mocks

Each item is a proposed endpoint or field the API doesn't have yet (request ids from [contract-requests.md](../contract-requests.md)). On the real API each screen degrades as described; in `dev:mock` it works as drawn.

**Endpoints the API doesn't mount (35 of the 36 proposed; only `PATCH /me/pledges/:id` exists):**

| App | Request | Without it |
|---|---|---|
| Viewer | A1 sign out everywhere, A2 watch history, A3 export and delete account | "This isn't available yet."; the account is left as it was |
| Viewer | E1 pledge card session | the Card row is hidden |
| Viewer, desk | B8 stop or claim from the permission link | the page keeps its state; claim works once there's a station (`startHandover`) |
| Master control | A5 `/me/stations/status` | the switcher leaves out on-air and dead-air state |
| Master control | A4 hosts | live sources load without the hosts |
| Master control | G5 listings GET/PATCH | "Listings can't be edited here yet." |
| Master control | L5 library history | "In the log" and "Aired" are left out |
| Master control | L6 replace a file, L7 captions, S15 lower third, G3 end early | a toast when used |
| Master control | N10 claim page, B6 claim attachments, P24 tell me when listed | Not found; can't send a file; the action fails |
| Business | P16 sponsor targets | "The stations and programs that take sponsors can't be listed here yet." (a sponsorship can't be started) |
| Business | E4 receipts | a note pointing to Balance, Statements |
| Business | P20 connections | the section hides |
| Business | P12, B5 redeem today and check | Redeem handles the 404 |
| Business | P10 place lookup | only Online works |
| Business | P9 category reach | the reach bar is hidden |
| Business | P11 logo, P26 edit a location, P21 close, E5 funding-source delete and default | "That isn't available yet." when used |
| Desk | A6 the Opencast team | "Run by" offers only the signed-in admin |
| Desk | N2 creator reminders | "This isn't available yet."; the creator stays Asked |
| Desk | B7 ticked works | the API ignores `workIds`: every work is included |

**Fields the API doesn't send** (the screens hide or fall back): S1, S2, S3, S4, S5, S6, S7, S8, S9, S11, S14, S17, S19; G1, G2, G5, G6, G7; C1–C9; L1–L4; E1, E2, E3, E6; U1, U3; P1, P4–P8, P13–P15, P17–P19, P22, P23, P25; B3, B4; N1, N3–N7, N9, N12; O1, O2. The app reports list what each hides.

**Mock-only by design:** the card form in the business app (the provider's widget), and the "Mock" panels that play the station's side.

**Not exercised on the real API:** anything that needs video to play or the playout worker to run (the harness runs neither): first sign-on can't finish, no picture plays, a claimable station doesn't move to on air. Approving a delivered spot needs a multipart upload the harness can't send.

## Left for the platform

- The API's legacy `/api/*` routes and `SERVE_WEB_APP` / `WEB_DIST_DIR` hosting (`apps/api/src/server.ts`, the env examples, `.railway/railway.ts`); `docs/technical-implementation-guide.md` and `docs/audit.md` still describe `apps/web`.
- The 35 proposed endpoints and the fields above.
- A115 (paused spots), A116 (offer codes), A117 (full playback URLs), A124 (claimable stations on air), A125 (held earnings).

## Open questions

All in [open-questions.md](open-questions.md), A1 to A126. Phase 9 added A111 to A126.
