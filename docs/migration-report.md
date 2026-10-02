# Legacy migration report

Run 2026-09-28T03:01:29.774Z into localhost:54329/opencast.

## opencast_state at localhost:54329/opencast

Read: channels 1, assets 4, assetFolders 0, playlistItems 1, playoutStates 1, commands 0, streamSchedules 1, destinations 0, livepeerConfigs 1, externalIngestJobs 0.

| Table | Written | Already there |
|---|---|---|
| accounts.station_memberships | 1 | 0 |
| accounts.users | 1 | 0 |
| broadcast.asset_files | 2 | 0 |
| broadcast.assets | 2 | 0 |
| broadcast.break_rules | 1 | 0 |
| broadcast.livepeer_config | 1 | 0 |
| broadcast.playout_state | 1 | 0 |
| broadcast.schedules | 1 | 0 |
| broadcast.stations | 1 | 0 |
| library copies (migrated via their station copy) | 0 | 2 |

### Didn't map (1)

- `playlistItems` 19abf7e1-0b75-42f3-a800-c51e24d3acdf: 1 queued items have no air times; old order: Demo program

### Mapped, needs a look (5)

- `channels` 19abf7e1-0b75-42f3-a800-c51e24d3acdf: colour #00a96b reads 3.05:1 on white (needs 4.5:1); left unset
- `channels` 19abf7e1-0b75-42f3-a800-c51e24d3acdf: "Inland Beat" needs a call sign, market, band and channel before it signs on
- `channels` 19abf7e1-0b75-42f3-a800-c51e24d3acdf: was "an ad after every 2 programs"; now a break after every program
- `assets` 73528fda-ffde-4bba-a7a1-5b91dafe0beb: "Demo program" needs its rights confirmed before it can go on the log
- `assets` 0f78c22a-f007-4642-8587-07fb2264d124: "Demo spot" needs its rights confirmed before it can go on the log

## db-2.json

Read: channels 1, assets 2, assetFolders 0, playlistItems 2, playoutStates 1, commands 0, streamSchedules 0, destinations 0, livepeerConfigs 1, externalIngestJobs 0.

| Table | Written | Already there |
|---|---|---|
| broadcast.asset_files | 2 | 0 |
| broadcast.assets | 2 | 0 |
| broadcast.break_rules | 1 | 0 |
| broadcast.livepeer_config | 1 | 0 |
| broadcast.playout_state | 1 | 0 |
| broadcast.stations | 1 | 0 |

### Didn't map (1)

- `playlistItems` 3de09b66-fda7-4ec7-9de7-065f98ff19af: 2 queued items have no air times; old order: Kappa Mikey S1E8, Kappa Mikey S1E3

### Mapped, needs a look (6)

- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: colour #ff5f3a reads 3.02:1 on white (needs 4.5:1); left unset
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: "Test Station" needs a call sign, market, band and channel before it signs on
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: player label "Test Brand" dropped (the bug shows call sign and channel)
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: no owner wallet: no one can manage it until an admin assigns an owner
- `assets` 7d441f24-5b4d-4d33-b0d8-42a127d88671: "Kappa Mikey S1E8" needs its rights confirmed before it can go on the log
- `assets` 8772663b-9974-45a5-b9ed-2405adb018d7: "Kappa Mikey S1E3" needs its rights confirmed before it can go on the log

## db-3.json

Read: channels 1, assets 5, assetFolders 0, playlistItems 5, playoutStates 1, commands 0, streamSchedules 1, destinations 0, livepeerConfigs 1, externalIngestJobs 1.

| Table | Written | Already there |
|---|---|---|
| broadcast.asset_files | 3 | 0 |
| broadcast.assets | 3 | 2 |
| broadcast.break_rules | 0 | 1 |
| broadcast.import_jobs | 1 | 0 |
| broadcast.livepeer_config | 0 | 1 |
| broadcast.playout_state | 0 | 1 |
| broadcast.schedules | 1 | 0 |
| broadcast.stations | 0 | 1 |

### Didn't map (1)

- `playlistItems` 3de09b66-fda7-4ec7-9de7-065f98ff19af: 5 queued items have no air times; old order: SpongeBob Episode, Kappa Mikey S1E3, Kappa Mikey S1E8, Far Cry 5: The Movie, Far Cry New Dawn: The Movie

