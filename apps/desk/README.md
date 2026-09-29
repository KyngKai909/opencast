# @opencast/desk

Network desk, Opencast's internal tool (`docs/reference/desk/opencast-network-desk.html`): the
market board, the creator pipeline, asking permission, setting up a claimable station from a
recipe, listed sources and the catalog station, and held earnings. Admin sign-in only.

- `npm run dev -w @opencast/desk`: port 5178, against the API (`/v1` proxied to :8787).
- `npm run dev:mock -w @opencast/desk`: port 5182, every call answered by Mock Service Worker
  (`src/mocks`), validated against `@opencast/contracts`. Sign in as `dee@opencast.example` with any
  six digits but `000000`; any other address signs in but isn't on the team. The mock keeps its
  state in localStorage (`oc-mock-desk-*`); remove those keys to start again. `?clock=<ISO>` starts
  the mock clock elsewhere.

The creator's permission page isn't here: it's public and needs no account, so it lives in the
viewer app at `/permission/:token` (the link the API builds from `APP_ORIGIN`).
