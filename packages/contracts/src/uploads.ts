// Direct uploads (added 2026-09-30, follow-up Phase 4): files go straight from the browser to object
// storage (Cloudflare R2 in production, a Railway bucket on staging), never through the API server.
// docs/uploads.md has the whole story.
//
// 1. `createUpload` checks the person's role for what the file is for (the same roles as the old
//    form uploads), and starts a multipart upload at a staging key (`uploads/<upload ID>`). It
//    answers with the part size, how many parts to send at once, and the first batch of presigned
//    part URLs.
// 2. The browser PUTs each part to its URL, several at once (`UPLOAD_PARALLEL_PARTS`), and asks
//    for more URLs as it goes (`signUploadParts`: lazily, a batch at a time). Each part's answer
//    carries an `ETag` header.
// 3. A dropped connection or a reload: `listUploadParts` says which parts the store already has, so
//    only the rest are sent.
// 4. `completeUpload` with every part's ETag. The upload is `checking` while the API reads it from
//    the store (never through the browser) to work out its content ID, stores it once (a file the
//    platform already has isn't stored again), and does what the old upload did: probe it, check it,
//    add captions, and start preparation. `getUpload` follows it: `uploading`, `checking`, then
//    `preparing` (it's kept, and what it made is being prepared) or `done` (nothing to prepare), or
//    `failed` with a reason.
//
// In local development (no bucket, files on disk) the part URLs point at the API itself
// (`LOCAL_UPLOAD_PART_PATH`), signed the same way, so the apps' flow is identical. Production
// refuses them.
//
// The old multipart-form endpoints (`libraryApi.upload`, `replaceFile`, `spotsApi.uploadSpotFile`,
// `attachBriefFile`, `deliverOrder`, `stationsApi.setRelayBackground`) still work; the apps use
// these instead.

import { z } from "zod";
import { endpoint } from "./core.js";
import { BumperRole, Id, LibraryCode, Millis, Ok, Timestamp } from "./common.js";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/** S3 and R2's limits: parts of at least 5 MiB (but the last), at most 10,000 of them. */
export const UPLOAD_MIN_PART_BYTES = 5 * MiB;
export const UPLOAD_MAX_PARTS = 10_000;

/**
 * The part size for a file, the same in the browser and the API: 16 MiB up to 1 GiB, 32 MiB up to
 * 16 GiB, then 64 MiB (more above 625 GiB, to stay under 10,000 parts). Big enough that a
 * multi-gigabyte file is a few hundred requests (R2 bills each part as one Class A operation), small
 * enough that a dropped connection re-sends little and that several parts in flight keep a fast
 * connection full.
 */
export function uploadPartSize(bytes: number): number {
  if (bytes <= GiB) return 16 * MiB;
  if (bytes <= 16 * GiB) return 32 * MiB;
  return Math.max(64 * MiB, Math.ceil(bytes / UPLOAD_MAX_PARTS / MiB) * MiB);
}

/** How many parts a file is sent in (one for a file up to its part size). */
export function uploadPartCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / uploadPartSize(bytes)));
}

/** Parts in flight at once, per upload widget. Leaves one of the browser's six connections to a host free. */
export const UPLOAD_PARALLEL_PARTS = 5;

/** Part URLs handed out per request (`createUpload`'s first batch, `signUploadParts` at most 100). */
export const UPLOAD_SIGN_BATCH = 10;

/** The largest file each purpose takes. */
export const UPLOAD_MAX_BYTES = {
  library_item: 100 * GiB,
  library_replace: 100 * GiB,
  spot_file: 100 * GiB,
  order_file: 100 * GiB,
  caption: MiB,
  relay_background: 100 * MiB
} as const;

/**
 * The local protocol's part URL (development and tests only; production answers 404): a `PUT` of the
 * part's bytes, with the `expires` and `signature` query the API signed. Answers 200 with an `ETag`
 * header (exposed to the browser). Not in `api`: its body is the part's bytes, not JSON.
 */
export const LOCAL_UPLOAD_PART_PATH = "/uploads/:uploadId/parts/:partNumber/data";

