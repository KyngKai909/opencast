// Direct uploads (added 2026-09-30, follow-up Phase 4): files go from the browser straight to object
// storage in parts, never through the API server. The API checks the role, hands out presigned part
// URLs (a batch at a time), says which parts are in (to resume), and once every part is in reads the
// file from the store (never through the browser) for its content ID, stores it once, and does what
// the old form upload did: probe it, check it, add captions, and start preparation. docs/uploads.md.
//
// Each upload is a row (`broadcast.uploads`): `uploading`, `checking`, then `preparing` or `done`
// (or `failed`, `aborted`). Completion is worked by whoever holds the row's lease (the API that took
// the `completeUpload`, renewing it as it reads); a restart leaves the lease to run out, and the jobs
// tick picks the upload up again. Uploads left `uploading` for 24 hours are aborted, and multipart
// uploads the store still has open under `uploads/` with no row waiting for them are aborted too.

import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_PARALLEL_PARTS,
  UPLOAD_SIGN_BATCH,
  uploadPartCount,
  uploadPartSize,
  type CreateUpload,
  type SignedPart,
  type UploadedPart,
  type UploadPurpose,
  type UploadSession,
  type UploadView
} from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser, UploadedFile } from "../../http.js";
import { conflict, HttpError, notFound, refused } from "../../errors.js";
import { bareEtag, cidFromSha256, contentTypeOf, objectKey, sha256FromCid } from "../../storage.js";

const U = schema.uploads;
type Row = typeof U.$inferSelect;

/** Part URLs are good for an hour; each is used once (a retry asks for a new one). */
const PART_URL_SECONDS = 3600;
/** Uploads not completed in a day are aborted. */
const ABANDONED_MS = 24 * 3_600_000;
/** How long whoever is completing an upload holds it without renewing (they renew every 15 s). */
const LEASE_MS = 2 * 60_000;
const RENEW_MS = 15_000;
/** Completion is tried this many times (a restart, the store failing to answer) before it's failed. */
const MAX_ATTEMPTS = 3;
/** The staged object is readable by FFmpeg this long (a multi-hour file's loudness takes a while). */
const READ_URL_SECONDS = 6 * 3600;

const RELAY_TYPES = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|quicktime|webm|x-m4v))$/;
const RELAY_EXTENSIONS = /\.(png|jpe?g|webp|gif|mp4|m4v|mov|webm)$/i;
const CAPTION_EXTENSIONS = /\.(vtt|srt|txt)$/i;

