# Opencast

A dial of 24/7 local stations. Viewers tune in on the web, a phone, a TV app or by casting; stations are run from master control. Opencast is a working name; the package scope is `@opencast/*`.

The build is driven by two prompts in `docs/prompts/`, working from the reference designs in `docs/reference/`:

- `1-platform.md` (branch `monorepo`): the repo, backend, contracts, money, escrow and Railway.
- `2-apps.md` (branch `apps`, from `monorepo`): every app from the reference files.

## Layout

| Path | Package | What it is | Owner |
|---|---|---|---|
| `apps/api` | `@opencast/api` | Express API: stations, library, uploads, playout control | platform |
| `apps/worker` | `@opencast/worker` | Playout: airs every station from its log, from its file cache; HLS and Livepeer out | platform |
| `apps/control` | `@opencast/control` | Master control (the old `apps/web`, unchanged) | apps |
| `apps/viewer` | `@opencast/viewer` | Viewer app, web and phone (empty) | apps |
| `apps/tv` | `@opencast/tv` | TV mode and the Cast receiver (empty) | apps |
| `apps/site` | `@opencast/site` | Marketing site (empty) | apps |
| `apps/spots` | `@opencast/spots` | Opencast for business (empty) | apps |
| `apps/desk` | `@opencast/desk` | Network desk, internal (empty) | apps |
| `apps/gallery` | `@opencast/gallery` | Every `@opencast/ui` component in every state, on both grounds, beside its reference frame | apps |
| `packages/domain` | `@opencast/domain` | Types and pure rules (the old `packages/shared`) | platform |
| `packages/db` | `@opencast/db` | Drizzle schema, SQL migrations, the legacy migration | platform |
| `packages/contracts` | `@opencast/contracts` | Zod request and response schemas | platform; the apps prompt reads it and never edits it |
| `packages/ui` | `@opencast/ui` | Design system: tokens, primitives, broadcast and data components, shells | apps |
| `packages/player` | `@opencast/player` | The one player for the viewer app, TV mode and the Cast receiver: live HLS, channel changes with warm neighbours, the banner, number entry, inputs | apps |
| `contracts` | | `CreatorEscrow` and `CreatorFund` (Foundry): claimable stations' earnings until claimed, and the fund that backs new stations | platform |
| `docs/reference` | | HTML design references, one folder per app | |

`domain` and `contracts` build to `dist/` because the API and worker import their JavaScript at runtime. `ui` and `player` are source-only, since Vite compiles them into each app.

## Run locally