/** What a library upload says about the new item (the old upload's form fields). */
export const LibraryUploadFields = z.object({
  title: z.string().min(1).max(200).optional(),
  /**
   * Its type. A242 (2026-10-02): `OPN` (opener), `CLS` (closer) or `OFF` (off-air card) too; an
   * off-air card can be a picture (PNG, JPEG or WebP) as well as video or audio.
   */
  code: LibraryCode.optional(),
  programId: Id.nullable().optional(),
  folderId: Id.nullable().optional(),
  episodeNumber: z.number().int().positive().nullable().optional(),
  /**
   * Programming Phase 2 (added 2026-10-09): its season, and a multi-part episode's shared words and
   * part number. Not sent: guessed from the file's name and the title, as `libraryApi.upload`.
   */
  seasonNumber: z.number().int().positive().nullable().optional(),
  partOf: z.string().trim().min(1).max(200).nullable().optional(),
  partNumber: z.number().int().positive().nullable().optional(),
  episodeDescription: z.string().max(160).nullable().optional(),
  breakPointsMs: z.array(Millis).optional(),
  /** A caption file's text (WebVTT, or SRT turned into WebVTT; up to 1 MB), read in the browser and sent here. */
  captions: z.string().min(1).max(1_048_576).optional(),
  /** Its language (BCP 47); else the program's captions language, else "en". */
  captionLanguage: z.string().min(2).max(35).optional(),
  /** A244 (added 2026-10-02): a bumper's role (A243), for a bumper uploaded into a block's role. */
  bumperRole: BumperRole.nullable().optional(),
  /**
   * A244 (added 2026-10-02): uploaded straight into a programming block (a bumper, station ID,
   * opener or closer: the block's bumper, ID, intro or outro). Its block must be the station's.
   */
  programBlockId: Id.nullable().optional()
});
export type LibraryUploadFields = z.infer<typeof LibraryUploadFields>;

/**
 * What the file is for, which decides who may send it (checked at `createUpload`, and again when it
 * completes) and what happens once it's in:
 * - `library_item`: a new library item on a station (owners, operators). 409 `storage_paused` while
 *   storage is at its cap.
 * - `library_replace`: a new file for a library item (L6; owners, operators).
 * - `spot_file`: a spot's file (the business's owners and managers). `scaleToFit` as P2.
 * - `order_file`: a production order's brief file (the business) or delivery (the maker station).
 * - `caption`: an item's caption track (WebVTT or SRT, up to 1 MB; owners, operators).
 * - `relay_background`: a radio station's relay background (an image, a GIF or a video up to 30 s,
 *   100 MB; owners, operators).
 */
export const UploadPurpose = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library_item"), stationId: Id, fields: LibraryUploadFields.default({}) }),
  z.object({ kind: z.literal("library_replace"), itemId: Id }),
  z.object({ kind: z.literal("spot_file"), spotId: Id, scaleToFit: z.boolean().default(false) }),
  z.object({ kind: z.literal("order_file"), orderId: Id, role: z.enum(["brief", "delivery"]) }),
  z.object({ kind: z.literal("caption"), itemId: Id, language: z.string().min(2).max(35) }),
  z.object({ kind: z.literal("relay_background"), stationId: Id })
]);
export type UploadPurpose = z.infer<typeof UploadPurpose>;
export type UploadPurposeInput = z.input<typeof UploadPurpose>;
export const UploadPurposeKind = z.enum(["library_item", "library_replace", "spot_file", "order_file", "caption", "relay_background"]);
export type UploadPurposeKind = z.infer<typeof UploadPurposeKind>;

export const CreateUpload = z.object({
  purpose: UploadPurpose,
  filename: z.string().min(1).max(255),
  /** Bytes. At least one; at most the purpose's `UPLOAD_MAX_BYTES` (422 `too_big`). */
  size: z.number().int().positive(),
  /** The file's type as the browser saw it (may be empty). */
  contentType: z.string().max(200).default("")
});
export type CreateUpload = z.input<typeof CreateUpload>;

/** A presigned URL for one part: `PUT` the part's bytes to it, with `headers` if any. Used once. */
export const SignedPart = z.object({
  partNumber: z.number().int().min(1).max(UPLOAD_MAX_PARTS),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  expiresAt: Timestamp
});
export type SignedPart = z.infer<typeof SignedPart>;

/**
 * - `uploading`: waiting for parts.
 * - `checking`: every part is in; the API is reading it (content ID, storing once, probing, the checks).
 * - `preparing`: finished. It's kept, and what it made (a library item, a spot, a delivery, a relay
 *   background) is being prepared for air. Follow that, not the upload.
 * - `done`: finished, with nothing to prepare (a brief file, a caption track).
 * - `failed`: refused or broken, with `error` (the old endpoints' codes: `unreadable_file`, `wrong_kind`,
 *   `too_long_for_log`, `not_captions`, `taken_down`…). Nothing is kept.
 * - `aborted`: cancelled, or abandoned for 24 hours.
 */
