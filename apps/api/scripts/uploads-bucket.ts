// The bucket's CORS and lifecycle rules for direct uploads (docs/uploads.md).
//
//   npm run storage:uploads-bucket -w @opencast/api                 prints them (the JSON for Cloudflare)
//   npm run storage:uploads-bucket -w @opencast/api -- --apply      sends them to the bucket in R2_*
//
// Origins: APP_ORIGIN, BUSINESS_ORIGIN and UPLOAD_CORS_ORIGINS (comma-separated).

import { applyUploadBucketRules, uploadCorsRules, uploadOrigins, UPLOAD_LIFECYCLE_RULES } from "../src/v1/uploadsBucket.js";

const env = process.env;
const origins = uploadOrigins(env);
if (!origins.length) {
  console.error("Set APP_ORIGIN and BUSINESS_ORIGIN (and UPLOAD_CORS_ORIGINS for any other origin) first.");
  process.exit(1);
}
const cors = uploadCorsRules(origins).map((r) => ({ AllowedOrigins: r.AllowedOrigins, AllowedMethods: r.AllowedMethods, AllowedHeaders: r.AllowedHeaders, ExposeHeaders: r.ExposeHeaders, MaxAgeSeconds: r.MaxAgeSeconds }));
console.log("CORS (S3 API shape; Railway buckets and `aws s3api put-bucket-cors`):");
console.log(JSON.stringify({ CORSRules: cors }, null, 2));
console.log("\nCORS (Cloudflare dashboard shape: R2 > bucket > Settings > CORS Policy):");
console.log(JSON.stringify(cors, null, 2));
console.log("\nLifecycle:");
console.log(JSON.stringify({ Rules: UPLOAD_LIFECYCLE_RULES }, null, 2));

if (process.argv.includes("--apply")) {
  const endpoint = env.R2_ENDPOINT?.trim() || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : "");
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    console.error("\nR2_ENDPOINT (or R2_ACCOUNT_ID), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are needed to apply them.");
    process.exit(1);
  }
  const result = await applyUploadBucketRules({ endpoint, accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(), bucket: env.R2_BUCKET.trim(), forcePathStyle: env.S3_FORCE_PATH_STYLE === "true" }, origins);
  console.log(`\n${env.R2_BUCKET}: CORS ${result.cors}; lifecycle ${result.lifecycle}`);
}
