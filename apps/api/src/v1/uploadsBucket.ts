// What the bucket needs for direct uploads (added 2026-09-30, follow-up Phase 4; docs/uploads.md):
//
// - CORS, two rules. Playback: every player reads segments with fetch/XHR (hls.js), from wherever
//   it runs (the web app, TV mode and the Cast receiver on its own origin, the phone apps'
//   capacitor://localhost and https://localhost, local development), so `GET` and `HEAD` are open
//   to any origin; the segments are public anyway. Uploads: browsers PUT parts straight to the
//   bucket from the apps' origins only, and read each part's `ETag` (Uppy completes with them).
// - Lifecycle: multipart uploads nobody finished are aborted after a day (their parts cost storage
//   until then), and anything left at a staging key (`uploads/…`) goes after a week. The jobs tick
//   aborts abandoned uploads too; this is the store's own backstop.
//
// `npm run storage:uploads-bucket -w @opencast/api` prints both; `-- --apply` sends them to the
// bucket in R2_* with PutBucketCors and PutBucketLifecycleConfiguration, where the credentials allow
// (an R2 token with Admin Read & Write can; an Object Read & Write one can't: set them in Cloudflare).

import { GetBucketCorsCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, S3Client, type CORSRule, type LifecycleRule } from "@aws-sdk/client-s3";

/** The apps' origins, from the environment: APP_ORIGIN, BUSINESS_ORIGIN, and any in UPLOAD_CORS_ORIGINS (comma-separated). */
export function uploadOrigins(env: NodeJS.ProcessEnv): string[] {
  const listed = [env.APP_ORIGIN, env.BUSINESS_ORIGIN, ...(env.UPLOAD_CORS_ORIGINS ?? "").split(",")].map((o) => o?.trim().replace(/\/+$/, "")).filter((o): o is string => Boolean(o));
  return [...new Set(listed)];
}

/** The CORS rules, in the S3 API's shape (R2 and Railway buckets take the same). */
export function uploadCorsRules(origins: string[]): CORSRule[] {
  return [
    // Playback, from any origin (a rule for uploads alone once left TV mode on Stand by).
    { AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], MaxAgeSeconds: 86400 },
    {
      AllowedOrigins: origins,
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedHeaders: ["content-type"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600
    }
  ];
}

/** The lifecycle rules: abort unfinished multipart uploads after a day; staging leftovers go after a week. */
export const UPLOAD_LIFECYCLE_RULES: LifecycleRule[] = [
  { ID: "abort-unfinished-multipart-uploads", Status: "Enabled", Filter: { Prefix: "" }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
  { ID: "expire-staged-uploads", Status: "Enabled", Filter: { Prefix: "uploads/" }, Expiration: { Days: 7 } }
];

export interface BucketTarget {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

/** Sends the CORS and lifecycle rules to a bucket. Each is tried on its own; what the store refused is said, not thrown. */
export async function applyUploadBucketRules(target: BucketTarget, origins: string[]): Promise<{ cors: "applied" | string; lifecycle: "applied" | string }> {
  const client = new S3Client({ region: "auto", endpoint: target.endpoint, forcePathStyle: target.forcePathStyle ?? false, credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED" });
  const why = (error: unknown) => `refused (${(error as { name?: string; Code?: string }).name ?? "error"}: ${(error as Error).message}). Set it by hand (docs/uploads.md).`;
  let cors: string = "applied";
  let lifecycle: string = "applied";
  try {
    await client.send(new PutBucketCorsCommand({ Bucket: target.bucket, CORSConfiguration: { CORSRules: uploadCorsRules(origins) } }));
    await client.send(new GetBucketCorsCommand({ Bucket: target.bucket }));
  } catch (error) {
    cors = why(error);
  }
  try {
    await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: target.bucket, LifecycleConfiguration: { Rules: UPLOAD_LIFECYCLE_RULES } }));
  } catch (error) {
    lifecycle = why(error);
  }
  return { cors, lifecycle };
}
