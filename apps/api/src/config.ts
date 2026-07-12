import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");
loadEnvFile(path.join(workspaceRoot, ".env"));

export const API_PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "*";
export const STORAGE_ROOT = resolveStorageRoot(process.env.STORAGE_ROOT);
export const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? "";
export const UPLOAD_ROOT = path.join(STORAGE_ROOT, "uploads");
export const HLS_ROOT = path.join(STORAGE_ROOT, "hls");
export const DB_PATH = path.join(STORAGE_ROOT, "db.json");
export const DB_LOCK_PATH = path.join(STORAGE_ROOT, "db.lock");
export const WEB_DIST_DIR = resolveWebDistDir(process.env.WEB_DIST_DIR);
export const KEEP_ORIGINAL_UPLOADS = String(process.env.KEEP_ORIGINAL_UPLOADS ?? "false") === "true";
export const MAX_COMPRESSION_INPUT_BYTES = parseOptionalPositiveIntEnv(process.env.MAX_COMPRESSION_INPUT_BYTES);
export type UploadStorageMode = "r2" | "hybrid" | "local";
export const UPLOAD_STORAGE_MODE = normalizeUploadStorageMode(process.env.UPLOAD_STORAGE_MODE);
export const DELETE_LOCAL_AFTER_IPFS = String(process.env.DELETE_LOCAL_AFTER_IPFS ?? "true") !== "false";

// Cloudflare R2 (S3-compatible) — the DEFAULT hot path for stream-ready assets.
// Chosen for zero egress fees, which is critical for video cost control.
export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim() ?? "";
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
export const R2_BUCKET = process.env.R2_BUCKET?.trim() ?? "";
// Optional explicit S3 endpoint override; defaults to the account's R2 endpoint.
export const R2_ENDPOINT =
  process.env.R2_ENDPOINT?.trim() ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
// Public base URL used to build playout URLs (custom domain or the bucket's r2.dev URL).
// When empty, R2 objects are served via short-lived presigned GET URLs instead.
export const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE?.trim() ?? "").replace(/\/+$/, "");
export const R2_PRESIGN_TTL_SEC = parsePositiveIntEnv(process.env.R2_PRESIGN_TTL_SEC, 6 * 60 * 60);
// Delete the local stream-ready file once it is safely in R2 (mirrors DELETE_LOCAL_AFTER_IPFS).
export const DELETE_LOCAL_AFTER_R2 = String(process.env.DELETE_LOCAL_AFTER_R2 ?? "true") !== "false";

// IPFS/Pinata is now an OPTIONAL archival/pinning tier — never on the live read path.
// Default off; can be enabled globally here or per-upload via the request body.
export const IPFS_ARCHIVE_DEFAULT = String(process.env.IPFS_ARCHIVE_DEFAULT ?? "false") === "true";

export function isR2Configured(): boolean {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_ENDPOINT);
}

export const LIVEPEER_API_KEY = process.env.LIVEPEER_API_KEY ?? "";
export const LIVEPEER_API_BASE = process.env.LIVEPEER_API_BASE ?? "https://livepeer.studio/api";
export const LIVEPEER_RTMP_INGEST_BASE =
  process.env.LIVEPEER_RTMP_INGEST_BASE ?? "rtmp://rtmp.livepeer.com/live";
export const LIVEPEER_DEFAULT_ENABLED = String(process.env.LIVEPEER_DEFAULT_ENABLED ?? "true") !== "false";

export const PINATA_JWT = process.env.PINATA_JWT ?? "";
export const PINATA_UPLOAD_URL = process.env.PINATA_UPLOAD_URL ?? "https://uploads.pinata.cloud/v3/files";
export const PINATA_GATEWAY_BASE =
  process.env.PINATA_GATEWAY_BASE ?? "https://gateway.pinata.cloud/ipfs";
export const PINATA_NETWORK = process.env.PINATA_NETWORK ?? "public";

export const EXTERNAL_INGEST_DOWNLOAD_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.EXTERNAL_INGEST_DOWNLOAD_TIMEOUT_MS,
  30 * 60 * 1000
);
export const EXTERNAL_INGEST_DOWNLOAD_STALL_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.EXTERNAL_INGEST_DOWNLOAD_STALL_TIMEOUT_MS,
  4 * 60 * 1000
);
export const EXTERNAL_INGEST_EXPAND_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.EXTERNAL_INGEST_EXPAND_TIMEOUT_MS,
  2 * 60 * 1000
);
export const EXTERNAL_INGEST_EXPAND_STALL_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.EXTERNAL_INGEST_EXPAND_STALL_TIMEOUT_MS,
  45 * 1000
);

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    let key = line.slice(0, equalsIndex).trim();
    if (key.startsWith("export ")) {
      key = key.slice("export ".length).trim();
    }
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function resolveStorageRoot(configured: string | undefined): string {
  if (!configured || !configured.trim()) {
    return path.join(workspaceRoot, "storage");
  }

  const value = configured.trim();
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function resolveWebDistDir(configured: string | undefined): string {
  if (!configured || !configured.trim()) {
    return path.join(workspaceRoot, "apps", "web", "dist");
  }

  const value = configured.trim();
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseOptionalPositiveIntEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function normalizeUploadStorageMode(value: string | undefined): UploadStorageMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "r2") {
    return normalized;
  }
  // Legacy "ipfs" mode is deprecated as a *primary* storage mode. IPFS is now
  // archival-only, so fall back to the R2-with-local-fallback hot path.
  if (normalized === "ipfs") {
    return "hybrid";
  }
  return "r2";
}
