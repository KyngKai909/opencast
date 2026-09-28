// Tests never talk to real providers: blank their keys before any config loads the repo's .env
// (the loader never overrides a variable that's already set).
for (const key of ["LIVEPEER_API_KEY", "PINATA_JWT", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE", "PRIVY_APP_SECRET"]) {
  process.env[key] = "";
}
