// Where files live. Every object is keyed by its content ID: a CID (v1, raw codec,
// sha-256), so a file carried by twelve stations is stored once, and any file can be
// published to IPFS later without being renamed. Object storage (R2, or local disk
// in development) is the working store; IPFS through Pinata is only for the Opencast
// catalog and a station's own "Export to IPFS".

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageClass = "standard" | "infrequent";

export interface ObjectStore {
  readonly name: "local" | "r2";
  /** Stores a file. The store checks the bytes against the sha-256 it's given. */
  put(key: string, file: string, options: { contentType: string; storageClass: StorageClass; sha256: Buffer }): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Copies an object to a local file (preparation's scratch space), checking its sha-256 on the way. */
  download(key: string, dest: string, sha256?: Buffer): Promise<void>;
  /**
   * Copies an object to another key inside the store (no download: R2 copies it server side), in
   * Standard. The relinks use it to carry a file's prepared segments over to its content ID.
   */
  copy(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Stores every file in a directory under a prefix (a prepared rendition's playlist and segments). */
  putDir(prefix: string, dir: string, storageClass: StorageClass): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /** A URL an app can fetch the object from. */
  url(key: string): Promise<string>;
  /**
   * A lasting public URL for the object (a bucket's custom domain, or the API's `/objects` in
   * development), or null when the store has none (its URLs are presigned). Playlists point at these.
   */
  publicUrl?(key: string): string | null;
  /** Reads an object (the proof frame and translators read prepared segments). */
  open?(key: string): Promise<Readable>;
  /**
   * Direct uploads (added 2026-09-30, follow-up Phase 4): multipart uploads the browser sends parts
   * of itself, to presigned URLs. R2 and S3-compatible stores sign S3's own; local disk signs the
   * API's (`LOCAL_UPLOAD_PART_PATH`), development only.
   */
  multipart?: MultipartTarget;
  /**
   * Moves an object to another key in the store, in a storage class (a direct upload, from its
   * staging key to its content ID). R2 copies server side (in parts above 5 GiB) and deletes the
   * original; local disk renames. Added 2026-09-30.
   */
  move?(from: string, to: string, options: { storageClass: StorageClass; contentType: string }): Promise<void>;
  /** Somewhere FFmpeg can read an object from: a local path, or a presigned URL good for `seconds`. Added 2026-09-30. */
  readUrl?(key: string, seconds?: number): Promise<string>;
  /** An object's size in bytes, or null when there's none. Added 2026-09-30. */
  size?(key: string): Promise<number | null>;
}

/** A part the store has, for resuming. `etag` is as the store gives it (quoted). */
export interface StoredPart {
  partNumber: number;
  etag: string;
  size: number;
}

/** Multipart uploads a browser sends to presigned part URLs (added 2026-09-30). */
export interface MultipartTarget {
  /** Starts one at `key` (a staging key, in Standard); returns the store's upload ID. */
  create(key: string, contentType: string): Promise<string>;
  /** A URL to `PUT` one part's bytes to, good for `seconds`. */
  signPart(key: string, uploadId: string, partNumber: number, seconds: number): Promise<{ url: string; headers?: Record<string, string> }>;
  listParts(key: string, uploadId: string): Promise<StoredPart[]>;
  /** Puts the parts together as the object at `key`. */
  complete(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void>;
  /** Deletes its parts. Unknown uploads are fine. */
  abort(key: string, uploadId: string): Promise<void>;
  /** Multipart uploads still open under a prefix, oldest first where the store says (the stale-upload sweep). */
  listOpen(prefix: string): Promise<Array<{ key: string; uploadId: string; initiated: Date | null }>>;
  /** Local disk only: takes a part's bytes from the API's part route. */
  putPart?(key: string, uploadId: string, partNumber: number, body: Readable, maxBytes: number): Promise<StoredPart>;
  /** Local disk only: whether a part URL's signature is the API's own and not expired (by the real clock, as S3's are). */
  verifyPart?(uploadId: string, partNumber: number, expires: string, signature: string): boolean;
}

/** An ETag without its quotes, to compare the browser's with the store's. */
export const bareEtag = (etag: string) => etag.replace(/^W\//, "").replace(/^"+|"+$/g, "");

export interface IpfsPublisher {
  readonly configured: boolean;
  /** Pins a file publicly. IPFS files are public and can't be taken back. */
  pin(file: string, name: string): Promise<{ ipfsCid: string; pinId: string; url: string }>;
  unpin(pinId: string): Promise<void>;
}

export interface Storage {
  objects: ObjectStore;
  ipfs: IpfsPublisher;
}

// --- Content IDs -----------------------------------------------------------------

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Uint8Array) {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** CIDv1, raw codec (0x55), sha2-256 multihash (0x12, 32 bytes), multibase base32 ("b"). */
export function cidFromSha256(digest: Buffer): string {
  return `b${base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]))}`;
}

/** A content ID's shape: "b", then 58 base32 characters (36 bytes: the 4-byte prefix and the digest). */
const CONTENT_ID = /^b[a-z2-7]{58}$/;
const CID_PREFIX = [0x01, 0x55, 0x12, 0x20];

export const isContentId = (cid: string) => {
  try {
    sha256FromCid(cid);
    return true;
  } catch {
    return false;
  }
};

/**
 * The sha-256 a content ID names. Only our own kind of CID: v1, raw codec, a sha2-256 multihash of
 * 32 bytes, in lowercase base32 ("b"). Anything else (an IPFS CID of a chunked file, `bafybei…`,
 * which names a DAG and not the bytes; a CIDv0 `Qm…`; a typo) throws, rather than reading the
 * wrong 32 bytes as a digest.
 */
export function sha256FromCid(cid: string): Buffer {
  if (!CONTENT_ID.test(cid)) throw new Error(`not a content ID: ${cid.slice(0, 80)}`);
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cid.slice(1)) {
    value = ((value << 5) | BASE32.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  // 58 characters are 290 bits: 36 bytes and 2 bits of padding, which must be zero.
  if (out.length !== 36 || (value & ((1 << bits) - 1)) !== 0) throw new Error(`not a content ID: ${cid}`);
  if (CID_PREFIX.some((byte, i) => out[i] !== byte)) throw new Error(`not a raw sha-256 CIDv1: ${cid}`);
  return Buffer.from(out.slice(4));
}

export async function contentIdOf(file: string): Promise<{ cid: string; sha256: Buffer; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  const sha256 = hash.digest();
  return { cid: cidFromSha256(sha256), sha256, bytes };
}

async function sha256Of(file: string) {
  return (await contentIdOf(file)).sha256;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ts": "video/mp2t",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip"
};

export const contentTypeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

// --- Local disk (development and tests) ------------------------------------------

export interface LocalUploadOptions {
  /** The API's public origin, for part URLs (empty: paths, which the apps put their API base in front of). */
  apiBase?: string;
  /** What part URLs are signed with. Development only; defaults to one derived from the store's root. */
  secret?: string;
}

export function localObjectStore(root: string, publicBase = "/objects", uploads: LocalUploadOptions = {}): ObjectStore {
  const at = (key: string) => path.join(root, ...key.split("/"));
  const secret = uploads.secret ?? createHash("sha256").update(`opencast-local-uploads:${root}`).digest("hex");
  const multipart = localMultipart(root, at, secret, (uploads.apiBase ?? "").replace(/\/+$/, ""));
  return {
    name: "local",
    multipart,
    async move(from, to) {
      await fs.mkdir(path.dirname(at(to)), { recursive: true });
      await fs.rename(at(from), at(to));
    },
    async readUrl(key) {
      return at(key);
    },
    async size(key) {
      return fs.stat(at(key)).then(
        (s) => s.size,
        () => null
      );
    },
    async put(key, file, { sha256 }) {
      if (!(await sha256Of(file)).equals(sha256)) throw new Error(`sha-256 mismatch storing ${key}`);
      await fs.mkdir(path.dirname(at(key)), { recursive: true });
      // Its own temporary name: two uploads of the same file can be stored at the same moment.
      const temp = `${at(key)}.${randomUUID()}.part`;
      await fs.copyFile(file, temp);
      await fs.rename(temp, at(key));
    },
    async has(key) {
      return fs.access(at(key)).then(
        () => true,
        () => false
      );
    },
    async download(key, dest, sha256) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const temp = `${dest}.${randomUUID()}.part`;
      await fs.copyFile(at(key), temp);
      if (sha256 && !(await sha256Of(temp)).equals(sha256)) {
        await fs.rm(temp, { force: true });
        throw new Error(`sha-256 mismatch reading ${key}`);
      }
      await fs.rename(temp, dest);
    },
    async copy(from, to) {
      await fs.mkdir(path.dirname(at(to)), { recursive: true });
      const temp = `${at(to)}.${randomUUID()}.part`;
      await fs.copyFile(at(from), temp);
      await fs.rename(temp, at(to));
    },
    async delete(key) {
      await fs.rm(at(key), { force: true });
    },
    async putDir(prefix, dir) {
      await fs.mkdir(at(prefix), { recursive: true });
      await fs.cp(dir, at(prefix), { recursive: true });
    },
    async deletePrefix(prefix) {
      await fs.rm(at(prefix), { recursive: true, force: true });
    },
    async url(key) {
      return `${publicBase}/${key}`;
    },
    publicUrl(key) {
      return `${publicBase}/${key}`;
    },
    async open(key) {
      await fs.access(at(key));
      return createReadStream(at(key));
    }
  };
}

/** The part URL's signature: an HMAC of the upload, the part and when it expires. */
export function localPartSignature(secret: string, uploadId: string, partNumber: number, expires: string) {
  return createHmac("sha256", secret).update(`${uploadId}:${partNumber}:${expires}`).digest("hex");
}

/**
 * Multipart uploads on local disk (development and tests): the same protocol as S3, with part URLs
 * that point at the API (`/v1/uploads/<id>/parts/<n>/data`), signed with an HMAC. Parts wait in
 * `<root>/.multipart/<upload ID>/` (a dot directory the `/objects` route doesn't serve), each with its
 * ETag (the MD5 of its bytes, as S3's); completing appends them in order into the object and deletes
 * each as it goes, so a big upload takes its own size on disk, plus one part.
 */
function localMultipart(root: string, at: (key: string) => string, secret: string, apiBase: string): MultipartTarget {
  const dirOf = (uploadId: string) => {
    if (!/^[\w-]+$/.test(uploadId)) throw new Error("not an upload ID");
    return path.join(root, ".multipart", uploadId);
  };
  const partFile = (uploadId: string, n: number) => path.join(dirOf(uploadId), String(n).padStart(5, "0"));
  async function listParts(_key: string, uploadId: string): Promise<StoredPart[]> {
    const names = await fs.readdir(dirOf(uploadId)).catch(() => [] as string[]);
    const parts: StoredPart[] = [];
    for (const name of names.filter((n) => /^\d{5}$/.test(n)).sort()) {
      const etag = await fs.readFile(path.join(dirOf(uploadId), `${name}.etag`), "utf8").catch(() => null);
      if (!etag) continue;
      parts.push({ partNumber: Number(name), etag, size: (await fs.stat(path.join(dirOf(uploadId), name))).size });
    }
    return parts;
  }
  return {
    async create(key) {
      // The staging key's last part is the upload's own ID; it's the local store's upload ID too.
      const uploadId = key.split("/").pop()!;
      await fs.mkdir(dirOf(uploadId), { recursive: true });
      return uploadId;
    },
    async signPart(_key, uploadId, partNumber, seconds) {
      const expires = String(Math.floor(Date.now() / 1000) + seconds);
      const signature = localPartSignature(secret, uploadId, partNumber, expires);
      return { url: `${apiBase}/v1/uploads/${uploadId}/parts/${partNumber}/data?expires=${expires}&signature=${signature}` };
    },
    verifyPart(uploadId, partNumber, expires, signature) {
      if (!/^\d+$/.test(expires) || Number(expires) * 1000 < Date.now() || !/^[0-9a-f]{64}$/.test(signature)) return false;
      const want = Buffer.from(localPartSignature(secret, uploadId, partNumber, expires), "hex");
      return timingSafeEqual(want, Buffer.from(signature, "hex"));
    },
    async putPart(_key, uploadId, partNumber, body, maxBytes) {
      await fs.mkdir(dirOf(uploadId), { recursive: true });
      const file = partFile(uploadId, partNumber);
      const temp = `${file}.${randomUUID()}.tmp`;
      const md5 = createHash("md5");
      let size = 0;
      body.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) body.destroy(new Error("part too big"));
        md5.update(chunk);
      });
      try {
        await pipeline(body, createWriteStream(temp));
      } catch (error) {
        await fs.rm(temp, { force: true });
        throw error;
      }
      const etag = `"${md5.digest("hex")}"`;
      await fs.rename(temp, file);
      await fs.writeFile(`${file}.etag`, etag);
      return { partNumber, etag, size };
    },
    listParts,
    async complete(key, uploadId, parts) {
      const have = new Map((await listParts(key, uploadId)).map((p) => [p.partNumber, p]));
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      for (const part of ordered) {
        if (bareEtag(have.get(part.partNumber)?.etag ?? "") !== bareEtag(part.etag)) throw new Error(`part ${part.partNumber} is missing or different`);
      }
      await fs.mkdir(path.dirname(at(key)), { recursive: true });
      const temp = `${at(key)}.${randomUUID()}.part`;
      await fs.writeFile(temp, "");
      for (const part of ordered) {
        const file = partFile(uploadId, part.partNumber);
        await pipeline(createReadStream(file), createWriteStream(temp, { flags: "a" }));
        await fs.rm(file, { force: true });
      }
      await fs.rename(temp, at(key));
      await fs.rm(dirOf(uploadId), { recursive: true, force: true });
    },
    async abort(_key, uploadId) {
      await fs.rm(dirOf(uploadId), { recursive: true, force: true });
    },
    async listOpen(prefix) {
      const base = path.join(root, ".multipart");
      const names = await fs.readdir(base).catch(() => [] as string[]);
      const open: Array<{ key: string; uploadId: string; initiated: Date | null }> = [];
      for (const name of names) {
        const stat = await fs.stat(path.join(base, name)).catch(() => null);
        if (stat?.isDirectory()) open.push({ key: `${prefix.replace(/\/+$/, "")}/${name}`, uploadId: name, initiated: stat.birthtime ?? stat.mtime });
      }
      return open;
    }
  };
}

// --- R2 (any S3-compatible store) --------------------------------------------------

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** A public domain for the bucket, if it has one; otherwise URLs are presigned. */
  publicBase?: string;
  presignSeconds?: number;
  /** Path-style URLs (bucket in the path): MinIO and other self-hosted S3 stores need it; R2 doesn't. */
  forcePathStyle?: boolean;
  /** Create the bucket on first use (a fresh self-hosted store); R2 buckets are made in Cloudflare. */
  createBucket?: boolean;
  /** Send storage classes (R2's Standard and Infrequent Access). Off for stores that don't know them (MinIO). */
  storageClasses?: boolean;
  /** Moves bigger than this copy in parts (S3's CopyObject stops at 5 GiB, the default). The demo lowers it to exercise the parts. */
  copyInPartsAbove?: number;
}

export function s3ObjectStore(config: S3Config): ObjectStore {
  const client = new S3Client({ region: "auto", endpoint: config.endpoint, forcePathStyle: config.forcePathStyle ?? false, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  const Bucket = config.bucket;
  let bucketReady: Promise<void> | null = null;
  const ensureBucket = () =>
    (bucketReady ??= config.createBucket
      ? client.send(new HeadBucketCommand({ Bucket })).then(
          () => undefined,
          () => client.send(new CreateBucketCommand({ Bucket })).then(() => undefined)
        )
      : Promise.resolve());
  // R2 maps STANDARD_IA to Infrequent Access.
  const cls = (c: StorageClass) => (c === "infrequent" ? ("STANDARD_IA" as const) : ("STANDARD" as const));
  // Direct uploads: a client that adds checksums only where S3 requires them. The SDK's default
  // (checksums on everything it can) would ask for CRC32 on each part at CreateMultipartUpload, and
  // put a checksum of an empty body in presigned part URLs; a browser's part PUTs carry neither.
  const plain = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
  const classOf = (c: StorageClass) => (config.storageClasses === false ? {} : { StorageClass: cls(c) });
  /** Above this, a copy goes in parts (S3's CopyObject stops at 5 GiB). */
  const COPY_LIMIT = config.copyInPartsAbove ?? 5 * 1024 ** 3;
  const COPY_PART = Math.min(1024 ** 3, Math.max(5 * 1024 ** 2, COPY_LIMIT));
  const multipart: MultipartTarget = {
    async create(key, contentType) {
      await ensureBucket();
      // Staged in Standard: Infrequent Access bills 30 days for anything deleted sooner.
      const made = await plain.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType || "application/octet-stream", ...classOf("standard") }));
      if (!made.UploadId) throw new Error("the store didn't start a multipart upload");
      return made.UploadId;
    },
    async signPart(key, uploadId, partNumber, seconds) {
      return { url: await getSignedUrl(plain, new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: seconds }) };
    },
    async listParts(key, uploadId) {
      const parts: StoredPart[] = [];
      let marker: string | undefined;
      for (;;) {
        const page = await plain.send(new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }));
        for (const p of page.Parts ?? []) if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
        if (!page.IsTruncated || !page.NextPartNumberMarker) break;
        marker = String(page.NextPartNumberMarker);
      }
      return parts;
    },
    async complete(key, uploadId, parts) {
      const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: `"${bareEtag(p.etag)}"` }));
      await plain.send(new CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: sorted } }));
    },
    async abort(key, uploadId) {
      try {
        await plain.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
      } catch (error) {
        if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
      }
    },
    async listOpen(prefix) {
      const open: Array<{ key: string; uploadId: string; initiated: Date | null }> = [];
      let keyMarker: string | undefined;
      let idMarker: string | undefined;
      for (;;) {
        const page = await plain.send(new ListMultipartUploadsCommand({ Bucket, Prefix: prefix, KeyMarker: keyMarker, UploadIdMarker: idMarker }));
        for (const u of page.Uploads ?? []) if (u.Key && u.UploadId) open.push({ key: u.Key, uploadId: u.UploadId, initiated: u.Initiated ?? null });
        if (!page.IsTruncated) break;
        keyMarker = page.NextKeyMarker;
        idMarker = page.NextUploadIdMarker;
        if (!keyMarker && !idMarker) break;
      }
      return open;
    }
  };
  const store: ObjectStore = {
    name: "r2",
    multipart,
    async move(from, to, { storageClass, contentType }) {
      await ensureBucket();
      const head = await plain.send(new HeadObjectCommand({ Bucket, Key: from }));
      const size = head.ContentLength ?? 0;
      const source = `${Bucket}/${from.split("/").map(encodeURIComponent).join("/")}`;
      if (size <= COPY_LIMIT) {
        await plain.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: source, MetadataDirective: "REPLACE", ContentType: contentType, ...classOf(storageClass) }));
      } else {
        // In 1 GiB parts, four at a time, all inside the store.
        const made = await plain.send(new CreateMultipartUploadCommand({ Bucket, Key: to, ContentType: contentType, ...classOf(storageClass) }));
        const uploadId = made.UploadId!;
        try {
          const ranges = Array.from({ length: Math.ceil(size / COPY_PART) }, (_, i) => ({ n: i + 1, from: i * COPY_PART, to: Math.min(size, (i + 1) * COPY_PART) - 1 }));
          const done: Array<{ PartNumber: number; ETag: string }> = [];
          let next = 0;
          await Promise.all(
            Array.from({ length: Math.min(4, ranges.length) }, async () => {
              while (next < ranges.length) {
                const r = ranges[next++]!;
                const copied = await plain.send(new UploadPartCopyCommand({ Bucket, Key: to, UploadId: uploadId, PartNumber: r.n, CopySource: source, CopySourceRange: `bytes=${r.from}-${r.to}` }));
                done.push({ PartNumber: r.n, ETag: copied.CopyPartResult!.ETag! });
              }
            })
          );
          await plain.send(new CompleteMultipartUploadCommand({ Bucket, Key: to, UploadId: uploadId, MultipartUpload: { Parts: done.sort((a, b) => a.PartNumber - b.PartNumber) } }));
        } catch (error) {
          await multipart.abort(to, uploadId).catch(() => undefined);
          throw error;
        }
      }
      await plain.send(new DeleteObjectCommand({ Bucket, Key: from }));
    },
    async readUrl(key, seconds = 6 * 3600) {
      return getSignedUrl(plain, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: seconds });
    },
    async size(key) {
      try {
        const head = await plain.send(new HeadObjectCommand({ Bucket, Key: key }));
        return head.ContentLength ?? 0;
      } catch {
        return null;
      }
    },
    async put(key, file, { contentType, storageClass, sha256 }) {
      await ensureBucket();
      const { size } = await fs.stat(file);
      // R2 recomputes the checksum and refuses the write if the bytes differ. (Railway buckets
      // accept it unchecked; downloads re-hash either way.)
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: contentType, ...(config.storageClasses === false ? {} : { StorageClass: cls(storageClass) }), ChecksumSHA256: sha256.toString("base64") }));
    },
    async has(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async download(key, dest, sha256) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const temp = `${dest}.${randomUUID()}.part`;
      const hash = createHash("sha256");
      const body = result.Body as Readable;
      body.on("data", (chunk: Buffer) => hash.update(chunk));
      await pipeline(body, createWriteStream(temp));
      if (sha256 && !hash.digest().equals(sha256)) {
        await fs.rm(temp, { force: true });
        throw new Error(`sha-256 mismatch reading ${key}`);
      }
      await fs.rename(temp, dest);
    },
    async copy(from, to) {
      await ensureBucket();
      const source = `${Bucket}/${from.split("/").map(encodeURIComponent).join("/")}`;
      await client.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: source, MetadataDirective: "COPY", ...(config.storageClasses === false ? {} : { StorageClass: cls("standard") }) }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async putDir(prefix, dir, storageClass) {
      for (const name of await fs.readdir(dir)) {
        const file = path.join(dir, name);
        await store.put(`${prefix}/${name}`, file, { contentType: contentTypeOf(file), storageClass, sha256: await sha256Of(file) });
      }
    },
    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: `${prefix}/`, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    async url(key) {
      if (config.publicBase) return `${config.publicBase.replace(/\/+$/, "")}/${key}`;
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: config.presignSeconds ?? 6 * 3600 });
    },
    publicUrl(key) {
      return config.publicBase ? `${config.publicBase.replace(/\/+$/, "")}/${key}` : null;
    },
    async open(key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return result.Body as Readable;
    }
  };
  return store;
}

