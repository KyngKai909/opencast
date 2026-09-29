# Testing the apps

Two ways to run the apps under Playwright (the `e2e/` workspace, `@opencast/e2e`), and each app's
own unit tests. Everything here runs on this machine: nothing outside is called.

Use Node 22 (`export PATH=/usr/local/bin:$PATH` on the team Macs) and the Docker Postgres and
Redis (`npm run db:up`). Playwright drives the installed Chrome (`channel: "chrome"`), so nothing is
downloaded.

## Unit tests

In each app: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run`. The API: `npm test -w @opencast/api`.

## The mock flows

`npm run e2e` from the root (or `cd e2e && npx playwright test --project <product>`) runs the specs
in `e2e/tests/<product>.<name>.spec.ts` against each app's `dev:mock` server, where Mock Service
Worker answers every API call from the reference files' fixtures:

| Project | App | Mock port |
| --- | --- | --- |
| `viewer` | apps/viewer (needs TV mode too, for casting) | 5174 |
| `tv` | apps/tv | 5175 |
| `control` | apps/control | 5179 |
| `spots` | apps/business | 5181 |
| `desk` | apps/desk (needs the viewer too, for the permission page) | 5182 |
| `site` | apps/site | 5183 |

A server that's already running on its port is reused; otherwise Playwright starts the ones the
chosen `--project`s need. `e2e/lib/a11y.ts` has `useGround` and `checkA11y` (axe, WCAG 2.2 A and
AA); `e2e/lib/contrast.ts` has `contrast()`. Failures leave traces and screenshots in
`e2e/test-results/`; `npm run report -w @opencast/e2e` opens the HTML report.

## The real-API runs

`npm run e2e:real` from the root (or `cd e2e && npx playwright test -c playwright.real.config.ts
[--project <product>]`) runs the specs in `e2e/tests/<product>[.<name>].real.spec.ts` against the
real API. The mock config leaves those specs out; this one runs only them.

What happens:

1. **The API** (`e2e/real/global-setup.ts` → `run.ts` → `api-server.ts`). A throwaway database,
   `opencast_e2e_<run>`, is created on the Docker Postgres (:54329), migrated with the repo's
   migrations (`packages/db/scripts/migrate.ts`) and given its markets (`packages/db/scripts/seed.ts`),
   then seeded (below). The API is the v1 API itself (`apps/api/src/v1`: the same routers, services,
   contracts and validation the API server mounts, plus its `/hls` playlists and `/objects`), on
   **:8788**, with:
   - `PRIVY_APP_ID=opencast-e2e` and `PRIVY_VERIFICATION_KEY` the public half of an ES256 key pair
     made for the run; the private half signs the tests' tokens.
   - `REDIS_URL` the Docker Redis (:63799), db index 9, its relay channels prefixed by the run.
   - CORS for the apps' e2e origins; `APP_ORIGIN` the viewer's; storage in a temp directory.
   - For everything outside, the fakes the API's own tests use: the fake payments provider (cards
     are `tok_4242`; no Stripe), a Clear lookup that says Clear is set up and nobody has linked it,
     IPFS that records pins, no geo lookup, no chain, and notices kept in a list (`GET /e2e/sent`)
     instead of sent. Every provider key is blanked before the repo's `.env` is read, and the
     process's `fetch` refuses any host but this machine (refusals are printed at the end).
   - The playout worker isn't running: stations are marked on the air (as the worker would), but
     nothing streams, so players find no video.
2. **The apps** each run their Vite dev server in real mode (`vite --mode e2e`, not `dev:mock`) on
   an e2e port, with `VITE_API_BASE=http://localhost:8788`, `VITE_DEV_TOKEN_AUTH=true`, and Privy,
   Clear's provider app and Cast blanked (so nothing outside loads in the browser either); only the
   servers the chosen `--project`s need, as the mock config does:

   | viewer | tv | control | spots | desk | site |
   | --- | --- | --- | --- | --- | --- |
   | 5274 | 5275 | 5279 | 5281 | 5282 | 5283 |

3. **The teardown** stops the API, which drops its database and temp storage. (If a run is killed,
   the API notices the runner is gone and does the same; `npm run real:down -w @opencast/e2e`
   cleans up anything left.)

### Signing in: test tokens

The viewer, master control, business and the desk have a third way to sign in beside Privy and the
mock: the **test sign-in** (`apps/<app>/src/auth/devTokenAuth.ts`). It's chosen only when
`import.meta.env.DEV && VITE_DEV_TOKEN_AUTH === "true"`, so a production build never contains it.
It reads a token and an email from `localStorage` (`oc-dev-token`, `oc-dev-email`) and hands the
token to the API as Privy's would be; every step of the sign-in page picks it up.

The tokens are what Privy would issue: ES256, issuer `privy.io`, audience `opencast-e2e`, subject
`did:privy:<person>`, signed with the run's key. The API makes an account the first time it sees
one, with the email `<person>@example.com`, so any new name is a new person.

