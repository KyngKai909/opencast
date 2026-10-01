// Opencast on Railway: every service, database, volume and bucket, in one file.
//
//   railway config plan     (see what would change in the linked environment)
//   railway config apply    (change it)
//
// Secrets never live here: variables marked preserve() are set once in Railway (the dashboard or
// `railway variables --set`) and kept. docs/deploy.md lists every variable and who needs it.
import { bucket, defineRailway, github, postgres, preserve, project, redis, ref, service, volume } from "railway/iac";

const REPO = "KyngKai909/untitled-project";

export default defineRailway((ctx) => {
  const production = ctx.isEnvironment("production");
  // Work happens on dev, staging builds the staging branch, and production builds main.
  const source = github(REPO, { branch: production ? "main" : "staging" });
  const shared = ["packages/**", "package.json", "package-lock.json", "turbo.json", "tsconfig.base.json", "nixpacks.toml"];
  const build = (filter: string, watch: string[]) => ({ builder: "NIXPACKS" as const, buildCommand: `npx turbo run build --filter=${filter}...`, watchPatterns: [...watch, ...shared] });
  const restart = { restartPolicyType: "ON_FAILURE" as const, restartPolicyMaxRetries: 10 };
  const secret = () => preserve();

  const Postgres = postgres("Postgres", { region: "us-west2" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const Redis = redis("Redis", { region: "us-west2" });
  Redis.deploy = {
    startCommand: '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"'
  };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const alerts = { usage: { "80": {}, "95": {}, "100": {} } };
  const redisVolume = volume("redis-volume", { alerts, allowOnlineResize: true, region: "us-west2", sizeMB: 5_000 });
  const postgresVolume = volume("postgres-volume", { alerts, allowOnlineResize: true, region: "us-west2", sizeMB: 5_000 });
  // The worker's scratch space: one preparation at a time (a 2-hour 1080p source and its
  // renditions) and the translators. Prepared segments live in the bucket, not here. The volume
  // keeps its old name (it was the file cache) so it's resized, not replaced.
  const scratchGB = production ? 20 : 5;
  const workerCache = volume("worker-cache", { alerts, allowOnlineResize: true, region: "us-west2", sizeMB: scratchGB * 1_000 });
  // Object storage by content ID. Production uses Cloudflare R2 (its keys preserved below);
  // staging uses a Railway bucket, S3-compatible, so it runs without a Cloudflare account.
  const media = production ? null : bucket("media", { region: "sjc" });

  // Where files live, for the API and the worker only.
  // Cloudflare R2 in every environment (staging moved off the Railway bucket on 2026-09-30; `media`
  // stays as a backup until it's no longer wanted). R2_BUCKET: opencast-staging / opencast-production;
  // R2_PUBLIC_BASE: the bucket's r2.dev address on staging, a custom domain in production.
  const storage = { R2_ACCOUNT_ID: secret(), R2_ACCESS_KEY_ID: secret(), R2_SECRET_ACCESS_KEY: secret(), R2_BUCKET: secret(), R2_PUBLIC_BASE: secret() };
  const origin = (name: string) => `https://\${{${name}.RAILWAY_PUBLIC_DOMAIN}}`;
  // The web apps are on Vercel (team Deed3Labs: opencast-web, opencast-business, opencast-site,
  // opencast-tv), on their free vercel.app addresses until a domain is bought. Railway runs only
  // the API, the worker, the relay service, Postgres and Redis. Staging's API allows the Vercel apps and links to
  // opencast-web; production's addresses are set at the cutover, when its domains are decided.
  const vercel = { web: "opencast-web", business: "opencast-business", site: "opencast-site", tv: "opencast-tv" } as const;
  const webOrigin = (name: keyof typeof vercel) => `https://${vercel[name]}.vercel.app`;
  const common = {
    NODE_ENV: "production",
    DATABASE_URL: Postgres.env.DATABASE_URL,
    REDIS_URL: Redis.env.REDIS_URL,
    // Full public addresses for files, receipts and webhooks (the API) and the HLS fallback (the
    // worker serves it), so apps on another host (Vercel) can use them.
    API_PUBLIC_URL: origin("api"),
    HLS_PUBLIC_URL: origin("worker"),
    APP_ORIGIN: production ? secret() : webOrigin("web"),
    // Business invites and business notices' emails link to the business app.
    BUSINESS_ORIGIN: production ? secret() : webOrigin("business"),
    // Email through Resend (invites, notices). Unset key: emails only go to the log. The domain is
    // Open until one is bought; until it's verified in Resend, EMAIL_FROM can be Resend's test sender.
    RESEND_API_KEY: secret(),
    EMAIL_FROM: secret(),
    EMAIL_REPLY_TO: secret(),
    PAYMENTS_PROVIDER: production ? secret() : "fake",
    STRIPE_SECRET_KEY: secret(),
    STRIPE_WEBHOOK_SECRET: secret(),
    STRIPE_PUBLISHABLE_KEY: secret(),
    // Platform connections (follow-up Phase 3, docs/platforms.md): stream keys and tokens are sealed
    // with PLATFORM_SECRETS_KEY (old keys kept for rotation); Google and Twitch sign-in clients.
    PLATFORM_SECRETS_KEY: secret(),
    PLATFORM_SECRETS_OLD_KEYS: secret(),
    GOOGLE_CLIENT_ID: secret(),
    GOOGLE_CLIENT_SECRET: secret(),
    TWITCH_CLIENT_ID: secret(),
    TWITCH_CLIENT_SECRET: secret(),
    // Storage maintenance's "Copy Pinata pins" (desk Settings); unset, that job says Pinata isn't connected.
    PINATA_JWT: secret(),
    PRIVY_APP_ID: secret(),
    PRIVY_VERIFICATION_KEY: secret(),
    PRIVY_APP_SECRET: secret(),
    // Clear as a Privy global wallet (docs/clear-integration.md): Clear's provider app, and what it shares.
    CLEAR_PRIVY_PROVIDER_APP_ID: secret(),
    CLEAR_WALLET_ACCESS: "read_only",
    LIVEPEER_API_KEY: secret(),
    // The escrow contract and creator fund (Base Sepolia on staging, Base in production); unset, claimable earnings stay owed.
    CHAIN_RPC_URL: secret(),
    CHAIN_ID: secret(),
    ESCROW_CONTRACT_ADDRESS: secret(),
    CREATOR_FUND_ADDRESS: secret(),
    USDC_ADDRESS: secret(),
    ...storage
  };

  const api = service("api", {
    source,
    build: build("@opencast/api", ["apps/api/**"]),
    deploy: { startCommand: "npm run start -w @opencast/api", // Staging also runs the seed (markets, ZIPs, Opencast's network stations); safe to repeat.
    preDeployCommand: production ? ["npm run migrate -w @opencast/db"] : ["npm run migrate -w @opencast/db && npm run seed -w @opencast/db"], healthcheckPath: "/health", healthcheckTimeout: 300, ...restart },
    env: {
      ...common,
      PORT: "8080",
      STORAGE_ROOT: "/tmp/opencast",
      // The minute jobs run in the worker, under its leader lock.
      JOBS: "off",
      // Opencast admins by email, comma-separated (set in Railway, never in the repo).
      OPENCAST_ADMIN_EMAILS: secret(),
      // Radio encoders push to the worker's RTMP ingest, through its TCP proxy.
      WORKER_INGEST_SERVER: "rtmp://${{worker.RAILWAY_TCP_PROXY_DOMAIN}}:${{worker.RAILWAY_TCP_PROXY_PORT}}/live",
      WEB_ORIGIN: production ? secret() : (["web", "business", "site", "tv"] as const).map(webOrigin).join(","),
      SERVE_WEB_APP: "false",
      // A237: Opencast's HTTPS relay for external stations' http:// stream links, a Cloudflare Worker
      // (apps/stream-relay, docs/stream-relay.md): its address (`https://opencast-stream-relay.<account>.workers.dev`,
      // kept in Railway since it isn't known here) and the secret the API signs with, the same value as
      // the Worker's. Unset: an http link plays only when it answers over https, else it waits.
      STREAM_RELAY_BASE: secret(),
      STREAM_RELAY_SECRET: secret()
    }
  });

  const worker = service("worker", {
    source,
    build: build("@opencast/worker", ["apps/worker/**", "apps/api/**"]),
    deploy: { startCommand: "npm run start -w @opencast/worker", healthcheckPath: "/health", healthcheckTimeout: 300, numReplicas: 1, ...restart },
    volumeMounts: { "/data": workerCache },
    // Radio live: the leading worker takes encoders' RTMP pushes on 1935 (one replica, so the proxy reaches it).
    tcp: [1935],
    env: {
      ...common,
      PORT: "8080",
      WORKER_INGEST_PORT: "1935",
      STORAGE_ROOT: "/data/storage",
      WORKER_SCRATCH_DIR: "/data/scratch",
      // Items prepared at once; each FFmpeg pass wants about 2 vCPU.
      PREPARE_CONCURRENCY: "1",
      // Unused: the old queue loop is gone from the worker. Remove at the next config apply (docs/deploy.md).
      LEGACY_PLAYOUT: "off",
      // Only the worker sends transactions (the weekly escrow batch, the pool's fund share).
      SETTLEMENT_PRIVATE_KEY: secret()
    }
  });

  // The relay service (follow-up Phase 3, docs/relay.md): each station's relays to other platforms,
  // one push per station to its Livepeer relay stream. Its own Docker image (apps/relay/Dockerfile),
  // configured only by these variables, so it can move to a host with cheap bandwidth by
  // redeploying the same image there. It reads the database and object storage, never writes the
  // channel; one replica (the Redis lease keeps a second one waiting during a redeploy).
  const relay = service("relay", {
    source,
    build: { builder: "DOCKERFILE" as const, dockerfilePath: "apps/relay/Dockerfile", watchPatterns: ["apps/relay/**", "apps/api/**", ...shared] },
    deploy: { healthcheckPath: "/health", healthcheckTimeout: 120, numReplicas: 1, ...restart },
    env: {
      NODE_ENV: "production",
      PORT: "8080",
      DATABASE_URL: Postgres.env.DATABASE_URL,
      REDIS_URL: Redis.env.REDIS_URL,
      LIVEPEER_API_KEY: secret(),
      // Opens the platforms' sealed stream keys (the same key as the API's).
      PLATFORM_SECRETS_KEY: secret(),
      PLATFORM_SECRETS_OLD_KEYS: secret(),
      // One push per station, split by Livepeer; `direct` pushes to each platform (docs/relay.md).
      RELAY_FAN_OUT: "livepeer",
      // The channel playlist base: prepared segments are read there when storage isn't reachable.
      HLS_PUBLIC_URL: origin("worker"),
      // The same bucket as the worker, read directly.
      ...storage
    }
  });

  return project("opencast", {
    environments: ["production", "staging"],
    resources: [Postgres, Redis, redisVolume, postgresVolume, workerCache, ...(media ? [media] : []), api, worker, relay]
  });
});