// --- IPFS through Pinata (the catalog, and Export to IPFS only) --------------------

export function pinataPublisher(config: { jwt: string; uploadUrl?: string; gatewayBase?: string }): IpfsPublisher {
  const gateway = (config.gatewayBase ?? "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");
  return {
    configured: Boolean(config.jwt),
    async pin(file, name) {
      if (!config.jwt) throw new Error("PINATA_JWT isn't set.");
      const form = new FormData();
      form.append("network", "public");
      form.append("name", name);
      form.append("file", new Blob([await fs.readFile(file)], { type: contentTypeOf(file) }), path.basename(file));
      const response = await fetch(config.uploadUrl ?? "https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${config.jwt}` }, body: form });
      if (!response.ok) throw new Error(`Pinata answered ${response.status}`);
      const { data } = (await response.json()) as { data: { id: string; cid: string } };
      return { ipfsCid: data.cid, pinId: data.id, url: `${gateway}/${data.cid}` };
    },
    async unpin(pinId) {
      const response = await fetch(`https://api.pinata.cloud/v3/files/public/${encodeURIComponent(pinId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${config.jwt}` } });
      if (!response.ok && response.status !== 404) throw new Error(`Pinata answered ${response.status}`);
    }
  };
}

export const noIpfs: IpfsPublisher = {
  configured: false,
  async pin() {
    throw new Error("IPFS isn't set up (PINATA_JWT).");
  },
  async unpin() {
    throw new Error("IPFS isn't set up (PINATA_JWT).");
  }
};