TV mode signs in the way it always does, by code: the test reads the code on screen and approves
it through the API (`tv.approveTvCode`) with a signed user token.

### Writing a real-API spec

```ts
import { api, approveTvCode, expect, seed, sent, signIn, test } from "../lib/real";

test("Kai carries Saturday Reel", async ({ page }) => {
  await signIn(page, "kai"); // before goto: the app opens signed in
  await page.goto("/");
  // …the flow, asserting on what the screens say…
  const offers = await api(`/stations/${seed.stations.beat.id}/carriage/agreements`, { as: "kai" });
});
```

`e2e/lib/real.ts`:

- `test`: Playwright's, with every browser request to anything but this machine blocked (and listed
  on the test as `outside` annotations).
- `signIn(page, person)`: a seeded person or any new name (`"new-owner"`). Before `page.goto` the
  app opens signed in; on an open page it signs in there and the app follows. `signOut(page)`.
- `api(path, { as, method, body, status })`: the real API under `/v1`, as someone or nobody;
  returns the body, throws an `ApiError` unless the status is `status` (default any 2xx). For
  arranging data and checking what a flow did.
- `seed`: the seed's ids (`seed.stations.beat.id`, `seed.businesses.orange`, `seed.users.kai`…).
- `approveTvCode(code, person)`, `sent()` (the notices sent this run), `tokenFor(person)`.

Every spec in a run shares the one seeded database (two workers). A flow that changes seeded
things (approves the sponsorship, spends a balance) should expect that, or make its own with
`api()` or a new person.

### What the seed has

All in the Inland Empire market (ZIPs 92373, 92374, 92324, 92335, 92501, 92507) unless it says so;
Los Angeles and the High Desert exist too. The schedule is on the real clock: an hour-long program
every hour from 12 hours before the run to 36 after.

| Person | Email | Who |
| --- | --- | --- |
| `kai` | kai@example.com | Kai M., owns BEAT |
| `marcus` | marcus@example.com | Marcus Reyes, operates BEAT |
| `jess` | jess@example.com | Jess Park, owns REEL; offers Saturday Reel for carriage |
| `maya` | maya@example.com | Maya Ortiz, owns Orange Street Coffee |
| `omar` | omar@example.com | Omar Haddad, owns Redlands Bikes |
| `sam` | sam@example.com | Sam T., a viewer: presets BEAT (1) and REEL (2), pledges $10 a month to REEL |
| `dee` | dee@example.com | Dee A., an Opencast admin (Network desk) |
| `lupe` | lupe@example.com | Lupe Ortiz, the creator behind Tía Lupe's Kitchen |

| Station | Channel | Kind | Programs |
| --- | --- | --- | --- |
| CIVC Inland Civic | 7.1 | station, no owner | Redlands City Council |
| BEAT Inland Beat | 12.1 | Kai's; takes spot orders (from $100); breaks sold on the spot market, rotation empty | Late Crate, Beat Tape Live |
| SAZN Sazón | 18.1 | station, no owner | Home Cooking |
| REEL Saturday Reel | 24.1 | Jess's; Fall menu in rotation | Saturday Reel (offered: barter, or $2.50 an airing) |
| NITE Night Desk | radio 88.3 | station, no owner | The Night Desk |
| CRAT Crate | radio 101.9 | claimable, set up by the desk from Crate's works (Dee operates it) | the creator's three works |
| MOJV Mojave Community | 5.1, High Desert | station, off the air | High Desert Report |

- **Orange Street Coffee** (Maya): $60 funded by card; spots Fall menu (:30, $4 an airing) and
  Night owl (:15, $8 per thousand, at most $3 an airing), both approved and listed; a $50-a-month
  sponsorship of Late Crate waiting for BEAT's answer.
- **Redlands Bikes** (Omar): $150 funded by card; Ride season (:30, $3 an airing) in review.
- **Network desk**: Tía Lupe's Kitchen said yes to two works (not set up: 33.1 is free for it);
  Crate is on the air on CRAT, waiting to be claimed; recipes "Cooking and food, TV band" and
  "Music, radio band".

The ids are in `seed` (the `Seed` type in `e2e/real/shared.ts`).

### Running it by hand

```sh
npm run real:up -w @opencast/e2e              # the API and every app, until Ctrl-C
npm run real:up -w @opencast/e2e -- control   # the API and master control
npm run real:up -w @opencast/e2e -- --no-apps # the API only
```

It prints each app's address and, for each seeded person, a line to paste into the app's browser
console (sets the test token; reload after). Ctrl-C stops everything and drops the database. While
it's up, `npx playwright test -c playwright.real.config.ts` uses it (and its app servers) instead of
starting its own, and leaves it running.

One real-API run at a time: they share :8788 and the e2e ports. A second test run started while
another is going uses the first one's API, which goes away when the first run ends.
