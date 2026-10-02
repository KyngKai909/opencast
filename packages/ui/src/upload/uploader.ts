// Direct uploads in the browser (follow-up Phase 4): Uppy with its S3 multipart plugin, driven by
// Opencast's own endpoints (contracts `uploadsApi`), never a third-party upload service. Files go
// straight to object storage in parts, several at once; part URLs are fetched a batch at a time and
// each is used once (a retried part gets a new one); after a dropped connection or a reload the
// parts the store already has are skipped. Golden Retriever keeps the list across reloads: a big
// file has to be chosen again (browsers don't keep it), and then carries on where it stopped.
//
// Once every part is in, the API checks the file ("Checking") and hands it on ("Preparing for air",
// or done); `onServerState` follows it with `getUpload`.

import Uppy, { type Meta, type UppyFile } from "@uppy/core";
import AwsS3, { type AwsS3MultipartOptions } from "@uppy/aws-s3";
import GoldenRetriever from "@uppy/golden-retriever";
import {
  UPLOAD_PARALLEL_PARTS,
  UPLOAD_SIGN_BATCH,
  uploadPartCount,
  uploadPartSize,
  type CreateUpload,
  type SignedPart,
  type UploadedPart,
  type UploadPurposeInput,
  type UploadSession,
  type UploadView
} from "@opencast/contracts";

/** The API calls an uploader makes. Each app builds one from its own client (`uploadClient`). */
export interface UploadClient {
  create(body: CreateUpload): Promise<UploadSession>;
  sign(uploadId: string, partNumbers: number[]): Promise<SignedPart[]>;
  list(uploadId: string): Promise<UploadedPart[]>;
  complete(uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<UploadView>;
  abort(uploadId: string): Promise<void>;
  get(uploadId: string): Promise<UploadView>;
  /** A part URL as the browser PUTs to it: the local protocol's are paths on the API, which need its origin in front. */
  resolveUrl(url: string): string;
}

/** What each file carries in Uppy (kept across reloads by Golden Retriever). */
export interface UploadMeta extends Meta {
  purpose: UploadPurposeInput;
  /** Our upload's ID, once it's started. */
  uploadId?: string;
}

export interface UploaderOptions {
  /** Unique per widget (Golden Retriever keeps each one's files apart), e.g. `library-<station ID>`. */
  id: string;
  client: UploadClient;
  /** Keep the list across reloads. Off where there's no IndexedDB (tests) or nothing big is sent. */
  resume?: boolean;
  /** Parts in flight at once. */
  parallel?: number;
}

export type OcUppy = Uppy<UploadMeta, Record<string, never>>;
export type OcUppyFile = UppyFile<UploadMeta, Record<string, never>>;

/** Part URLs handed out and not used yet, per upload; a batch asked for once for the parts around it. */
function partUrls(client: UploadClient) {
  const ready = new Map<string, Map<number, SignedPart>>();
  const asked = new Map<string, Map<number, Promise<void>>>();
  const bucket = <T>(m: Map<string, Map<number, T>>, id: string) => {
    let b = m.get(id);
    if (!b) m.set(id, (b = new Map()));
    return b;
  };
  return {
    seed(uploadId: string, parts: SignedPart[]) {
      const b = bucket(ready, uploadId);
      for (const p of parts) b.set(p.partNumber, p);
    },
    async take(uploadId: string, partNumber: number, partCount: number): Promise<SignedPart> {
      const have = bucket(ready, uploadId);
      const waiting = bucket(asked, uploadId);
      if (!have.has(partNumber)) {
        const pending = waiting.get(partNumber);
        if (pending) await pending;
      }
      if (!have.has(partNumber)) {
        // This part and the next ones that nobody has asked for yet.
        const numbers: number[] = [];
        for (let n = partNumber; n <= partCount && numbers.length < UPLOAD_SIGN_BATCH; n++) if (n === partNumber || (!have.has(n) && !waiting.has(n))) numbers.push(n);
        const batch = client.sign(uploadId, numbers).then((parts) => {
          for (const p of parts) have.set(p.partNumber, p);
        });
        for (const n of numbers) waiting.set(n, batch);
        try {
          await batch;
        } finally {
          for (const n of numbers) if (waiting.get(n) === batch) waiting.delete(n);
        }
      }
      const part = have.get(partNumber);
      if (!part) throw new Error("No URL for that part. Try again.");
      // Used once: a retry asks for a fresh one.
      have.delete(partNumber);
      return part;
    },
    forget(uploadId: string) {
      ready.delete(uploadId);
      asked.delete(uploadId);
    }
  };
}

/** An Uppy set up for Opencast's direct uploads. Files start as soon as they're added. */
export function createUploader({ id, client, resume = false, parallel = UPLOAD_PARALLEL_PARTS }: UploaderOptions): OcUppy {
  const uppy: OcUppy = new Uppy<UploadMeta, Record<string, never>>({ id, autoProceed: true, allowMultipleUploadBatches: true });
  const urls = partUrls(client);
  const uploadIdOf = (file: OcUppyFile, given?: string) => given ?? file.meta.uploadId ?? "";
  const s3: AwsS3MultipartOptions<UploadMeta, Record<string, never>> = {
    shouldUseMultipart: true,
    limit: parallel,
    // The same part size as the API's, from the contracts.
    getChunkSize: (file) => uploadPartSize(file.size),
    retryDelays: [0, 1000, 3000, 5000, 10000],
    async createMultipartUpload(file) {
      const session = await client.create({ purpose: file.meta.purpose, filename: file.name ?? "file", size: file.size ?? 0, contentType: file.type ?? "" });
      urls.seed(session.id, session.parts);
      uppy.setFileMeta(file.id, { uploadId: session.id } as UploadMeta);
      return { uploadId: session.id, key: session.key };
    },
    async signPart(file, { uploadId, partNumber }) {
      const part = await urls.take(uploadIdOf(file, uploadId), partNumber, uploadPartCount(file.size ?? 0));
      return { method: "PUT" as const, url: client.resolveUrl(part.url), headers: part.headers };
    },
    async listParts(file, { uploadId }) {
      const parts = await client.list(uploadIdOf(file, uploadId));
      return parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag, Size: p.size }));
    },
    async completeMultipartUpload(file, { uploadId, parts }) {
      const id = uploadIdOf(file, uploadId);
      urls.forget(id);
      await client.complete(
        id,
        parts.map((p) => ({ partNumber: p.PartNumber!, etag: p.ETag! }))
      );
      return {};
    },
    async abortMultipartUpload(file, { uploadId }) {
      const id = uploadIdOf(file, uploadId);
      urls.forget(id);
      if (id) await client.abort(id);
    }
  };
  uppy.use(AwsS3<UploadMeta, Record<string, never>>, s3);
  if (resume && typeof indexedDB !== "undefined") {
    uppy.use(GoldenRetriever<UploadMeta, Record<string, never>>, { serviceWorker: false });
  }
  return uppy;
}