export const UploadState = z.enum(["uploading", "checking", "preparing", "done", "failed", "aborted"]);
export type UploadState = z.infer<typeof UploadState>;

export const UploadSession = z.object({
  id: Id,
  /** Opaque to the apps; Uppy's multipart `key`. */
  key: z.string(),
  /** `s3`: parts go to the bucket. `local`: to the API (development). */
  protocol: z.enum(["s3", "local"]),
  partSize: z.number().int().positive(),
  partCount: z.number().int().positive(),
  /** Parts to send at once. */
  parallel: z.number().int().positive(),
  /** The first batch of part URLs, from part 1. */
  parts: z.array(SignedPart),
  state: UploadState,
  /** Abandoned uploads are cleaned up after this. */
  expiresAt: Timestamp
});
export type UploadSession = z.infer<typeof UploadSession>;

export const UploadedPart = z.object({ partNumber: z.number().int().positive(), etag: z.string(), size: z.number().int().nonnegative() });
export type UploadedPart = z.infer<typeof UploadedPart>;

export const UploadView = z.object({
  id: Id,
  purpose: UploadPurposeKind,
  filename: z.string(),
  bytes: z.number().int().nonnegative(),
  contentType: z.string(),
  state: UploadState,
  partSize: z.number().int().positive(),
  partCount: z.number().int().positive(),
  /** Its content ID, once it's been read. */
  contentId: z.string().nullable(),
  /** The platform already had these bytes: nothing new was stored. */
  duplicate: z.boolean(),
  /** What it made or changed, once finished. */
  result: z
    .object({
      itemId: Id.optional(),
      spotId: Id.optional(),
      orderId: Id.optional(),
      stationId: Id.optional()
    })
    .nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  completedAt: Timestamp.nullable()
});
export type UploadView = z.infer<typeof UploadView>;

const UploadParams = z.object({ uploadId: Id });

export const uploadsApi = {
  createUpload: endpoint({
    method: "POST",
    path: "/uploads",
    auth: "user",
    summary:
      "Start a direct upload: checks the role for its purpose (404 or 403 as the old upload endpoint would), then answers with the part size, parts to send at once and the first part URLs. 422 `too_big`, `wrong_file_type` (a relay background or caption file of the wrong type); 409 `storage_paused` (a library item while storage is at its cap), `not_radio` (a relay background on a TV station), `brief_closed`, `not_in_the_making`, `not_an_upload`, `preparing`, `claim_open`.",
    body: CreateUpload,
    response: UploadSession,
    status: 201
  }),
  signUploadParts: endpoint({
    method: "POST",
    path: "/uploads/:uploadId/parts",
    auth: "user",
    summary: "More part URLs (up to 100 at once), each used once; ask again to retry a part. The person who started it only (404 otherwise). 409 `not_uploading` once it's completed or aborted; 422 for a part number past `partCount`.",
    params: UploadParams,
    body: z.object({ partNumbers: z.array(z.number().int().min(1).max(UPLOAD_MAX_PARTS)).min(1).max(100) }),
    response: z.object({ parts: z.array(SignedPart) })
  }),
  listUploadParts: endpoint({
    method: "GET",
    path: "/uploads/:uploadId/parts",
    auth: "user",
    summary: "The parts the store already has, to resume after a dropped connection or a reload. 409 `not_uploading` once it's completed or aborted.",
    params: UploadParams,
    response: z.object({ parts: z.array(UploadedPart) })
  }),
  completeUpload: endpoint({
    method: "POST",
    path: "/uploads/:uploadId/complete",
    auth: "user",
    summary:
      "Every part is in: the upload becomes `checking` and the API takes it from there (content ID, stored once, the checks, preparation). Answers at once; follow it with `getUpload`. Calling it again answers the same. 409 `parts_missing` (a part the store doesn't have, or an ETag that doesn't match), `not_uploading` (aborted).",
    params: UploadParams,
    body: z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(UPLOAD_MAX_PARTS), etag: z.string().min(1) })).min(1).max(UPLOAD_MAX_PARTS) }),
    response: UploadView
  }),
  abortUpload: endpoint({
    method: "DELETE",
    path: "/uploads/:uploadId",
    auth: "user",
    summary: "Cancel an upload: its parts are deleted. An upload that's already finished is left as it is. Uploads left unfinished for 24 hours are aborted by themselves.",
    params: UploadParams,
    response: Ok
  }),
  getUpload: endpoint({
    method: "GET",
    path: "/uploads/:uploadId",
    auth: "user",
    summary: "An upload's state, content ID and what it made. The person who started it only (404 otherwise).",
    params: UploadParams,
    response: UploadView
  })
};