### Mapped, needs a look (11)

- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: colour #ff5f3a reads 3.02:1 on white (needs 4.5:1); left unset
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: "Test Station" needs a call sign, market, band and channel before it signs on
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: player label "Test Brand" dropped (the bug shows call sign and channel)
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: no owner wallet: no one can manage it until an admin assigns an owner
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: was "an ad after every 2 programs"; now a break after every program
- `assets` eb9c2f0b-ceec-4dfc-a84b-147194630e27: "SpongeBob Episode" needs its rights confirmed before it can go on the log
- `assets` 7d441f24-5b4d-4d33-b0d8-42a127d88671: "Kappa Mikey S1E8" needs its rights confirmed before it can go on the log
- `assets` 8772663b-9974-45a5-b9ed-2405adb018d7: "Kappa Mikey S1E3" needs its rights confirmed before it can go on the log
- `assets` 5d59b6c0-dd05-4456-b62c-8a0fb947566b: "Far Cry 5: The Movie" needs its rights confirmed before it can go on the log
- `assets` 719a3f81-f68b-4383-aad1-d014e865e0a3: "Far Cry New Dawn: The Movie" needs its rights confirmed before it can go on the log
- `playoutStates` 3de09b66-fda7-4ec7-9de7-065f98ff19af: was running; arrives off air until it signs on

## db-backup-review.json

Read: channels 3, assets 3, assetFolders 0, playlistItems 2, playoutStates 3, commands 0, streamSchedules 1, destinations 0, livepeerConfigs 3, externalIngestJobs 0.

| Table | Written | Already there |
|---|---|---|
| accounts.station_memberships | 2 | 0 |
| accounts.users | 1 | 1 |
| broadcast.assets | 0 | 2 |
| broadcast.break_rules | 2 | 1 |
| broadcast.livepeer_config | 2 | 1 |
| broadcast.playout_state | 2 | 1 |
| broadcast.schedules | 1 | 0 |
| broadcast.stations | 2 | 1 |

### Didn't map (2)

- `assets` 1d1a9b64-b063-4f8f-bde4-f98cf7c86f0f: "DBZA Full Series" is only in library:0x895d44d10d1b7b4f5f38e2ae2322539cf93f7aaa's creator library; there are no libraries outside stations now
- `playlistItems` 3de09b66-fda7-4ec7-9de7-065f98ff19af: 2 queued items have no air times; old order: Kappa Mikey S1E8, Kappa Mikey S1E3

### Mapped, needs a look (12)

- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: colour #ff5f3a reads 3.02:1 on white (needs 4.5:1); left unset
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: "Test Station" needs a call sign, market, band and channel before it signs on
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: player label "Test Brand" dropped (the bug shows call sign and channel)
- `channels` 3de09b66-fda7-4ec7-9de7-065f98ff19af: no owner wallet: no one can manage it until an admin assigns an owner
- `channels` bb3704c5-4884-4488-bcf7-cd7ad6865c23: colour #00a96b reads 3.05:1 on white (needs 4.5:1); left unset
- `channels` bb3704c5-4884-4488-bcf7-cd7ad6865c23: "Smoke Station" needs a call sign, market, band and channel before it signs on
- `channels` bb3704c5-4884-4488-bcf7-cd7ad6865c23: was "an ad after every 2 programs"; now a break after every program
- `channels` 39b636b1-3123-443c-b498-66152e8486bb: colour #0ea5e9 reads 2.77:1 on white (needs 4.5:1); left unset
- `channels` 39b636b1-3123-443c-b498-66152e8486bb: "Test" needs a call sign, market, band and channel before it signs on
- `channels` 39b636b1-3123-443c-b498-66152e8486bb: was "an ad after every 2 programs"; now a break after every program
- `assets` 7d441f24-5b4d-4d33-b0d8-42a127d88671: "Kappa Mikey S1E8" needs its rights confirmed before it can go on the log
- `assets` 8772663b-9974-45a5-b9ed-2405adb018d7: "Kappa Mikey S1E3" needs its rights confirmed before it can go on the log
