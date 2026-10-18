# @opencast/site: the Dial marketing site

usedial.com, built from `docs/reference/site/` by the site prompt. Astro, static output, no UI framework: each page is prerendered HTML with small TypeScript modules for the interactive parts.

## Run it

- `npm run dev -w @opencast/site`: on :5183 (launch entry "dial-site"). With `PUBLIC_API_URL` blank, the waitlist and contact forms are answered by the in-page mocks, so no API is needed.
- `npm run build -w @opencast/site`: `astro check`, then the static site in `dist/` (pages, OG images at `/og/<page>.png`).
- `npm test -w @opencast/site`: Vitest (calculators, call-sign rules, link building).
- `/_kit` shows every shared component in every state (not linked, `noindex`); `/_kit?widths` shows it at 1440, 820 and 390.

## Settings

All `PUBLIC_` and read at build time (see `.env.example`): `PUBLIC_LAUNCH_MODE` (`waitlist` or `live`), `PUBLIC_WATCH_URL`, `PUBLIC_APP_URL`, `PUBLIC_BUSINESS_URL`, `PUBLIC_API_URL`. Every link target comes from `src/data/links.ts`.

## How it's put together

- `src/styles/`: `tokens.css` (the reference's `:root` blocks), `ref/` (the shared layers ported verbatim: head, polish, grid, flat, nav, shape, lt), `ref/pages/` (the page stylesheets), and `pages/` (each page's cascade, in the reference's order). Pages import their CSS after `Base`, so the cascade matches the reference.
- `src/components/`: `Sheet`, `Cell` (`d`, `t`, `m`; a `t` over 6 fails the build), `Mh`, `Mf`, `Btn`, `Seg`, `Faq`, `Ticker`, `Slider`, `Steps`, `Header`, `Footer` and each page's footer first row.
- `src/data/`: `stations.ts` (the one station list), `links.ts`, `pages.ts` (titles, descriptions, OG headlines), `nav.ts`.
- `src/lib/`: `site.ts` (grain, now playing, Lenis, anchors, cursor, menu), `nav.ts`, `clock.ts` (Pacific), `focus.ts`, `motion.ts`, `seg.ts`, `slider.ts`, `ticker.ts`.
- Contracts are imported one file at a time (`@contracts/waitlist`), so a page carries only the schemas it calls.

Decisions and open items: `docs/site/open-questions.md`. New copy: `docs/site/new-copy.md`.
