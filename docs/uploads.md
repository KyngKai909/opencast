# Direct uploads

Added 2026-09-30 (follow-up Phase 4). Files go straight from the browser to object storage, in parts, several at once. They never pass through the API server. That's Cloudflare R2 on staging and in production (`opencast-staging`, `opencast-production`), and local disk in development. The API does three things. It checks the person's role. It hands out presigned part URLs. Once every part is in, it reads the file back from storage (never through the browser) to work out its content ID, stores it once, and does what the old form upload did. No third-party upload service is involved: the browser side is Uppy (`@uppy/core`, `@uppy/aws-s3`, `@uppy/golden-retriever`), driven by Opencast's own endpoints.

Before this, the browser streamed the whole file through the API on Railway. multer wrote it to disk, the API copied it, hashed it and uploaded it to R2. That was one connection with several hops and no resume, and it failed on request timeouts. Every byte also went out of Railway to R2 a second time.

## How it works

1. **Start.** The app calls `createUpload` (`POST /v1/uploads`) with what the file is for (`purpose`), its name, size and type. The API checks the person's role for that purpose, using the same roles as the old endpoints. It also checks what would refuse the file anyway before a byte is sent: size, type, storage at its cap, a relay background on a TV station, a closed brief. It then starts a multipart upload at a staging key, `uploads/<upload ID>`, in Standard. The answer carries the part size, how many parts to send at once and the first 10 presigned part URLs.
2. **Parts.** The browser `PUT`s each part to its URL, 5 at a time, and reads each answer's `ETag`. It asks for more URLs as it goes, 10 at a time (`signUploadParts`). A URL is good for an hour and used once: a part sent again gets a new one.
3. **Resume.** Uppy retries a failed part by itself (0, 1, 3, 5 and 10 seconds). Pause and Resume, a dropped connection or a reload all resume the same way: the app calls `listUploadParts`, the API asks the store which parts it has, and only the rest are sent. After a reload, Golden Retriever brings the list back (without the file for anything over 10 MB, since browsers don't keep it). The row says "Choose the file again to carry on", and choosing it picks up where it stopped.
4. **Complete.** `completeUpload` with every part's ETag. The API checks them against the store's own list, puts the parts together, and answers `checking` at once.
5. **Checking** happens in the background:
   - The API reads the staged object once, streaming it, for its sha-256. That gives the content ID (CIDv1, raw, sha-256), with a check that the size is what was declared.
   - It runs what the old endpoint did, pointed at the staged object (a presigned URL FFmpeg reads, or a local path): the probe, the checks, loudness, captions.
   - Then it keeps the file. If the platform already has those bytes, the staged copy is deleted and the file points at the existing object ("stored once", `duplicate: true`). Otherwise the staged object moves to its content ID in its storage class (Infrequent Access for originals), copied server side by R2 (in 1 GiB parts above 5 GiB) and then deleted.
   - Then preparation for air starts: the item is queued for the worker, after anything airing within the hour.
   - A refusal, such as `unreadable_file`, `wrong_kind`, `too_long_for_log`, `not_captions` or `taken_down`, fails the upload with the old endpoint's code and words. Nothing is kept.
6. **Done.** The upload becomes `preparing` (what it made is being prepared: a library item, a spot, a delivery, a relay background) or `done` (nothing to prepare: a brief file, a caption track). The apps follow it with `getUpload` and show "Uploading", "Checking", then "Preparing for air" (or the screen's own word).

Each purpose, and who may send it:

| `purpose.kind` | What it does | Who | Largest |
|---|---|---|---|
| `library_item` | A new library item (`fields`: title, code, program, folder, caption text) | station owners, operators | 100 GiB |
| `library_replace` | L6, a new file for an item | station owners, operators | 100 GiB |
| `spot_file` | A spot's file and its checks (`scaleToFit` for P2) | business owners, managers | 100 GiB |
| `order_file` | A brief's file (the business) or a delivery (the maker station) | as the old endpoints | 100 GiB |
| `caption` | An item's caption track (WebVTT or SRT) | station owners, operators | 1 MiB |
| `relay_background` | A radio station's relay background | station owners, operators | 100 MiB |

Only the person who started an upload can sign its parts, list, complete, abort or read it (404 for anyone else). The role is checked again when the upload completes.

**Surviving a restart.** Each upload is a row (`broadcast.uploads`, migration 0037). The API that takes the `completeUpload` holds the row's lease while it works, renewing it every 15 seconds as it reads. If the API restarts, the lease runs out after 2 minutes. The jobs tick (every minute, in the worker) then picks the upload up again. That covers a restart before the multipart upload was put together, and one after the file was already moved to its content ID. Completion is tried 3 times before the upload fails with `couldnt_read`. A library item made by an upload has the upload's ID, so a completion done twice finds the item it made rather than making another. Nothing holds a multi-gigabyte file in memory: parts go straight to the store, and the API streams the object once to hash it.

**Not done: hashing in the browser.** The browser could hash the file while it uploads, so the API could skip reading back a file it already has. That isn't safe. A browser could claim the sha-256 of a file someone else uploaded, send anything, and be pointed at their object. R2 can't check a whole-object sha-256 for a multipart upload (only a checksum of the parts' checksums). The API's own read stays the source of truth. It costs one read inside Cloudflare (no egress) or over Railway's network.

## Part size and parallelism

| File | Part size | Parts |
|---|---|---|
| up to 1 GiB | 16 MiB | up to 64 |
| up to 16 GiB | 32 MiB | up to 512 (a 4 GiB file: 128) |
| bigger | 64 MiB, more above 625 GiB to stay under 10,000 | a 100 GiB file: 1,600 |

5 parts go at a time per upload widget (`UPLOAD_PARALLEL_PARTS`). The browser and the API share the same functions (`uploadPartSize`, `uploadPartCount` in `packages/contracts/src/uploads.ts`).

Why these numbers:
- **Parts in parallel fill the connection.** One TCP stream is limited by its window and the round trip. Five at once fill a fast uplink, and they leave one of the browser's six connections to a host free for the app's own calls (in development the parts go to the API itself).
- **Big enough parts keep requests few.** R2 bills each part as one Class A operation. A 4 GiB file is about 130 operations in all (create, 128 parts, complete, the copy), a fraction of a cent.
- **Small enough parts lose little to a drop.** A dropped connection re-sends at most the parts in flight: 5 × 32 MiB for a 4 GiB file. A part is also slow enough to finish on a poor connection within its URL's hour: 32 MiB at 5 Mbit/s takes under a minute.
- **The browser's memory stays small.** Uppy slices the file as it sends it: at most the parts in flight are read at once.
- **The limits hold.** S3 and R2's rules (parts of at least 5 MiB except the last, at most 10,000 of them) hold for every size.

### Measured

The STOP demo (`npm run demo:uploads -w @opencast/api -- --s3`, below) sends a 4 GiB file from a separate uploader process that does what the browser does. It runs on this Mac: loopback, the API and the store on the same machine, so this is the protocol's own ceiling, not a network's. On a real connection the uplink is the limit, and 5 parts in flight are what keep it full.

| Store | Sending (4 GiB, 128 × 32 MiB, 5 at a time) | Checking (read back and hash 4 GiB, probe, loudness, keep) |
|---|---|---|
| Local protocol (parts to the API, on disk) | 520–564 MiB/s (4.4–4.7 Gbit/s) | 7.1–7.3 s |
| S3-compatible (SeaweedFS in Docker, presigned URLs, server-side copy in parts) | 317–370 MiB/s (2.7–3.1 Gbit/s) | 7.7–8.2 s |

## Cleaning up

- **Abandoned uploads.** An upload not completed within 24 hours is aborted by the jobs tick: its parts are deleted in the store and it becomes `aborted` (`abandoned`). Once an hour the tick also aborts multipart uploads the store still has open under `uploads/` with no upload waiting for them.
- **The store's own backstop** is its lifecycle rules. Multipart uploads nobody finished are aborted after 1 day, and anything left at a staging key (`uploads/…`) goes after 7 days.
- **Staged objects are Standard, never Infrequent Access.** Infrequent Access bills at least 30 days for anything deleted sooner, and it charges for reads. The API reads the staged copy (hash, probe, loudness) while it's still Standard, and the final copy is written once, in its own class.

`npm run storage:uploads-bucket -w @opencast/api` prints the rules. Add `-- --apply` to send them to the bucket in `R2_*` with `PutBucketCors` and `PutBucketLifecycleConfiguration`, where the credentials allow. The origins come from `APP_ORIGIN`, `BUSINESS_ORIGIN` and `UPLOAD_CORS_ORIGINS` (comma-separated). An R2 token with Object Read & Write can't set bucket rules. Either use an Admin Read & Write token once, or set them in the dashboard (below).

## CORS

Two rules. **Playback:** every player (the web app, TV mode and the Cast receiver on their own origin, the phone apps' `capacitor://localhost` and `https://localhost`, local development) reads segments with `fetch`/XHR, so `GET` and `HEAD` are open to any origin; the segments are public anyway. **Uploads:** the browser `PUT`s parts from the apps' origins only, and must read each answer's `ETag`. (Until 2026-09-30 this page had only the upload rule, which left TV mode on Stand by: its origin couldn't read the segments.)

**Cloudflare R2** (dashboard: R2 → the bucket → Settings → CORS Policy → Edit; the dashboard takes this shape). For `opencast-staging`:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  },
  {
    "AllowedOrigins": ["https://opencast-web.vercel.app", "https://opencast-business.vercel.app", "http://localhost:5173", "http://localhost:5174", "http://localhost:5177", "http://localhost:5181"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

For `opencast-production`, the same with production's web and business origins in the second rule, and no localhost.

Through the S3 API instead: `npm run storage:uploads-bucket -w @opencast/api` prints the same rules from `APP_ORIGIN`, `BUSINESS_ORIGIN` and `UPLOAD_CORS_ORIGINS`, and `-- --apply` sends them (needs an Admin Read & Write token; see above).

If the Railway bucket refuses `PutBucketCors` (the script says so, and changes nothing), set the rule in the bucket's settings in Railway, or ask Railway. Uploads fail in the browser without it (Uppy logs "Could not read the ETag header").

The local protocol needs no CORS set up: the API answers its own part `PUT`s with `Access-Control-Expose-Headers: ETag`, and its CORS already allows the apps' origins.

## Lifecycle rule

In the S3 API's shape (what `--apply` sends):

```json
{
  "Rules": [
    { "ID": "abort-unfinished-multipart-uploads", "Status": "Enabled", "Filter": { "Prefix": "" }, "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } },
    { "ID": "expire-staged-uploads", "Status": "Enabled", "Filter": { "Prefix": "uploads/" }, "Expiration": { "Days": 7 } }
  ]
}
```

In Cloudflare: R2 → the bucket → Settings → Object lifecycle rules. New buckets come with a "Default Multipart Abort Rule" of 7 days: edit it to 1 day. Then add a rule for the prefix `uploads/` that deletes objects 7 days after they're uploaded.

## Costs

Cloudflare's prices at the time of writing (check [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before relying on them):

- **Ingress and egress are free.** The upload in, the API's read back (hash, probe, loudness) and the worker's download to prepare it cost nothing for bandwidth.
- **Class A operations** (each part, create, complete, copy, list) cost $4.50 a million in Standard, $9.00 in Infrequent Access. A 4 GiB upload is about 130, a fraction of a cent. A 100 GiB file (1,600 parts) is under a cent.
- **Class B operations** (reads, heads; the probe's range reads) cost $0.36 a million in Standard. A few per upload.
- **Storage** is $0.015/GB-month in Standard and $0.01 in Infrequent Access. A staged copy lives minutes, in Standard. Originals are Infrequent Access: at least 30 days are billed, and reads are $0.01/GB (the worker's one download to prepare it).
- **Compared with before:** the old path sent every byte out of Railway to R2, billed as Railway egress per GB, and needed the API's disk twice over and its CPU. Now the API only reads the file back, and that read is free on both sides.

Staging's Railway bucket bills as Railway's bucket pricing says. It has no storage classes (`S3_STORAGE_CLASSES=false`).

## What to set in Cloudflare

1. **The bucket.** `opencast-staging` for staging and `opencast-production` for production (both created 2026-09-30). Staging's is public through its r2.dev address, for playback; production's gets a custom domain.
2. **CORS.** Add the policy above with production's two app origins, and any other origin the apps are served from (`UPLOAD_CORS_ORIGINS`).
3. **Lifecycle.** Change the default multipart abort rule to 1 day, and add the `uploads/` prefix rule (7 days).
4. **API tokens.** The API and the worker need one with **Object Read & Write** on this bucket (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). It covers multipart uploads, presigning, the server-side copy and deletes. To apply CORS and lifecycle with the script instead of the dashboard, make a short-lived **Admin Read & Write** token, run `-- --apply` once, then delete the token.
5. **Variables.** Set `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_BUCKET` and the keys on api and worker. Leave `S3_STORAGE_CLASSES` unset (R2 has Infrequent Access).
6. **Optional, with a public custom domain (`R2_PUBLIC_BASE`).** Staged uploads are readable there by their unguessable key for the minutes they're staged. To close that, add a WAF custom rule on the domain that blocks paths starting `/uploads/`. The API reads staged objects through the S3 endpoint, never the domain.

## Development and tests

With no bucket (`R2_*` unset), the API stores files on disk under `STORAGE_ROOT`. The flow is the same protocol:
- Part URLs point at the API itself: `PUT /v1/uploads/<id>/parts/<n>/data?expires=…&signature=…`, an HMAC with `LOCAL_UPLOAD_SECRET`, or one derived from the storage root.
- Parts wait in `<STORAGE_ROOT>/objects/.multipart/<id>/` until they're put together.
- The apps put their API base in front of these paths.
- Production answers them 404 and refuses to start an upload without a bucket (`uploads_need_bucket`).

The apps' mock mode answers every upload endpoint, including the part `PUT`s. It finishes each file with its mock's old form-endpoint logic (`packages/ui/src/upload/mock.ts`).

- `apps/api/test/uploads.test.ts`: roles; create, sign, list, complete, abort; the part-size math; resume from `listUploadParts`; the content ID, a duplicate stored once, Infrequent Access, preparation queued; refusals; a completion picked up after a restart; abandoned and orphaned uploads aborted; production refusing the local protocol.
- `npm run demo:uploads -w @opencast/api [-- --size 4g] [-- --s3]`: the STOP demo. It kills the uploader part-way through a 4 GiB upload and resumes it, then sends the same file again and shows it stored once. With `--s3` it runs a second time against SeaweedFS's S3 gateway in Docker, with real presigned URLs and the server-side copy in parts. MinIO's images aren't on Docker Hub any more. The file is a real 20-second MP4 at the start of a sparse file, so it takes almost no disk. Under 15 GB free, it uses 1 GiB.
