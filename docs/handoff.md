# Opencast handoff

Everything Claude Code needs to build Opencast: the reference designs and two prompts.

## What's here

- `docs/reference/`: the designs, one folder per app. Self-contained HTML; open them in a browser.
  - `brand/`: style guide and marketing site
  - `viewer/`: the viewer app, web and phone
  - `tv/`: TV mode, casting, AirPlay mirroring, TV settings
  - `control/`: master control, for stations and studios
  - `business/`: Opencast for business (sponsorships and production orders show both sides)
  - `desk/`: Network desk, Opencast's internal tool
- `prompts/1-platform.md`: the repo, backend, money, escrow contract and Railway
- `prompts/2-apps.md`: every app, from the reference files

## Order

1. Copy `docs/reference/` into the repo at `docs/reference/` and commit it to `main`.
2. Start the platform prompt in one Claude Code session. Review each STOP before replying.
3. When the platform prompt's Phase 2 (restructure) is merged into the `monorepo` branch, start the apps prompt in a second session.
4. The two meet at `packages/contracts`: the platform prompt publishes schemas, the apps prompt builds against them with mocks until the real endpoints land.

## Before launch, with a lawyer

- The claimable-station permission page (it's a licence in plain words)
- Takedown and counter-notice wording, deadlines, and the repeat-infringer policy
- Who holds advertisers' prepaid money, and what that requires
- Whether political spots are allowed
- The production-order ownership terms
