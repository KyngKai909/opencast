# Dial site: open questions

Anything not decided yet. Each is built so it's easy to change, and noted where it lives in the code once it exists. **Open** items are from the site prompt. **Q** items were found while porting.

## Open (from the prompt)

- **O1. App hosts and launch.** The hosts for `PUBLIC_WATCH_URL` and `PUBLIC_APP_URL` (for example `watch.usedial.com` and `app.usedial.com`), and when `PUBLIC_LAUNCH_MODE` flips from `waitlist` to `live`.
- **O2. Desk addresses.** The email addresses on the Contact page. The defaults are `stations@`, `makers@`, `spots@`, `public@`, `press@` and `rights@usedial.com`, and they're configurable.
- **O3. Analytics.** None by default. If it's wanted, a cookieless one only.
- **O4. Takedown form.** `/rights/takedown` is linked from Contact's Rights desk with a TODO. The route is for later, with a lawyer.

## Found in Phase 0

- **Q1. Relay price.** The site says $0.05 an hour, never over $25 a month (§5). The platform charges $0.20 an hour with no cap (migration 0033). One side has to change before launch.
- **Q2. Dial's share.** The site's 10/20/5/5/20% split has no matching rules. `shares.opencast` is all 0 and has no keys for Dial-sourced spots, syndication cash or partner ads.
- **Q3. Revenue-share syndication.** The calculator's default mode, revenue share capped at 80%, isn't a carriage term the platform offers (it has barter, cash, cash plus barter and free).
- **Q4. Night.** The spec says `#140F24`; the reference ground token is `#0E0A1C`. The port keeps both as drawn.
- **Q5. Station text contrast.** BEAT and PREP fall short of 4.5:1 on night as text. Proposal: a lighter text tint for them, used only where the colour carries text.
- **Q6. Call-sign rules.** The proposal is the contracts' `callSignRefusal()` (the API's list and matching) instead of `net.js`'s own list.
- **Q7. Buttons the spec routes but the reference doesn't draw.** Start a spot (planner), Reserve (checker), the Network footer's Claim a number, and the Run footer's Claim a number. They'll be added in the reference's button style.
- **Q8. Copy that disagrees with the numbers.** Partner ads "after our 10%", "Every airing pays the maker", "1:45 a break", and the $30.87 vs $30.88 cash total.
- **Q9. Pay calculator unit.** It prices each 15-second spot at $8 per 1,000; the copy says "about $8 per 1,000 tuned in".
- **Q10. Hosting.** The site moves from Vercel (`opencast-site`) to Railway. Staging's API `WEB_ORIGIN` will need the new origin.
- **Q11. OCAT.** The demo call sign OCAT ("Classic Matinee", 60.1) reads like "Opencast". Keep it or rename it?
