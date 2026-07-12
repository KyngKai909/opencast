import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  R2_ACCESS_KEY_ID,
  R2_BUCKET,
  R2_ENDPOINT,
  R2_PRESIGN_TTL_SEC,
  R2_PUBLIC_BASE,
  R2_SECRET_ACCESS_KEY,
  isR2Configured
} from "./config.js";

export interface R2PutResult {
  key: string;
  /**
   * Stable, publicly resolvable playout URL — set only when R2_PUBLIC_BASE is
   * configured. Undefined means the object is safely in R2 but has no stable URL,
   * so callers keep local disk as the playout read path (R2 stays a durable backup).
   */
  url?: string;
}

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured.");
  }
  if (!client) {
    client = new S3Client({
      // R2 ignores region but the SDK requires a value.
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      }
    });
  }
  return client;
}

export { isR2Configured };

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".ts": "video/mp2t",
  ".m3u8": "application/vnd.apple.mpegurl"
};

function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Build a stable public URL for an object, if a public base is configured.
 * Returns undefined when the bucket has no public domain (callers then presign).
 */
export function publicUrlFor(key: string): string | undefined {
  if (!R2_PUBLIC_BASE) {
    return undefined;
  }
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${R2_PUBLIC_BASE}/${encoded}`;
}

/** Generate a fresh presigned GET URL for an object key (used when no public base). */
export async function presignGetUrl(key: string, ttlSec = R2_PRESIGN_TTL_SEC): Promise<string> {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: ttlSec });
}

/**
 * Upload a stream-ready file to R2 and return how the playout path should read it.
 * The returned {@link R2PutResult.url} is always an R2 URL (public or presigned) —
 * never an IPFS gateway — so the live read path stays low-latency and egress-free.
 */
export async function uploadFileToR2(filePath: string, key: string): Promise<R2PutResult> {
  const client = getClient();
  const { size } = await stat(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentTypeFor(filePath)
    })
  );

  // A stable public URL (custom domain or r2.dev) is what the worker stores and
  // reads on the live path. Without one we still keep the object as a durable
  // backup, but playout continues to read from local disk.
  return { key, url: publicUrlFor(key) };
}

/** Deterministic object key for an asset's stream-ready file. */
export function assetObjectKey(scopeId: string, assetId: string, filePath: string): string {
  const ext = path.extname(filePath) || ".bin";
  return `assets/${scopeId}/${assetId}${ext}`;
}