export interface UploadsService {
  create(user: CurrentUser, input: CreateUpload): Promise<UploadSession>;
  sign(user: CurrentUser, uploadId: string, partNumbers: number[]): Promise<{ parts: SignedPart[] }>;
  parts(user: CurrentUser, uploadId: string): Promise<{ parts: UploadedPart[] }>;
  complete(user: CurrentUser, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<UploadView>;
  abort(user: CurrentUser, uploadId: string): Promise<void>;
  view(user: CurrentUser, uploadId: string): Promise<UploadView>;
  /** The local protocol's part PUT (development and tests). 404 in production. */
  acceptLocalPart(uploadId: string, partNumber: number, query: { expires?: string; signature?: string }, body: Readable): Promise<{ etag: string }>;
  /**
   * The jobs tick: completions whose lease ran out (a restart) are picked up again, uploads left
   * unfinished for 24 hours aborted, and (hourly) multipart uploads the store has open under
   * `uploads/` with nothing waiting for them aborted.
   */
  sweep(options?: { orphans?: boolean }): Promise<{ resumed: number; abandoned: number; orphans: number }>;
  /** Works an upload's completion now (the tick, tests). */
  process(uploadId: string): Promise<void>;
  /** Waits for completions started so far (tests, shutdown). */
  settle(): Promise<void>;
}

export function createUploadsService({ deps, services }: ModuleContext): UploadsService {
  const { db } = deps;
  const objects = deps.storage.objects;
  const running = new Set<Promise<void>>();
  const staff = ["owner", "operator"] as const;
  const doers = ["owner", "manager"] as const;

  const multipart = () => {
    if (!objects.multipart || !objects.move || !objects.open || !objects.readUrl) throw conflict("uploads_unavailable", "Direct uploads aren't available on this server.");
    return objects.multipart;
  };

  /** The person's role for what the file is for: the same roles as the old upload endpoints. */
  async function authorize(user: CurrentUser, purpose: UploadPurpose) {
    switch (purpose.kind) {
      case "library_item":
        await services.accounts.requireStation(user, purpose.stationId, [...staff]);
        return;
      case "library_replace":
      case "caption":
        await services.accounts.requireStation(user, await services.library.stationOfItem(purpose.itemId), [...staff]);
        return;
      case "spot_file":
        await services.accounts.requireBusiness(user, await services.spots.businessOfSpot(purpose.spotId), [...doers]);
        return;
      case "order_file": {
        const parties = await services.spots.partiesOfOrder(purpose.orderId);
        if (purpose.role === "brief") {
          const asBusiness = await services.accounts.requireBusiness(user, parties.businessId, [...doers]).catch(() => null);
          if (!asBusiness) throw notFound("That order");
          return;
        }
        await services.accounts.requireStation(user, parties.makerStationId, [...staff]);
        return;
      }
      case "relay_background":
        await services.accounts.requireStation(user, purpose.stationId, [...staff]);
        return;
    }
  }

  /** What would refuse the file anyway, checked before a single byte is sent. */
  async function precheck(purpose: UploadPurpose, input: { filename: string; size: number; contentType: string }) {
    if (input.size > UPLOAD_MAX_BYTES[purpose.kind]) {
      const limit = UPLOAD_MAX_BYTES[purpose.kind];
      const words = limit >= 1024 ** 3 ? `${limit / 1024 ** 3} GB` : `${limit / 1024 ** 2} MB`;
      throw refused("too_big", `Use a file of ${words} or less.`);
    }
    switch (purpose.kind) {
      case "library_item":
        // Pay-as-you-go: storage at its monthly cap takes nothing new.
        await services.billing.requireStorage(purpose.stationId);
        return;
      case "library_replace": {
        const item = await services.library.item(purpose.itemId);
        if (item.source !== "upload") throw new HttpError(409, "not_an_upload", item.source === "link" ? "It came from a link: import it again instead." : "Only uploads can be replaced here.");
        if (item.status === "preparing") throw new HttpError(409, "preparing", "It's still being prepared. Try again when it's ready.");
        return;
      }
      case "caption":
        if (!CAPTION_EXTENSIONS.test(input.filename) && !/^text\//.test(input.contentType)) throw refused("wrong_file_type", "Use a WebVTT (.vtt) or SRT (.srt) caption file.");
        return;
      case "relay_background": {
        const band = (await services.stations.idents([purpose.stationId])).get(purpose.stationId)?.band;
        if (band !== "radio") throw conflict("not_radio", "Backgrounds are for radio stations' relays. A TV station relays its own picture.");
        if (!RELAY_TYPES.test(input.contentType) && !RELAY_EXTENSIONS.test(input.filename)) throw refused("wrong_file_type", "Use a PNG, JPEG or WebP image, a GIF, or an MP4, MOV or WebM video.");
        return;
      }
      case "order_file": {
        const order = await services.spots.order(purpose.orderId);
        if (purpose.role === "brief" && !["asked", "quoted"].includes(order.state)) throw refused("brief_closed", "The brief can't change once the quote is accepted.");
        if (purpose.role === "delivery" && !["accepted", "changes_requested"].includes(order.state)) throw refused("not_in_the_making", "That order isn't waiting for a delivery.");
        return;
      }
      case "spot_file":
        return;
    }
  }

  async function own(user: CurrentUser, uploadId: string): Promise<Row> {
    const [row] = await db.select().from(U).where(eq(U.id, uploadId));
    // Someone else's upload is as good as none.
    if (!row || row.userId !== user.id) throw notFound("That upload");
    return row;
  }

  async function signed(row: Row, partNumbers: number[]): Promise<SignedPart[]> {
    const target = multipart();
    const expiresAt = new Date(Date.now() + PART_URL_SECONDS * 1000).toISOString();
    return Promise.all(
      partNumbers.map(async (partNumber) => {
        const { url, headers } = await target.signPart(row.key, row.multipartId ?? row.id, partNumber, PART_URL_SECONDS);
        return { partNumber, url, ...(headers ? { headers } : {}), expiresAt };
      })
    );
  }

  function view(row: Row): UploadView {
    return {
      id: row.id,
      purpose: row.purpose,
      filename: row.filename,
      bytes: row.bytes,
      contentType: row.contentType,
      state: row.state,
      partSize: row.partSize,
      partCount: row.partCount,
      contentId: row.contentId,
      duplicate: row.duplicate,
      result: (row.result as UploadView["result"]) ?? null,
      error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? "That upload couldn't be finished." } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null
    };
  }

  const update = (id: string, set: Partial<typeof U.$inferInsert>) => db.update(U).set({ ...set, updatedAt: deps.clock.now() }).where(eq(U.id, id));

  function kick(uploadId: string) {
    const work = service
      .process(uploadId)
      .catch((error) => console.error(`[uploads] ${uploadId} couldn't be completed`, error))
      .finally(() => running.delete(work));
    running.add(work);
  }

  /** Reads the staged object once for its sha-256, renewing the lease as it goes. */
  async function hash(row: Row): Promise<{ sha256: Buffer; bytes: number }> {
    const stream = await objects.open!(row.key);
    const sha = createHash("sha256");
    let bytes = 0;
    let renewed = Date.now();
    for await (const chunk of stream) {
      sha.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
      if (Date.now() - renewed > RENEW_MS) {
        renewed = Date.now();
        await update(row.id, { leaseUntil: new Date(deps.clock.now().getTime() + LEASE_MS) });
      }
    }
    return { sha256: sha.digest(), bytes };
  }

  /** What the file is for, done with it: the old endpoints' own service calls, given the staged file. */
  async function finish(row: Row, file: UploadedFile): Promise<{ state: "preparing" | "done"; result: NonNullable<UploadView["result"]> }> {
    const purpose = row.target as UploadPurpose;
    const user = { id: row.userId, privyDid: null, isAdmin: false } satisfies CurrentUser;
    // The role again: it may have changed while the file was on its way.
    await authorize(user, purpose);
    switch (purpose.kind) {
      case "library_item": {
        const item = await services.library.upload(purpose.stationId, file, purpose.fields ?? {}, { id: row.id });
        return { state: "preparing", result: { itemId: item.id, stationId: purpose.stationId } };
      }
      case "library_replace": {
        const item = await services.library.replaceFile(purpose.itemId, file);
        return { state: "preparing", result: { itemId: item.id } };
      }
      case "spot_file": {
        const spot = await services.spots.uploadSpotFile(purpose.spotId, file, purpose.scaleToFit);
        return { state: "preparing", result: { spotId: spot.id } };
      }
      case "order_file": {
        const order = purpose.role === "brief" ? await services.spots.attachBriefFile(purpose.orderId, file) : await services.spots.deliver(purpose.orderId, file);
        return { state: purpose.role === "brief" ? "done" : "preparing", result: { orderId: order.id } };
      }
      case "relay_background": {
        await services.stations.setRelayBackground(purpose.stationId, file);
        return { state: "preparing", result: { stationId: purpose.stationId } };
      }
      case "caption": {
        // A caption file isn't kept as it came: its WebVTT is (by its own content ID), as `putCaptionTrack` does.
        const chunks: Buffer[] = [];
        for await (const chunk of await objects.open!(row.key)) chunks.push(chunk as Buffer);
        const text = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
        await services.library.putCaptionTrack(purpose.itemId, row.userId, { language: purpose.language, text, source: "uploaded" });
        return { state: "done", result: { itemId: purpose.itemId } };
      }
    }
  }

  const service: UploadsService = {
    async create(user, input) {
      const purpose = input.purpose as UploadPurpose;
      const contentType = input.contentType?.trim() || contentTypeOf(input.filename);
      await authorize(user, purpose);
      await precheck(purpose, { filename: input.filename, size: input.size, contentType });
      const target = multipart();
      // Local disk is for development: production uploads go to the bucket.
      if (deps.config.production && objects.name === "local") throw conflict("uploads_need_bucket", "Uploads need object storage (R2) on this server.");
      const id = randomUUID();
      const key = objectKey.upload(id);
      const partSize = uploadPartSize(input.size);
      const partCount = uploadPartCount(input.size);
      const multipartId = await target.create(key, contentType);
      const now = deps.clock.now();
      const [row] = await db
        .insert(U)
        .values({
          id,
          userId: user.id,
          purpose: purpose.kind,
          target: purpose,
          filename: input.filename,
          contentType,
          bytes: input.size,
          partSize,
          partCount,
          store: objects.name,
          key,
          multipartId,
          state: "uploading",
          expiresAt: new Date(now.getTime() + ABANDONED_MS),
          updatedAt: now,
          createdAt: now
        })
        .returning();
      const first = Array.from({ length: Math.min(partCount, UPLOAD_SIGN_BATCH) }, (_, i) => i + 1);
      return {
        id,
        key,
        protocol: objects.name === "local" ? "local" : "s3",
        partSize,
        partCount,
        parallel: UPLOAD_PARALLEL_PARTS,
        parts: await signed(row, first),
        state: "uploading",
        expiresAt: row.expiresAt.toISOString()
      };
    },

    async sign(user, uploadId, partNumbers) {
      const row = await own(user, uploadId);
      if (row.state !== "uploading") throw conflict("not_uploading", "That upload isn't taking parts any more.");
      if (partNumbers.some((n) => n > row.partCount)) throw refused("no_such_part", `That upload has ${row.partCount} ${row.partCount === 1 ? "part" : "parts"}.`);
      return { parts: await signed(row, [...new Set(partNumbers)]) };
    },

    async parts(user, uploadId) {
      const row = await own(user, uploadId);
      if (row.state !== "uploading") throw conflict("not_uploading", "That upload isn't taking parts any more.");
      const parts = await multipart().listParts(row.key, row.multipartId ?? row.id);
      return { parts: parts.filter((p) => p.partNumber <= row.partCount).map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size })) };
    },

    async complete(user, uploadId, parts) {
      const row = await own(user, uploadId);
      if (row.state !== "uploading") {
        if (row.state === "failed" || row.state === "aborted") throw conflict("not_uploading", "That upload was cancelled or couldn't be finished. Upload the file again.");
        return view(row);
      }
      const target = multipart();
      // Every part, as the store has it: the browser's list has to match.
      const have = new Map((await target.listParts(row.key, row.multipartId ?? row.id)).map((p) => [p.partNumber, p]));
      const given = new Map(parts.map((p) => [p.partNumber, p]));
      for (let n = 1; n <= row.partCount; n++) {
        const stored = have.get(n);
        if (!stored || !given.has(n) || bareEtag(stored.etag) !== bareEtag(given.get(n)!.etag)) {
          throw conflict("parts_missing", `Part ${n} of ${row.partCount} isn't in yet. Resume the upload.`);
        }
      }
      // Taken by this call: a second one at the same moment answers what this one does.
      const now = deps.clock.now();
      const [claimed] = await db
        .update(U)
        .set({ state: "checking", completedAt: now, leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now })
        .where(and(eq(U.id, row.id), eq(U.state, "uploading")))
        .returning();
      if (!claimed) return view((await db.select().from(U).where(eq(U.id, row.id)))[0]!);
      try {
        await target.complete(row.key, row.multipartId ?? row.id, [...have.values()].filter((p) => p.partNumber <= row.partCount));
      } catch (error) {
        await update(row.id, { state: "uploading", completedAt: null, leaseUntil: null });
        throw error;
      }
      // Handed on: the lease is let go and the work started here.
      await update(row.id, { leaseUntil: null });
      kick(row.id);
      return view({ ...claimed, leaseUntil: null });
    },

    async abort(user, uploadId) {
      const row = await own(user, uploadId);
      if (row.state !== "uploading") return;
      await multipart()
        .abort(row.key, row.multipartId ?? row.id)
        .catch((error) => console.error(`[uploads] aborting ${row.id} in the store failed`, error));
      await update(row.id, { state: "aborted", leaseUntil: null });
    },

    async view(user, uploadId) {
      return view(await own(user, uploadId));
    },

    async acceptLocalPart(uploadId, partNumber, query, body) {
      const target = objects.multipart;
      if (deps.config.production || objects.name !== "local" || !target?.putPart || !target.verifyPart) throw notFound("That upload");
      if (!/^[0-9a-f-]{36}$/.test(uploadId) || !Number.isInteger(partNumber) || partNumber < 1) throw notFound("That upload");
      if (!target.verifyPart(uploadId, partNumber, query.expires ?? "", query.signature ?? "")) throw new HttpError(403, "signature", "That part URL has expired or isn't signed. Ask for a new one.");
      const [row] = await db.select().from(U).where(eq(U.id, uploadId));
      if (!row) throw notFound("That upload");
      if (row.state !== "uploading") throw conflict("not_uploading", "That upload isn't taking parts any more.");
      if (partNumber > row.partCount) throw refused("no_such_part", `That upload has ${row.partCount} parts.`);
      const part = await target.putPart(row.key, row.multipartId ?? row.id, partNumber, body, row.partSize);
      return { etag: part.etag };
    },

    async process(uploadId) {
      // Held by this worker until it's done (or the lease runs out: a restart).
      const now = deps.clock.now();
      const [row] = await db
        .update(U)
        .set({ leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${U.attempts} + 1`, updatedAt: now })
        .where(and(eq(U.id, uploadId), eq(U.state, "checking"), or(isNull(U.leaseUntil), lt(U.leaseUntil, now))))
        .returning();
      if (!row) return;
      const fail = async (code: string, message: string) => {
        await objects.delete(row.key).catch(() => undefined);
        await update(row.id, { state: "failed", errorCode: code, errorMessage: message, leaseUntil: null });
      };
      try {
        let staged = (await objects.size?.(row.key)) ?? null;
        // Picked up after a restart that came between taking it and finishing the multipart upload.
        if (staged === null && !row.contentId && row.multipartId) {
          const parts = await multipart().listParts(row.key, row.multipartId);
          if (parts.length >= row.partCount) {
            await multipart().complete(row.key, row.multipartId, parts.filter((p) => p.partNumber <= row.partCount));
            staged = (await objects.size?.(row.key)) ?? null;
          }
        }
        let cid = row.contentId;
        let sha256: Buffer;
        let bytes = row.bytes;
        let key = row.key;
        if (staged !== null) {
          if (staged !== row.bytes) return fail("wrong_size", "The file that arrived isn't the size it said it was. Upload it again.");
          const read = await hash(row);
          sha256 = read.sha256;
          bytes = read.bytes;
          cid = cidFromSha256(sha256);
          await update(row.id, { contentId: cid });
        } else if (cid) {
          // Moved to its content ID already (a restart after it was kept): finish from there.
          key = objectKey.file(cid);
          sha256 = sha256FromCid(cid);
        } else {
          return fail("not_found", "The file didn't arrive. Upload it again.");
        }
        let duplicate = false;
        const file: UploadedFile = {
          path: await objects.readUrl!(key, READ_URL_SECONDS),
          originalName: row.filename,
          size: bytes,
          mimeType: row.contentType,
          stored: { key, cid: cid!, sha256, bytes, onKept: (kept) => void (duplicate = kept.duplicate) }
        };
        const done = await finish(row, file);
        // Anything the purpose didn't keep (a caption file's bytes) goes.
        if (key === row.key) await objects.delete(row.key).catch(() => undefined);
        await update(row.id, { state: done.state, result: done.result, duplicate, leaseUntil: null, errorCode: null, errorMessage: null });
      } catch (error) {
        if (error instanceof HttpError) {
          // Refused, as the old endpoint would have: nothing is kept.
          await fail(error.code, error.message);
          return;
        }
        console.error(`[uploads] completing ${row.id} failed (attempt ${row.attempts})`, error);
        if (row.attempts >= MAX_ATTEMPTS) await fail("couldnt_read", "That file couldn't be read from storage. Upload it again.");
        // Let go at once: the next tick tries again.
        else await update(row.id, { leaseUntil: new Date(deps.clock.now().getTime() - 1) });
      }
    },

    async sweep(options = {}) {
      const now = deps.clock.now();
      // Completions nobody holds: the API that took them restarted, or the store failed to answer.
      const stale = await db
        .select({ id: U.id })
        .from(U)
        .where(and(eq(U.state, "checking"), or(isNull(U.leaseUntil), lt(U.leaseUntil, now))));
      for (const { id } of stale) kick(id);
      // Abandoned: aborted in the store, so their parts stop costing anything.
      const abandoned = await db
        .select()
        .from(U)
        .where(and(eq(U.state, "uploading"), lt(U.expiresAt, now)));
      for (const row of abandoned) {
        await objects.multipart?.abort(row.key, row.multipartId ?? row.id).catch((error) => console.error(`[uploads] aborting ${row.id} failed`, error));
        await update(row.id, { state: "aborted", errorCode: "abandoned", errorMessage: "Not finished within a day, so it was cancelled. Upload the file again." });
      }
      let orphans = 0;
      if (options.orphans && objects.multipart) {
        // Open in the store under uploads/ but not waiting in a row (a row lost, a key made by hand).
        const open = await objects.multipart.listOpen("uploads/");
        const old = open.filter((u) => !u.initiated || u.initiated.getTime() < now.getTime() - ABANDONED_MS);
        if (old.length) {
          const ids = old.map((u) => u.key.split("/").pop()!).filter((id) => /^[0-9a-f-]{36}$/.test(id));
          const waiting = new Set(
            ids.length
              ? (
                  await db
                    .select({ id: U.id })
                    .from(U)
                    .where(and(inArray(U.id, ids), eq(U.state, "uploading")))
                ).map((r) => r.id)
              : []
          );
          for (const u of old) {
            if (waiting.has(u.key.split("/").pop()!)) continue;
            await objects.multipart.abort(u.key, u.uploadId).catch(() => undefined);
            orphans++;
          }
        }
      }
      return { resumed: stale.length, abandoned: abandoned.length, orphans };
    },

    async settle() {
      while (running.size) await Promise.all([...running]);
    }
  };
  return service;
}