You need Node 22 (or 20.19+), npm 10+, Docker, and `ffmpeg` and `ffprobe` on `PATH`. `yt-dlp` is only needed for link imports.

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` builds `domain` and `contracts`, then runs:
- the API on http://localhost:8787
- the worker
- master control on http://localhost:5173, which proxies `/api`, `/hls` and `/uploads` to the API

Postgres is required; there is no JSON fallback any more. The API and worker still keep their state in the old `opencast_state` table until each module moves onto the new schema (`docs/schema.md`) in platform Phase 4. `scripts/create-sample-media.sh` makes a 45 s program and a 12 s spot to upload.

Each empty app runs on its own with `npm run dev -w @opencast/<name>`. Ports: viewer 5174, tv 5175, site 5176, spots 5177, desk 5178.

| Script | Does |
|---|---|
| `npm run build` | Builds everything with Turborepo, dependencies first |
| `npm run typecheck`, `npm run lint`, `npm test` | Every workspace. The db tests need `npm run db:up` |
| `npm run db:up`, `db:down` | Postgres and Redis in Docker |
| `npm run db:migrate`, `db:reset`, `db:generate` | Apply migrations; drop and re-apply (local only); write a migration after editing the schema |
| `npm run db:migrate:legacy -- [files]` | One-time move from `opencast_state` and JSON files into the new tables |
| `npm run build:service:{api,worker,control}` | One service and what it depends on (`turbo --filter=<pkg>...`) |
| `npm run start:service:{api,worker,control}` | Starts one built service |
| `npm run start:runtime` | API and worker in one process (single-service mode); the API also serves `apps/control/dist` |
| `npm run env:check` | Lists which variables are set |

### The gallery

```bash
npm run dev -w @opencast/gallery
```

http://localhost:5180 shows every component in `@opencast/ui` on the dark and light grounds side by side, each linked to the reference frame it comes from (served from `docs/reference` at `/reference/`). "Compare with the reference" puts a component next to its reference section.

`npm run compare -w @opencast/gallery` checks the build against the references: it opens each pair of elements listed in `apps/gallery/scripts/pairs/*.json` in Chrome, on both grounds, and prints every computed style that differs. Add `-- <id or group>` for some, and `-- --shots` for side-by-side screenshots in `apps/gallery/compare-out/`. It uses the installed Chrome; nothing is downloaded.

Apps import the design system's styles once, `import "@opencast/ui/styles.css"`, and take every colour, font, space and radius from its tokens (`packages/ui/src/tokens.css`). The rules every screen follows are in `docs/apps/rules.md`.

### The player

`@opencast/player` is one engine (`PlayerEngine`) with a React surface (`PlayerProvider`, `PlayerSurface`). Inputs (`keyboardInput`, `castInput`, `bridgeInput`, `mediaSessionInput`) all produce the same commands, so the TV's remote, the phone remote over Cast and the iPhone bridge drive it identically.

For development it plays mock stations served as live HLS:

```bash
npm run mock:streams -w @opencast/player
```

That makes four 60-second loops (CIVC, BEAT and REEL on the TV band, NITE on radio) with captions, in `packages/player/.mock-streams/` (git-ignored; needs ffmpeg). The gallery serves them live at `/mock-hls/<station>/master.m3u8` (`mockLiveHls` from `@opencast/player/mock`), and its Player pages drive the real engine against them.

### Why Turborepo

Before, every app's `build` script rebuilt `shared` first, and the root repeated the same order by hand in `build`, each `build:service:*` and three `pre*` hooks. With nine apps and four packages that doubles. Turborepo's `dependsOn: ["^build"]` replaces all of it. npm workspaces still install everything.

## The API

`/v1` is the new API, built from `packages/contracts`: 183 endpoints in 13 modules, listed in `docs/api.md` (regenerate with `npm run docs:api`). How it's put together is in `docs/architecture.md`. The old `/api` routes stay for the old master control until the apps prompt replaces it.

Sign-in is Privy: set `PRIVY_APP_ID` (and `PRIVY_VERIFICATION_KEY` if you have it). Without it, signed-in endpoints answer 401; public ones (the dial, guide, station pages, heartbeats) still work. To make someone an Opencast admin: `update accounts.users set is_admin = true where email = '…'`.

## Playout

The worker airs every station that's on air from its program log: `npm run dev` runs it. To see an evening end to end in about four and a half minutes (on the dev database, with the dev stack running):

```bash
npm run demo:evening -w @opencast/worker
```

It prints the station, when it starts, and an RTMP URL to push an encoder to for the live block. Afterwards, `npm run as-run -w @opencast/worker -- <stationId>` prints what aired.

In development the API and worker run the workspace packages from source (the `source` export condition, `tsx --conditions=source`), so an edit to `packages/db` or the API reloads the worker too. Built services (`npm start`, Railway) use `dist`.

The worker airs files from its cache (`storage/cache` locally, a volume on Railway), which it fills ahead of time from object storage. `curl localhost:8788/health` shows the cache's hit rate, bytes and misses.

## Storage

Files are stored once, by content ID, in object storage: R2 when its keys are set, `storage/objects` otherwise (served at `/objects` in development). IPFS is only for the Opencast catalog and a station's own "Export to IPFS". See [docs/architecture.md](docs/architecture.md#storage).

## Environment

`.env.example` at the root is read by the API and the worker. `apps/control/.env.example` holds `VITE_API_BASE`, which you only need when the API is on another origin. Per-service examples arrive with the Railway work (platform Phase 7).

## Deploying

The services go into a **new** Railway project, with staging first, in platform Phase 7. The old project (`glistening-truth`) stays as it is and isn't used.

Old names, for anyone looking at that project:

| Old | New |
|---|---|
| `@openchannel/web` | `@opencast/control` |
| `@openchannel/shared` | `@opencast/domain` |
| `@openchannel/api` | `@opencast/api` |
| `@openchannel/worker` | `@opencast/worker` |
| `build:service:web`, `start:service:web` | `build:service:control`, `start:service:control` |

The browser still stores the connected wallet under `openchannel.creator.wallet.v1`, so existing sessions carry over.

## Docs

- `docs/api.md`: every endpoint, generated from the contracts
- `docs/architecture.md`: services, modules, roles, and how money moves
- `docs/audit.md`: what the repo did before the restructure
- `docs/schema.md`: the schema, its constraints, and the migration from the old model
- `docs/open-decisions.md`: what isn't decided yet, and its default
- `docs/migration-report.md`: the last legacy migration run
- `docs/technical-implementation-guide.md`: the MVP's design and cost notes (predates the reference designs)
- `docs/contracts-changelog.md`: changes to published contracts
- `docs/apps/`: the apps prompt's inventory of the reference designs, the rules for every screen, open questions, and copy waiting for review
- `docs/contract-requests.md`: fields and endpoints the apps need from the contracts
