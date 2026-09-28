// Where files live. Every object is keyed by its content ID: a CID (v1, raw codec,
// sha-256), so a file carried by twelve stations is stored once, and any file can be
// published to IPFS later without being renamed. Object storage (R2, or local disk
// in development) is the working store; IPFS through Pinata is only for the Opencast
// catalog and a station's own "Export to IPFS".

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageClass = "standard" | "infrequent";

export interface ObjectStore {
  readonly name: "local" | "r2";
  /** Stores a file. The store checks the bytes against the sha-256 it's given. */
  put(key: string, file: string, options: { contentType: string; storageClass: StorageClass; sha256: Buffer }): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Copies an object to a local file (the worker cache), checking its sha-256 on the way. */
  download(key: string, dest: string, sha256?: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  /** Stores every file in a directory under a prefix (a preview rendition's playlist and segments). */
  putDir(prefix: string, dir: string, storageClass: StorageClass): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /** A URL an app can fetch the object from. */
  url(key: string): Promise<string>;
}

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

export function sha256FromCid(cid: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cid.slice(1)) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
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
  ".pdf": "application/pdf"
};

export const contentTypeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

// --- Local disk (development and tests) ------------------------------------------

export function localObjectStore(root: string, publicBase = "/objects"): ObjectStore {
  const at = (key: string) => path.join(root, ...key.split("/"));
  return {
    name: "local",
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
}

export function s3ObjectStore(config: S3Config): ObjectStore {
  const client = new S3Client({ region: "auto", endpoint: config.endpoint, forcePathStyle: config.forcePathStyle ?? false, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  const Bucket = config.bucket;
  // R2 maps STANDARD_IA to Infrequent Access.
  const cls = (c: StorageClass) => (c === "infrequent" ? "STANDARD_IA" : "STANDARD");
  const store: ObjectStore = {
    name: "r2",
    async put(key, file, { contentType, storageClass, sha256 }) {
      const { size } = await fs.stat(file);
      // The store recomputes the checksum and refuses the write if the bytes differ.
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: contentType, StorageClass: cls(storageClass), ChecksumSHA256: sha256.toString("base64") }));
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
export function storageFromEnv(env: NodeJS.ProcessEnv, storageRoot: string): Storage {
  const endpoint = env.R2_ENDPOINT?.trim() || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : "");
  const r2 = endpoint && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET;
  const objects = r2
    ? s3ObjectStore({ endpoint, accessKeyId: env.R2_ACCESS_KEY_ID!.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(), bucket: env.R2_BUCKET!.trim(), publicBase: env.R2_PUBLIC_BASE?.trim() || undefined, presignSeconds: Number(env.R2_PRESIGN_TTL_SEC) || undefined, forcePathStyle: env.S3_FORCE_PATH_STYLE === "true" })
    : localObjectStore(path.join(storageRoot, "objects"));
  const ipfs = env.PINATA_JWT ? pinataPublisher({ jwt: env.PINATA_JWT, uploadUrl: env.PINATA_UPLOAD_URL || undefined, gatewayBase: env.PINATA_GATEWAY_BASE || undefined }) : noIpfs;
  return { objects, ipfs };
}

/** Object keys. Files are keyed by their content ID; previews sit under the ID they preview. */
export const objectKey = {
  file: (cid: string) => cid,
  preview: (cid: string) => `previews/${cid}`
};