/** The store from the environment: R2 when its keys are set, local disk otherwise. */
export function storageFromEnv(env: NodeJS.ProcessEnv, storageRoot: string, publicBase: string | null = null): Storage {
  const endpoint = env.R2_ENDPOINT?.trim() || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : "");
  const r2 = endpoint && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET;
  const objects = r2
    ? s3ObjectStore({ endpoint, accessKeyId: env.R2_ACCESS_KEY_ID!.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(), bucket: env.R2_BUCKET!.trim(), publicBase: env.R2_PUBLIC_BASE?.trim() || undefined, presignSeconds: Number(env.R2_PRESIGN_TTL_SEC) || undefined, forcePathStyle: env.S3_FORCE_PATH_STYLE === "true", createBucket: env.S3_CREATE_BUCKET === "true", storageClasses: env.S3_STORAGE_CLASSES !== "false" })
    : localObjectStore(path.join(storageRoot, "objects"), `${publicBase ?? ""}/objects`, { apiBase: publicBase ?? "", secret: env.LOCAL_UPLOAD_SECRET?.trim() || undefined });
  const ipfs = env.PINATA_JWT ? pinataPublisher({ jwt: env.PINATA_JWT, uploadUrl: env.PINATA_UPLOAD_URL || undefined, gatewayBase: env.PINATA_GATEWAY_BASE || undefined }) : noIpfs;
  return { objects, ipfs };
}

/** Object keys. Files (originals) are keyed by their content ID; what's prepared from them sits under it. */
export const objectKey = {
  file: (cid: string) => cid,
  /**
   * Retired 2026-09-29: the separate 360p previews (previews play the prepared segments now). Only
   * the storage sweep uses it, to delete the ones made before.
   */
  preview: (cid: string) => `previews/${cid}`,
  /** A prepared item's rendition (playlist and segments), under its content ID (or slate key). Added 2026-09-29. */
  prepared: (key: string, rendition: string) => `prepared/${key}/${rendition}`,
  /** Everything prepared from a file: every rendition and caption track. */
  preparedItem: (key: string) => `prepared/${key}`,
  /** A direct upload's staging key, until it's read and moved to its content ID (added 2026-09-30). */
  upload: (uploadId: string) => `uploads/${uploadId}`,
  /** A spot's proof frame, with the station's bug, kept a year. */
  proof: (stationId: string, airingId: string) => `proof/${stationId}/${airingId}.jpg`
};
