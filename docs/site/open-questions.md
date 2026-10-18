# Dial site: open questions

Anything not decided yet. Each is built so it's easy to change, and noted where it lives in the code. **Open** items are from the site prompt. **Q** items were found while porting, with the decision taken (the user accepted the Phase 0 recommendations on 2026-10-17).

## Open (from the prompt)

- **O1. App hosts and launch.** The hosts for `PUBLIC_WATCH_URL` and `PUBLIC_APP_URL` (for example `watch.usedial.com` and `app.usedial.com`), and when `PUBLIC_LAUNCH_MODE` flips from `waitlist` to `live`. Code: `apps/site/src/data/links.ts`, `.env.example`.
- **O2. Desk addresses.** The email addresses on the Contact page. The defaults are `stations@`, `makers@`, `spots@`, `public@`, `press@` and `rights@usedial.com`, and they're configurable. (Phase 3)
- **O3. Analytics.** None by default. If it's wanted, a cookieless one only.
- **O4. Takedown form.** `/rights/takedown` is linked from Contact's Rights desk with a TODO. The route is for later, with a lawyer.

## Decided

- **Q1. Relay price.** The site shows $0.05 an hour, never over $25 a month (SITE-SPEC §5). The platform charges $0.20 an hour with no cap (migration 0033), so it should move to match before launch. The site doesn't change.
- **Q2. Dial's share.** The site shows the 10/20/5/5/20% split. The platform's rules should be set to match: `shares.opencast` is all 0 and has no keys for Dial-sourced spots, syndication cash or partner ads.
- **Q3. Revenue-share syndication.** The site keeps revenue share, capped at 80%, as the calculator's default mode. The platform needs a revenue-share carriage term to match (it has barter, cash, cash plus barter and free).
- **Q4. Night.** The ground stays `#0E0A1C` (the reference's `--night`). `#140F24` stays the surface ink where the reference uses it. `apps/site/src/styles/tokens.css`.
- **Q5. Station text contrast.** Each station has `ink`, the colour for text. It's lighter only for BEAT (`#C65AA8`) and PREP (`#4685CC`), both 4.6:1 or better on every ground. `apps/site/src/data/stations.ts`. Used wherever a station colour carries text (Phase 2).
- **Q6. Call-sign rules.** One shared function on the contracts' `callSignRefusal()` and `CALL_SIGN_RULES_DEFAULT`, so the site refuses exactly what the API refuses. Plus 3 to 5 letters and the demo "on the dial" set. (Phase 2)
- **Q7. Buttons the spec routes but the reference doesn't draw.** They're added in the reference's button style: Start a spot (planner), Reserve (checker), and Claim a number in the Network and Run footers. The footers are done; the rest come in Phase 2.
- **Q8. Copy that disagrees with the numbers.** Partner ads "after our 10%", "Every airing pays the maker", "1:45 a break", and the $30.87 vs $30.88 cash total. Copy is final, so these are left as written and flagged here for whoever owns the copy.
- **Q9. Pay calculator unit.** It prices each 15-second spot at $8 per 1,000, ported exactly. The copy "about $8 per 1,000 tuned in" is left as written.
- **Q10. Hosting.** The site moves from Vercel (`opencast-site`) to Railway in Phase 5. Staging's API `WEB_ORIGIN` will need the new origin; that is asked for at the Phase 5 STOP.
- **Q11. OCAT.** Renamed to MATN (Classic Matinee, 60.1) everywhere in the site's demo data.
- **Q12. Whose clock.** "Now" on the site is Pacific time wherever the visitor is, because the stations are in Southern California. The reference used the browser's own zone. `apps/site/src/lib/clock.ts`.
